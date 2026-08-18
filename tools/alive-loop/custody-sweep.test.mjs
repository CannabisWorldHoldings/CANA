// CUSTODY SWEEP courts — the immune system audit must verify every ledger,
// court every verifier, and report coverage gaps instead of hiding them.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { probeVerifier, sweep } from './custody-sweep.mjs';
import { LessonStore } from './winner-memory.mjs';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-court-'));

const seedLessons = (root) => {
  const store = new LessonStore(path.join(root, 'winner-memory', 'lessons.jsonl'));
  store.persist({
    stored: true, lesson_id: 'wm_seeded000001', plane: 'LOCAL_VERIFICATION',
    brittle_point: 'a real prior weakness', improvement: 'a receipted answer',
    outcome_metric: 'court verdict PASS', measured: { improved: true, source: 'court', non_business: true },
    learned_at: new Date().toISOString(),
  });
  return store;
};

test('DETECTION COURT, resolved: the cycle-store verifier now refuses payload-body mutation', () => {
  // History of this court: at commit cc5fd04 it PINNED a live weakness — the
  // cycle store validated the row-hash chain but never recomputed payload
  // digests, so a mutated payload body slid through (probe verdict
  // VERIFIER_BLIND; receipt _mission/receipts/flywheel/00-verifier-blind-detection.json).
  // The fix commit flipped this assertion to STRICT, exactly as predeclared.
  const p = probeVerifier('alive-loop-cycles');
  assert.equal(p.valid_chain_ok, true, 'honest bytes must verify');
  assert.equal(p.verdict, 'STRICT', 'the hole the sweep caught is closed and pinned closed');
});

test('the fixed ledgers all probe STRICT: valid chains pass, body mutants are refused', () => {
  for (const family of ['winner-memory', 'slow-memory', 'forecasts', 'goodhart-guard', 'regret-ledger']) {
    const p = probeVerifier(family);
    assert.equal(p.valid_chain_ok, true, `${family}: honest bytes verify`);
    assert.equal(p.mutation_refused, true, `${family}: body mutation refused`);
    assert.equal(p.verdict, 'STRICT');
  }
});

test('sweep verifies real ledgers under a root and flags a body-mutated one', () => {
  const root = tmpRoot();
  const store = seedLessons(root);
  let verdict = sweep({ localDir: root });
  const lessons = verdict.ledgers.find((l) => l.family === 'winner-memory' && !l.absent);
  assert.equal(lessons.valid, true);
  assert.equal(lessons.rows, 1);

  const file = store.filePath;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('a real prior weakness', 'a flattering rewrite'));
  verdict = sweep({ localDir: root });
  assert.equal(verdict.ledgers.find((l) => l.family === 'winner-memory' && !l.absent).valid, false);
  assert.equal(verdict.all_ledgers_valid, false);
  assert.equal(verdict.strict, false);
});

test('coverage duty: unregistered chained files are reported, quarantine artifacts are not failures', () => {
  const root = tmpRoot();
  seedLessons(root);
  fs.mkdirSync(path.join(root, 'mystery'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mystery', 'orphan.jsonl'), '{"seq":0}\n');
  fs.writeFileSync(path.join(root, 'winner-memory', 'lessons.jsonl.quarantined.123'), 'broken bytes\n');
  const verdict = sweep({ localDir: root });
  assert.deepEqual(verdict.unregistered, [path.join('mystery', 'orphan.jsonl')]);
  assert.deepEqual(verdict.quarantine_artifacts, [path.join('winner-memory', 'lessons.jsonl.quarantined.123')]);
  assert.equal(verdict.all_ledgers_valid, true, 'quarantine copies and coverage gaps never fail the audit — they signal it');
});

test('extension families register without an import cycle and get probed', () => {
  const root = tmpRoot();
  const extDir = path.join(root, 'ext');
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, 'ext.jsonl'), '{"ok":true}\n');
  const family = {
    id: 'ext-family', dir: 'ext', match: (f) => f === 'ext.jsonl',
    verify: () => ({ valid: true, count: 1 }),
    probe: () => { // a deliberately blind verifier must be CAUGHT
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-probe-'));
      const file = path.join(d, 'probe.jsonl');
      fs.writeFileSync(file, '{"body":"PROBE_MARKER_ALPHA"}\n');
      return { file, verify: () => ({ valid: true }) };
    },
  };
  const verdict = sweep({ localDir: root, extraFamilies: [family] });
  assert.equal(verdict.ledgers.find((l) => l.family === 'ext-family').valid, true);
  const probe = verdict.probes.find((p) => p.family === 'ext-family');
  assert.equal(probe.verdict, 'VERIFIER_BLIND', 'a blind extension verifier is caught by its own probe');
  assert.equal(verdict.all_verifiers_strict, false);
});
