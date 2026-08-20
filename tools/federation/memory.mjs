#!/usr/bin/env node
/**
 * CANA FEDERATION — GATE C: MEMORY ATOMS + SETTLEMENT
 *
 * Federated memory (§7–§8) WITHOUT new memory authority:
 *  - MemoryAtom is the typed candidate unit (raw recall is never truth).
 *  - MemorySettlement runs the promotion path RAW → CANDIDATE → provenance
 *    → valid-time → scope → contradiction → retention consequence → SETTLED.
 *  - Durable procedural residue is DELEGATED to the incumbent stores:
 *    tools/alive-loop/winner-memory.mjs (FAST) and slow-memory.mjs (SLOW).
 *    This module composes them; it does not duplicate them (§74).
 *  - Settled atoms live in an append-only hash-chained JSONL with the same
 *    custody style as the loop stores. Nothing is ever deleted: supersession,
 *    expiry, contradiction and quarantine are explicit states, so negative
 *    evidence survives (§8: no destructive consolidation).
 *
 * SHARED RECALL ≠ CANONICAL TRUTH: recall() returns only settled, in-validity,
 * non-superseded, non-quarantined atoms scoped to the caller's tenant.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LessonStore, isDurableLesson } from '../alive-loop/winner-memory.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));

export const MEMORY_CLASSES = [
  'episodic', 'working', 'market', 'epistemic', 'procedural', 'causal_precedent', 'evolution', 'owner_correction',
];
export const EPISTEMIC_STATES = ['SETTLED', 'CANDIDATE', 'QUARANTINED', 'SUPERSEDED', 'EXPIRED', 'CONTRADICTED'];

/** A typed memory candidate. Validation is shape-only; TRUTH comes from settlement. */
export function makeMemoryAtom(a) {
  const errors = [];
  if (!text(a?.project)) errors.push('project required');
  if (!text(a?.tenant)) errors.push('tenant required — tenantless memory cannot be isolation-checked');
  if (!MEMORY_CLASSES.includes(a?.memoryClass)) errors.push(`memoryClass must be one of ${MEMORY_CLASSES.join('|')}`);
  if (!text(a?.proposition)) errors.push('proposition required');
  if (!text(a?.source)) errors.push('source required — unsourced memory is rumor');
  if (!text(a?.acquiredAt)) errors.push('acquiredAt required');
  if (!text(a?.validFrom)) errors.push('validFrom required');
  if (!text(a?.retentionConsequence)) errors.push('retentionConsequence required — state what future decision this memory changes, or it is junk (§43)');
  const atom = {
    atom_id: null,
    project: a?.project ?? null,
    tenant: a?.tenant ?? null,
    memory_class: a?.memoryClass ?? null,
    proposition: a?.proposition ?? null,
    source: a?.source ?? null,
    source_revision: a?.sourceRevision ?? null,
    acquired_at: a?.acquiredAt ?? null,
    valid_from: a?.validFrom ?? null,
    valid_until: a?.validUntil ?? null,
    epistemic_state: 'CANDIDATE',
    contradictions: [],
    learned_from: a?.learnedFrom ?? null,
    reuse_count: 0,
    retention_consequence: a?.retentionConsequence ?? null,
    supersedes: a?.supersedes ?? null,
    superseded_by: null,
    access_scope: a?.accessScope ?? 'tenant',
    privacy_class: a?.privacyClass ?? 'internal',
    measured: a?.measured ?? null,
    promotion_receipt: null,
    valid: errors.length === 0,
    errors,
  };
  atom.atom_id = 'ma_' + sha(canonical({ t: atom.tenant, c: atom.memory_class, p: atom.proposition, s: atom.source, v: atom.valid_from })).slice(0, 16);
  return atom;
}

/** Append-only, hash-chained settlement ledger + scoped recall. */
export class MemorySettlement {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'memory.jsonl');
    fs.mkdirSync(dir, { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  verifyChain() {
    let prev = 'GENESIS';
    for (const r of this.records()) {
      const expect = sha(canonical({ prev, atom: r.atom, action: r.action, at: r.at }));
      if (r.hash !== expect) return { valid: false, broken_at: r.seq };
      prev = r.hash;
    }
    return { valid: true, count: this.records().length };
  }

  #append(action, atom, at) {
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const row = { seq: records.length, at, action, atom, hash: sha(canonical({ prev, atom, action, at })) };
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n');
    return row;
  }

  /** Latest state of every atom_id (append-only store, last write is current). */
  #current() {
    const m = new Map();
    for (const r of this.records()) m.set(r.atom.atom_id, r.atom);
    return m;
  }

  /**
   * The promotion path (§8). Returns { settled, atom, checks } and never
   * throws on a refusable atom — refusal is a receipted verdict, not a crash.
   */
  settle(candidate, { now = new Date() } = {}) {
    const checks = [];
    const fail = (name, why) => { checks.push({ name, ok: false, why }); };
    const pass = (name) => { checks.push({ name, ok: true }); };
    if (!candidate?.valid) fail('shape', (candidate?.errors ?? ['no atom']).join('; ')); else pass('shape');
    if (candidate?.valid) {
      // provenance: source must be retrievable-looking (path, url, receipt ref) — not free prose
      if (/[/.:]/.test(candidate.source)) pass('provenance'); else fail('provenance', `source "${candidate.source}" is not a retrievable ref`);
      // valid-time
      if (candidate.valid_until && new Date(candidate.valid_until) <= now) fail('valid_time', 'already expired at settlement time'); else pass('valid_time');
      // scope: privacy_class secret may never settle into shared recall
      if (candidate.privacy_class === 'secret') fail('scope', 'secret-class content must not enter shared memory'); else pass('scope');
      // contradiction: an active settled atom in the same tenant+class asserting a different proposition it claims to supersede must be named
      const current = this.#current();
      const clash = [...current.values()].find((x) => x.tenant === candidate.tenant
        && x.memory_class === candidate.memory_class
        && x.epistemic_state === 'SETTLED'
        && x.proposition !== candidate.proposition
        && this.#sameSubject(x, candidate)
        && candidate.supersedes !== x.atom_id);
      if (clash) fail('contradiction', `contradicts settled ${clash.atom_id} without declaring supersession`); else pass('contradiction');
      // retention consequence already shape-required; re-affirm
      pass('retention_consequence');
    }
    const ok = checks.every((c) => c.ok);
    const at = now.toISOString();
    if (!ok) {
      const refused = { ...candidate, epistemic_state: 'QUARANTINED' };
      this.#append('QUARANTINE', refused, at);
      return { settled: false, atom: refused, checks };
    }
    // explicit supersession: retire the old atom first, with lineage both ways
    if (candidate.supersedes) {
      const current = this.#current();
      const old = current.get(candidate.supersedes);
      if (old && old.epistemic_state === 'SETTLED') {
        this.#append('SUPERSEDE', { ...old, epistemic_state: 'SUPERSEDED', superseded_by: candidate.atom_id }, at);
      }
    }
    const settled = { ...candidate, epistemic_state: 'SETTLED', promotion_receipt: { at, checks: checks.map((c) => c.name) } };
    this.#append('SETTLE', settled, at);
    return { settled: true, atom: settled, checks };
  }

  /** Two atoms are "about the same subject" when they share a learned_from key. */
  #sameSubject(a, b) { return text(a.learned_from) && a.learned_from === b.learned_from; }

  /** Scoped recall: only settled, in-validity, same-tenant atoms. Raw history stays retrievable via records(). */
  recall({ tenant, memoryClass = null, now = new Date() } = {}) {
    const out = [];
    for (const atom of this.#current().values()) {
      if (atom.tenant !== tenant) continue;
      if (memoryClass && atom.memory_class !== memoryClass) continue;
      if (atom.epistemic_state !== 'SETTLED') continue;
      if (atom.valid_until && new Date(atom.valid_until) <= now) continue;
      out.push(atom);
    }
    return out;
  }

  /** Explicit contradiction quarantine of an already-settled atom, with evidence. Nothing is deleted. */
  quarantine(atomId, evidenceRef, { now = new Date() } = {}) {
    const atom = this.#current().get(atomId);
    if (!atom) return { quarantined: false, reason: 'unknown atom' };
    if (!text(evidenceRef)) return { quarantined: false, reason: 'quarantine requires an evidence ref' };
    this.#append('QUARANTINE', { ...atom, epistemic_state: 'CONTRADICTED', contradictions: [...(atom.contradictions ?? []), evidenceRef] }, now.toISOString());
    return { quarantined: true };
  }

  /**
   * DELEGATION, not duplication: a settled procedural atom with a measured
   * improvement becomes a FAST lesson in the incumbent winner-memory store.
   * SLOW promotion stays entirely owned by slow-memory.mjs (replication law).
   */
  toFastLesson(atom, lessonStoreDir) {
    if (atom?.epistemic_state !== 'SETTLED') return { stored: false, reason: 'only settled atoms may become lessons' };
    if (atom.memory_class !== 'procedural' && atom.memory_class !== 'evolution') return { stored: false, reason: 'only procedural/evolution memory becomes lessons' };
    const lesson = {
      stored: true,
      lesson_id: 'wm_' + atom.atom_id.slice(3),
      brittle_point: atom.learned_from ?? atom.proposition,
      outcome_metric: atom.measured?.metric ?? null,
      measured: atom.measured ?? null,
      proposition: atom.proposition,
      source_atom: atom.atom_id,
    };
    const gate = isDurableLesson(lesson);
    if (!gate.ok) return { stored: false, reason: gate.reason };
    const store = new LessonStore(lessonStoreDir); // filePath — incumbent API
    return store.persist(lesson);
  }
}
