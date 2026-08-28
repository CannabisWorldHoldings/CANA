import { assert, digest, sealPlain } from './core.mjs';
import { resolveCanonicalReceipt } from './receipts.mjs';

export const ACTIONS = sealPlain({
  PROPOSE:'PROPOSE', AUTHORIZE_EXPERIMENT:'AUTHORIZE_EXPERIMENT', EXECUTE_EXPERIMENT:'EXECUTE_EXPERIMENT',
  SETTLE_EXPERIMENT:'SETTLE_EXPERIMENT', ADMIT_LESSON:'ADMIT_LESSON', PROMOTE_CHALLENGER:'PROMOTE_CHALLENGER',
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
