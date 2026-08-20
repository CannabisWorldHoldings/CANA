#!/usr/bin/env node
// ADVANTAGE ALLOCATOR — "do anything to win" as computation, not chaos.
//
// Given candidate actions, rank where the next unit of scarce resource
// (developer-hour, agent cycle, owner conversation, experiment slot) should
// go to maximize long-term compounding advantage. External red-team organ 1,
// built under the standing truth laws:
//
//   THE FABRICATED-VALUE LAW: a candidate may carry a numeric expected value
//   ONLY with a declared basis of MEASURED (evidence refs mandatory) or
//   ESTIMATED (method stated). basis UNKNOWN with a number attached is
//   refused — pre-revenue, the machine does not invent dollars. UNKNOWN
//   candidates still rank: learning value, compounding, and gate-opening
//   carry them. That is honest pre-revenue allocation: the scarce resource
//   buys LEARNING and GATE-READINESS until measured value exists.
//
//   Blocked candidates (owner gates, environment gates) are ranked but never
//   chosen — they compile into the owner lane with their rank attached, so
//   the owner sees exactly what their key unlocks and in what order.
//
// The scoring function is explicit, deterministic, and versioned — an
// allocation whose formula is hidden cannot be argued with, and an
// allocation that cannot be argued with cannot be improved. Reality grades
// allocations through the Regret Ledger (register the decision, settle it
// later, measure opportunity regret).
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const text = (v) => typeof v === 'string' && v.trim() !== '';
const bounded = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;

export class AllocatorError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'AllocatorError'; this.code = code; }
}
const refuse = (code, msg) => { throw new AllocatorError(code, msg); };

export const POLICY_VERSION = 'allocator/1 — pre-revenue: advantage = (learning + compounding + strategic + gate_opening)/20 × confidence × (0.5 + reversibility/2); burden = 1 + (cost-1)/4 + (risk-1)/4; score = advantage / burden';
export const VALUE_BASES = Object.freeze(['MEASURED', 'ESTIMATED', 'UNKNOWN']);

export function validateCandidate(c) {
  if (!c || typeof c !== 'object') refuse('CANDIDATE_ABSENT', 'a candidate object is required');
  if (!text(c.id)) refuse('CANDIDATE_FIELD', 'candidate id required');
  if (!text(c.action)) refuse('CANDIDATE_FIELD', `${c.id}: action required — what would the resource buy?`);
  if (!VALUE_BASES.includes(c.value_basis)) refuse('VALUE_BASIS', `${c.id}: value_basis must be ${VALUE_BASES.join('|')}`);
  if (c.value_basis === 'UNKNOWN' && typeof c.expected_value === 'number') {
    refuse('VALUE_FABRICATED', `${c.id}: a numeric expected value with basis UNKNOWN is an invented dollar — state the basis or drop the number`);
  }
  if (c.value_basis === 'MEASURED') {
    const ok = Array.isArray(c.evidence) && c.evidence.length > 0 && c.evidence.every((e) => text(e?.observation) && text(e?.ref));
    if (!ok) refuse('VALUE_UNEVIDENCED', `${c.id}: MEASURED value demands evidence refs`);
    if (typeof c.expected_value !== 'number') refuse('VALUE_MISSING', `${c.id}: MEASURED basis with no number is a contradiction`);
  }
  if (c.value_basis === 'ESTIMATED' && !text(c.estimate_method)) {
    refuse('ESTIMATE_METHOD', `${c.id}: ESTIMATED value must state its method`);
  }
  for (const [field, lo, hi] of [['learning_value', 0, 5], ['compounding_value', 0, 5], ['strategic_value', 0, 5], ['gate_opening', 0, 5], ['cost', 1, 5], ['risk', 1, 5]]) {
    if (!bounded(c[field], lo, hi)) refuse('SCALE_INVALID', `${c.id}: ${field} must be a number in [${lo},${hi}]`);
  }
  if (!bounded(c.confidence, 0, 1)) refuse('SCALE_INVALID', `${c.id}: confidence must be in [0,1]`);
  if (!bounded(c.reversibility, 0, 1)) refuse('SCALE_INVALID', `${c.id}: reversibility must be in [0,1]`);
  if (c.blocked_by != null && !text(c.blocked_by)) refuse('GATE_INVALID', `${c.id}: blocked_by must name the gate when present`);
  return true;
}

export function score(c) {
  validateCandidate(c);
  const advantage = ((c.learning_value + c.compounding_value + c.strategic_value + c.gate_opening) / 20)
    * c.confidence * (0.5 + c.reversibility / 2);
  const burden = 1 + (c.cost - 1) / 4 + (c.risk - 1) / 4;
  return Number((advantage / burden).toFixed(6));
}

/** Rank all candidates; choose the top executable (unblocked) ones. */
export function allocate(candidates, { slots = 1 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) refuse('PORTFOLIO_EMPTY', 'an allocator with nothing to rank allocates nothing');
  const ids = new Set();
  for (const c of candidates) {
    validateCandidate(c);
    if (ids.has(c.id)) refuse('CANDIDATE_DUPLICATE', `candidate ${c.id} appears twice`);
    ids.add(c.id);
  }
  const ranked = candidates
    .map((c) => ({ ...c, score: score(c) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const executable = ranked.filter((c) => c.blocked_by == null);
  const gated = ranked.filter((c) => c.blocked_by != null)
    .map((c) => ({ lane: 'OWNER_GATED', kind: 'ALLOCATION_GATED', id: c.id, action: c.action, rank: ranked.indexOf(c) + 1, score: c.score, gate: c.blocked_by }));
  const decisionDigest = createHash('sha256').update(JSON.stringify(ranked.map((c) => [c.id, c.score]))).digest('hex').slice(0, 16);
  return {
    policy_version: POLICY_VERSION,
    decision_digest: `alloc_${decisionDigest}`,
    ranked: ranked.map((c, i) => ({ rank: i + 1, id: c.id, score: c.score, blocked_by: c.blocked_by ?? null, action: c.action })),
    chosen: executable.slice(0, slots).map((c) => c.id),
    gated,
    law: 'blocked candidates are ranked but never chosen — the owner sees exactly what each key unlocks, in order',
  };
}

// CLI: node tools/vanguard/allocator.mjs --portfolio=path.json [--slots=N]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fs = await import('node:fs');
  const fileArg = process.argv.find((a) => a.startsWith('--portfolio='));
  if (!fileArg) { console.error('pass --portfolio=path.json'); process.exit(2); }
  const slotsArg = process.argv.find((a) => a.startsWith('--slots='));
  const portfolio = JSON.parse(fs.readFileSync(fileArg.slice(12), 'utf8'));
  console.log(JSON.stringify(allocate(portfolio, { slots: slotsArg ? Number(slotsArg.slice(8)) : 1 }), null, 2));
}
