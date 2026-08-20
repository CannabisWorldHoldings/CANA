// FLYWHEEL courts — the metabolism must recall, appoint the judge before the
// contest, refuse rumors, never invent wins, obey the blind judge over its own
// local court, grade every prediction against reality, and keep custody.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  FlywheelStore, FlywheelError, runFlywheelCycle, validateSignal, verifyFlywheelFile,
} from './flywheel.mjs';
import { GoodhartGuard } from './goodhart-guard.mjs';
import { verifyLessonFile } from './winner-memory.mjs';
import { verifyForecastFile } from './forecast-ledger.mjs';

const SALT = 'flywheel-court-salt-over-16-chars';
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);

function rig({ metricVerdict = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-court-'));
  const stores = {
    flywheel: path.join(d, 'flywheel', 'flywheel.jsonl'),
    lessons: path.join(d, 'winner-memory', 'lessons.jsonl'),
    forecasts: path.join(d, 'forecasts', 'ledger.jsonl'),
    guard: path.join(d, 'goodhart', 'guard.jsonl'),
  };
  const metricScript = path.join(d, 'metric.mjs');
  fs.writeFileSync(metricScript, `console.log(JSON.stringify({ improved: ${metricVerdict}, evidence: [{ observation: 'stub judge verdict', ref: 'stub' }] }));\n`);
  const metric = { id: 'fw-court-metric', scriptPath: metricScript, salt: SALT, purpose: 'court stub confirmation' };
  const executor = () => ({
    succeeded: true,
    evidence: [{ observation: 'stub battery green', ref: 'stub stdout' }],
    observed_side_effects: 0,
    touched_paths: ['tools/alive-loop'],
    output: { ok: true },
    measurement: { source: 'stub', window: 'single-run', improved: true, value: 'green' },
  });
  const execution = {
    missionId: `fw-court-${path.basename(d)}`, missionVersion: 1,
    objective: 'prove the flywheel admits only blind-confirmed improvements',
    improvement: 'a receipted metabolism instead of unwired organs',
    metricStatement: 'stub battery green under the sealed judge',
    target: 'flywheel-court', allowedPaths: ['tools/alive-loop'],
    capabilities: ['RUN_TESTS'], subjects: ['flywheel'],
    storeDir: path.join(d, 'alive-loop'),
  };
  const signal = {
    id: 'sig-1', kind: 'TEST_GAP', severity: 4,
    observation: 'stubbed real signal with a receipt behind it', ref: 'receipts/detection.json',
  };
  return { d, stores, metric, executor, execution, signal };
}

const run = (r, over = {}) => runFlywheelCycle({
  repo: { root: r.d, head: HEAD, tree: TREE },
  stores: r.stores, metric: r.metric, executor: r.executor, execution: r.execution,
  sense: async () => ({ signals: [r.signal], owner_gated: [] }),
  forecast: { probability: 0.9, horizonMinutes: 60 },
  ...over,
});

test('signals fail closed: malformed, unknown-kind, and unevidenced signals are refused', () => {
  assert.throws(() => validateSignal(null), /SIGNAL_INVALID/);
  assert.throws(() => validateSignal({ id: 's', kind: 'VIBES', severity: 3, observation: 'x', ref: 'y' }), /SIGNAL_INVALID/);
  assert.throws(() => validateSignal({ id: 's', kind: 'TEST_FAIL', severity: 9, observation: 'x', ref: 'y' }), /SIGNAL_INVALID/);
  assert.throws(() => validateSignal({ id: 's', kind: 'TEST_FAIL', severity: 3, observation: 'x', ref: '' }), /SIGNAL_UNEVIDENCED/);
  assert.equal(validateSignal({ id: 's', kind: 'TEST_FAIL', severity: 3, observation: 'x', ref: 'receipt.json' }).id, 's');
});

test('HONESTY FLOOR: a cycle with no verified signal closes STEADY_STATE and claims nothing', async () => {
  const r = rig();
  const result = await run(r, { sense: async () => ({ signals: [], owner_gated: [{ lane: 'OWNER_GATED', note: 'waits for the owner' }] }) });
  assert.equal(result.result, 'STEADY_STATE');
  assert.equal(result.owner_gated, 1, 'gated work is counted, never executed');
  const kinds = new FlywheelStore(r.stores.flywheel).records().map((x) => x.kind);
  assert.ok(kinds.includes('STEADY_STATE'));
  assert.ok(!kinds.includes('FORECASTED'), 'no prediction invented');
  assert.ok(!kinds.includes('CONFIRMED'), 'no confirmation staged');
  assert.equal(fs.existsSync(r.stores.lessons), false, 'no lesson persisted from nothing');
  assert.equal(verifyFlywheelFile(r.stores.flywheel).valid, true);
});

test('FULL METABOLISM: signal → judge-first → forecast → execute → blind confirm → admit → resolve → calibrate', async () => {
  const r = rig();
  const result = await run(r);
  assert.equal(result.result, 'ADMITTED');
  assert.ok(result.lesson_id.startsWith('wm_'));
  assert.equal(result.forecast.outcome, true);
  assert.equal(result.forecast.brier, 0.01, 'p=0.9, outcome true → Brier 0.01');
  assert.equal(result.calibration.resolved, 1);

  const rows = new FlywheelStore(r.stores.flywheel).records();
  const seqOf = (kind) => rows.find((x) => x.kind === kind)?.seq;
  assert.ok(seqOf('JUDGE_APPOINTED') < seqOf('SENSED'), 'the judge is sealed BEFORE sensing');
  assert.ok(seqOf('SENSED') < seqOf('SELECTED'), 'selection follows evidence');
  assert.ok(seqOf('FORECASTED') < seqOf('EXECUTED'), 'the prediction precedes the work');
  assert.ok(seqOf('FORECASTED') < seqOf('CONFIRMED'), 'the chain itself proves prediction-before-outcome');
  assert.ok(seqOf('CONFIRMED') < seqOf('ADMITTED'), 'memory admits only after the blind judge');

  assert.equal(verifyFlywheelFile(r.stores.flywheel).valid, true);
  assert.equal(verifyLessonFile(r.stores.lessons).valid, true);
  assert.equal(verifyForecastFile(r.stores.forecasts).valid, true);
  assert.equal(new GoodhartGuard(r.stores.guard).verifyChain().valid, true);
});

test('BLIND JUDGE VETO: a locally-passing cycle is REJECTED when the sealed judge says not improved — and the Brier hit is taken honestly', async () => {
  const r = rig({ metricVerdict: false });
  const result = await run(r);
  assert.equal(result.result, 'REJECTED');
  assert.equal(result.lesson_id, null);
  assert.equal(fs.existsSync(r.stores.lessons), false, 'the loop cannot feed its own memory past the judge');
  assert.equal(result.forecast.outcome, false);
  assert.equal(result.forecast.brier, 0.81, 'p=0.9 and reality said no — the miss is recorded, not excused');
  const rejected = new FlywheelStore(r.stores.flywheel).records().find((x) => x.kind === 'REJECTED');
  assert.equal(rejected.payload.by, 'BLIND_JUDGE');
  assert.equal(rejected.payload.local_admitted, true, 'the local court passed — and that was not enough');
});

test('JUDGE DRIFT: editing the sealed metric after commitment refuses confirmation and the cycle closes REFUSED_BY_GUARD', async () => {
  const r = rig();
  new GoodhartGuard(r.stores.guard).commitConfirmation({ metricId: r.metric.id, scriptPath: r.metric.scriptPath, salt: SALT, purpose: 'court stub confirmation' });
  fs.appendFileSync(r.metric.scriptPath, '// flattering tweak after candidates existed\n');
  const result = await run(r);
  assert.equal(result.result, 'REFUSED_BY_GUARD');
  assert.equal(result.code, 'JUDGE_DRIFTED');
  assert.equal(result.forecast.resolved, true, 'the prediction still meets reality: outcome false');
  assert.equal(fs.existsSync(r.stores.lessons), false);
});

test('SELECTION CONTAMINATION: a metric consumed for selection cannot confirm', async () => {
  const r = rig();
  const guard = new GoodhartGuard(r.stores.guard);
  guard.commitConfirmation({ metricId: r.metric.id, scriptPath: r.metric.scriptPath, salt: SALT, purpose: 'court stub confirmation' });
  guard.recordSelectionUse({ metricId: r.metric.id, context: 'used to rank candidates' });
  const result = await run(r);
  assert.equal(result.result, 'REFUSED_BY_GUARD');
  assert.equal(result.code, 'SELECTION_CONTAMINATED');
});

test('a contest without a pre-appointed judge is refused outright', async () => {
  const r = rig();
  await assert.rejects(run(r, { metric: null }), /JUDGE_ABSENT/);
});

test('an unevidenced signal refuses the whole cycle — rumors do not drive metabolism', async () => {
  const r = rig();
  await assert.rejects(
    run(r, { sense: async () => ({ signals: [{ id: 'rumor', kind: 'TEST_FAIL', severity: 4, observation: 'someone said so', ref: '' }] }) }),
    /SIGNAL_UNEVIDENCED/,
  );
});

test('custody: flywheel payload-body mutation breaks the chain; appends quarantine', async () => {
  const r = rig();
  await run(r);
  const original = fs.readFileSync(r.stores.flywheel, 'utf8');
  fs.writeFileSync(r.stores.flywheel, original.replace('stubbed real signal', 'a rewritten history'));
  assert.equal(verifyFlywheelFile(r.stores.flywheel).valid, false, 'body mutation is caught — strict from birth');
  assert.throws(() => new FlywheelStore(r.stores.flywheel).append('CYCLE_OPEN', 'fwc_x', {}), /CHAIN_BROKEN/);
  assert.ok(fs.readdirSync(path.dirname(r.stores.flywheel)).some((f) => f.includes('quarantined')));
});
