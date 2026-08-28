import { assert, digest, iso, sealPlain, deepFreeze } from './core.mjs';

export const EVIDENCE_REALMS = sealPlain([
  'VERIFIED_REAL','VERIFIED_LOCAL','HISTORICAL_RECEIPT','IMPLEMENTED_UNVERIFIED','SIMULATED','FIXTURE','UNKNOWN','REFUSED',
]);
export const RECEIPT_KINDS = sealPlain([
  'PRINCIPAL','BROWSER_OBSERVATION','PRIVATE_PREVIEW','COURT','ROLLBACK','PROMOTION','ASSIGNMENT','EXPOSURE','OUTCOME','PREDICTION_OUTCOME',
  'MERCHANT_AUTHORIZATION','EXPERIENCE_EXECUTION','EXPERIMENT_SETTLEMENT','VALUE','ECONOMIC_OBSERVATION','INFORMATION_GAP','LESSON_ADMISSION','MODEL_TRIAL','HARNESS_TRIAL','SKILL_RUN','VERIFIER','SUPREMACY_BENCHMARK',
]);

export function makeReceipt({kind,subjectDigest,realm='VERIFIED_LOCAL',issuer,payload={},issuedAt=new Date(),expiresAt=null,parentDigests=[]}) {
  assert(RECEIPT_KINDS.includes(kind), `unsupported receipt kind ${kind}`, 'RECEIPT_KIND_INVALID');
  assert(EVIDENCE_REALMS.includes(realm), `unsupported evidence realm ${realm}`, 'RECEIPT_REALM_INVALID');
  assert(subjectDigest && issuer, 'receipt subjectDigest and issuer required', 'RECEIPT_INCOMPLETE');
  const body={kind,subjectDigest,realm,issuer,payload,issuedAt:iso(issuedAt),expiresAt:expiresAt?iso(expiresAt):null,parentDigests:[...parentDigests]};
  return sealPlain({...body,receiptDigest:digest(body,`receipt-${kind.toLowerCase()}`)});
}

export function validateReceiptShape(receipt,{kind=null,subjectDigest=null,minimumRealm=null,now=new Date()}={}) {
  assert(receipt && typeof receipt==='object','receipt required','RECEIPT_REQUIRED');
  assert(RECEIPT_KINDS.includes(receipt.kind),'receipt kind invalid','RECEIPT_KIND_INVALID');
  assert(EVIDENCE_REALMS.includes(receipt.realm),'receipt realm invalid','RECEIPT_REALM_INVALID');
  if(kind) assert(receipt.kind===kind,`expected ${kind} receipt`,'RECEIPT_KIND_MISMATCH');
  if(subjectDigest) assert(receipt.subjectDigest===subjectDigest,'receipt subject mismatch','RECEIPT_SUBJECT_MISMATCH');
  assert(Number.isFinite(new Date(receipt.issuedAt).getTime()),'receipt issuedAt invalid','RECEIPT_ISSUED_AT_INVALID');
  assert(Array.isArray(receipt.parentDigests),'receipt parentDigests invalid','RECEIPT_PARENTS_INVALID');
  if(receipt.expiresAt) assert(new Date(receipt.expiresAt).getTime()>=new Date(now).getTime(),'receipt expired','RECEIPT_EXPIRED');
  const {receiptDigest,...body}=receipt;
  assert(receiptDigest===digest(body,`receipt-${receipt.kind.toLowerCase()}`),'receipt digest mismatch','RECEIPT_DIGEST_MISMATCH');
  if(minimumRealm){
    const rank=new Map(EVIDENCE_REALMS.map((r,i)=>[r,EVIDENCE_REALMS.length-i]));
    assert((rank.get(receipt.realm)??0)>=(rank.get(minimumRealm)??Infinity),`receipt realm below ${minimumRealm}`,'RECEIPT_REALM_TOO_LOW');
  }
  return receipt;
}

export function requireExactEvidenceRealm(receipt, realm) {
  assert(EVIDENCE_REALMS.includes(realm), `unsupported evidence realm ${realm}`, 'RECEIPT_REALM_INVALID');
  assert(receipt?.realm === realm, `receipt must be in ${realm}`, 'RECEIPT_REALM_MISMATCH');
  return receipt;
}

export function createCanonicalEvidenceAdapter(impl){
  assert(typeof impl?.loadReceipt==='function','loadReceipt required','EVIDENCE_ADAPTER_INCOMPLETE');
  assert(typeof impl?.loadLesson==='function','loadLesson required','EVIDENCE_ADAPTER_INCOMPLETE');
  assert(typeof impl?.loadExperimentLedger==='function','loadExperimentLedger required','EVIDENCE_ADAPTER_INCOMPLETE');
  return deepFreeze({...impl,ownsTruthStore:false,ownsAuth:false,authority:'CANONICAL_CANA_ONLY'});
}

export async function resolveCanonicalReceipt(adapter,receiptDigest,requirements={}){
  assert(receiptDigest,'receipt digest required','RECEIPT_DIGEST_REQUIRED');
  const r=await adapter.loadReceipt(receiptDigest);
  assert(r,'canonical receipt not found','CANONICAL_RECEIPT_NOT_FOUND');
  validateReceiptShape(r,requirements);
  assert(r.receiptDigest===receiptDigest,'canonical receipt identity mismatch','CANONICAL_RECEIPT_IDENTITY_MISMATCH');
  return r;
}
