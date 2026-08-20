// SLOW MEMORY courts — promotion must demand replication, demotion must
// demand evidence, fallen laws must stay fallen, stale knowledge must drop
// out of recall, and custody must hold from birth.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  SlowStore, SlowMemoryError, slowLessonsAsFacts, validateReplications, verifySlowFile,
} from './slow-memory.mjs';
import { probeVerifier } from './custody-sweep.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slow-')), 'slow.jsonl');
const lesson = (over = {}) => ({
  stored: true, lesson_id: 'wm_slowcourt0001', plane: 'LOCAL_VERIFICATION',
  brittle_point: 'a weakness proven twice', improvement: 'a replicated answer',
  outcome_metric: 'court verdict PASS', measured: { improved: true, source: 'court', non_business: true },
  learned_at: '2026-08-18T12:00:00Z', ...over,
});
const reps = (a = 'mission-alpha', b = 'mission-beta') => [
  { mission_id: a, receipt_ref: 'cycle.aaa.jsonl', measured_improved: true, at: '2026-08-17T10:00:00Z' },
  { mission_id: b, receipt_ref: 'cycle.bbb.jsonl', measured_improved: true, at: '2026-08-18T10:00:00Z' },
];
const evidence = [{ observation: 'contradicting court run', ref: 'cycle.ccc.jsonl' }];

test('REPLICATION COURT: one receipt refused; same-mission pair refused; distinct missions promote', () => {
  assert.throws(() => validateReplications([reps()[0]]), /REPLICATION_REQUIRED/);
  assert.throws(() => validateReplications(reps('same', 'same')), /REPLICATION_REQUIRED/);
  assert.throws(() => validateReplications([{ mission_id: 'm', receipt_ref: 'r', measured_improved: false, at: '2026-08-18T10:00:00Z' }, reps()[1]]), /REPLICATION_INVALID/);
  assert.equal(validateReplications(reps()), true);

  const store = new SlowStore(tmp());
  const r = store.promote({ lesson: lesson(), replications: reps(), scope: 'alive-loop custody' });
  assert.equal(r.promoted, true);
  assert.equal(r.replication_count, 2);
  assert.equal(store.verifyChain().valid, true);
});

test('a non-durable lesson and an unscoped lesson are refused; promotion dedupes by id', () => {
  const store = new SlowStore(tmp());
  assert.throws(() => store.promote({ lesson: lesson({ stored: false }), replications: reps(), scope: 's' }), /LESSON_REFUSED/);
  assert.throws(() => store.promote({ lesson: lesson(), replications: reps(), scope: '' }), /SCOPE_REQUIRED/);
  store.promote({ lesson: lesson(), replications: reps(), scope: 'alive-loop custody' });
  const again = store.promote({ lesson: lesson(), replications: reps(), scope: 'alive-loop custody' });
  assert.equal(again.deduped, true);
});

test('DEMOTION: evidence-mandatory, drops the lesson from recall, and is permanent for that id', () => {
  const store = new SlowStore(tmp());
  store.promote({ lesson: lesson(), replications: reps(), scope: 'alive-loop custody' });
  assert.throws(() => store.demote('wm_slowcourt0001', { reason: 'contradicted', evidence: [] }), /EVIDENCE_REQUIRED/);
  assert.throws(() => store.demote('wm_slowcourt0001', { reason: '', evidence }), /REASON_REQUIRED/);
  store.demote('wm_slowcourt0001', { reason: 'later cycles contradicted the lesson', evidence });
  assert.equal(store.recall().active.length, 0, 'a demoted law no longer teaches');
  assert.throws(() => store.demote('wm_slowcourt0001', { reason: 'again', evidence }), /ALREADY_DEMOTED/);
  assert.throws(
    () => store.promote({ lesson: lesson(), replications: reps('mission-new1', 'mission-new2'), scope: 's' }),
    /DEMOTED_LESSON/,
    'a fallen law does not return under the same id',
  );
});

test('REVIEW HORIZON: stale lessons drop out of recall; revalidation with evidence restores them', () => {
  const store = new SlowStore(tmp());
  store.promote({ lesson: lesson(), replications: reps(), scope: 'alive-loop custody', reviewDays: 1, now: new Date('2026-01-01T00:00:00Z') });
  const later = new Date('2026-03-01T00:00:00Z');
  let recall = store.recall({ now: later });
  assert.equal(recall.active.length, 0);
  assert.equal(recall.stale.length, 1);
  assert.equal(recall.stale[0].status, 'STALE');
  assert.throws(() => store.revalidate('wm_slowcourt0001', { evidence: [], now: later }), /EVIDENCE_REQUIRED/);
  store.revalidate('wm_slowcourt0001', { evidence: [{ observation: 'fresh replication held', ref: 'cycle.ddd.jsonl' }], now: later });
  recall = store.recall({ now: later });
  assert.equal(recall.active.length, 1, 'revalidated knowledge earns more time — by evidence, not assertion');
});

test('slow facts state their replication count and non-business nature plainly', () => {
  const store = new SlowStore(tmp());
  store.promote({ lesson: lesson(), replications: reps(), scope: 'alive-loop custody' });
  const facts = slowLessonsAsFacts(store.recall().recalled);
  assert.equal(facts.length, 1);
  assert.match(facts[0].claim, /2 independent missions/);
  assert.match(facts[0].claim, /non-business/);
  assert.ok(facts[0].tags.includes('slow-memory'));
});

test('custody from birth: payload-body mutation breaks the chain; appends quarantine; probe is STRICT', () => {
  const file = tmp();
  const store = new SlowStore(file);
  store.promote({ lesson: lesson(), replications: reps(), scope: 'alive-loop custody' });
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('a weakness proven twice', 'a flattering rewrite'));
  assert.equal(verifySlowFile(file).valid, false, 'body mutation caught');
  assert.throws(() => new SlowStore(file).promote({ lesson: lesson({ lesson_id: 'wm_slowcourt0002' }), replications: reps(), scope: 's' }), /CHAIN_BROKEN/);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('quarantined')));

  const probe = probeVerifier('slow-memory');
  assert.equal(probe.verdict, 'STRICT', 'the sweep courts this verifier like every other');
});
