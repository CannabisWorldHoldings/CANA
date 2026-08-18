// WINNER MEMORY courts — the recursion substrate must persist only proven
// lessons, feed them forward honestly, and be tamper-evident + rollback-safe.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LessonStore, LessonMemoryError, isDurableLesson, lessonsAsFacts, verifyLessonFile,
} from './winner-memory.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-')), 'lessons.jsonl');
const lesson = (over = {}) => ({
  stored: true, lesson_id: 'wm_abc123def456', plane: 'LOCAL_VERIFICATION',
  brittle_point: 'unverified assumption', improvement: 'a receipt-backed answer',
  outcome_metric: 'court verdict PASS', measured: { improved: true, source: 'run-static', non_business: true },
  learned_at: '2026-08-18T11:00:00Z', ...over,
});

test('only genuinely admitted, measured lessons are durable', () => {
  assert.equal(isDurableLesson(lesson()).ok, true);
  assert.equal(isDurableLesson({ ...lesson(), stored: false }).ok, false);
  assert.equal(isDurableLesson({ ...lesson(), measured: { improved: false } }).ok, false);
  assert.equal(isDurableLesson({ ...lesson(), lesson_id: 'not-wm' }).ok, false);
  assert.equal(isDurableLesson({ ...lesson(), brittle_point: '' }).ok, false);
});

test('persist refuses a non-lesson and stores a real one, hash-chained', () => {
  const store = new LessonStore(tmp());
  assert.throws(() => store.persist({ stored: false }), /LESSON_REFUSED/);
  const r = store.persist(lesson());
  assert.equal(r.persisted, true);
  assert.equal(store.verifyChain().valid, true);
  assert.equal(store.verifyChain().count, 1);
});

test('dedupe by lesson_id: an idempotent re-run never double-counts', () => {
  const store = new LessonStore(tmp());
  assert.equal(store.persist(lesson()).persisted, true);
  const again = store.persist(lesson());
  assert.equal(again.persisted, false);
  assert.equal(again.deduped, true);
  assert.equal(store.verifyChain().count, 1);
});

test('recall returns newest-first and filters by plane — this is the feed-forward', () => {
  const store = new LessonStore(tmp());
  store.persist(lesson({ lesson_id: 'wm_000000000001', plane: 'LOCAL_VERIFICATION' }));
  store.persist(lesson({ lesson_id: 'wm_000000000002', plane: 'COMPETITIVE_SENTINEL' }));
  store.persist(lesson({ lesson_id: 'wm_000000000003', plane: 'LOCAL_VERIFICATION' }));
  const all = store.recall();
  assert.equal(all[0].lesson_id, 'wm_000000000003', 'newest first');
  const lv = store.recall({ plane: 'LOCAL_VERIFICATION' });
  assert.equal(lv.length, 2);
  assert.ok(lv.every((l) => l.plane === 'LOCAL_VERIFICATION'));
});

test('recalled lessons compile to honest, non-over-claiming facts', () => {
  const facts = lessonsAsFacts([lesson()]);
  assert.equal(facts.length, 1);
  const f = facts[0];
  assert.equal(f.authority, 'INDEPENDENTLY_VERIFIED_RECEIPT');
  assert.equal(f.truth_status, 'VERIFIED');
  assert.match(f.claim, /non-business/, 'the fact states plainly it is not a market fact');
  assert.ok(f.tags.includes('winner-memory'));
});

test('tamper detection: mutation, deletion, reorder, replay all break the chain', () => {
  const file = tmp();
  const store = new LessonStore(file);
  store.persist(lesson({ lesson_id: 'wm_000000000001' }));
  store.persist(lesson({ lesson_id: 'wm_000000000002' }));
  store.persist(lesson({ lesson_id: 'wm_000000000003' }));
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.trim().split('\n');

  fs.writeFileSync(file, original.replace('wm_000000000002', 'wm_TAMPERED0002'));
  assert.equal(verifyLessonFile(file).valid, false);
  fs.writeFileSync(file, original.replace('unverified assumption', 'flattering rewritten claim'));
  assert.equal(verifyLessonFile(file).valid, false, 'lesson BODY mutation must break the chain');
  fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
  assert.equal(verifyLessonFile(file).valid, false);
  fs.writeFileSync(file, [lines[1], lines[0], lines[2]].join('\n') + '\n');
  assert.equal(verifyLessonFile(file).valid, false);
  fs.writeFileSync(file, [...lines, lines[1]].join('\n') + '\n');
  assert.equal(verifyLessonFile(file).valid, false);

  // Appending onto a broken chain quarantines instead of writing.
  fs.writeFileSync(file, original.replace('wm_000000000002', 'wm_TAMPERED0002'));
  assert.throws(() => new LessonStore(file).persist(lesson({ lesson_id: 'wm_000000000009' })), /CHAIN_BROKEN/);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('quarantined')));
});

test('rollback-safe: the store reads with only node builtins after the module is gone', () => {
  const file = tmp();
  const store = new LessonStore(file);
  store.persist(lesson());
  const verdict = verifyLessonFile(file);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.count, 1);
  const parsed = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(parsed[0].lesson.lesson_id, 'wm_abc123def456');
});
