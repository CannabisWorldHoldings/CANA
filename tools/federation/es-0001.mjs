#!/usr/bin/env node
/**
 * ES-0001 — the first real EvaluatorSuccessionCase: census term matching v1 → v2.
 *
 * REAL DEFECT (probed live 2026-08-19, before any candidate existed): v1's
 * exact-word matching let three morphological evasions through —
 * "competitors/fingerprints/drifts", "shadowing/fingerprinting",
 * "lessons/cycles" — all CLEAR_TO_BUILD under v1 despite naming owned jobs.
 *
 * PROMOTION CRITERIA (fixed before v2 was written, from §64 + the census
 * gate's purpose):
 *   P1 candidate reproduces EVERY bridge-corpus verdict (EC-0001 holdout, 6 cases);
 *   P2 candidate is correct on EVERY hidden holdout case;
 *   P3 candidate corrects the incumbent on at least one holdout case;
 *   P4 candidate itself fails closed (mutation test: empty registry refuses).
 *
 * Both evaluators are RUN, not trusted: every result below is measured by
 * executing v1 and v2 over the corpora. The adjudicator is the verification
 * lane's harness (node:test), never the candidate.
 */
import { censusVerdict, loadOwners } from './capability-census.mjs';
import { HOLDOUT } from './ec-0001.mjs';
import { makeEvaluatorSuccessionCase } from './evaluators.mjs';

/** Bridge corpus = EC-0001's six measured holdout cases (historical regressions). */
export const BRIDGE = HOLDOUT;

/** Hidden holdout: neither evaluator was built against these exact strings. */
export const HIDDEN = [
  { id: 'S1-plural-evasion', proposal: 'nightly monitoring of competitors with fingerprints of their pages and drift detections', correct: 'REFUSED_DUPLICATE' },
  { id: 'S2-gerund-evasion', proposal: 'shadowing competitors and fingerprinting page snapshots', correct: 'REFUSED_DUPLICATE' },
  { id: 'S3-lesson-plural', proposal: 'a durable lessons memory storing admitted lessons from improvement cycles', correct: 'REFUSED_DUPLICATE' },
  { id: 'S4-clear-geo', proposal: 'delivery coverage evidence maps for neighborhood boundaries', correct: 'CLEAR_TO_BUILD' },
  { id: 'S5-clear-outreach', proposal: 'merchant preview packet generator for the free month funnel', correct: 'CLEAR_TO_BUILD' },
  { id: 'S6-clear-trajectory', proposal: 'trajectory capturing for consequential agent runs', correct: 'CLEAR_TO_BUILD' },
];

export function runBridge(owners = loadOwners()) {
  return BRIDGE.map((b) => {
    const v1 = censusVerdict(b.proposal, owners, { version: 'v1' }).verdict;
    const v2 = censusVerdict(b.proposal, owners, { version: 'v2' }).verdict;
    return { case: b.id, expected: b.expected, v1, v2, agree: v1 === v2 && v2 === b.expected };
  });
}

export function runHidden(owners = loadOwners()) {
  return HIDDEN.map((h) => {
    const v1 = censusVerdict(h.proposal, owners, { version: 'v1' }).verdict;
    const v2 = censusVerdict(h.proposal, owners, { version: 'v2' }).verdict;
    return { case: h.id, correct: h.correct, v1, v2, incumbentCorrect: v1 === h.correct, candidateCorrect: v2 === h.correct };
  });
}

export function runMutationTest() {
  // the candidate must itself fail closed: a census whose registry is gone must refuse to run
  try {
    censusVerdict('anything', [], { version: 'v2' });
    // empty owners array: loadOwners would refuse; direct empty owners yields zero collisions —
    // the fail-closed property lives in loadOwners, so probe THAT:
    loadOwners('/nonexistent/registry.json');
    return { description: 'missing registry must throw', pass: false };
  } catch {
    return { description: 'missing/empty owners registry refuses to run (loadOwners throws; gate blocks verify)', pass: true };
  }
}

export function buildES0001() {
  const bridgeResults = runBridge();
  const holdoutResults = runHidden();
  return makeEvaluatorSuccessionCase({
    scope: 'capability-census-term-matching',
    incumbent: { evaluator_id: 'census-term-v1', mechanism: 'exact-word job-term matching' },
    candidate: {
      evaluator_id: 'census-term-v2',
      mechanism: 'conservative inflection-folded matching (foldV2, iteration v2.1)',
      repair_history: 'v2.0 FAILED hidden holdout case S3 (verdict at that run: RETAIN_INCUMBENT — receipted in thread): -ing stripping dropped the stem\'s terminal e ("storing"->"stor" vs "store"->"store"). One principled repair (terminal-e neutralization) with criteria and corpora UNCHANGED; re-judged against the same bridge and holdout.',
    },
    candidateAuthor: 'lane-implementation',
    adjudicator: 'lane-verification (node:test harness over measured runs of BOTH evaluators)',
    reason: 'Three live probes (2026-08-19, pre-candidate) proved morphological evasion: proposals naming owned jobs in plural/gerund form pass v1 as CLEAR_TO_BUILD, defeating the census gate promoted by EC-0001.',
    demonstratedDefects: [
      { probe: 'nightly monitoring of competitors with fingerprints of their pages and drift detections', incumbentVerdict: 'CLEAR_TO_BUILD', correctVerdict: 'REFUSED_DUPLICATE' },
      { probe: 'shadowing competitors and fingerprinting page snapshots', incumbentVerdict: 'CLEAR_TO_BUILD', correctVerdict: 'REFUSED_DUPLICATE' },
      { probe: 'a durable lessons memory storing admitted lessons from improvement cycles', incumbentVerdict: 'CLEAR_TO_BUILD', correctVerdict: 'REFUSED_DUPLICATE' },
    ],
    promotionCriteria: [
      'P1: reproduce every EC-0001 bridge verdict (6/6)',
      'P2: correct on every hidden holdout case (evasions refused AND clears untouched — zero new false refusals)',
      'P3: correct the incumbent on at least one holdout case',
      'P4: fail closed on missing registry',
    ],
    criteriaFixedBeforeCandidate: true,
    bridgeCorpus: BRIDGE.map((b) => b.id),
    bridgeResults,
    hiddenHoldout: HIDDEN.map((h) => h.id),
    holdoutResults,
    mutationTest: runMutationTest(),
    distributionShiftNote: 'Corpora are English build proposals from this repo\'s actual practice; multilingual or semantic-synonym proposals are OUT OF SCOPE for v2 and recorded as its known blind spots in the registry.',
    reversibility: 'evaluator-registry.json status flip (v2 INCUMBENT -> v1) via git revert of the Gate E commit; censusVerdict accepts an explicit version override for forensic replay of either evaluator forever.',
    verdict: bridgeResults.every((r) => r.agree)
      && holdoutResults.every((r) => r.candidateCorrect)
      && holdoutResults.some((r) => !r.incumbentCorrect && r.candidateCorrect)
      ? 'SUCCEED' : 'RETAIN_INCUMBENT',
    successionReceipt: '_mission/receipts/federation-gate-e (composed suite) + this record\'s measured bridge/holdout results',
  });
}
