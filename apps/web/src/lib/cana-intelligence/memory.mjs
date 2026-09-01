import { assert, digest, newId, sealPlain } from './core.mjs';
import { assertIndependentVerifier, requirePrincipalReceipt, ACTIONS } from './authority.mjs';
import {
  makeReceipt,
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
} from './receipts.mjs';
export function proposeLesson({claim,scope,context,valueReceipt,proposerId,counterevidence=[]}){assert(claim&&scope,'claim and scope required');return sealPlain({lessonId:newId('lesson'),claim,scope,context:context??{},valueReceiptDigest:valueReceipt?.receiptDigest??null,causalStatus:valueReceipt?.causalStatus??'UNESTABLISHED',counterevidence,proposerId,status:'PROPOSED',trusted:false,createdAt:new Date().toISOString()});}
export async function admitLesson(lesson,{verifierId,verdict,evidenceDigest},evidenceAdapter,principalReceiptDigest){assertIndependentVerifier({proposerId:lesson.proposerId,verifierId});await requirePrincipalReceipt(evidenceAdapter,principalReceiptDigest,ACTIONS.ADMIT_LESSON);assert(verdict==='ADMIT'||verdict==='REJECT','verdict must be ADMIT or REJECT');const causalEnough=lesson.causalStatus==='CAUSALLY_SUPPORTED'&&Boolean(lesson.valueReceiptDigest);const admitted=verdict==='ADMIT'&&causalEnough;const updated=sealPlain({...lesson,verifierId,verificationEvidenceDigest:evidenceDigest,status:admitted?'ADMITTED':'REJECTED',trusted:admitted});const admissionReceipt=makeReceipt({kind:'LESSON_ADMISSION',subjectDigest:digest(updated,'lesson'),realm:'VERIFIED_LOCAL',issuer:verifierId,payload:{lessonId:lesson.lessonId,verdict,evidenceDigest,causalEnough,valueReceiptDigest:lesson.valueReceiptDigest}});return sealPlain({...updated,admissionDigest:admissionReceipt.receiptDigest,admissionReceipt});}

export function proposeRealityCellLesson({ claim, scope, context, valueReceipt, proposerId, counterevidence = [] }) {
  assert(claim && scope && proposerId, 'Reality Cell lesson proposal incomplete', 'LESSON_PROPOSAL_INCOMPLETE');
  assert(valueReceipt?.receiptDigest && valueReceipt?.settlementDigest, 'ValueReceipt required for Reality Cell lesson', 'LESSON_VALUE_RECEIPT_REQUIRED');
  const body = {
    lessonId: newId('lesson'),
    claim,
    scope,
    context: context ?? {},
    valueReceiptDigest: valueReceipt.receiptDigest,
    settlementDigest: valueReceipt.settlementDigest,
    causalStatus: valueReceipt.settlementClassification,
    evidenceRealm: valueReceipt.evidenceRealm,
    counterevidence,
    proposerId,
    status: 'PROPOSED',
    trusted: false,
    createdAt: new Date().toISOString(),
  };
  return sealPlain({ ...body, lessonDigest: digest(body, 'reality-cell-lesson') });
}

export async function admitRealityCellLesson(lesson, {
  verifierReceiptDigest,
  principalReceiptDigest,
  now = new Date(),
}, evidenceAdapter) {
  const valueReceipt = await resolveCanonicalReceipt(evidenceAdapter, lesson?.valueReceiptDigest, {
    kind: 'VALUE',
    subjectDigest: lesson?.settlementDigest,
    now,
  });
  requireExactEvidenceRealm(valueReceipt, lesson.evidenceRealm);
  const verifier = await resolveCanonicalReceipt(evidenceAdapter, verifierReceiptDigest, {
    kind: 'VERIFIER',
    subjectDigest: lesson.lessonDigest,
    now,
  });
  requireExactEvidenceRealm(verifier, lesson.evidenceRealm);
  assertIndependentVerifier({ proposerId: lesson.proposerId, verifierId: verifier.payload?.verifierId });
  assert(verifier.payload?.verdict === 'ADMIT' || verifier.payload?.verdict === 'REJECT', 'lesson verifier verdict invalid', 'LESSON_VERDICT_INVALID');
  if (lesson.evidenceRealm === 'VERIFIED_REAL') {
    await requirePrincipalReceipt(evidenceAdapter, principalReceiptDigest, ACTIONS.ADMIT_LESSON);
  } else {
    const fixturePrincipal = await resolveCanonicalReceipt(evidenceAdapter, principalReceiptDigest, { kind: 'PRINCIPAL', now });
    requireExactEvidenceRealm(fixturePrincipal, lesson.evidenceRealm);
    assert(fixturePrincipal.payload?.verified === true && fixturePrincipal.payload?.allowedActions?.includes(ACTIONS.ADMIT_LESSON), 'fixture admission principal invalid', 'AUTH_FORBIDDEN');
  }
  const causalEnough = lesson.causalStatus === 'CAUSAL_SUPPORTED'
    && valueReceipt.payload?.settlementClassification === 'CAUSAL_SUPPORTED';
  const realEnough = lesson.evidenceRealm === 'VERIFIED_REAL';
  const admitted = verifier.payload.verdict === 'ADMIT' && causalEnough && realEnough;
  const status = admitted
    ? 'ADMITTED'
    : lesson.evidenceRealm === 'VERIFIED_REAL'
      ? 'REJECTED'
      : 'REJECTED_FIXTURE_BOUNDARY';
  const updated = sealPlain({
    ...lesson,
    verifierId: verifier.payload.verifierId,
    verifierReceiptDigest: verifier.receiptDigest,
    status,
    trusted: admitted,
  });
  const admissionReceipt = makeReceipt({
    kind: 'LESSON_ADMISSION',
    subjectDigest: lesson.lessonDigest,
    realm: lesson.evidenceRealm,
    issuer: verifier.payload.verifierId,
    payload: {
      lessonId: lesson.lessonId,
      verdict: admitted ? 'ADMIT' : 'REJECT',
      causalEnough,
      realEnough,
      valueReceiptDigest: lesson.valueReceiptDigest,
      verifierReceiptDigest: verifier.receiptDigest,
    },
    parentDigests: [lesson.valueReceiptDigest, verifier.receiptDigest, principalReceiptDigest],
  });
  return sealPlain({ ...updated, admissionDigest: admissionReceipt.receiptDigest, admissionReceipt });
}
