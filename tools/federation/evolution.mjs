#!/usr/bin/env node
/**
 * CANA FEDERATION — GATE D: EVOLUTION CASE (§19) + SELF-EVOLUTION CONTROL LAW (§20)
 *
 * Every system-improvement attempt is a typed EvolutionCase. Fail-closed:
 * a case without competing diagnoses, without a lowest-sufficient-surface
 * argument, without >=2 candidates (or an explicit singleton justification),
 * without an evaluator independent of the mutator, without a holdout, or
 * without a rollback target is INVALID — it cannot carry a verdict.
 *
 * GENERATOR ≠ JUDGE is structural: evaluator.owner must differ from
 * mutation author, and the evaluator ref must point at machinery that
 * existed before the candidates (declared_before_candidates).
 */
import { createHash } from 'node:crypto';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const list = (v) => Array.isArray(v) && v.length > 0;
const joinParts = (...p) => p.map((x) => { const t = String(x ?? ''); return `${t.length}:${t}`; }).join('|');

/** Multi-surface adaptation ladder (§18). Lower index = more reversible. */
export const MUTATION_SURFACES = [
  'L0_TASK_STATE', 'L1_MEMORY', 'L2_RETRIEVAL_SKILLS', 'L3_PROMPT_HARNESS',
  'L4_WORKFLOW_POLICY_CODE', 'L5_LOCAL_EVALUATOR', 'L6_WEIGHTS', 'L7_META_OPERATOR', 'L8_POPULATION',
];
export const VERDICTS = ['PROMOTE', 'HOLD', 'REPAIR', 'REJECT', 'QUARANTINE'];

export function makeEvolutionCase(c) {
  const errors = [];
  if (!text(c?.mission)) errors.push('mission required');
  if (!text(c?.observedFailure)) errors.push('observedFailure required — no case without a real failure');
  if (!list(c?.diagnoses) || c.diagnoses.length < 2) errors.push('>=2 competing diagnoses required (§60.4) — a single explanation is unexamined');
  for (const d of c?.diagnoses ?? []) if (!text(d?.hypothesis) || !text(d?.evidence)) errors.push('each diagnosis needs hypothesis + evidence');
  if (!MUTATION_SURFACES.includes(c?.selectedSurface)) errors.push(`selectedSurface must be one of the ladder surfaces (got ${c?.selectedSurface})`);
  if (!text(c?.surfaceSelectionReason)) errors.push('surfaceSelectionReason required — argue LOWEST SUFFICIENT, not preferred');
  if (!list(c?.candidateMutations) || c.candidateMutations.length < 2) errors.push('>=2 candidate mutations required (§60.6) unless meaningfully impossible — then this case shape is wrong');
  for (const m of c?.candidateMutations ?? []) {
    if (!text(m?.id) || !text(m?.change)) errors.push('each candidate needs id + change');
    if (!text(m?.rollback)) errors.push(`candidate ${m?.id} needs a rollback`);
  }
  const ev = c?.evaluator;
  if (!text(ev?.ref)) errors.push('evaluator.ref required');
  if (!text(ev?.owner)) errors.push('evaluator.owner required');
  if (text(ev?.owner) && text(c?.mutationAuthor) && ev.owner === c.mutationAuthor) {
    errors.push('GENERATOR ≠ JUDGE: evaluator.owner must differ from mutationAuthor (§20)');
  }
  if (ev?.declared_before_candidates !== true) errors.push('evaluator must be declared before candidates exist — a judge minted after the contestants is not independent');
  if (!list(c?.holdout)) errors.push('holdout[] required — cases the candidates were not built against');
  if (!text(c?.baseline)) errors.push('baseline required (measurable pre-mutation behavior)');
  if (!text(c?.rollbackTarget)) errors.push('rollbackTarget required (exact SHA or ref)');
  const verdict = c?.verdict ?? 'HOLD';
  if (!VERDICTS.includes(verdict)) errors.push(`verdict must be one of ${VERDICTS.join('|')}`);
  if (verdict === 'PROMOTE') {
    if (!text(c?.promotedCandidate)) errors.push('PROMOTE requires promotedCandidate');
    if (!list(c?.holdoutResults) || !c.holdoutResults.every((h) => h?.pass === true)) {
      errors.push('PROMOTE requires holdoutResults with every case passing — a failed holdout cannot promote');
    }
    if (!text(c?.mechanismAttribution)) errors.push('PROMOTE requires mechanismAttribution — WHY did the winner win');
  }
  const eCase = {
    case_id: 'ec_' + sha(joinParts(c?.mission, c?.observedFailure)).slice(0, 16),
    system_revision: c?.systemRevision ?? 'UNKNOWN',
    mission: c?.mission ?? null,
    observed_failure: c?.observedFailure ?? null,
    novelty_state: c?.noveltyState ?? 'IMPLEMENTATION_DEFECT',
    diagnoses: c?.diagnoses ?? [],
    selected_surface: c?.selectedSurface ?? null,
    surface_selection_reason: c?.surfaceSelectionReason ?? null,
    candidate_mutations: c?.candidateMutations ?? [],
    mutation_author: c?.mutationAuthor ?? null,
    baseline: c?.baseline ?? null,
    evaluator: ev ?? null,
    holdout: c?.holdout ?? [],
    holdout_results: c?.holdoutResults ?? [],
    cost_delta: c?.costDelta ?? 'UNKNOWN',
    regressions: c?.regressions ?? [],
    mechanism_attribution: c?.mechanismAttribution ?? null,
    verdict,
    promoted_candidate: c?.promotedCandidate ?? null,
    negative_evidence: c?.negativeEvidence ?? [],
    parent_lineage: c?.parentLineage ?? null,
    rollback_target: c?.rollbackTarget ?? null,
    valid: errors.length === 0,
    errors,
  };
  return eCase;
}
