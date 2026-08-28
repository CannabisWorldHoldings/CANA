import { assert, sealPlain, deepFreeze } from './core.mjs';
import { requirePrincipalReceipt, ACTIONS } from './authority.mjs';
import { resolveCanonicalReceipt } from './receipts.mjs';
export function createFullFabricAdapter(impl){
  const required=['enumerateExperienceSurfaces','loadExperienceManifest','persistExperienceCandidate','renderPrivatePreview','captureRenderedEvidenceReceipt','generateMediaCandidate','loadReceipt','resolveVerifiedPrincipalReceipt','executeAuthorizedExperienceCandidate','rollbackExperienceVersion'];
  for(const key of required)assert(typeof impl?.[key]==='function',`full fabric adapter missing ${key}`,'FULL_FABRIC_ADAPTER_INCOMPLETE');return deepFreeze({...impl,ownsAuth:false,ownsTruthStore:false,ownsRoutes:false,ownsMediaModel:false,authority:'CANONICAL_CANA_ONLY'});
}
export async function experiencePromotionCourt(adapter,candidate,{principalReceiptDigest,previewReceiptDigest,browserCourtReceiptDigest,realityCourtReceiptDigest,rollbackReceiptDigest}){
  const principal=await requirePrincipalReceipt(adapter,principalReceiptDigest,ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE);
  const preview=await resolveCanonicalReceipt(adapter,previewReceiptDigest,{kind:'PRIVATE_PREVIEW',subjectDigest:candidate.candidateDigest,minimumRealm:'VERIFIED_LOCAL'});
  const browser=await resolveCanonicalReceipt(adapter,browserCourtReceiptDigest,{kind:'COURT',subjectDigest:candidate.candidateDigest,minimumRealm:'VERIFIED_LOCAL'});
  const reality=await resolveCanonicalReceipt(adapter,realityCourtReceiptDigest,{kind:'COURT',subjectDigest:candidate.candidateDigest,minimumRealm:'VERIFIED_LOCAL'});
  const rollback=await resolveCanonicalReceipt(adapter,rollbackReceiptDigest,{kind:'ROLLBACK',subjectDigest:candidate.candidateDigest,minimumRealm:'VERIFIED_LOCAL'});
  assert(browser.payload?.court==='BROWSER'&&browser.payload?.verdict==='PASS','browser court not passed','EXPERIENCE_BROWSER_COURT_FAILED');
  assert(reality.payload?.court==='REALITY'&&reality.payload?.verdict==='PASS','reality court not passed','EXPERIENCE_REALITY_COURT_FAILED');
  const payload={candidateDigest:candidate.candidateDigest,principalReceiptDigest:principal.principalReceiptDigest,previewReceiptDigest:preview.receiptDigest,browserCourtReceiptDigest:browser.receiptDigest,realityCourtReceiptDigest:reality.receiptDigest,rollbackReceiptDigest:rollback.receiptDigest,allowedEffectSet:candidate.operations.map(o=>o.type)};
  return adapter.persistPromotionReceipt ? adapter.persistPromotionReceipt(payload) : sealPlain({status:'ELIGIBLE_FOR_NARROW_EXECUTION',...payload,authorityMinted:false});
}
export async function executeExperienceThroughCanonicalAuthority(adapter,{candidate,principalReceiptDigest,promotionReceiptDigest}){
  const principal=await requirePrincipalReceipt(adapter,principalReceiptDigest,ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE);
  const promotion=await resolveCanonicalReceipt(adapter,promotionReceiptDigest,{kind:'PROMOTION',subjectDigest:candidate.candidateDigest,minimumRealm:'VERIFIED_LOCAL'});
  assert(promotion.payload?.principalReceiptDigest===principal.principalReceiptDigest,'promotion principal mismatch','PROMOTION_PRINCIPAL_MISMATCH');
  assert(Array.isArray(promotion.payload?.allowedEffectSet),'promotion effect set required','PROMOTION_EFFECT_SET_REQUIRED');
  return adapter.executeAuthorizedExperienceCandidate({candidateId:candidate.candidateId,candidateDigest:candidate.candidateDigest,principal,promotionReceiptDigest:promotion.receiptDigest,allowedEffectSet:promotion.payload.allowedEffectSet});
}
export async function rollbackExperienceThroughCanonicalAuthority(adapter,{versionId,principalReceiptDigest}){const principal=await requirePrincipalReceipt(adapter,principalReceiptDigest,ACTIONS.ROLLBACK_EXPERIENCE_VERSION);return adapter.rollbackExperienceVersion({versionId,principal});}
