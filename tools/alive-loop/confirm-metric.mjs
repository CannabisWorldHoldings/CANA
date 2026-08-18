#!/usr/bin/env node
// SEALED CONFIRMATION METRIC — the held-out blind judge for flywheel cycles.
//
// This script is COMMITTED to the Goodhart guard (salted content hash) BEFORE
// improvement candidates are authored or selected. After sealing, any edit to
// these bytes is JUDGE_DRIFTED and confirmation refuses. It is deliberately
// SELF-CONTAINED: strict chain verification below is implemented inline with
// node builtins — it shares no verification code with the modules it judges,
// so a bug (or a bribe) in the system's own verifiers cannot blind the judge.
// The only system imports are WRITER classes + verifier exports used as
// SUBJECTS of the blindness probes — importing the accused to cross-examine
// it, never to borrow its judgment. The tools court battery is the third arm:
// every listed suite MUST exist and pass — a deleted court is a failure, not
// an exemption.
//
// Verdict contract (stdout, single JSON object):
//   { improved: boolean, evidence: [{ observation, ref }] }
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = path.join(ROOT, '.cana-local');

const sha = (v) => createHash('sha256').update(v).digest('hex');
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));

// ---- ARM 1: independent strict chain audit (inline; schemas frozen here) ----
// family: rowFields hashed into row.hash; bodyKey recomputed against digestKey.
const FAMILIES = [
  { id: 'alive-loop-cycles', dir: 'alive-loop', match: (f) => /^cycle\..+\.jsonl$/.test(f), rowFields: ['seq', 'at', 'state', 'mission_id', 'idem_key', 'payload_digest', 'prev_hash'], bodyKey: 'payload', digestKey: 'payload_digest' },
  { id: 'winner-memory', dir: 'winner-memory', match: (f) => f === 'lessons.jsonl', rowFields: ['seq', 'at', 'lesson_id', 'lesson_digest', 'prev_hash'], bodyKey: 'lesson', digestKey: 'lesson_digest' },
  { id: 'forecasts', dir: 'forecasts', match: (f) => f === 'ledger.jsonl', rowFields: ['seq', 'at', 'kind', 'forecast_id', 'payload_digest', 'prev_hash'], bodyKey: 'payload', digestKey: 'payload_digest' },
  { id: 'goodhart-guard', dir: 'goodhart', match: (f) => f === 'guard.jsonl', rowFields: ['seq', 'at', 'kind', 'metric_id', 'payload_digest', 'prev_hash'], bodyKey: 'payload', digestKey: 'payload_digest' },
  { id: 'flywheel', dir: 'flywheel', match: (f) => f.endsWith('.jsonl'), rowFields: ['seq', 'at', 'kind', 'cycle_id', 'payload_digest', 'prev_hash'], bodyKey: 'payload', digestKey: 'payload_digest' },
];

function auditFile(file, fam) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
  let prev = 'GENESIS';
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    const rowBody = Object.fromEntries(fam.rowFields.map((k) => [k, r[k]]));
    if (r.prev_hash !== prev) return { valid: false, at: i, why: 'chain link broken' };
    if (r.hash !== sha(canonical(rowBody))) return { valid: false, at: i, why: 'row hash mismatch' };
    if (sha(canonical(r[fam.bodyKey] ?? null)) !== r[fam.digestKey]) return { valid: false, at: i, why: 'BODY DIGEST MISMATCH — payload was rewritten' };
    prev = r.hash;
  }
  return { valid: true, rows: lines.length };
}

function auditAllLedgers() {
  const findings = [];
  for (const fam of FAMILIES) {
    const dir = path.join(LOCAL, fam.dir);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fam.match(f) && !f.includes('.quarantined')) : [];
    for (const f of files) {
      const verdict = auditFile(path.join(dir, f), fam);
      findings.push({ family: fam.id, file: f, ...verdict });
    }
  }
  return findings;
}

// ---- ARM 2: blindness probes against the system's own verifiers ----
const MARK_A = 'JUDGE_PROBE_ALPHA';
const MARK_B = 'JUDGE_PROBE_BRAVO';
async function probeVerifiers() {
  const { CycleStore, verifyChainFile } = await import('./adapter.mjs');
  const { LessonStore, verifyLessonFile } = await import('./winner-memory.mjs');
  const { ForecastLedger, verifyForecastFile } = await import('./forecast-ledger.mjs');
  const { GoodhartGuard, verifyGuardFile } = await import('./goodhart-guard.mjs');
  const cases = [
    ['alive-loop-cycles', () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cy-'));
      const file = path.join(d, 'cycle.judge.jsonl');
      new CycleStore(file).append({ state: 'GRANTED', missionId: 'judge', idemKey: 'judge-key', payload: { note: MARK_A } });
      return { file, verify: verifyChainFile };
    }],
    ['winner-memory', () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-wm-'));
      const file = path.join(d, 'lessons.jsonl');
      new LessonStore(file).persist({ stored: true, lesson_id: 'wm_judgeprobe00', plane: 'LOCAL_VERIFICATION', brittle_point: MARK_A, improvement: 'probe', outcome_metric: 'probe', measured: { improved: true, source: 'probe', non_business: true }, learned_at: new Date().toISOString() });
      return { file, verify: verifyLessonFile };
    }],
    ['forecasts', () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-fc-'));
      const file = path.join(d, 'ledger.jsonl');
      new ForecastLedger(file).register({ target: 'probe', scope: 'probe', statement: `probe ${MARK_A}`, probability: 0.5, horizon: 'nowcast', resolves_by: new Date(Date.now() + 3600000).toISOString(), resolution_method: 'probe', input_snapshot: { p: 1 }, model: 'probe', non_business: true });
      return { file, verify: verifyForecastFile };
    }],
    ['goodhart-guard', () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-gg-'));
      const file = path.join(d, 'guard.jsonl');
      const m = path.join(d, 'm.mjs');
      fs.writeFileSync(m, 'export const x = 1;\n');
      new GoodhartGuard(file).commitConfirmation({ metricId: 'judge-probe', scriptPath: m, salt: 'judge-probe-salt-over-16', purpose: `probe ${MARK_A}` });
      return { file, verify: verifyGuardFile };
    }],
  ];
  const results = [];
  for (const [family, build] of cases) {
    const { file, verify } = build();
    const original = fs.readFileSync(file, 'utf8');
    const cleanOk = verify(file).valid === true;
    const mutant = `${file}.mutant`;
    fs.writeFileSync(mutant, original.replace(MARK_A, MARK_B));
    const refused = verify(mutant).valid === false;
    results.push({ family, strict: cleanOk && refused });
  }
  return results;
}

// ---- ARM 3: the tools court battery — every court must exist and pass ----
const BATTERY = [
  'tools/alive-loop/alive-loop.test.mjs',
  'tools/alive-loop/winner-memory.test.mjs',
  'tools/alive-loop/forecast-ledger.test.mjs',
  'tools/alive-loop/goodhart-guard.test.mjs',
  'tools/alive-loop/custody-sweep.test.mjs',
  'tools/alive-loop/flywheel.test.mjs',
  'tools/sentinel/sentinel.test.mjs',
  'tools/experience-fabric/kernel.test.mjs',
];

function runBattery() {
  const missing = BATTERY.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length > 0) return { ok: false, missing, note: 'a deleted court is a failure, not an exemption' };
  const proc = spawnSync('node', ['--test', ...BATTERY], { cwd: ROOT, encoding: 'utf8', timeout: 480000 });
  const fails = Number((proc.stdout.match(/ℹ fail (\d+)/) ?? [])[1] ?? 'NaN');
  const passes = Number((proc.stdout.match(/ℹ pass (\d+)/) ?? [])[1] ?? 'NaN');
  return { ok: proc.status === 0 && fails === 0 && passes > 0, passes, fails, exit: proc.status };
}

// ---- VERDICT ----
const ledgerFindings = auditAllLedgers();
const ledgersOk = ledgerFindings.every((f) => f.valid);
const probes = await probeVerifiers();
const probesOk = probes.every((p) => p.strict);
const battery = runBattery();
const improved = ledgersOk && probesOk && battery.ok;

console.log(JSON.stringify({
  improved,
  evidence: [
    { observation: `independent inline audit: ${ledgerFindings.length} ledgers, ${ledgerFindings.filter((f) => f.valid).length} strict-valid${ledgersOk ? '' : ` — FAILURES: ${JSON.stringify(ledgerFindings.filter((f) => !f.valid))}`}`, ref: '.cana-local (audited by sealed judge, inline verifier)' },
    { observation: `verifier blindness probes: ${probes.map((p) => `${p.family}=${p.strict ? 'STRICT' : 'BLIND'}`).join(', ')}`, ref: 'tools/alive-loop/confirm-metric.mjs probes' },
    { observation: battery.ok ? `tools court battery: ${battery.passes} pass, 0 fail across ${BATTERY.length} suites` : `tools court battery FAILED: ${JSON.stringify(battery)}`, ref: 'node --test stdout (sealed judge spawn)' },
  ],
}));
