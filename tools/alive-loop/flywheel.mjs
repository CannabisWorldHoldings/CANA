#!/usr/bin/env node
// FLYWHEEL — OWD-ALIVE-LOOP v2: the metabolism.
//
// Until now the organs were proven but separate: the loop executed, winner
// memory remembered, the forecast ledger graded, the guard sat unwired, the
// sentinel watched. This module is the composition that makes them ONE
// organism with a heartbeat. Each cycle:
//
//   RECALL      winner memory → labeled facts (the system reasons with its past)
//   APPOINT     blind judge sealed BEFORE sensing/selection (Goodhart law M2)
//   SENSE       custody sweep + verifier probes + overdue forecasts + recorded
//               signals; sentinel drift compiles into the OWNER-GATED lane
//   SELECT      top signal by severity taxonomy — never by the sealed metric
//   FORECAST    a falsifiable prediction about THIS cycle, registered before
//               execution (the chain itself proves prediction preceded outcome)
//   EXECUTE     a governed alive-loop cycle (grants, leases, receipts — v1 spine)
//   CONFIRM     the sealed judge runs blind; drift/contamination refuse
//   ADMIT       lesson persists ONLY when local court AND blind judge both pass
//   RESOLVE     reality grades the forecast; Brier lands in the calibration set
//   CLOSE       hash-chained cycle receipt binding every sub-receipt
//
// HONESTY FLOOR: a cycle with no verified signal closes STEADY_STATE — no
// improvement claimed, no forecast registered, no lesson persisted. The
// machine never invents a win to feed its own memory.
//
// AUTHORITY LAW UNCHANGED: models propose → policy authorizes → narrow
// executors act → evidence proves. The flywheel authors nothing itself; it
// governs what may enter memory. Market-facing moves NEVER execute here —
// they compile into the owner-gated lane and wait.
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { idempotencyKey, runCycle } from './adapter.mjs';
import { LessonStore, lessonsAsFacts } from './winner-memory.mjs';
import { ForecastLedger } from './forecast-ledger.mjs';
import { GoodhartGuard } from './goodhart-guard.mjs';
import { sweep } from './custody-sweep.mjs';
import { makeCandidate, makeChangeEvent } from '../../skills-src/cana-signal-to-fix.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim() !== '';
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));

export class FlywheelError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'FlywheelError'; this.code = code; }
}
const refuse = (code, msg) => { throw new FlywheelError(code, msg); };

/** Signal taxonomy — selection ranks by THIS, never by the sealed metric. */
export const SIGNAL_KINDS = Object.freeze({
  CHAIN_INVALID: 5, VERIFIER_BLIND: 5, TEST_FAIL: 4,
  OVERDUE_FORECAST: 3, COVERAGE_GAP: 3, SENTINEL_DRIFT: 2, TEST_GAP: 4,
});

export function validateSignal(s) {
  if (!s || typeof s !== 'object') refuse('SIGNAL_INVALID', 'a signal must be an object');
  if (!text(s.id)) refuse('SIGNAL_INVALID', 'signal id required');
  if (!text(s.kind) || !(s.kind in SIGNAL_KINDS)) refuse('SIGNAL_INVALID', `signal kind must be one of ${Object.keys(SIGNAL_KINDS).join('|')}`);
  if (!Number.isInteger(s.severity) || s.severity < 1 || s.severity > 5) refuse('SIGNAL_INVALID', 'severity must be an integer 1..5');
  if (!text(s.observation)) refuse('SIGNAL_INVALID', 'a signal must state what was observed');
  if (!text(s.ref)) refuse('SIGNAL_UNEVIDENCED', `signal ${s.id} carries no evidence ref — an unevidenced signal is a rumor, and rumors do not drive cycles`);
  return Object.freeze({ ...s });
}

/** The flywheel's own custody: strict from birth (payload digests recomputed). */
export class FlywheelStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  static rowHash(r) {
    return sha(canonical({ seq: r.seq, at: r.at, kind: r.kind, cycle_id: r.cycle_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }));
  }

  verifyChain() {
    let prev = 'GENESIS';
    for (const r of this.records()) {
      if (r.prev_hash !== prev || r.hash !== FlywheelStore.rowHash(r)
        || sha(canonical(r.payload ?? null)) !== r.payload_digest) return { valid: false, at_seq: r.seq };
      prev = r.hash;
    }
    return { valid: true, count: this.records().length };
  }

  append(kind, cycleId, payload) {
    const verdict = this.verifyChain();
    if (!verdict.valid) {
      const q = `${this.filePath}.quarantined.${Date.now()}`;
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, q);
      refuse('CHAIN_BROKEN', `flywheel ledger fails verification at seq ${verdict.at_seq}; quarantined to ${q}`);
    }
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const row = { seq: records.length, at: new Date().toISOString(), kind, cycle_id: cycleId, payload_digest: sha(canonical(payload ?? null)), prev_hash: prev };
    row.hash = FlywheelStore.rowHash(row);
    fs.appendFileSync(this.filePath, `${JSON.stringify({ ...row, payload })}\n`);
    return row;
  }
}

/** Standalone strict verifier — node builtins only, rollback-safe. */
export function verifyFlywheelFile(filePath) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
  let prev = 'GENESIS';
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    const expect = createHash('sha256').update(JSON.stringify(sortKeys({ seq: r.seq, at: r.at, kind: r.kind, cycle_id: r.cycle_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }))).digest('hex');
    const bodyDigest = createHash('sha256').update(JSON.stringify(sortKeys(r.payload ?? null))).digest('hex');
    if (r.prev_hash !== prev || r.hash !== expect || bodyDigest !== r.payload_digest) return { valid: false, at: i };
    prev = r.hash;
  }
  return { valid: true, count: lines.length };
}

/** Register the flywheel with the custody sweep — no import cycle needed. */
export const flywheelFamily = () => ({
  id: 'flywheel', dir: 'flywheel', match: (f) => f.endsWith('.jsonl'), verify: verifyFlywheelFile,
  probe: () => {
    const os = { tmpdir: () => process.env.TMPDIR || '/tmp' };
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-probe-'));
    const file = path.join(d, 'flywheel.jsonl');
    new FlywheelStore(file).append('CYCLE_OPEN', 'fwc_probe', { note: 'PROBE_MARKER_ALPHA' });
    return { file, verify: verifyFlywheelFile };
  },
});

/** Default blind runner: spawn the sealed metric, parse its verdict. Fail-closed. */
export const spawnMetricRunner = ({ scriptPath }) => {
  const proc = spawnSync('node', [scriptPath], { encoding: 'utf8', timeout: 600000 });
  try {
    const lastLine = proc.stdout.trim().split('\n').pop();
    const parsed = JSON.parse(lastLine);
    if (typeof parsed.improved !== 'boolean') throw new Error('no boolean verdict');
    return parsed;
  } catch {
    return { improved: false, evidence: [{ observation: `sealed metric emitted no parseable verdict (exit ${proc.status})`, ref: scriptPath }] };
  }
};

/**
 * Run ONE metabolic cycle. Everything is injected so courts can try to break
 * it; the CLI wires the real organs.
 */
export async function runFlywheelCycle({
  repo,               // { root, head, tree }
  stores,             // { flywheel, lessons, forecasts, guard } — file paths
  sense,              // async () => ({ signals: [], owner_gated: [], health? })
  metric,             // { id, scriptPath, salt, purpose } | null
  confirmRunner = spawnMetricRunner,
  executor,           // bounded fixture for the governed cycle (required for a contest)
  execution,          // { missionId, missionVersion, objective, improvement, metricStatement, target, allowedPaths, capabilities, subjects, storeDir }
  forecast = { probability: 0.8, horizonMinutes: 60 },
  now = new Date(),
}) {
  const store = new FlywheelStore(stores.flywheel);
  const cycleId = `fwc_${store.records().filter((r) => r.kind === 'CYCLE_OPEN').length + 1}`;
  store.append('CYCLE_OPEN', cycleId, { head: repo.head, mission: execution?.missionId ?? 'sense-only' });

  // RECALL — the system starts from its measured past, never a blank slate.
  const lessonStore = new LessonStore(stores.lessons);
  const prior = lessonStore.recall({ limit: 25 });
  const recalledFacts = lessonsAsFacts(prior, { now });
  store.append('RECALLED', cycleId, { lessons: prior.length });

  // APPOINT — the judge is sealed BEFORE sensing and selection (Goodhart law).
  const guard = new GoodhartGuard(stores.guard);
  if (metric) {
    const already = guard.records().some((r) => r.kind === 'COMMITTED' && r.metric_id === metric.id);
    if (!already) guard.commitConfirmation({ metricId: metric.id, scriptPath: metric.scriptPath, salt: metric.salt, purpose: metric.purpose });
    store.append('JUDGE_APPOINTED', cycleId, { metric_id: metric.id, newly_sealed: !already, sealed_before_selection: true });
  }

  // SENSE — verified signals only; market-facing findings land owner-gated.
  const sensed = await sense();
  const signals = (sensed.signals ?? []).map(validateSignal);
  const ownerGated = sensed.owner_gated ?? [];
  store.append('SENSED', cycleId, { signals, owner_gated: ownerGated, health: sensed.health ?? null });

  // HONESTY FLOOR — nothing real to improve means saying exactly that.
  if (signals.length === 0) {
    store.append('STEADY_STATE', cycleId, {
      note: 'no verified signal — no improvement claimed, no forecast registered, no lesson persisted',
      owner_gated_pending: ownerGated.length,
    });
    store.append('CYCLE_CLOSED', cycleId, { result: 'STEADY_STATE' });
    return { result: 'STEADY_STATE', cycle_id: cycleId, owner_gated: ownerGated.length, chain: store.verifyChain() };
  }

  // SELECT — taxonomy rank only. The sealed metric is never consulted here;
  // consulting it would be SELECTION_USE and would disqualify it as judge.
  if (!metric) refuse('JUDGE_ABSENT', 'an improvement contest without a pre-appointed blind judge is refused — that is the exact trap this module exists to close');
  if (!executor || !execution) refuse('EXECUTOR_ABSENT', 'a contest requires a bounded executor and execution contract');
  const top = [...signals].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id))[0];
  const event = makeChangeEvent({
    source: 'flywheel-sensor', surface: execution.target, kind: 'STRUCTURAL',
    observedAt: now.toISOString(), observation: top.observation, evidenceRef: top.ref, confidence: 1,
  });
  const candidate = makeCandidate({
    event,
    brittlePoint: top.observation,
    hypothesis: execution.objective,
    improvement: execution.improvement,
    falsificationTest: `blind confirmation under sealed metric ${metric.id} returns improved:false, or the governed cycle rejects`,
    rollback: 'git revert of the improvement; every ledger retains the full evidence chain',
    outcomeMetric: execution.metricStatement,
    plane: 'LOCAL_VERIFICATION',
  });
  if (!candidate.valid) refuse('CANDIDATE_INVALID', candidate.errors.join('; '));
  store.append('SELECTED', cycleId, { signal_id: top.id, signal_kind: top.kind, candidate_id: candidate.candidate_id });

  // FORECAST — registered BEFORE execution/confirmation; chain order proves it.
  const ledger = new ForecastLedger(stores.forecasts);
  const reg = ledger.register({
    target: `flywheel ${cycleId}`, scope: execution.target,
    statement: `${cycleId}: candidate ${candidate.candidate_id} is admitted by the governed cycle AND blind-confirmed improved under sealed metric ${metric.id}`,
    probability: forecast.probability, horizon: 'nowcast',
    resolves_by: new Date(now.getTime() + (forecast.horizonMinutes ?? 60) * 60000).toISOString(),
    resolution_method: 'goodhart-guard CONFIRMED row + alive-loop cycle final state, both hash-chained',
    input_snapshot: { signal: top, candidate_id: candidate.candidate_id, head: repo.head },
    model: 'flywheel-orchestrator/1', non_business: true,
  }, { now });
  store.append('FORECASTED', cycleId, { forecast_id: reg.forecast_id, probability: forecast.probability });

  // EXECUTE — the v1 governed spine, unchanged: grant, lease, court, receipt.
  const grant = {
    mission_id: execution.missionId, mission_version: execution.missionVersion ?? 1,
    issued_at: now.toISOString(), expires_at: new Date(now.getTime() + 30 * 60000).toISOString(),
    cana_commit: repo.head, cana_tree: repo.tree,
    target: execution.target, allowed_paths: execution.allowedPaths,
    objective: execution.objective, metric: execution.metricStatement,
    max_attempts: 1, max_runtime_ms: 600000, max_bytes: 8388608, max_cost: 0,
    capabilities: execution.capabilities ?? ['RUN_TESTS'],
    evidence_requirements: ['execution receipt', 'measured verdict'],
    policy_version: 'cana-authority/1', schema_version: 'cana-alive-loop/1', provider_route: 'none',
  };
  grant.idempotency_key = idempotencyKey(grant);
  const headFact = {
    id: `fact-head-${repo.head.slice(0, 12)}`,
    claim: `candidate tree pinned at ${repo.head.slice(0, 12)} for ${execution.target}: ${execution.metricStatement}`,
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT', truth_status: 'VERIFIED',
    source: 'git rev-parse HEAD (local clone)', observed_at: now.toISOString().slice(0, 10),
    valid_for_days: 1, tags: [execution.target, 'verification', 'pinned', 'tree', ...(execution.subjects ?? [])],
  };
  const exec = await runCycle({
    grant, facts: [headFact, ...recalledFacts], fixture: executor,
    storeDir: execution.storeDir, now, repoHead: repo.head, repoTree: repo.tree,
    intentSubjects: execution.subjects,
  });
  store.append('EXECUTED', cycleId, {
    final_state: exec.final_state, admitted: exec.admitted === true,
    cycle_store: exec.store_path, chain: exec.chain ?? null,
  });

  // CONFIRM — blind. Refusals are receipted verdicts, not crashes.
  let confirmation = null;
  try {
    confirmation = guard.confirm({ metricId: metric.id, salt: metric.salt, runner: confirmRunner });
    store.append('CONFIRMED', cycleId, { improved: confirmation.improved });
  } catch (err) {
    if (err?.name !== 'GoodhartError') throw err;
    store.append('CONFIRM_REFUSED', cycleId, { code: err.code, message: err.message });
    const res = ledger.resolve(reg.forecast_id, {
      outcome: false,
      evidence: [{ observation: `blind confirmation REFUSED: ${err.code}`, ref: stores.guard }],
      now: new Date(),
    });
    store.append('RESOLVED', cycleId, { forecast_id: reg.forecast_id, outcome: false, brier: res.brier_score });
    store.append('CYCLE_CLOSED', cycleId, { result: 'REFUSED_BY_GUARD', code: err.code });
    return { result: 'REFUSED_BY_GUARD', code: err.code, cycle_id: cycleId, forecast: res, chain: store.verifyChain() };
  }

  // ADMIT — both eyes must agree: the local court AND the blind judge.
  const admitted = exec.admitted === true && confirmation.improved === true;
  let persisted = null;
  if (admitted) {
    persisted = lessonStore.persist(exec.lesson);
    store.append('ADMITTED', cycleId, { lesson_id: exec.lesson.lesson_id, persisted });
  } else {
    store.append('REJECTED', cycleId, {
      by: confirmation.improved ? 'LOCAL_COURT' : 'BLIND_JUDGE',
      local_admitted: exec.admitted === true, blind_improved: confirmation.improved,
      note: 'no lesson persists — memory admits only what both eyes verified',
    });
  }

  // RESOLVE + CALIBRATE — reality grades the prediction, publicly.
  const res = ledger.resolve(reg.forecast_id, {
    outcome: admitted,
    evidence: [
      { observation: `governed cycle final ${exec.final_state}, admitted=${exec.admitted === true}`, ref: exec.store_path },
      { observation: `blind confirmation improved=${confirmation.improved} under sealed metric ${metric.id}`, ref: stores.guard },
    ],
    now: new Date(),
  });
  store.append('RESOLVED', cycleId, { forecast_id: reg.forecast_id, outcome: admitted, brier: res.brier_score });
  const cal = ledger.calibration();
  store.append('CALIBRATED', cycleId, cal);
  store.append('CYCLE_CLOSED', cycleId, { result: admitted ? 'ADMITTED' : 'REJECTED' });

  return {
    result: admitted ? 'ADMITTED' : 'REJECTED', cycle_id: cycleId,
    lesson_id: admitted ? exec.lesson.lesson_id : null, persisted,
    forecast: { id: reg.forecast_id, outcome: admitted, brier: res.brier_score },
    calibration: cal, owner_gated: ownerGated.length, chain: store.verifyChain(),
  };
}

// ---------------------------------------------------------------------------
// CLI — the live metabolism. node tools/alive-loop/flywheel.mjs [--signal-file=path]
// ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { execFileSync } = await import('node:child_process');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const LOCAL = path.join(ROOT, '.cana-local');
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  const HEAD = git('rev-parse', 'HEAD');
  const TREE = git('rev-parse', 'HEAD^{tree}');
  const signalFileArg = process.argv.find((a) => a.startsWith('--signal-file='));

  const liveSense = async () => {
    const verdict = sweep({ localDir: LOCAL, extraFamilies: [flywheelFamily()] });
    const signals = [];
    for (const l of verdict.ledgers.filter((x) => !x.valid)) {
      signals.push({ id: `chain-${l.path}`, kind: 'CHAIN_INVALID', severity: 5, observation: `ledger ${l.path} fails strict verification`, ref: path.join('.cana-local', l.path) });
    }
    for (const p of verdict.probes.filter((x) => x.verdict !== 'STRICT')) {
      signals.push({ id: `blind-${p.family}`, kind: 'VERIFIER_BLIND', severity: 5, observation: `verifier for ${p.family} accepts payload-body mutation`, ref: 'tools/alive-loop/custody-sweep.mjs probe' });
    }
    for (const u of verdict.unregistered) {
      signals.push({ id: `cover-${u}`, kind: 'COVERAGE_GAP', severity: 3, observation: `chained file ${u} is registered with no custody family`, ref: path.join('.cana-local', u) });
    }
    const forecastLedger = new ForecastLedger(path.join(LOCAL, 'forecasts', 'ledger.jsonl'));
    for (const p of forecastLedger.pending().filter((x) => x.overdue)) {
      signals.push({ id: `overdue-${p.forecast_id}`, kind: 'OVERDUE_FORECAST', severity: 3, observation: `forecast ${p.forecast_id} passed resolves_by without resolution — reality must grade it`, ref: '.cana-local/forecasts/ledger.jsonl' });
    }
    // Recorded signals (e.g. a pre-fix detection receipt) ride in explicitly.
    if (signalFileArg) {
      const recorded = JSON.parse(fs.readFileSync(path.resolve(signalFileArg.slice(14)), 'utf8'));
      for (const s of recorded) signals.push(s);
    }
    // Sentinel drift → OWNER-GATED lane (never auto-executed here).
    let ownerGated = [];
    try {
      const sentinelDir = path.join(LOCAL, 'sentinel');
      const latest = fs.existsSync(sentinelDir) ? fs.readdirSync(sentinelDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop() : null;
      if (latest) {
        const report = JSON.parse(fs.readFileSync(path.join(sentinelDir, latest), 'utf8'));
        const deltas = report?.deltas ?? report?.diff?.deltas ?? [];
        if (deltas.length > 0) {
          const { compileSentinelProposals } = await import('../sentinel/bridge.mjs');
          const compiled = compileSentinelProposals(deltas, { observedAt: new Date().toISOString(), reportRef: `.cana-local/sentinel/${latest}` });
          ownerGated = compiled.proposals.map((p) => ({ lane: 'OWNER_GATED', kind: 'SENTINEL_DRIFT', proposal: p }));
        }
      }
    } catch { /* sentinel lane stays empty rather than fabricated */ }
    return { signals, owner_gated: ownerGated, health: { ledgers: verdict.ledgers.length, strict: verdict.strict } };
  };

  const batteryExecutor = () => {
    const web = spawnSync('node', ['--test',
      'tests/entity-genome.test.mjs', 'tests/market-graph-projection.test.mjs', 'tests/market-page-compiler.test.mjs',
      'tests/service-area.test.mjs', 'tests/discovery-command.test.mjs', 'tests/discovery-resolution.test.mjs',
      'tests/merchant-media-intake.test.mjs', 'tests/customer-world.test.mjs',
    ], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8', timeout: 300000 });
    const webFails = Number((web.stdout.match(/ℹ fail (\d+)/) ?? [])[1] ?? 'NaN');
    const webPasses = Number((web.stdout.match(/ℹ pass (\d+)/) ?? [])[1] ?? 'NaN');
    const ok = web.status === 0 && webFails === 0 && webPasses > 0;
    return {
      succeeded: ok,
      failureReason: ok ? undefined : `web suites exit ${web.status}, fails=${webFails}`,
      evidence: ok ? [{ observation: `${webPasses} assertions pass, 0 fail across 8 web suites at the post-fix tree`, ref: 'node --test stdout (flywheel executor)' }] : [],
      observed_side_effects: 0,
      touched_paths: ['apps/web/tests'],
      output: { web: { passes: webPasses, fails: webFails, exit: web.status } },
      measurement: { source: 'node --test (web pure suites)', window: 'single-run', improved: ok, value: `${webPasses}/0` },
    };
  };

  const salt = fs.readFileSync(path.join(LOCAL, 'goodhart', 'salt.fw-metabolism-v1'), 'utf8').trim();
  const result = await runFlywheelCycle({
    repo: { root: ROOT, head: HEAD, tree: TREE },
    stores: {
      flywheel: path.join(LOCAL, 'flywheel', 'flywheel.jsonl'),
      lessons: path.join(LOCAL, 'winner-memory', 'lessons.jsonl'),
      forecasts: path.join(LOCAL, 'forecasts', 'ledger.jsonl'),
      guard: path.join(LOCAL, 'goodhart', 'guard.jsonl'),
    },
    sense: liveSense,
    metric: {
      id: 'fw-metabolism-v1',
      scriptPath: path.join(ROOT, 'tools', 'alive-loop', 'confirm-metric.mjs'),
      salt,
      purpose: 'confirm that strict custody holds across every live ledger (payload digests recomputed by an independent inline auditor), that every registered chain verifier refuses payload-body mutation, and that the full tools court battery passes at the current tree',
    },
    executor: batteryExecutor,
    execution: {
      missionId: process.argv.includes('--mission-id')
        ? process.argv[process.argv.indexOf('--mission-id') + 1]
        : `flywheel-${new Date().toISOString().slice(0, 10)}`,
      missionVersion: 1,
      objective: 'metabolize the highest-severity verified signal into a blind-confirmed, receipted improvement',
      improvement: 'the organism holds a judge-confirmed answer instead of an assumption',
      metricStatement: 'sealed metric fw-metabolism-v1 returns improved:true AND the governed cycle admits',
      target: 'flywheel-metabolism',
      allowedPaths: ['tools', 'apps/web/tests', '.cana-local'],
      capabilities: ['RUN_TESTS'],
      subjects: ['flywheel metabolism'],
      storeDir: path.join(LOCAL, 'alive-loop'),
    },
    forecast: { probability: 0.9, horizonMinutes: 120 },
  });
  console.log(JSON.stringify({ pinned: HEAD.slice(0, 12), ...result }, null, 2));
  process.exit(['ADMITTED', 'STEADY_STATE'].includes(result.result) ? 0 : 1);
}
