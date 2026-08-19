// GATE C court — the controlled memory-lifecycle demonstration (§63) plus
// composition with the incumbent winner-memory / slow-memory stores.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMemoryAtom, MemorySettlement, MEMORY_CLASSES } from './memory.mjs';
import { SlowStore } from '../alive-loop/slow-memory.mjs';
import { LessonStore } from '../alive-loop/winner-memory.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gatec-'));
const T1 = '2026-08-01T00:00:00Z';
const T2 = '2026-08-15T00:00:00Z';

const fact = (over = {}) => makeMemoryAtom({
  project: 'orderweeddc', tenant: 'owner', memoryClass: 'epistemic',
  proposition: 'canonical main is 3a340f3', source: 'git:origin/main@2026-08-14',
  acquiredAt: T1, validFrom: T1, learnedFrom: 'canonical-main-sha',
  retentionConsequence: 'future recovery steps diff against the wrong base without this',
  ...over,
});

test('shape law: unsourced, tenantless, or consequence-free atoms are invalid', () => {
  assert.equal(fact().valid, true);
  assert.equal(makeMemoryAtom({ ...{}, project: 'p', tenant: 't', memoryClass: 'epistemic', proposition: 'x', acquiredAt: T1, validFrom: T1, retentionConsequence: 'r' }).valid, false, 'missing source');
  assert.equal(fact({ retentionConsequence: '' }).valid, false, 'junk without consequence');
  assert.equal(fact({ memoryClass: 'vibes' }).valid, false);
});

test('§63 lifecycle: F1 settles, F2 supersedes at t2; history traceable, recall favors F2 only', () => {
  const m = new MemorySettlement(tmp());
  const f1 = fact();
  const r1 = m.settle(f1, { now: new Date(T1) });
  assert.equal(r1.settled, true, JSON.stringify(r1.checks));

  const f2 = fact({
    proposition: 'canonical main is 3a340f3; newest sovereign tip is 9d3bd70 (31 ahead)',
    source: 'bundle:orderweeddc-sovereign-vnext-31 verified 2026-08-19',
    acquiredAt: T2, validFrom: T2, supersedes: r1.atom.atom_id,
  });
  const r2 = m.settle(f2, { now: new Date(T2) });
  assert.equal(r2.settled, true, JSON.stringify(r2.checks));

  // recall returns ONLY F2
  const recalled = m.recall({ tenant: 'owner', memoryClass: 'epistemic' });
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].atom_id, r2.atom.atom_id);

  // supersession is explicit and bidirectional in the ledger
  const history = m.records();
  const superseded = history.find((r) => r.action === 'SUPERSEDE');
  assert.ok(superseded, 'an explicit SUPERSEDE row exists');
  assert.equal(superseded.atom.superseded_by, r2.atom.atom_id);
  assert.equal(superseded.atom.epistemic_state, 'SUPERSEDED');

  // raw history remains: the original settled F1 row is still in the ledger
  assert.ok(history.some((r) => r.action === 'SETTLE' && r.atom.atom_id === r1.atom.atom_id));
  // custody: the chain verifies
  assert.equal(m.verifyChain().valid, true);
});

test('contradiction without declared supersession is quarantined, not merged', () => {
  const m = new MemorySettlement(tmp());
  assert.equal(m.settle(fact(), { now: new Date(T1) }).settled, true);
  const rogue = fact({ proposition: 'canonical main is deadbeef', source: 'chat:someone-said-so/1' });
  const r = m.settle(rogue, { now: new Date(T2) });
  assert.equal(r.settled, false);
  assert.ok(r.checks.find((c) => c.name === 'contradiction' && !c.ok));
  // the refusal itself is in the ledger as negative evidence
  assert.ok(m.records().some((row) => row.action === 'QUARANTINE' && row.atom.atom_id === rogue.atom_id));
  // and recall still returns the original truth
  assert.equal(m.recall({ tenant: 'owner' })[0].proposition, fact().proposition);
});

test('expiry: an atom past valid_until drops out of recall but stays in history', () => {
  const m = new MemorySettlement(tmp());
  const ephemeral = fact({ validUntil: '2026-08-10T00:00:00Z', learnedFrom: 'ephemeral-subject' });
  assert.equal(m.settle(ephemeral, { now: new Date(T1) }).settled, true);
  assert.equal(m.recall({ tenant: 'owner', now: new Date(T1) }).length, 1);
  assert.equal(m.recall({ tenant: 'owner', now: new Date(T2) }).length, 0, 'expired at t2');
  assert.equal(m.records().length, 1, 'nothing deleted');
  // settling an already-expired atom is refused outright
  const dead = m.settle(fact({ validUntil: '2026-08-02T00:00:00Z', learnedFrom: 'other' }), { now: new Date(T2) });
  assert.equal(dead.settled, false);
});

test('tenant isolation: recall never crosses tenants; secret-class content never settles', () => {
  const m = new MemorySettlement(tmp());
  m.settle(fact({ tenant: 'merchant-a', learnedFrom: 'a' }), { now: new Date(T1) });
  m.settle(fact({ tenant: 'merchant-b', learnedFrom: 'b' }), { now: new Date(T1) });
  assert.equal(m.recall({ tenant: 'merchant-a' }).length, 1);
  assert.equal(m.recall({ tenant: 'merchant-a' })[0].tenant, 'merchant-a');
  const secret = m.settle(fact({ privacyClass: 'secret', learnedFrom: 'c' }), { now: new Date(T1) });
  assert.equal(secret.settled, false);
  assert.ok(secret.checks.find((c) => c.name === 'scope' && !c.ok));
});

test('owner correction settles as its own class and evidence-quarantine retires a bad settled atom', () => {
  const m = new MemorySettlement(tmp());
  const wrong = m.settle(fact({ learnedFrom: 'visual-direction' }), { now: new Date(T1) });
  const correction = m.settle(fact({
    memoryClass: 'owner_correction',
    proposition: 'owner: incumbent visual direction is comparator only, never the canvas',
    source: 'thread:cmszd6rop03o107adbvhnh6f3/owner-turn',
    learnedFrom: 'owner-visual-law',
  }), { now: new Date(T2) });
  assert.equal(correction.settled, true);
  const q = m.quarantine(wrong.atom.atom_id, 'thread:owner-correction-2026-08-18');
  assert.equal(q.quarantined, true);
  assert.equal(m.recall({ tenant: 'owner', memoryClass: 'epistemic' }).length, 0, 'contradicted atom left recall');
  assert.equal(m.quarantine('ma_nonexistent', 'x').quarantined, false);
  assert.equal(m.quarantine(correction.atom.atom_id, '').quarantined, false, 'quarantine without evidence refused');
});

test('COMPOSITION: settled procedural atom with measured improvement becomes a FAST lesson in the incumbent store', () => {
  const dir = tmp();
  const m = new MemorySettlement(dir);
  const atom = m.settle(makeMemoryAtom({
    project: 'orderweeddc', tenant: 'owner', memoryClass: 'procedural',
    proposition: 'before building any new capability, run the capability census over ALL recovered lineages including bundles — origin/main alone is not the capability universe',
    source: '_mission/CANA_SOVEREIGN_COGNITIVE_FEDERATION_CURRENT_STATE.md#3',
    acquiredAt: T2, validFrom: T2, learnedFrom: 'sentinel-duplication-2026-08-18',
    retentionConsequence: 'prevents duplicate-capability builds like the withdrawn sentinel monitor',
    measured: { improved: true, metric: 'duplicate-capability builds per continuation (1 -> 0 on holdout replay)' },
  }), { now: new Date(T2) });
  assert.equal(atom.settled, true);
  const lessonFile = path.join(dir, 'lessons.jsonl');
  const res = m.toFastLesson(atom.atom, lessonFile);
  assert.equal(res.persisted, true, JSON.stringify(res));
  const store = new LessonStore(lessonFile);
  assert.equal(store.verifyChain().valid, true);
  assert.equal(store.has(res.lesson_id), true);
  // a merely epistemic settled atom may NOT become a lesson
  const notLesson = m.toFastLesson(m.settle(fact({ learnedFrom: 'x2' }), { now: new Date(T2) }).atom, lessonFile);
  assert.equal(notLesson.stored, false);
});

test('COMPOSITION: SLOW promotion stays owned by slow-memory — replication law is untouched', () => {
  const dir = tmp();
  const slow = new SlowStore(path.join(dir, 'slow.jsonl'));
  const lesson = {
    stored: true, lesson_id: 'wm_censusbeforebuild1', brittle_point: 'sentinel-duplication-2026-08-18',
    outcome_metric: 'duplicate builds per continuation', measured: { improved: true },
  };
  // one mission's evidence must refuse
  assert.throws(() => slow.promote({
    lesson,
    replications: [
      { mission_id: 'm1', receipt_ref: 'r1', measured_improved: true, at: T1 },
      { mission_id: 'm1', receipt_ref: 'r2', measured_improved: true, at: T2 },
    ],
    scope: 'continuation-builds', generalization: 'census precedes invention',
  }), /REPLICATION_REQUIRED/);
  // two distinct missions promote
  const ok = slow.promote({
    lesson,
    replications: [
      { mission_id: 'three-lane-2026-08-18', receipt_ref: '_mission/receipts/federation-gates-ab-781ddd9.txt', measured_improved: true, at: T1 },
      { mission_id: 'federation-continuation-2026-08-18', receipt_ref: 'tools/federation/federation.test.mjs', measured_improved: true, at: T2 },
    ],
    scope: 'continuation-builds', generalization: 'census precedes invention',
  });
  assert.equal(ok.promoted, true);
});

test('memory classes cover the federation taxonomy (§7)', () => {
  assert.deepEqual(MEMORY_CLASSES, ['episodic', 'working', 'market', 'epistemic', 'procedural', 'causal_precedent', 'evolution', 'owner_correction']);
});
