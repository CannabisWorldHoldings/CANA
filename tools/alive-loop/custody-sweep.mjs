// CUSTODY SWEEP — the verifier of verifiers (immune system audit).
//
// Two duties, both fail-closed:
//   1. LEDGER AUDIT — every live hash-chained ledger (alive-loop cycle stores,
//      winner memory, forecast ledger, goodhart guard, and any registered
//      extension) verifies from bytes alone.
//   2. VERIFIER PROBE — every registered VERIFIER is itself courted: the sweep
//      builds a synthetic valid chain with the family's real writer, mutates a
//      payload BODY byte (leaving every row-hash field untouched), and demands
//      the verifier REFUSE the mutant. A verifier that accepts a body mutation
//      is VERIFIER_BLIND — the hole the forecast court caught in its own first
//      session, hunted here across the whole organism forever after.
//
// Coverage duty: chained .jsonl files under the local ledger root that no
// family claims are reported as UNREGISTERED — a coverage gap is a signal for
// the flywheel, not a silent blind spot. Quarantine artifacts (deliberately
// preserved broken copies) are listed separately and are never failures.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CycleStore, verifyChainFile } from './adapter.mjs';
import { LessonStore, verifyLessonFile } from './winner-memory.mjs';
import { ForecastLedger, verifyForecastFile } from './forecast-ledger.mjs';
import { GoodhartGuard, verifyGuardFile } from './goodhart-guard.mjs';
import { SlowStore, verifySlowFile } from './slow-memory.mjs';
import { RegretLedger, verifyRegretFile } from '../vanguard/regret-ledger.mjs';

const MARK_A = 'PROBE_MARKER_ALPHA';
const MARK_B = 'PROBE_MARKER_BRAVO'; // same length — mutation, not reshape

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `sweep-${label}-`));

/** Build a valid chain via the family's REAL writer, then body-mutate a copy. */
const PROBES = {
  'alive-loop-cycles': () => {
    const d = tmp('cycle');
    const file = path.join(d, 'cycle.probe.jsonl');
    const store = new CycleStore(file);
    store.append({ state: 'GRANTED', missionId: 'probe', idemKey: 'probe-key', payload: { note: MARK_A } });
    store.append({ state: 'CLOSED', missionId: 'probe', idemKey: 'probe-key', payload: { final: 'PROBE' } });
    return { file, verify: verifyChainFile };
  },
  'winner-memory': () => {
    const d = tmp('lessons');
    const file = path.join(d, 'lessons.jsonl');
    const store = new LessonStore(file);
    store.persist({
      stored: true, lesson_id: 'wm_probe000000', plane: 'LOCAL_VERIFICATION',
      brittle_point: MARK_A, improvement: 'probe', outcome_metric: 'probe court',
      measured: { improved: true, source: 'probe', non_business: true }, learned_at: new Date().toISOString(),
    });
    return { file, verify: verifyLessonFile };
  },
  forecasts: () => {
    const d = tmp('forecast');
    const file = path.join(d, 'ledger.jsonl');
    const ledger = new ForecastLedger(file);
    ledger.register({
      target: 'probe', scope: 'probe', statement: `probe statement ${MARK_A}`,
      probability: 0.5, horizon: 'nowcast',
      resolves_by: new Date(Date.now() + 3600000).toISOString(),
      resolution_method: 'probe', input_snapshot: { probe: true }, model: 'probe', non_business: true,
    });
    return { file, verify: verifyForecastFile };
  },
  'goodhart-guard': () => {
    const d = tmp('guard');
    const file = path.join(d, 'guard.jsonl');
    const metric = path.join(d, 'metric.mjs');
    fs.writeFileSync(metric, 'export const judge = () => true;\n');
    new GoodhartGuard(file).commitConfirmation({
      metricId: 'probe-metric', scriptPath: metric,
      salt: 'probe-salt-well-over-16-chars', purpose: `probe purpose ${MARK_A}`,
    });
    return { file, verify: verifyGuardFile };
  },
  'regret-ledger': () => {
    const d = tmp('regret');
    const file = path.join(d, 'regret.jsonl');
    new RegretLedger(file).register({
      chosen_action: `probe decision ${MARK_A}`,
      alternatives: [{ id: 'probe-alt', summary: 'do nothing' }],
      expected_value: { basis: 'UNKNOWN' },
      information_available: [{ observation: 'probe info', ref: 'probe.ref' }],
      policy_version: 'probe/1',
    });
    return { file, verify: verifyRegretFile };
  },
  'slow-memory': () => {
    const d = tmp('slow');
    const file = path.join(d, 'slow.jsonl');
    new SlowStore(file).promote({
      lesson: {
        stored: true, lesson_id: 'wm_probe0000slow', plane: 'LOCAL_VERIFICATION',
        brittle_point: MARK_A, improvement: 'probe', outcome_metric: 'probe court',
        measured: { improved: true, source: 'probe', non_business: true }, learned_at: new Date().toISOString(),
      },
      replications: [
        { mission_id: 'probe-m1', receipt_ref: 'probe.a', measured_improved: true, at: new Date().toISOString() },
        { mission_id: 'probe-m2', receipt_ref: 'probe.b', measured_improved: true, at: new Date().toISOString() },
      ],
      scope: 'probe scope',
    });
    return { file, verify: verifySlowFile };
  },
};

/** Court one family's verifier: valid chain must pass, body mutant must be refused. */
export function probeVerifier(familyId, build = PROBES[familyId]) {
  if (!build) return { family: familyId, verdict: 'NO_PROBE', note: 'no registered probe builder' };
  const { file, verify } = build();
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(MARK_A)) {
    return { family: familyId, verdict: 'PROBE_INVALID', note: 'probe marker never landed in a payload body' };
  }
  const validOk = verify(file).valid === true;
  const mutant = `${file}.mutant`;
  fs.writeFileSync(mutant, original.replace(MARK_A, MARK_B));
  const mutantVerdict = verify(mutant);
  const mutationRefused = mutantVerdict.valid === false;
  return {
    family: familyId,
    valid_chain_ok: validOk,
    mutation_refused: mutationRefused,
    verdict: validOk && mutationRefused ? 'STRICT' : (validOk ? 'VERIFIER_BLIND' : 'PROBE_INVALID'),
    note: validOk && mutationRefused
      ? 'verifier accepts honest bytes and refuses a payload-body mutation'
      : (validOk ? 'verifier ACCEPTED a payload-body mutation — it checks the chain skeleton but not the flesh' : 'probe chain did not verify clean'),
  };
}

const BUILTIN_FAMILIES = [
  { id: 'alive-loop-cycles', dir: 'alive-loop', match: (f) => /^cycle\..+\.jsonl$/.test(f), verify: verifyChainFile },
  { id: 'winner-memory', dir: 'winner-memory', match: (f) => f === 'lessons.jsonl', verify: verifyLessonFile },
  { id: 'slow-memory', dir: 'winner-memory', match: (f) => f === 'slow.jsonl', verify: verifySlowFile },
  { id: 'forecasts', dir: 'forecasts', match: (f) => f === 'ledger.jsonl', verify: verifyForecastFile },
  { id: 'goodhart-guard', dir: 'goodhart', match: (f) => f === 'guard.jsonl', verify: verifyGuardFile },
  { id: 'regret-ledger', dir: 'regret', match: (f) => f === 'regret.jsonl', verify: verifyRegretFile },
];

const listJsonl = (root) => {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.jsonl') || e.name.includes('.jsonl.quarantined')) out.push(full);
    }
  };
  walk(root);
  return out;
};

/**
 * Sweep the ledger root. extraFamilies lets late-born organs (the flywheel)
 * register themselves without an import cycle: { id, dir, match, verify, probe? }.
 */
export function sweep({ localDir, extraFamilies = [] } = {}) {
  if (!localDir) throw new Error('SWEEP_DIR_REQUIRED: pass the ledger root (e.g. .cana-local)');
  const families = [...BUILTIN_FAMILIES, ...extraFamilies];

  const ledgers = [];
  const covered = new Set();
  for (const fam of families) {
    const dir = path.join(localDir, fam.dir);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fam.match(f)) : [];
    for (const f of files) {
      const full = path.join(dir, f);
      covered.add(full);
      const verdict = fam.verify(full);
      ledgers.push({ family: fam.id, path: path.relative(localDir, full), valid: verdict.valid === true, rows: verdict.count ?? null });
    }
    if (files.length === 0) ledgers.push({ family: fam.id, path: null, valid: true, rows: 0, absent: true });
  }

  const probes = families.map((fam) => probeVerifier(fam.id, fam.probe ?? PROBES[fam.id]));

  const all = listJsonl(localDir);
  const quarantine_artifacts = all.filter((f) => f.includes('.quarantined')).map((f) => path.relative(localDir, f));
  const unregistered = all
    .filter((f) => !f.includes('.quarantined') && !covered.has(f))
    .map((f) => path.relative(localDir, f));

  const all_ledgers_valid = ledgers.every((l) => l.valid);
  const all_verifiers_strict = probes.every((p) => p.verdict === 'STRICT');
  return {
    at: new Date().toISOString(),
    ledgers, probes, unregistered, quarantine_artifacts,
    all_ledgers_valid, all_verifiers_strict,
    strict: all_ledgers_valid && all_verifiers_strict,
  };
}

// CLI: node tools/alive-loop/custody-sweep.mjs [--dir=path]  — exit 0 iff strict.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirArg = process.argv.find((a) => a.startsWith('--dir='));
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const localDir = dirArg ? path.resolve(dirArg.slice(6)) : path.join(ROOT, '.cana-local');
  const verdict = sweep({ localDir });
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.strict ? 0 : 1);
}
