import { assert, digest, sealPlain } from './core.mjs';
import { requireExactEvidenceRealm, resolveCanonicalReceipt } from './receipts.mjs';

export const ACTIONS = sealPlain({
  PROPOSE:'PROPOSE', AUTHORIZE_EXPERIMENT:'AUTHORIZE_EXPERIMENT', EXECUTE_EXPERIMENT:'EXECUTE_EXPERIMENT',
  SETTLE_EXPERIMENT:'SETTLE_EXPERIMENT', ADMIT_LESSON:'ADMIT_LESSON', PROMOTE_CHALLENGER:'PROMOTE_CHALLENGER',
  AUTHORIZE_REALITY_CELL:'AUTHORIZE_REALITY_CELL',
  EXECUTE_EXPERIENCE_CANDIDATE:'EXECUTE_EXPERIENCE_CANDIDATE', ROLLBACK_EXPERIENCE_VERSION:'ROLLBACK_EXPERIENCE_VERSION',
});

// Legacy in-memory principal gate retained only for read-only/local unit-level code. High-impact v3 paths use receipt-bound gate below.
export function requireVerifiedPrincipal(principal, action) {
  assert(principal && typeof principal==='object','verified principal required','AUTH_REQUIRED');
  assert(principal.verified===true,'principal is not verified','AUTH_NOT_VERIFIED');
  assert(typeof principal.subject==='string'&&principal.subject.length>0,'principal subject required','AUTH_SUBJECT_REQUIRED');
  assert(Array.isArray(principal.allowedActions),'principal allowedActions required','AUTH_ACTIONS_REQUIRED');
  assert(principal.allowedActions.includes(action),`principal lacks ${action}`,'AUTH_FORBIDDEN');
  return sealPlain({subject:principal.subject,action,verifiedBy:principal.verifiedBy??'canonical-cana-auth',authorityDigest:digest({subject:principal.subject,action,verifiedBy:principal.verifiedBy??'canonical-cana-auth'})});
}

export async function requirePrincipalReceipt(evidenceAdapter,principalReceiptDigest,action){
  const receipt=await resolveCanonicalReceipt(evidenceAdapter,principalReceiptDigest,{kind:'PRINCIPAL',minimumRealm:'VERIFIED_LOCAL'});
  assert(receipt.payload?.verified===true,'principal receipt not verified','AUTH_NOT_VERIFIED');
  assert(Array.isArray(receipt.payload?.allowedActions)&&receipt.payload.allowedActions.includes(action),`principal lacks ${action}`,'AUTH_FORBIDDEN');
  assert(receipt.payload?.subject,'principal subject required','AUTH_SUBJECT_REQUIRED');
  return sealPlain({subject:receipt.payload.subject,action,principalReceiptDigest:receipt.receiptDigest,authorityDigest:digest({principalReceiptDigest:receipt.receiptDigest,action},'authority')});
}

export function assertIndependentVerifier({proposerId,verifierId}){
  assert(proposerId&&verifierId,'proposerId and verifierId required','VERIFIER_ID_REQUIRED');
  assert(proposerId!==verifierId,'proposer cannot self-certify','SELF_CERTIFICATION_FORBIDDEN');
  return true;
}

function requiredAuthorityEffects(experiment) {
  const configured = experiment?.merchantAuthorityRequirement?.allowedEffectSet;
  return Array.isArray(configured) && configured.length > 0
    ? configured
    : [];
}

export async function requireRealityCellAuthority({
  experiment,
  evidenceAdapter,
  authorityBinding,
  now = new Date(),
}) {
  assert(experiment?.preregistrationDigest, 'Reality Cell preregistration required', 'INVALID_AUTHORITY_LINEAGE');
  assert(authorityBinding && typeof authorityBinding === 'object', 'Reality Cell authority binding required', 'INVALID_AUTHORITY_LINEAGE');
  assert(authorityBinding.experimentId === experiment.experimentId, 'authority experiment mismatch', 'INVALID_AUTHORITY_LINEAGE');
  assert(authorityBinding.preregistrationDigest === experiment.preregistrationDigest, 'authority preregistration mismatch', 'INVALID_AUTHORITY_LINEAGE');
  assert(authorityBinding.candidateDigest === experiment.treatmentDefinition?.candidateDigest, 'authority candidate mismatch', 'INVALID_AUTHORITY_LINEAGE');
  const owner = await resolveCanonicalReceipt(evidenceAdapter, authorityBinding.ownerPrincipalReceiptDigest, {
    kind: 'PRINCIPAL',
    now,
  });
  const fixture = experiment.evidenceRealm === 'FIXTURE' || experiment.evidenceRealm === 'SIMULATED';
  if (fixture) requireExactEvidenceRealm(owner, experiment.evidenceRealm);
  else assert(['VERIFIED_LOCAL', 'VERIFIED_REAL'].includes(owner.realm), 'Owner authority realm invalid', 'INVALID_AUTHORITY_LINEAGE');
  assert(owner.payload?.verified === true, 'canonical Owner principal not verified', 'AUTH_NOT_VERIFIED');
  assert(owner.payload?.subject, 'canonical Owner subject required', 'AUTH_SUBJECT_REQUIRED');
  assert(owner.subjectDigest === digest({ subject: owner.payload.subject }, 'principal-subject'), 'Owner principal subject lineage invalid', 'INVALID_AUTHORITY_LINEAGE');
  if (fixture) {
    assert(owner.issuer === 'fixture-canonical-owner-session' && owner.payload?.fixtureOnly === true, 'fixture Owner lineage invalid', 'INVALID_AUTHORITY_LINEAGE');
  } else {
    assert(owner.issuer === 'canonical-owner-session' && owner.payload?.verifiedBy === 'canonical-assertAdmin', 'canonical Owner lineage invalid', 'INVALID_AUTHORITY_LINEAGE');
  }
  assert(Array.isArray(owner.payload?.allowedActions) && owner.payload.allowedActions.includes(ACTIONS.AUTHORIZE_REALITY_CELL), 'Owner lacks Reality Cell authority', 'AUTH_FORBIDDEN');

  const merchant = await resolveCanonicalReceipt(evidenceAdapter, authorityBinding.merchantAuthorizationReceiptDigest, {
    kind: 'MERCHANT_AUTHORIZATION',
    subjectDigest: experiment.preregistrationDigest,
    now,
  });
  requireExactEvidenceRealm(merchant, fixture ? experiment.evidenceRealm : 'VERIFIED_REAL');
  const payload = merchant.payload ?? {};
  if (fixture) {
    assert(merchant.issuer === 'fixture-merchant-authority-not-real' && payload.fixtureOnly === true, 'fixture merchant authority lineage invalid', 'INVALID_AUTHORITY_LINEAGE');
  } else {
    assert(merchant.issuer === 'canonical-merchant-authority' && payload.verifiedBy === 'canonical-merchant-role-gate' && payload.authorizationEvidenceDigest, 'canonical merchant authority lineage invalid', 'INVALID_AUTHORITY_LINEAGE');
  }
  assert(payload.decision === 'AUTHORIZED', 'merchant authorization decision missing', 'MERCHANT_AUTHORITY_REQUIRED');
  assert(payload.merchantPrincipalId, 'merchant principal identity required', 'MERCHANT_AUTHORITY_REQUIRED');
  assert(payload.merchantId === experiment.merchantId && payload.tenantId === experiment.tenantId, 'merchant tenant authorization mismatch', 'MERCHANT_AUTHORITY_MISMATCH');
  assert(payload.experimentId === experiment.experimentId, 'merchant experiment authorization mismatch', 'MERCHANT_AUTHORITY_MISMATCH');
  assert(payload.preregistrationDigest === experiment.preregistrationDigest, 'merchant preregistration authorization mismatch', 'MERCHANT_AUTHORITY_MISMATCH');
  assert(payload.candidateDigest === experiment.treatmentDefinition?.candidateDigest, 'merchant candidate authorization mismatch', 'MERCHANT_AUTHORITY_MISMATCH');
  assert(payload.rollbackContractDigest === experiment.rollbackContract?.digest, 'merchant rollback authorization mismatch', 'MERCHANT_AUTHORITY_MISMATCH');
  assert(Array.isArray(payload.allowedEffectSet), 'merchant allowed effect set required', 'MERCHANT_AUTHORITY_MISMATCH');
  const requiredEffects = requiredAuthorityEffects(experiment);
  assert(requiredEffects.every((effect) => payload.allowedEffectSet.includes(effect)), 'merchant authority does not cover required effects', 'MERCHANT_AUTHORITY_MISMATCH');
  assert(payload.expiresAt && new Date(payload.expiresAt).getTime() >= new Date(now).getTime(), 'merchant authorization expired', 'MERCHANT_AUTHORITY_EXPIRED');
  assert(authorityBinding.expiresAt === payload.expiresAt, 'authority expiration mismatch', 'INVALID_AUTHORITY_LINEAGE');
  const realWorldExecutionAllowed = !fixture && merchant.realm === 'VERIFIED_REAL';
  assert(authorityBinding.realWorldExecutionAllowed === realWorldExecutionAllowed, 'authority execution classification mismatch', 'INVALID_AUTHORITY_LINEAGE');
  return sealPlain({ owner, merchant, realWorldExecutionAllowed });
}

export async function createRealityCellAuthorityBinding({
  experiment,
  evidenceAdapter,
  ownerPrincipalReceiptDigest,
  merchantAuthorizationReceiptDigest,
  now = new Date(),
}) {
  const merchant = await resolveCanonicalReceipt(evidenceAdapter, merchantAuthorizationReceiptDigest, {
    kind: 'MERCHANT_AUTHORIZATION',
    subjectDigest: experiment?.preregistrationDigest,
    now,
  });
  const fixture = experiment?.evidenceRealm === 'FIXTURE' || experiment?.evidenceRealm === 'SIMULATED';
  const binding = sealPlain({
    experimentId: experiment?.experimentId,
    preregistrationDigest: experiment?.preregistrationDigest,
    candidateDigest: experiment?.treatmentDefinition?.candidateDigest,
    ownerPrincipalReceiptDigest,
    merchantAuthorizationReceiptDigest,
    allowedEffectSet: [...(merchant.payload?.allowedEffectSet ?? [])],
    rollbackContractDigest: merchant.payload?.rollbackContractDigest ?? null,
    expiresAt: merchant.payload?.expiresAt ?? null,
    evidenceRealm: experiment?.evidenceRealm,
    realWorldExecutionAllowed: !fixture,
  });
  await requireRealityCellAuthority({ experiment, evidenceAdapter, authorityBinding: binding, now });
  return binding;
}
