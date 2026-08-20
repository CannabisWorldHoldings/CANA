#!/usr/bin/env node
/**
 * CANA FEDERATION — GATE E: EVALUATOR SUCCESSION (§22, §64)
 *
 * Evaluators may become inadequate, but succession can never be:
 *   candidate evaluator → candidate grades itself → PASS.
 *
 * makeEvaluatorSuccessionCase is fail-closed: a case without a real incumbent
 * defect, a bridge corpus (historical regressions the candidate must
 * reproduce), a hidden holdout (cases the candidate was not built against),
 * a mutation test of the candidate's own fail-closed behavior, promotion
 * criteria FIXED BEFORE the candidate existed, and a reversibility path is
 * INVALID. Self-certification is structural refusal: the adjudicator may not
 * be the candidate or its author, and every measured verdict must come from
 * RUNNING BOTH evaluators — agreement with the incumbent on the bridge,
 * superiority only where the incumbent's documented defect lies.
 */
import { createHash } from 'node:crypto';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const list = (v) => Array.isArray(v) && v.length > 0;
const joinParts = (...p) => p.map((x) => { const t = String(x ?? ''); return `${t.length}:${t}`; }).join('|');

export const SUCCESSION_VERDICTS = ['SUCCEED', 'RETAIN_INCUMBENT'];

export function makeEvaluatorSuccessionCase(c) {
  const errors = [];
  if (!text(c?.scope)) errors.push('scope required');
  if (!text(c?.incumbent?.evaluator_id)) errors.push('incumbent.evaluator_id required');
  if (!text(c?.candidate?.evaluator_id)) errors.push('candidate.evaluator_id required');
  if (c?.incumbent?.evaluator_id === c?.candidate?.evaluator_id) errors.push('candidate must differ from incumbent');
  if (!text(c?.reason)) errors.push('reason required — succession without a demonstrated inadequacy is churn');
  if (!list(c?.demonstratedDefects)) errors.push('demonstratedDefects[] required — each a REAL probe the incumbent got wrong');
  for (const d of c?.demonstratedDefects ?? []) {
    if (!text(d?.probe) || !text(d?.incumbentVerdict) || !text(d?.correctVerdict)) errors.push('each defect needs probe + incumbentVerdict + correctVerdict');
  }
  if (!text(c?.adjudicator)) errors.push('adjudicator required');
  if (text(c?.adjudicator) && (c.adjudicator === c?.candidate?.evaluator_id || c.adjudicator === c?.candidateAuthor)) {
    errors.push('SELF-CERTIFICATION REFUSED: adjudicator may not be the candidate or its author (§22)');
  }
  if (!list(c?.promotionCriteria)) errors.push('promotionCriteria[] required');
  if (c?.criteriaFixedBeforeCandidate !== true) errors.push('promotion criteria must be fixed BEFORE the candidate exists — criteria written after the contestant can be shaped to crown it');
  if (!list(c?.bridgeCorpus)) errors.push('bridgeCorpus[] required — historical cases whose verdicts the candidate must reproduce');
  if (!list(c?.hiddenHoldout)) errors.push('hiddenHoldout[] required — cases the candidate was not built against');
  if (!c?.mutationTest?.description || c?.mutationTest?.pass !== true) errors.push('mutationTest required and must pass — the candidate must itself fail closed');
  if (!text(c?.reversibility)) errors.push('reversibility required — an irreversible judge swap is forbidden');
  // measured results
  if (!list(c?.bridgeResults)) errors.push('bridgeResults[] required (measured, both evaluators)');
  if (!list(c?.holdoutResults)) errors.push('holdoutResults[] required (measured, both evaluators)');
  const verdict = c?.verdict;
  if (!SUCCESSION_VERDICTS.includes(verdict)) errors.push(`verdict must be one of ${SUCCESSION_VERDICTS.join('|')}`);
  if (verdict === 'SUCCEED') {
    const bridgeClean = (c?.bridgeResults ?? []).every((r) => r?.agree === true);
    if (!bridgeClean) errors.push('SUCCEED requires the candidate to reproduce EVERY bridge verdict — historical regression is disqualifying');
    const holdoutClean = (c?.holdoutResults ?? []).every((r) => r?.candidateCorrect === true);
    if (!holdoutClean) errors.push('SUCCEED requires the candidate to be correct on EVERY hidden holdout case');
    const defectsFixed = (c?.holdoutResults ?? []).some((r) => r?.incumbentCorrect === false && r?.candidateCorrect === true);
    if (!defectsFixed) errors.push('SUCCEED requires at least one holdout case where the candidate corrects the incumbent — otherwise there is no reason to succeed');
  }
  return {
    case_id: 'es_' + sha(joinParts(c?.scope, c?.incumbent?.evaluator_id, c?.candidate?.evaluator_id)).slice(0, 16),
    scope: c?.scope ?? null,
    incumbent: c?.incumbent ?? null,
    candidate: c?.candidate ?? null,
    candidate_author: c?.candidateAuthor ?? null,
    adjudicator: c?.adjudicator ?? null,
    reason: c?.reason ?? null,
    demonstrated_defects: c?.demonstratedDefects ?? [],
    promotion_criteria: c?.promotionCriteria ?? [],
    criteria_fixed_before_candidate: c?.criteriaFixedBeforeCandidate === true,
    bridge_corpus: c?.bridgeCorpus ?? [],
    bridge_results: c?.bridgeResults ?? [],
    hidden_holdout: c?.hiddenHoldout ?? [],
    holdout_results: c?.holdoutResults ?? [],
    mutation_test: c?.mutationTest ?? null,
    distribution_shift_note: c?.distributionShiftNote ?? 'NOT_ASSESSED',
    reversibility: c?.reversibility ?? null,
    verdict: verdict ?? null,
    succession_receipt: c?.successionReceipt ?? null,
    valid: errors.length === 0,
    errors,
  };
}
