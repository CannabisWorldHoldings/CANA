import {
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const DEFAULT_GRACE_MS = 5_000;

function processFailure(failureClass, detail = {}) {
  const error = new Error(`${failureClass} ${JSON.stringify(detail)}`);
  error.failureClass = failureClass;
  error.failureDetail = detail;
  return error;
}

function parseStat(pid, stat) {
  const close = stat.lastIndexOf(') ');
  if (close < 0) throw new Error('missing comm terminator');
  const fields = stat.slice(close + 2).trim().split(/\s+/);
  if (fields.length < 20) throw new Error('truncated stat record');
  const parentPid = Number(fields[1]);
  const processGroup = Number(fields[2]);
  const startTime = fields[19];
  if (!Number.isInteger(parentPid) || !Number.isInteger(processGroup) || !/^\d+$/.test(startTime)) {
    throw new Error('malformed stat identity');
  }
  return { pid, state: fields[0], parentPid, processGroup, startTime };
}

function readNullSeparated(file) {
  return readFileSync(file).toString('utf8').split('\0').filter(Boolean);
}

function createLinuxSubreaperCustodian({
  rootPid,
  processController,
  supervisorBoundary,
  waitForSupervisorExit,
  graceMs,
} = {}) {
  if (!processController?.bindSupervisor || typeof waitForSupervisorExit !== 'function') {
    throw processFailure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', {
      REASON: 'SUBREAPER_BOUNDARY_UNAVAILABLE',
    });
  }
  const binding = processController.bindSupervisor({ supervisorBoundary, pid: rootPid });
  if (!['LIVE_EXACT', 'EXITED_EXACT'].includes(binding.status)) {
    throw processFailure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', {
      REASON: 'SUBREAPER_BOUNDARY_REJECTED',
      STATUS: binding.status,
    });
  }
  if (binding.status === 'LIVE_EXACT' && !/^\d+$/.test(binding.startTime ?? '')) {
    throw processFailure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', {
      REASON: 'SUBREAPER_IDENTITY_UNAVAILABLE',
    });
  }
  let closed = false;

  async function cleanup({ requestBrowserClose = async () => false } = {}) {
    if (closed) throw processFailure('CHROMIUM_CUSTODY_CLOSED');
    let browserCloseRequested = false;
    const signalFailures = [];
    const proofErrors = [];
    try {
      browserCloseRequested = await requestBrowserClose();
    } catch (error) {
      signalFailures.push({ target: 'Browser.close', message: error.message });
    }

    let outcome = null;
    if (browserCloseRequested) {
      try {
        outcome = await waitForSupervisorExit(graceMs);
      } catch (error) {
        proofErrors.push({ type: 'SUPERVISOR_EXIT_OBSERVATION_FAILED', phase: 'BROWSER_CLOSE_GRACE', message: error.message });
      }
    }

    if (!outcome?.exited) {
      if (binding.status === 'LIVE_EXACT') {
        const status = processController.status({ pid: rootPid, startTime: binding.startTime });
        if (status.status === 'LIVE_EXACT') {
          const signalled = processController.signal({
            pid: rootPid,
            startTime: binding.startTime,
            signal: 'SIGTERM',
          });
          if (!['SIGNALLED_EXACT', 'EXITED_EXACT', 'IDENTITY_REPLACED'].includes(signalled.status)) {
            signalFailures.push({
              target: 'subreaper-supervisor',
              pid: rootPid,
              signal: 'SIGTERM',
              status: signalled.status,
            });
          }
        } else if (!['EXITED_EXACT', 'IDENTITY_REPLACED'].includes(status.status)) {
          proofErrors.push({
            type: 'SUPERVISOR_STATUS_PROOF_UNAVAILABLE',
            pid: rootPid,
            status: status.status,
          });
        }
      }

      try {
        outcome = await waitForSupervisorExit(graceMs);
      } catch (error) {
        proofErrors.push({ type: 'SUPERVISOR_EXIT_OBSERVATION_FAILED', phase: 'EXACT_SIGNAL_DRAIN', message: error.message });
      }
    }
    if (!outcome?.exited) {
      proofErrors.push({ type: 'SUPERVISOR_DRAIN_INCOMPLETE', pid: rootPid });
    } else if (outcome.code !== 0 || outcome.signal !== null) {
      proofErrors.push({
        type: 'SUPERVISOR_DRAIN_OUTCOME_INVALID',
        pid: rootPid,
        exitCode: outcome.code ?? null,
        signal: outcome.signal ?? null,
      });
    }

    const proofAvailable = proofErrors.length === 0 && signalFailures.length === 0;
    closed = true;
    return {
      proofAvailable,
      proofBasis: 'LINUX_SUBREAPER_EXACT_ZERO_EXIT',
      failureClass: proofAvailable ? null : 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE',
      platform: 'linux',
      browserCloseRequested,
      signalFailures,
      proofErrors,
      initiallyOwnedCount: binding.status === 'LIVE_EXACT' ? 1 : 0,
      beforeKillCount: 0,
      escapedChildDiscovered: false,
      ownedBrowserProcessCountAfter: proofAvailable ? 0 : null,
      residual: [],
    };
  }

  return {
    cleanup,
    enumerateOwnedProcesses() {
      return binding.status === 'LIVE_EXACT'
        ? [{ pid: rootPid, startTime: binding.startTime, reasons: ['LINUX_SUBREAPER_BOUNDARY'] }]
        : [];
    },
    get proofErrors() { return []; },
    stopSampler() {},
  };
}

export function readLinuxProcessSnapshot(procRoot = '/proc', {
  effectiveUid = process.geteuid?.() ?? null,
  ledger = new Map(),
} = {}) {
  const rows = [];
  const errors = [];
  const transientGone = [];
  let names;
  try {
    names = readdirSync(procRoot);
  } catch (error) {
    return { rows, errors: [{ pid: null, field: 'root', code: error.code ?? null }], transientGone, complete: false };
  }
  processEntries: for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    const directory = path.join(procRoot, name);
    let directoryStat;
    try {
      directoryStat = statSync(directory);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') transientGone.push(pid);
      else if (ledger.has(pid)) errors.push({ pid, field: 'directory', code: error.code ?? null });
      continue;
    }
    if (effectiveUid !== null && directoryStat.uid !== effectiveUid && !ledger.has(pid)) continue;
    let identity = null;
    let statError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        identity = parseStat(pid, readFileSync(path.join(directory, 'stat'), 'utf8'));
        statError = null;
        break;
      } catch (error) {
        statError = error;
        if (error.code !== 'ENOENT' && error.code !== 'ESRCH') break;
      }
    }
    if (!identity) {
      if (statError?.code === 'ENOENT' || statError?.code === 'ESRCH') transientGone.push(pid);
      else errors.push({ pid, field: 'stat', code: statError?.code ?? 'MALFORMED' });
      continue;
    }
    let environment;
    let argv;
    try {
      environment = readNullSeparated(path.join(directory, 'environ'));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') {
        try {
          const confirmed = parseStat(pid, readFileSync(path.join(directory, 'stat'), 'utf8'));
          if (confirmed.startTime !== identity.startTime) {
            transientGone.push(pid);
            continue processEntries;
          }
          if (confirmed.state === 'Z' || confirmed.state === 'X') environment = [];
        } catch (confirmationError) {
          if (confirmationError.code === 'ENOENT' || confirmationError.code === 'ESRCH') {
            transientGone.push(pid);
            continue processEntries;
          }
          errors.push({ pid, field: 'stat', code: confirmationError.code ?? 'MALFORMED' });
          continue processEntries;
        }
      }
      if (environment === undefined) {
        errors.push({ pid, field: 'environ', code: error.code ?? null });
        environment = null;
      }
    }
    try {
      argv = readNullSeparated(path.join(directory, 'cmdline'));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') {
        try {
          const confirmed = parseStat(pid, readFileSync(path.join(directory, 'stat'), 'utf8'));
          if (confirmed.startTime !== identity.startTime) {
            transientGone.push(pid);
            continue processEntries;
          }
          if (confirmed.state === 'Z' || confirmed.state === 'X') argv = [];
        } catch (confirmationError) {
          if (confirmationError.code === 'ENOENT' || confirmationError.code === 'ESRCH') {
            transientGone.push(pid);
            continue processEntries;
          }
          errors.push({ pid, field: 'stat', code: confirmationError.code ?? 'MALFORMED' });
          continue processEntries;
        }
      }
      if (argv === undefined) {
        errors.push({ pid, field: 'cmdline', code: error.code ?? null });
        argv = null;
      }
    }
    rows.push({ ...identity, uid: directoryStat.uid, environment, argv });
  }
  return { rows, errors, transientGone, complete: errors.length === 0 };
}

export function createBrowserProcessCustodian({
  rootPid,
  runToken,
  userDataDir,
  processController,
  supervisorBoundary = null,
  waitForSupervisorExit = null,
  platform = process.platform,
  procRoot = '/proc',
  effectiveUid = process.geteuid?.() ?? null,
  snapshot = readLinuxProcessSnapshot,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  sleep = (timeoutMs) => new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  now = Date.now,
  graceMs = DEFAULT_GRACE_MS,
  pollMs = 50,
  samplerMs = 25,
} = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0 || !runToken || !userDataDir) {
    throw new Error('browser custody requires rootPid, runToken, and userDataDir');
  }
  if (platform === 'linux' && (!processController?.signal || !processController?.status)) {
    throw new Error('Linux browser custody requires an exact process controller');
  }
  if (supervisorBoundary !== null) {
    if (platform !== 'linux') {
      throw processFailure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', {
        REASON: 'SUBREAPER_BOUNDARY_REQUIRES_LINUX',
      });
    }
    return createLinuxSubreaperCustodian({
      rootPid,
      processController,
      supervisorBoundary,
      waitForSupervisorExit,
      graceMs,
    });
  }
  const tokenMarker = `CANA_VISUAL_RUN_TOKEN=${runToken}`;
  const userDataMarker = `--user-data-dir=${userDataDir}`;
  const ledger = new Map();
  const proofErrors = [];
  const proofErrorKeys = new Set();
  let sampler = null;
  let closed = false;
  let escapedChildDiscovered = false;

  function rememberProofError(error) {
    const key = JSON.stringify(error);
    if (proofErrorKeys.has(key)) return;
    proofErrorKeys.add(key);
    proofErrors.push(error);
  }

  function takeSnapshot() {
    if (platform !== 'linux') throw processFailure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', { PLATFORM: platform });
    const result = snapshot(procRoot, { effectiveUid, ledger });
    if (!result.complete) rememberProofError({ type: 'INCOMPLETE_PROC_SNAPSHOT', errors: result.errors });
    return result;
  }

  function observe() {
    const result = takeSnapshot();
    const byPid = new Map(result.rows.map((row) => [row.pid, row]));
    const owned = new Map();
    for (const [pid, startTime] of ledger) {
      const row = byPid.get(pid);
      if (row?.startTime === startTime) owned.set(pid, { ...row, reasons: ['KNOWN_PID_START_TIME'] });
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of result.rows) {
        if (owned.has(row.pid)) continue;
        const parent = owned.get(row.parentPid);
        if (!parent) continue;
        owned.set(row.pid, { ...row, reasons: ['OWNED_PARENT_LINEAGE'] });
        ledger.set(row.pid, row.startTime);
        if (row.processGroup !== rootPid) escapedChildDiscovered = true;
        changed = true;
      }
    }
    for (const row of result.rows) {
      if (owned.has(row.pid)) continue;
      const markerMatch = row.environment?.includes(tokenMarker) || row.argv?.includes(userDataMarker);
      if (markerMatch) rememberProofError({ type: 'UNATTRIBUTED_BROWSER_MARKER', pid: row.pid, startTime: row.startTime });
    }
    return { owned: [...owned.values()].sort((left, right) => left.pid - right.pid), snapshot: result };
  }

  if (platform === 'linux') {
    const initial = takeSnapshot();
    const root = initial.rows.find((row) => row.pid === rootPid);
    if (!root) rememberProofError({ type: 'ROOT_IDENTITY_UNAVAILABLE', pid: rootPid });
    else ledger.set(rootPid, root.startTime);
    observe();
    if (samplerMs > 0) {
      sampler = setIntervalFn(() => {
        try { observe(); } catch (error) { rememberProofError({ type: 'SAMPLER_FAILURE', message: error.message }); }
      }, samplerMs);
      sampler?.unref?.();
    }
  }

  function stopSampler() {
    if (sampler === null) return;
    clearIntervalFn(sampler);
    sampler = null;
  }

  async function statuses() {
    const current = [];
    for (const [pid, startTime] of ledger) {
      const result = processController.status({ pid, startTime });
      current.push({ pid, startTime, status: result.status });
      if (!['LIVE_EXACT', 'EXITED_EXACT', 'IDENTITY_REPLACED'].includes(result.status)) {
        rememberProofError({ type: 'STATUS_PROOF_UNAVAILABLE', pid, startTime, status: result.status });
      }
    }
    return current;
  }

  async function waitForExit({ includeRoot = true } = {}) {
    const deadline = now() + graceMs;
    observe();
    let current = await statuses();
    const isRelevantLive = (entry) => entry.status === 'LIVE_EXACT' && (includeRoot || entry.pid !== rootPid);
    while (current.some(isRelevantLive) && now() < deadline) {
      await sleep(Math.min(pollMs, Math.max(1, deadline - now())));
      observe();
      current = await statuses();
    }
    return current;
  }

  async function signalAndWait(signal, { includeRoot, signalFailures }) {
    const attempted = new Set();
    const deadline = now() + graceMs;
    let current = [];
    for (;;) {
      observe();
      current = await statuses();
      const live = current
        .filter((entry) => entry.status === 'LIVE_EXACT' && (includeRoot || entry.pid !== rootPid))
        .sort((left, right) => (left.pid === rootPid) - (right.pid === rootPid) || left.pid - right.pid);
      for (const row of live) {
        const identity = `${row.pid}:${row.startTime}`;
        if (attempted.has(identity)) continue;
        attempted.add(identity);
        const result = processController.signal({ pid: row.pid, startTime: row.startTime, signal });
        if (!['SIGNALLED_EXACT', 'EXITED_EXACT', 'IDENTITY_REPLACED'].includes(result.status)) {
          signalFailures.push({ target: 'process', pid: row.pid, signal, status: result.status });
          rememberProofError({ type: 'SIGNAL_PROOF_UNAVAILABLE', pid: row.pid, status: result.status });
        }
      }
      if (live.length === 0 || now() >= deadline) return current;
      await sleep(Math.min(pollMs, Math.max(1, deadline - now())));
    }
  }

  async function cleanup({ requestBrowserClose = async () => false } = {}) {
    if (closed) throw processFailure('CHROMIUM_CUSTODY_CLOSED');
    let browserCloseRequested = false;
    const signalFailures = [];
    try {
      browserCloseRequested = await requestBrowserClose();
    } catch (error) {
      signalFailures.push({ target: 'Browser.close', message: error.message });
    }
    if (platform !== 'linux') {
      closed = true;
      return {
        proofAvailable: false,
        failureClass: 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE',
        platform,
        browserCloseRequested,
        signalFailures,
        ownedBrowserProcessCountAfter: null,
        residual: [],
      };
    }

    const initiallyOwned = observe().owned;
    stopSampler();
    let current = await signalAndWait('SIGTERM', { includeRoot: false, signalFailures });
    const beforeKillCount = current.filter((entry) => entry.pid !== rootPid && entry.status === 'LIVE_EXACT').length;
    current = await signalAndWait('SIGKILL', { includeRoot: false, signalFailures });
    current = await waitForExit();
    if (current.some((entry) => entry.status === 'LIVE_EXACT')) {
      current = await signalAndWait('SIGTERM', { includeRoot: true, signalFailures });
    }
    if (current.some((entry) => entry.status === 'LIVE_EXACT')) {
      current = await signalAndWait('SIGKILL', { includeRoot: false, signalFailures });
      current = await waitForExit();
    }
    const supervisor = current.find((entry) => entry.pid === rootPid && entry.status === 'LIVE_EXACT');
    if (supervisor) {
      rememberProofError({
        type: 'SUPERVISOR_DRAIN_INCOMPLETE',
        pid: rootPid,
        startTime: supervisor.startTime,
      });
    }
    observe();
    current = await statuses();
    const residual = current.filter((entry) => entry.status === 'LIVE_EXACT');
    const proofAvailable = proofErrors.length === 0 && signalFailures.length === 0;
    closed = true;
    return {
      proofAvailable,
      failureClass: !proofAvailable
        ? 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE'
        : residual.length > 0 ? 'CHROMIUM_CLEANUP_INCOMPLETE' : null,
      platform,
      browserCloseRequested,
      signalFailures,
      proofErrors,
      initiallyOwnedCount: initiallyOwned.length,
      beforeKillCount,
      escapedChildDiscovered,
      ownedBrowserProcessCountAfter: proofAvailable ? residual.length : null,
      residual,
    };
  }

  return {
    cleanup,
    enumerateOwnedProcesses() { return observe().owned; },
    get proofErrors() { return [...proofErrors]; },
    stopSampler,
  };
}

export { parseStat, processFailure };
