#!/usr/bin/env node
// VISUAL COURT v1 — RENDERED harness (screenshots + rendered-law inputs).
// Drives a running build over raw Chrome DevTools Protocol using Node's
// native WebSocket — zero npm dependencies beyond a Chromium binary.
//
// Usage:
//   node tools/visual-court/screenshot-harness.mjs \
//     --base-url http://127.0.0.1:3000 \
//     --chromium /path/to/headless_shell \
//     --out /tmp/cana-visual-court \
//     [--routes /,/dispensaries,/products]
//
// Per route × width (1728,1512,1440,1280,1024,834,768,430,393,375,360)
// × scheme (light via emulated prefers-color-scheme light, dark via dark):
//   - viewport screenshot (PNG) into <out>/<route>/<scheme>/<width>.png
//   - rendered inputs: header height (getBoundingClientRect), body font-size,
//     document overflow, chip text census, <img> src census
// Then the SAME court laws from checks.mjs judge the rendered values and a
// verdict receipt lands at <out>/rendered-verdict.json.
//
// PREREQUISITES (honest): a running `next build && next start` (or dev) of
// apps/web and a Chromium binary. In environments without npm-registry
// access this cannot self-run; execute it wherever the app builds.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkHeaderHeight, checkImageRegistry, checkOverflow, courtVerdict } from './checks.mjs';

const WIDTHS = [1728, 1512, 1440, 1280, 1024, 834, 768, 430, 393, 375, 360];
const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => (arg.startsWith('--') ? [arg.slice(2), all[index + 1]] : null)).filter(Boolean),
);
const BASE = args['base-url'];
const CHROMIUM = args.chromium;
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL_SOURCE_ROOT = realpathSync(SOURCE_ROOT);
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
let OUT = args.out ? path.resolve(args.out) : null;
const ROUTES = (args.routes ?? '/').split(',');
const CDP_COMMAND_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 20_000;
const CHROMIUM_EXIT_TIMEOUT_MS = 5_000;

const MEASURE = `(() => {
  const header = document.querySelector('header');
  const bar = header ? header.querySelector('div') : null;
  const chipTexts = [...document.querySelectorAll('.tint-chip')].map((el) => el.textContent.trim());
  const imgs = [...document.images].map((img) => new URL(img.currentSrc || img.src, location.href).pathname);
  return JSON.stringify({
    headerPx: bar ? Math.round(bar.getBoundingClientRect().height * 10) / 10 : null,
    bodyFontPx: getComputedStyle(document.body).fontSize,
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    chipTexts,
    imgs,
  });
})()`;

const { spawn } = await import('node:child_process');

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathFailure(failureClass, detail) {
  const error = new Error(`${failureClass} ${JSON.stringify(detail)}`);
  error.failureClass = failureClass;
  error.failureDetail = detail;
  return error;
}

function canonicalProspectivePath(candidate) {
  const missing = [];
  let cursor = path.resolve(candidate);
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw pathFailure('VISUAL_PATH_CANONICALIZATION_FAILED', { PATH: candidate });
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(realpathSync(cursor), ...missing);
}

function requireOutsideSource(candidate, sourceRoot, failureClass) {
  if (isInside(candidate, sourceRoot)) {
    throw pathFailure(failureClass, { CANONICAL_PATH: candidate, CANONICAL_SOURCE_ROOT: sourceRoot });
  }
  return candidate;
}

export function resolveChromiumWorkingDirectory(_outputRoot, {
  sourceRoot = CANONICAL_SOURCE_ROOT,
  tempRoot = os.tmpdir(),
  makeTemp = mkdtempSync,
} = {}) {
  const canonicalSource = realpathSync(sourceRoot);
  const canonicalTemp = canonicalProspectivePath(tempRoot);
  requireOutsideSource(canonicalTemp, canonicalSource, 'BROWSER_WORKSPACE_INSIDE_SOURCE');
  const candidate = makeTemp(path.join(canonicalTemp, 'cana-visual-browser-'));
  return requireOutsideSource(realpathSync(candidate), canonicalSource, 'BROWSER_WORKSPACE_INSIDE_SOURCE');
}

export function prepareHarnessDirectories(outputRoot, {
  sourceRoot = CANONICAL_SOURCE_ROOT,
  tempRoot = os.tmpdir(),
  makeTemp = mkdtempSync,
} = {}) {
  const canonicalSource = realpathSync(sourceRoot);
  const requestedOutput = outputRoot
    ? path.resolve(outputRoot)
    : makeTemp(path.join(canonicalProspectivePath(tempRoot), 'cana-visual-court-'));
  const prospectiveOutput = canonicalProspectivePath(requestedOutput);
  requireOutsideSource(prospectiveOutput, canonicalSource, 'VISUAL_OUTPUT_INSIDE_SOURCE');
  mkdirSync(requestedOutput, { recursive: true });
  const output = requireOutsideSource(
    realpathSync(requestedOutput),
    canonicalSource,
    'VISUAL_OUTPUT_INSIDE_SOURCE',
  );
  const browserWorkspace = resolveChromiumWorkingDirectory(output, { sourceRoot: canonicalSource, tempRoot, makeTemp });
  const userDataDir = path.join(browserWorkspace, 'profile');
  const crashDumpsDir = path.join(browserWorkspace, 'crashes');
  mkdirSync(userDataDir);
  mkdirSync(crashDumpsDir);
  return {
    sourceRoot: canonicalSource,
    output,
    browserWorkspace,
    userDataDir: realpathSync(userDataDir),
    crashDumpsDir: realpathSync(crashDumpsDir),
  };
}

export function createTimerRegistry({
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const active = new Set();
  return {
    set(callback, timeoutMs) {
      let timer = null;
      timer = setTimeoutFn(() => {
        active.delete(timer);
        callback();
      }, timeoutMs);
      active.add(timer);
      return timer;
    },
    clear(timer) {
      if (timer === null || timer === undefined) return;
      clearTimeoutFn(timer);
      active.delete(timer);
    },
    clearAll() {
      for (const timer of active) clearTimeoutFn(timer);
      active.clear();
    },
    get activeCount() {
      return active.size;
    },
  };
}

export function createCdpLifecycle({
  sendJson,
  timerRegistry = createTimerRegistry(),
  commandTimeoutMs = CDP_COMMAND_TIMEOUT_MS,
  now = Date.now,
  onTerminalFailure = () => {},
  onEvent = () => {},
} = {}) {
  let messageId = 0;
  const pending = new Map();
  let lastRequest = null;
  let terminalFailure = null;
  let terminalFailureCount = 0;

  function cdpFailure(failureClass, entry = lastRequest, extra = {}) {
    const context = entry?.context ?? lastRequest?.context ?? {};
    const detail = {
      CDP_MESSAGE_ID: entry?.id ?? lastRequest?.id ?? null,
      CDP_METHOD: entry?.method ?? lastRequest?.method ?? null,
      ROUTE: context.route ?? null,
      SCHEME: context.scheme ?? null,
      WIDTH: context.width ?? null,
      FAILURE_CLASS: failureClass,
      ELAPSED_MS: entry ? now() - entry.startedAt : null,
      ...extra,
    };
    const error = new Error(`CANA_RENDERED_CDP_FAILURE ${JSON.stringify(detail)}`);
    error.cdpFailure = detail;
    return error;
  }

  function rejectEntry(entry, canonicalFailure) {
    if (!pending.delete(entry.id)) return false;
    timerRegistry.clear(entry.timer);
    entry.timer = null;
    const cause = canonicalFailure.cdpFailure;
    const failure = cdpFailure(cause.FAILURE_CLASS, entry, { TERMINAL_CAUSE: cause });
    entry.reject(failure);
    return true;
  }

  function failLifecycle(failureClass, extra = {}, causeEntry = lastRequest) {
    if (!terminalFailure) {
      terminalFailure = cdpFailure(failureClass, causeEntry, extra);
      terminalFailureCount += 1;
      try {
        onTerminalFailure(terminalFailure);
      } catch (error) {
        terminalFailure.cdpFailure.HANDLER_ERROR = error.message;
      }
    }
    for (const entry of [...pending.values()]) rejectEntry(entry, terminalFailure);
    return terminalFailure;
  }

  function send(method, params = {}, context = null) {
    const entry = {
      id: ++messageId,
      method,
      context,
      startedAt: now(),
      timer: null,
      resolve: null,
      reject: null,
    };
    lastRequest = entry;
    return new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      if (terminalFailure) {
        reject(cdpFailure(terminalFailure.cdpFailure.FAILURE_CLASS, entry, {
          TERMINAL_CAUSE: terminalFailure.cdpFailure,
        }));
        return;
      }
      pending.set(entry.id, entry);
      entry.timer = timerRegistry.set(() => {
        failLifecycle('CDP_TIMEOUT', {}, entry);
      }, commandTimeoutMs);
      try {
        sendJson(JSON.stringify({ id: entry.id, method, params }));
      } catch (error) {
        failLifecycle('WEBSOCKET_ERROR', { MESSAGE: error.message }, entry);
      }
    });
  }

  function resolveEntry(entry, result) {
    if (!pending.delete(entry.id)) return;
    timerRegistry.clear(entry.timer);
    entry.timer = null;
    entry.resolve(result);
  }

  function handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      failLifecycle('CDP_MALFORMED_MESSAGE', { MESSAGE: error.message });
      return;
    }
    try {
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        if (message.error) {
          failLifecycle('CDP_PROTOCOL_ERROR', { PROTOCOL_ERROR: message.error }, entry);
        } else {
          resolveEntry(entry, message.result);
        }
        return;
      }
      onEvent(message);
    } catch (error) {
      failLifecycle('HARNESS_ASYNC_HANDLER', { MESSAGE: error.message });
    }
  }

  return {
    send,
    handleMessage,
    failLifecycle,
    get pendingCount() { return pending.size; },
    get activeRequestTimerCount() {
      return [...pending.values()].filter((entry) => entry.timer !== null).length;
    },
    get terminalFailure() { return terminalFailure; },
    get terminalFailureCount() { return terminalFailureCount; },
    get lastRequest() { return lastRequest; },
  };
}

function readLinuxProcessTable(procRoot) {
  const rows = [];
  for (const name of readdirSync(procRoot)) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const pid = Number(name);
      const stat = readFileSync(path.join(procRoot, name, 'stat'), 'utf8');
      const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
      const [state, parentPid, processGroup] = fields;
      let environment = [];
      let argv = [];
      try {
        environment = readFileSync(path.join(procRoot, name, 'environ')).toString('utf8').split('\0').filter(Boolean);
      } catch {
        // Process identity remains partially available through stat/lineage.
      }
      try {
        argv = readFileSync(path.join(procRoot, name, 'cmdline')).toString('utf8').split('\0').filter(Boolean);
      } catch {
        // Process identity remains partially available through stat/lineage.
      }
      rows.push({
        pid,
        state,
        parentPid: Number(parentPid),
        processGroup: Number(processGroup),
        startTime: fields[19],
        environment,
        argv,
      });
    } catch {
      // A process may exit, or become unreadable, between /proc reads.
    }
  }
  return rows;
}

export function createBrowserProcessCustodian({
  rootPid,
  rootProcessGroup = rootPid,
  runToken,
  userDataDir,
  platform = process.platform,
  procRoot = '/proc',
  signalProcess = (pid, signal) => process.kill(pid, signal),
  signalProcessGroup = (group, signal) => process.kill(-group, signal),
  sleep = (timeoutMs) => new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  graceMs = CHROMIUM_EXIT_TIMEOUT_MS,
  pollMs = 50,
} = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0 || !runToken || !userDataDir) {
    throw new Error('browser custody requires rootPid, runToken, and userDataDir');
  }
  const tokenMarker = `CANA_VISUAL_RUN_TOKEN=${runToken}`;
  const userDataMarker = `--user-data-dir=${userDataDir}`;
  const knownOwned = new Map();
  const originalProcess = platform === 'linux'
    ? readLinuxProcessTable(procRoot).find((row) => row.pid === rootPid)
    : null;
  const rootStartTime = originalProcess?.startTime ?? null;
  if (rootStartTime) knownOwned.set(rootPid, rootStartTime);

  function enumerateOwnedProcesses() {
    if (platform !== 'linux') {
      throw pathFailure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', { PLATFORM: platform });
    }
    const rows = readLinuxProcessTable(procRoot);
    const owned = new Map();
    for (const row of rows) {
      const knownStart = knownOwned.get(row.pid);
      const reasons = [];
      if (row.pid === rootPid && row.startTime === rootStartTime) reasons.push('ORIGINAL_PID_START_TIME');
      if (rootStartTime && row.processGroup === rootProcessGroup) reasons.push('ORIGINAL_PROCESS_GROUP');
      if (row.environment.includes(tokenMarker)) reasons.push('RUN_TOKEN');
      if (row.argv.includes(userDataMarker)) reasons.push('USER_DATA_DIR');
      if (knownStart && knownStart === row.startTime) reasons.push('KNOWN_PID_START_TIME');
      if (reasons.length > 0) owned.set(row.pid, { ...row, reasons });
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (owned.has(row.pid) || !owned.has(row.parentPid)) continue;
        owned.set(row.pid, { ...row, reasons: ['OWNED_PARENT_LINEAGE'] });
        changed = true;
      }
    }
    for (const row of owned.values()) knownOwned.set(row.pid, row.startTime);
    return [...owned.values()].sort((left, right) => left.pid - right.pid);
  }

  function signalOne(pid, signal, failures) {
    try {
      signalProcess(pid, signal);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      failures.push({ target: 'process', pid, signal, code: error.code ?? null, message: error.message });
      return false;
    }
  }

  function signalGroup(signal, failures) {
    try {
      signalProcessGroup(rootProcessGroup, signal);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      failures.push({ target: 'group', processGroup: rootProcessGroup, signal, code: error.code ?? null, message: error.message });
      return false;
    }
  }

  async function waitForZero() {
    const deadline = Date.now() + graceMs;
    let residual = enumerateOwnedProcesses();
    while (residual.length > 0 && Date.now() < deadline) {
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
      residual = enumerateOwnedProcesses();
    }
    return residual;
  }

  async function cleanup({ requestBrowserClose = async () => false } = {}) {
    const signalFailures = [];
    let browserCloseRequested = false;
    try {
      browserCloseRequested = await requestBrowserClose();
    } catch (error) {
      signalFailures.push({ target: 'Browser.close', message: error.message });
    }

    if (platform !== 'linux') {
      signalGroup('SIGTERM', signalFailures);
      signalOne(rootPid, 'SIGTERM', signalFailures);
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

    const initiallyOwned = enumerateOwnedProcesses();
    const escapedChildDiscovered = initiallyOwned.some((row) => (
      row.pid !== rootPid
      && row.processGroup !== rootProcessGroup
      && (row.reasons.includes('RUN_TOKEN') || row.reasons.includes('USER_DATA_DIR'))
    ));
    if (initiallyOwned.some((row) => row.processGroup === rootProcessGroup)) {
      signalGroup('SIGTERM', signalFailures);
    }
    if (initiallyOwned.some((row) => row.pid === rootPid)) {
      signalOne(rootPid, 'SIGTERM', signalFailures);
    }

    const afterGroupSignal = enumerateOwnedProcesses();
    for (const row of afterGroupSignal) signalOne(row.pid, 'SIGTERM', signalFailures);
    let residual = await waitForZero();
    const beforeKillCount = residual.length;
    for (const row of residual) signalOne(row.pid, 'SIGKILL', signalFailures);
    residual = await waitForZero();

    return {
      proofAvailable: true,
      failureClass: residual.length > 0 ? 'CHROMIUM_CLEANUP_INCOMPLETE' : null,
      platform,
      browserCloseRequested,
      signalFailures,
      initiallyOwnedCount: initiallyOwned.length,
      afterGroupSignalCount: afterGroupSignal.length,
      beforeKillCount,
      escapedChildDiscovered,
      ownedBrowserProcessCountAfter: residual.length,
      residual: residual.map((row) => ({
        pid: row.pid,
        state: row.state,
        parentPid: row.parentPid,
        processGroup: row.processGroup,
        reasons: row.reasons,
      })),
    };
  }

  return { cleanup, enumerateOwnedProcesses };
}

let chrome = null;
let ws = null;
let lifecycle = null;
let timers = null;
let loadWait = null;
let cleanupStarted = false;
let cleanupPromise = null;
let chromiumCwd = null;
let browserCustodian = null;
let browserCleanupReceipt = null;
let browserRunToken = null;
let userDataDir = null;
let crashDumpsDir = null;
let terminalWaiters = new Set();

function delay(timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      timers.clear(timer);
      terminalWaiters.delete(cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = (error) => finish(error);
    terminalWaiters.add(cancel);
    timer = timers.set(() => finish(), timeoutMs);
  });
}

function waitForLoad(context) {
  if (loadWait) loadWait.resolve('replaced');
  return new Promise((resolve) => {
    const timer = timers.set(() => {
      if (loadWait?.timer !== timer) return;
      loadWait = null;
      resolve('timeout');
    }, LOAD_TIMEOUT_MS);
    loadWait = {
      timer,
      resolve(reason) {
        if (loadWait?.timer !== timer) return;
        timers.clear(timer);
        loadWait = null;
        resolve(reason);
      },
      fail(error) {
        if (loadWait?.timer !== timer) return;
        timers.clear(timer);
        loadWait = null;
        resolve({ reason: 'failure', error });
      },
      context,
    };
  });
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupStarted = true;
  cleanupPromise = (async () => {
    try {
      if (lifecycle?.pendingCount > 0) lifecycle.failLifecycle('HARNESS_CLEANUP');
      if (loadWait) loadWait.resolve('cleanup');
      const requestBrowserClose = async () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify({ id: 2_147_483_647, method: 'Browser.close' }));
        return true;
      };
      if (ws) {
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
      }
      if (browserCustodian) {
        try {
          browserCleanupReceipt = await browserCustodian.cleanup({ requestBrowserClose });
        } catch (error) {
          browserCleanupReceipt = {
            proofAvailable: false,
            failureClass: error.failureClass ?? 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE',
            platform: process.platform,
            browserCloseRequested: false,
            signalFailures: [{ target: 'custody-proof', message: error.message }],
            ownedBrowserProcessCountAfter: null,
            residual: [],
          };
        }
        if (browserCleanupReceipt.failureClass) {
          lifecycle.failLifecycle(browserCleanupReceipt.failureClass, {
            PLATFORM: browserCleanupReceipt.platform,
            OWNED_BROWSER_PROCESS_COUNT_AFTER: browserCleanupReceipt.ownedBrowserProcessCountAfter,
            SIGNAL_FAILURES: browserCleanupReceipt.signalFailures,
            RESIDUAL: browserCleanupReceipt.residual,
          });
        }
      }
      if (ws && ws.readyState < 2) {
        try {
          ws.close();
        } catch (error) {
          process.stderr.write(`WEBSOCKET_CLEANUP_FAILED ${error.message}\n`);
        }
      }
    } finally {
      timers?.clearAll();
    }
  })();
  return cleanupPromise;
}

async function runScreenshotHarness() {
  if (!BASE || !CHROMIUM) {
    console.error('REFUSED: --base-url and --chromium are required. This harness needs a running build; see file header.');
    process.exitCode = 2;
    return;
  }

  try {
    const directories = prepareHarnessDirectories(OUT);
    OUT = directories.output;
    chromiumCwd = directories.browserWorkspace;
    userDataDir = directories.userDataDir;
    crashDumpsDir = directories.crashDumpsDir;
  } catch (error) {
    const detail = {
      FAILURE_CLASS: error.failureClass ?? 'VISUAL_PATH_CANONICALIZATION_FAILED',
      ...(error.failureDetail ?? {}),
      MESSAGE: error.message,
    };
    process.stderr.write(`CANA_RENDERED_CDP_FAILURE ${JSON.stringify(detail)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `VISUAL_COURT_OUT=${OUT}\nBROWSER_CWD=${chromiumCwd}\nUSER_DATA_DIR=${userDataDir}\nCRASH_DUMPS_DIR=${crashDumpsDir}\n`,
  );

  chrome = null;
  ws = null;
  loadWait = null;
  cleanupStarted = false;
  cleanupPromise = null;
  browserCustodian = null;
  browserCleanupReceipt = null;
  browserRunToken = randomBytes(32).toString('hex');
  terminalWaiters = new Set();
  timers = createTimerRegistry();
  lifecycle = createCdpLifecycle({
    timerRegistry: timers,
    sendJson(payload) {
      if (!ws) throw new Error('WebSocket is not connected');
      ws.send(payload);
    },
    onTerminalFailure(error) {
      for (const cancel of [...terminalWaiters]) cancel(error);
      if (loadWait) loadWait.fail(error);
    },
    onEvent(message) {
      if (message.method === 'Page.loadEventFired' && loadWait) loadWait.resolve('event');
      if (message.method === 'Inspector.targetCrashed' || message.method === 'Target.targetCrashed') {
        lifecycle.failLifecycle('TARGET_CRASH', { EVENT: message.method, PARAMS: message.params ?? null });
      }
      if (message.method === 'Inspector.detached' || message.method === 'Target.detachedFromTarget') {
        lifecycle.failLifecycle('TARGET_DETACH', { EVENT: message.method, PARAMS: message.params ?? null });
      }
    },
  });
  const { send } = lifecycle;
  let failure = null;
  let failureDetail = null;
  let verdict = null;

try {
  chrome = spawn(CHROMIUM, [
    '--no-sandbox',
    '--disable-gpu',
    '--headless',
    '--hide-scrollbars',
    '--remote-debugging-port=9224',
    `--user-data-dir=${userDataDir}`,
    `--crash-dumps-dir=${crashDumpsDir}`,
    'about:blank',
  ], {
    cwd: chromiumCwd,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    env: { ...process.env, CANA_VISUAL_RUN_TOKEN: browserRunToken },
  });
  chrome.once('error', (error) => {
    if (!cleanupStarted) lifecycle.failLifecycle('CHROMIUM_EXIT', { MESSAGE: error.message });
  });
  chrome.once('exit', (code, signal) => {
    if (!cleanupStarted) lifecycle.failLifecycle('CHROMIUM_EXIT', { EXIT_CODE: code, SIGNAL: signal });
  });
  browserCustodian = createBrowserProcessCustodian({
    rootPid: chrome.pid,
    runToken: browserRunToken,
    userDataDir,
  });
  await delay(3000);
  if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;

  const controller = new AbortController();
  const cancelFetch = () => controller.abort();
  terminalWaiters.add(cancelFetch);
  const fetchTimer = timers.set(() => controller.abort(), CDP_COMMAND_TIMEOUT_MS);
  let targets;
  try {
    targets = await (await fetch('http://127.0.0.1:9224/json/list', { signal: controller.signal })).json();
  } catch (error) {
    throw lifecycle.terminalFailure ?? lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: error.message });
  } finally {
    timers.clear(fetchTimer);
    terminalWaiters.delete(cancelFetch);
  }
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No Chromium page target is available');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      timers.clear(timer);
      terminalWaiters.delete(cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = (error) => finish(error);
    terminalWaiters.add(cancel);
    timer = timers.set(() => {
      finish(lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: 'WebSocket open timed out' }));
    }, CDP_COMMAND_TIMEOUT_MS);
    ws.onopen = () => finish();
    ws.onerror = (event) => {
      finish(lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: String(event?.message ?? 'WebSocket open failed') }));
    };
    ws.onclose = (event) => {
      finish(lifecycle.failLifecycle('WEBSOCKET_CLOSED', { CLOSE_CODE: event.code, REASON: event.reason }));
    };
  });
  ws.onclose = (event) => lifecycle.failLifecycle('WEBSOCKET_CLOSED', { CLOSE_CODE: event.code, REASON: event.reason });
  ws.onerror = (event) => lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: String(event?.message ?? 'unknown WebSocket error') });
  ws.onmessage = (event) => lifecycle.handleMessage(event.data);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Inspector.enable');

  const rendered = { measuredAt: new Date().toISOString(), baseUrl: BASE, routes: {} };
  const overflowing = new Set();
  const headerSamples = [];
  const allImgs = new Set();

  for (const route of ROUTES) {
    rendered.routes[route] = {};
    for (const scheme of ['light', 'dark']) {
      await send(
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: scheme }] },
        { route, scheme, width: null },
      );
      for (const width of WIDTHS) {
        const context = { route, scheme, width };
        await send(
          'Emulation.setDeviceMetricsOverride',
          { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 834 },
          context,
        );
        const loaded = waitForLoad(context);
        await send('Page.navigate', { url: new URL(route, BASE).href }, context);
        const loadOutcome = await loaded;
        if (loadOutcome?.error) throw loadOutcome.error;
        await delay(1200);
        if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;
        const evaluated = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true }, context);
        const values = JSON.parse(evaluated.result.value);
        rendered.routes[route][`${scheme}@${width}`] = values;
        if (values.overflowX) overflowing.add(`${route} ${scheme}@${width}`);
        if (values.headerPx) headerSamples.push(values.headerPx);
        values.imgs.forEach((img) => allImgs.add(img));
        const shot = await send('Page.captureScreenshot', { format: 'png' }, context);
        const dir = path.join(OUT, route.replaceAll('/', '_') || '_home', scheme);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${width}.png`), Buffer.from(shot.data, 'base64'));
        process.stdout.write(`OK ${route} ${scheme}@${width} header=${values.headerPx}\n`);
      }
    }
  }
  if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;

  const { assertRegisteredImage } = await import(path.join(SOURCE_ROOT, 'apps/web/src/lib/asset-registry.mjs'));
  const unregistered = [...allImgs].filter((img) => {
    try { assertRegisteredImage(img); return false; } catch { return true; }
  });

  const checks = [
    checkHeaderHeight({ desktopPx: Math.max(...headerSamples.filter(Boolean)) }),
    checkOverflow({ overflowingWidths: [...overflowing] }),
    checkImageRegistry({ unregistered }),
  ];
  if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;
  verdict = courtVerdict(checks, 'RENDERED');
  writeFileSync(path.join(OUT, 'rendered-verdict.json'), JSON.stringify({ verdict, rendered }, null, 1));
  console.log(JSON.stringify(verdict, null, 2));
} catch (error) {
  failure = error;
  const lastRequest = lifecycle.lastRequest;
  failureDetail = error.cdpFailure ?? {
    CDP_MESSAGE_ID: lastRequest?.id ?? null,
    CDP_METHOD: lastRequest?.method ?? null,
    ROUTE: lastRequest?.context?.route ?? null,
    SCHEME: lastRequest?.context?.scheme ?? null,
    WIDTH: lastRequest?.context?.width ?? null,
    FAILURE_CLASS: 'HARNESS_ERROR',
    ELAPSED_MS: lastRequest ? Date.now() - lastRequest.startedAt : null,
    MESSAGE: error.message,
  };
} finally {
  await cleanup();
}

  if (browserCleanupReceipt) {
    process.stdout.write(
      `OWNED_BROWSER_PROCESS_COUNT_AFTER=${browserCleanupReceipt.ownedBrowserProcessCountAfter ?? 'UNPROVEN'}\n`,
    );
  }
  if (browserCleanupReceipt?.failureClass) {
    const primaryFailure = failureDetail;
    failure = pathFailure(browserCleanupReceipt.failureClass, browserCleanupReceipt);
    failureDetail = {
      FAILURE_CLASS: browserCleanupReceipt.failureClass,
      PLATFORM: browserCleanupReceipt.platform,
      OWNED_BROWSER_PROCESS_COUNT_AFTER: browserCleanupReceipt.ownedBrowserProcessCountAfter,
      SIGNAL_FAILURES: browserCleanupReceipt.signalFailures,
      RESIDUAL: browserCleanupReceipt.residual,
      PRIMARY_FAILURE: primaryFailure,
    };
  }
  failure ??= lifecycle.terminalFailure;
  if (failure) {
    failureDetail ??= failure.cdpFailure ?? { FAILURE_CLASS: 'HARNESS_ERROR', MESSAGE: failure.message };
    const detail = {
      ...failureDetail,
      BROWSER_CWD: chromiumCwd,
      PENDING_COUNT: lifecycle.pendingCount,
      ACTIVE_TIMER_COUNT: timers.activeCount,
      TERMINAL_FAILURE_COUNT: lifecycle.terminalFailureCount,
      BROWSER_CLEANUP: browserCleanupReceipt,
    };
    writeFileSync(path.join(OUT, 'rendered-failure.json'), JSON.stringify(detail, null, 2));
    process.stderr.write(`CANA_RENDERED_CDP_FAILURE ${JSON.stringify(detail)}\n`);
  }
  process.exitCode = failure || verdict?.verdict !== 'PASS' ? 1 : 0;
}

if (IS_MAIN) await runScreenshotHarness();
