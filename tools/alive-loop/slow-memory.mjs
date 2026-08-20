// SLOW MEMORY — WINNER MEMORY v2: two-temperature learning.
//
// The trap this closes (external red-team, 2026-08-18): a single lucky result
// can corrupt the whole organism if one admitted lesson is treated as
// architectural law. So memory now runs at two temperatures:
//
//   FAST (lessons.jsonl, the existing store) — provisional, context-bound,
//   admitted per-cycle behind the blind judge. It may decay. It proves only
//   what it measured, where it measured it.
//
//   SLOW (slow.jsonl, this store) — architecture-grade knowledge. Promotion
//   FAST → SLOW requires REPLICATION: at least two independent admitted
//   receipts from DISTINCT missions. A same-mission re-run is idempotence,
//   not replication. One good result is not universal law.
//
// Slow lessons are not immortal: each carries a review_by horizon (stale
// lessons drop out of recall until revalidated) and can be DEMOTED with
// evidence when contradicted — never silently. A demoted lesson_id cannot be
// re-promoted; new evidence must earn a new lesson through new cycles.
// Same custody as every organ: append-only, hash-chained, payload digests
// recomputed from birth, quarantine on broken chains, standalone verifier.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isDurableLesson } from './winner-memory.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim() !== '';
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));

export class SlowMemoryError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'SlowMemoryError'; this.code = code; }
}
const refuse = (code, msg) => { throw new SlowMemoryError(code, msg); };

const DEFAULT_REVIEW_DAYS = 180;

/** Replication court: ≥2 independent admitted receipts from DISTINCT missions. */
export function validateReplications(replications) {
  if (!Array.isArray(replications) || replications.length < 2) {
    refuse('REPLICATION_REQUIRED', 'promotion to slow memory requires at least TWO independent admitted receipts — one good result is not universal law');
  }
  for (const r of replications) {
    if (!r || typeof r !== 'object') refuse('REPLICATION_INVALID', 'each replication must be an object');
    if (!text(r.mission_id)) refuse('REPLICATION_INVALID', 'each replication must name its mission_id');
    if (!text(r.receipt_ref)) refuse('REPLICATION_INVALID', 'each replication must carry a retrievable receipt_ref');
    if (r.measured_improved !== true) refuse('REPLICATION_INVALID', 'each replication must carry measured_improved: true from its own admission');
    if (!text(r.at) || Number.isNaN(Date.parse(r.at))) refuse('REPLICATION_INVALID', 'each replication must carry a valid time');
  }
  const missions = new Set(replications.map((r) => r.mission_id));
  if (missions.size < 2) {
    refuse('REPLICATION_REQUIRED', 'replications come from the same mission — a re-run is idempotence, not replication');
  }
  return true;
}

export class SlowStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  static rowHash(r) {
    return sha(canonical({ seq: r.seq, at: r.at, kind: r.kind, lesson_id: r.lesson_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }));
  }

  verifyChain() {
    let prev = 'GENESIS';
    for (const r of this.records()) {
      if (r.prev_hash !== prev || r.hash !== SlowStore.rowHash(r)
        || sha(canonical(r.payload ?? null)) !== r.payload_digest) return { valid: false, at_seq: r.seq };
      prev = r.hash;
    }
    return { valid: true, count: this.records().length };
  }

  #append(kind, lessonId, payload) {
    const verdict = this.verifyChain();
    if (!verdict.valid) {
      const q = `${this.filePath}.quarantined.${Date.now()}`;
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, q);
      refuse('CHAIN_BROKEN', `slow memory fails verification at seq ${verdict.at_seq}; quarantined to ${q}`);
    }
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const row = { seq: records.length, at: new Date().toISOString(), kind, lesson_id: lessonId, payload_digest: sha(canonical(payload)), prev_hash: prev };
    row.hash = SlowStore.rowHash(row);
    fs.appendFileSync(this.filePath, `${JSON.stringify({ ...row, payload })}\n`);
    return row;
  }

  statusOf(lessonId) {
    const rows = this.records().filter((r) => r.lesson_id === lessonId);
    if (rows.length === 0) return 'ABSENT';
    return rows[rows.length - 1].kind; // PROMOTED | REVALIDATED | DEMOTED
  }

  /** Promote a FAST lesson to SLOW. Replication-gated; demoted ids stay closed. */
  promote({ lesson, replications, scope, generalization, reviewDays = DEFAULT_REVIEW_DAYS, now = new Date() }) {
    const check = isDurableLesson(lesson);
    if (!check.ok) refuse('LESSON_REFUSED', check.reason);
    validateReplications(replications);
    const status = this.statusOf(lesson.lesson_id);
    if (status === 'DEMOTED') {
      refuse('DEMOTED_LESSON', `lesson ${lesson.lesson_id} was demoted with evidence — a fallen law does not return; new cycles must earn a new lesson`);
    }
    if (status !== 'ABSENT') return { promoted: false, deduped: true, lesson_id: lesson.lesson_id };
    if (!text(scope)) refuse('SCOPE_REQUIRED', 'a slow lesson must declare the scope it generalizes over');
    const review_by = new Date(now.getTime() + reviewDays * 86400000).toISOString();
    this.#append('PROMOTED', lesson.lesson_id, {
      lesson, replications, scope,
      generalization: generalization ?? 'CROSS_MISSION',
      promoted_at: now.toISOString(), review_by,
    });
    return { promoted: true, lesson_id: lesson.lesson_id, review_by, replication_count: replications.length };
  }

  /** Revalidation extends the review horizon — with fresh evidence, never by assertion. */
  revalidate(lessonId, { evidence, reviewDays = DEFAULT_REVIEW_DAYS, now = new Date() }) {
    const status = this.statusOf(lessonId);
    if (status === 'ABSENT') refuse('LESSON_UNKNOWN', `no slow lesson ${lessonId}`);
    if (status === 'DEMOTED') refuse('DEMOTED_LESSON', `lesson ${lessonId} is demoted — revalidation cannot resurrect it`);
    if (!Array.isArray(evidence) || evidence.length === 0 || !evidence.every((e) => text(e?.observation) && text(e?.ref))) {
      refuse('EVIDENCE_REQUIRED', 'revalidation requires evidence rows with observation + ref');
    }
    const review_by = new Date(now.getTime() + reviewDays * 86400000).toISOString();
    this.#append('REVALIDATED', lessonId, { evidence, revalidated_at: now.toISOString(), review_by });
    return { revalidated: true, lesson_id: lessonId, review_by };
  }

  /** Demotion is evidence-mandatory and permanent for this lesson_id. */
  demote(lessonId, { reason, evidence, now = new Date() }) {
    const status = this.statusOf(lessonId);
    if (status === 'ABSENT') refuse('LESSON_UNKNOWN', `no slow lesson ${lessonId}`);
    if (status === 'DEMOTED') refuse('ALREADY_DEMOTED', `lesson ${lessonId} is already demoted`);
    if (!text(reason)) refuse('REASON_REQUIRED', 'demotion must state what contradicted the lesson');
    if (!Array.isArray(evidence) || evidence.length === 0 || !evidence.every((e) => text(e?.observation) && text(e?.ref))) {
      refuse('EVIDENCE_REQUIRED', 'demotion requires evidence rows with observation + ref — memory is never rewritten by mood');
    }
    this.#append('DEMOTED', lessonId, { reason, evidence, demoted_at: now.toISOString() });
    return { demoted: true, lesson_id: lessonId };
  }

  /**
   * Recall ACTIVE slow lessons: promoted (or revalidated), not demoted, and
   * within their review horizon. Stale lessons are reported separately —
   * excluded from recall, never silently kept alive.
   */
  recall({ now = new Date(), includeStale = false, limit = 20 } = {}) {
    const byLesson = new Map();
    for (const r of this.records()) {
      const cur = byLesson.get(r.lesson_id) ?? {};
      if (r.kind === 'PROMOTED') { cur.lesson = r.payload.lesson; cur.scope = r.payload.scope; cur.replications = r.payload.replications.length; cur.review_by = r.payload.review_by; cur.demoted = false; }
      if (r.kind === 'REVALIDATED') cur.review_by = r.payload.review_by;
      if (r.kind === 'DEMOTED') cur.demoted = true;
      byLesson.set(r.lesson_id, cur);
    }
    const active = []; const stale = [];
    for (const [id, s] of byLesson) {
      if (s.demoted || !s.lesson) continue;
      const isStale = Date.parse(s.review_by) < now.getTime();
      (isStale ? stale : active).push({ lesson_id: id, ...s, status: isStale ? 'STALE' : 'ACTIVE' });
    }
    const out = includeStale ? [...active, ...stale] : active;
    return { active: active.slice(0, limit), stale, recalled: out.slice(0, limit) };
  }
}

/** Standalone strict verifier — node builtins only, rollback-safe. */
export function verifySlowFile(filePath) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
  let prev = 'GENESIS';
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    const expect = createHash('sha256').update(JSON.stringify(sortKeys({ seq: r.seq, at: r.at, kind: r.kind, lesson_id: r.lesson_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }))).digest('hex');
    const bodyDigest = createHash('sha256').update(JSON.stringify(sortKeys(r.payload ?? null))).digest('hex');
    if (r.prev_hash !== prev || r.hash !== expect || bodyDigest !== r.payload_digest) return { valid: false, at: i };
    prev = r.hash;
  }
  return { valid: true, count: lines.length };
}

/** Slow lessons as facts — honest about being replicated NON-BUSINESS loop knowledge. */
export function slowLessonsAsFacts(recalled, { now = new Date() } = {}) {
  return (recalled ?? []).map((s) => ({
    id: `slow-${s.lesson_id}`,
    claim: `replicated non-business loop lesson (${s.replications} independent missions, scope: ${s.scope}): "${s.lesson.outcome_metric}" measured improved; brittle point — ${s.lesson.brittle_point}`,
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT',
    truth_status: 'VERIFIED',
    source: `slow-memory:${s.lesson_id}`,
    observed_at: now.toISOString().slice(0, 10),
    valid_for_days: 365,
    tags: ['slow-memory', 'replicated', 'non-business', 'recursion'],
  }));
}
