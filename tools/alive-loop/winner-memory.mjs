// WINNER MEMORY — the durable substrate that closes the recursion.
//
// The Alive Loop already ADMITS a lesson per cycle (skills-src/cana-signal-to-fix
// toWinnerMemory), but until now that lesson evaporated when the cycle closed.
// This module persists admitted lessons in an append-only, hash-chained store
// and RECALLS them as labeled facts for the NEXT cycle's context compile — so
// the system's future reasoning is informed by its own measured past wins.
// That, and only that, is what "recursively learn" means in code here.
//
// TRUTH DISCIPLINE (the whole product's moat, applied to the loop itself):
//   - Only genuinely admitted lessons persist: re-verified through the same
//     toWinnerMemory-shaped gate, never trusted on a caller's say-so.
//   - The store is append-only and hash-chained; mutation/deletion/reorder/
//     replay break verification exactly like the cycle store.
//   - A recalled lesson is honestly non-business evidence and says so; it is
//     labeled INDEPENDENTLY_VERIFIED_RECEIPT only because it literally carries
//     a court receipt hash, and it can never claim more than it measured.
//   - Dedupe is by lesson_id, so an idempotent cycle re-run never double-counts.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const text = (value) => typeof value === 'string' && value.trim() !== '';
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}
const canonical = (value) => JSON.stringify(sortKeys(value));

export class LessonMemoryError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'LessonMemoryError'; this.code = code; }
}

/**
 * Re-validate a lesson object independently of whoever produced it. Mirrors the
 * canonical toWinnerMemory admission rules: a lesson that cannot prove it passed
 * a court (receipt hash) and measured an improvement is refused, even if a
 * caller hands us {stored:true}. A gate that trusts its input is not a gate.
 */
export function isDurableLesson(lesson) {
  if (!lesson || typeof lesson !== 'object') return { ok: false, reason: 'lesson must be an object' };
  if (lesson.stored !== true) return { ok: false, reason: 'lesson.stored must be true (came from an admission)' };
  if (!text(lesson.lesson_id) || !lesson.lesson_id.startsWith('wm_')) return { ok: false, reason: 'lesson_id must be a wm_ id' };
  if (!text(lesson.brittle_point)) return { ok: false, reason: 'lesson missing brittle_point' };
  if (!text(lesson.outcome_metric)) return { ok: false, reason: 'lesson missing outcome_metric' };
  if (lesson.measured?.improved !== true) return { ok: false, reason: 'a durable lesson must carry a measured improvement' };
  return { ok: true };
}

export class LessonStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  static rowHash(r) {
    return sha(canonical({ seq: r.seq, at: r.at, lesson_id: r.lesson_id, lesson_digest: r.lesson_digest, prev_hash: r.prev_hash }));
  }

  verifyChain() {
    let prev = 'GENESIS';
    for (const r of this.records()) {
      if (r.prev_hash !== prev || r.hash !== LessonStore.rowHash(r)
        || sha(canonical(r.lesson)) !== r.lesson_digest) return { valid: false, at_seq: r.seq };
      prev = r.hash;
    }
    return { valid: true, count: this.records().length };
  }

  has(lessonId) { return this.records().some((r) => r.lesson_id === lessonId); }

  /** Persist an admitted lesson. Refuses non-lessons; dedupes by id; quarantines a broken chain. */
  persist(lesson) {
    const check = isDurableLesson(lesson);
    if (!check.ok) throw new LessonMemoryError('LESSON_REFUSED', check.reason);
    const verdict = this.verifyChain();
    if (!verdict.valid) {
      const q = `${this.filePath}.quarantined.${Date.now()}`;
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, q);
      throw new LessonMemoryError('CHAIN_BROKEN', `lesson store fails verification at seq ${verdict.at_seq}; quarantined to ${q}`);
    }
    if (this.has(lesson.lesson_id)) return { persisted: false, deduped: true, lesson_id: lesson.lesson_id };
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const row = {
      seq: records.length,
      at: new Date().toISOString(),
      lesson_id: lesson.lesson_id,
      lesson_digest: sha(canonical(lesson)),
      prev_hash: prev,
      lesson,
    };
    row.hash = LessonStore.rowHash(row);
    fs.appendFileSync(this.filePath, `${JSON.stringify(row)}\n`);
    return { persisted: true, deduped: false, lesson_id: lesson.lesson_id, seq: row.seq };
  }

  /** Recall admitted lessons, newest first, optionally filtered by plane. */
  recall({ plane, limit = 20 } = {}) {
    let rows = this.records().map((r) => r.lesson);
    if (plane) rows = rows.filter((l) => l.plane === plane);
    return rows.reverse().slice(0, limit);
  }
}

/** Standalone verifier — usable with no other import after rollback. */
export function verifyLessonFile(filePath) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
  let prev = 'GENESIS';
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    const expect = createHash('sha256').update(JSON.stringify(sortKeys({ seq: r.seq, at: r.at, lesson_id: r.lesson_id, lesson_digest: r.lesson_digest, prev_hash: r.prev_hash }))).digest('hex');
    const lessonDigest = createHash('sha256').update(JSON.stringify(sortKeys(r.lesson))).digest('hex');
    if (r.prev_hash !== prev || r.hash !== expect || lessonDigest !== r.lesson_digest) return { valid: false, at: i };
    prev = r.hash;
  }
  return { valid: true, count: lines.length };
}

/**
 * Turn recalled lessons into labeled facts for the context compiler. A lesson
 * carries a court receipt, so its honest authority tier is
 * INDEPENDENTLY_VERIFIED_RECEIPT with truth_status VERIFIED — but the claim text
 * states plainly that it is a prior NON-BUSINESS loop outcome, never a market
 * fact, so a downstream cycle cannot over-read it.
 */
export function lessonsAsFacts(lessons, { now = new Date() } = {}) {
  return (lessons ?? []).map((l) => ({
    id: `lesson-${l.lesson_id}`,
    claim: `prior admitted non-business loop lesson (${l.plane ?? 'UNASSIGNED'}): "${l.outcome_metric}" measured improved; brittle point — ${l.brittle_point}`,
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT',
    truth_status: 'VERIFIED',
    source: `winner-memory:${l.lesson_id}`,
    observed_at: (l.learned_at ?? now.toISOString()).slice(0, 10),
    valid_for_days: 3650,
    tags: ['winner-memory', 'non-business', 'recursion', String(l.plane ?? 'UNASSIGNED').toLowerCase()],
  }));
}
