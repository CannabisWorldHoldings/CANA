import { assert, digest, newId, sealPlain } from './core.mjs';
import { assertIndependentVerifier, requirePrincipalReceipt, ACTIONS } from './authority.mjs';
import {
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
} from './receipts.mjs';

export async function evaluateChallenger({
  incumbent,
  challenger,
  lessonId,
  cases,
  evaluator,
  ablator,
  verifierId,
  proposerId,
  evidenceAdapter,
  principalReceiptDigest,
  nextCycleReceiptDigest = null,
  subsequentRealityReceiptDigest = null,
}) {
  const lesson = await evidenceAdapter.loadLesson(lessonId);
  assert(lesson, 'canonical lesson not found', 'RSI_LESSON_NOT_FOUND');
  assert(lesson.lessonId === lessonId, 'canonical lesson identity mismatch', 'RSI_LESSON_IDENTITY_MISMATCH');
  assert(lesson.status === 'ADMITTED' && lesson.trusted === true, 'canonical lesson was not admitted', 'UNVERIFIED_LESSON_FOR_RSI');
  const admission = await resolveCanonicalReceipt(evidenceAdapter, lesson.admissionDigest, {
    kind: 'LESSON_ADMISSION',
    subjectDigest: lesson.lessonDigest,
  });
  requireExactEvidenceRealm(admission, 'VERIFIED_REAL');
  assert(admission.payload?.lessonId === lessonId && admission.payload?.verdict === 'ADMIT' && admission.payload?.causalEnough === true && admission.payload?.realEnough === true, 'lesson admission receipt is insufficient', 'UNVERIFIED_LESSON_FOR_RSI');
  const value = await resolveCanonicalReceipt(evidenceAdapter, lesson.valueReceiptDigest, {
    kind: 'VALUE',
    subjectDigest: lesson.settlementDigest,
  });
  requireExactEvidenceRealm(value, 'VERIFIED_REAL');
  assert(value.payload?.settlementClassification === 'CAUSAL_SUPPORTED', 'lesson ValueReceipt is insufficient', 'UNVERIFIED_LESSON_FOR_RSI');
  if (lesson.expiresAt) assert(new Date(lesson.expiresAt).getTime() >= Date.now(), 'lesson expired', 'RSI_LESSON_EXPIRED');
  assertIndependentVerifier({ proposerId, verifierId });
  await requirePrincipalReceipt(evidenceAdapter, principalReceiptDigest, ACTIONS.PROMOTE_CHALLENGER);
  assert(typeof evaluator === 'function' && typeof ablator === 'function', 'evaluator and ablator required');
  assert(Array.isArray(cases) && cases.length > 0, 'frozen evaluation cases required');
  const incumbentResult = await evaluator({ mechanism: incumbent, cases });
  const challengerResult = await evaluator({ mechanism: challenger, cases });
  const ablation = await ablator({ incumbent, challenger, lesson, cases });
  const improved = Number(challengerResult.score) > Number(incumbentResult.score);
  const lessonLinked = ablation.lessonContributionEstablished === true && ablation.lessonId === lesson.lessonId;
  const regressions = Number(challengerResult.criticalRegressions ?? 0);
  const challengerWins = improved && lessonLinked && regressions === 0;
  const challengerDigest = digest(challenger);
  let nextCycle = null;
  let subsequentReality = null;
  if (nextCycleReceiptDigest) {
    nextCycle = await resolveCanonicalReceipt(evidenceAdapter, nextCycleReceiptDigest, {
      kind: 'MODEL_TRIAL',
      subjectDigest: challengerDigest,
      minimumRealm: 'VERIFIED_LOCAL',
    });
    assert(nextCycle.payload?.lessonId === lessonId && nextCycle.payload?.ranNextImprovementCycle === true, 'challenger did not run the next improvement cycle', 'RSI_NEXT_CYCLE_REQUIRED');
  }
  if (subsequentRealityReceiptDigest) {
    subsequentReality = await resolveCanonicalReceipt(evidenceAdapter, subsequentRealityReceiptDigest, {
      kind: 'COURT',
      subjectDigest: challengerDigest,
    });
    requireExactEvidenceRealm(subsequentReality, 'VERIFIED_REAL');
    assert(subsequentReality.payload?.court === 'SUBSEQUENT_REALITY' && subsequentReality.payload?.verdict === 'PASS', 'subsequent reality did not confirm the challenger', 'RSI_SUBSEQUENT_REALITY_REQUIRED');
  }
  const rsiEstablished = challengerWins && Boolean(nextCycle) && Boolean(subsequentReality);
  const body = {
    trialId: newId('rsi'),
    lessonId: lesson.lessonId,
    admissionDigest: lesson.admissionDigest,
    incumbentDigest: digest(incumbent),
    challengerDigest,
    incumbentResult,
    challengerResult,
    ablation,
    verifierId,
    verdict: challengerWins ? 'CHALLENGER_WINS' : 'REJECT',
    nextCycleReceiptDigest: nextCycle?.receiptDigest ?? null,
    subsequentRealityReceiptDigest: subsequentReality?.receiptDigest ?? null,
    realRsi: rsiEstablished ? 'ESTABLISHED' : 'NOT_ESTABLISHED',
    createdAt: new Date().toISOString(),
  };
  return sealPlain({ ...body, trialDigest: digest(body, 'rsi-trial') });
}

export function recursiveImproverCourt({ parentImproverDigest, successorImproverDigest, nextCycleReceiptDigest, ablationReceiptDigest }) {
  const pass = Boolean(parentImproverDigest && successorImproverDigest && parentImproverDigest !== successorImproverDigest && nextCycleReceiptDigest && ablationReceiptDigest);
  return sealPlain({
    parentImproverDigest,
    successorImproverDigest,
    nextCycleReceiptDigest: nextCycleReceiptDigest ?? null,
    ablationReceiptDigest: ablationReceiptDigest ?? null,
    verdict: pass ? 'RECURSIVE_IMPROVEMENT_SUPPORTED' : 'NOT_ESTABLISHED',
  });
}
