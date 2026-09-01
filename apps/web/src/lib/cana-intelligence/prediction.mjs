import { assert, digest, newId, sealPlain, iso } from './core.mjs';
import { resolveCanonicalReceipt } from './receipts.mjs';
const DIRECTIONS=new Set(['UP','DOWN','FLAT']);
export function lockPrediction(input){
  assert(input.worldStateDigest,'worldStateDigest required');assert(input.hypothesis,'hypothesis required');
  const windowStart=iso(input.windowStart),windowEnd=iso(input.windowEnd);assert(new Date(windowEnd)>new Date(windowStart),'positive observation window required');
  assert(input.falsificationRule,'falsificationRule required');assert(DIRECTIONS.has(input.expectedDirection),'expectedDirection must be UP/DOWN/FLAT','PREDICTION_DIRECTION_INVALID');
  if(input.magnitudeRange){assert(Array.isArray(input.magnitudeRange)&&input.magnitudeRange.length===2&&input.magnitudeRange.every(Number.isFinite)&&input.magnitudeRange[0]<=input.magnitudeRange[1],'magnitudeRange invalid','PREDICTION_MAGNITUDE_INVALID');}
  const body={predictionId:input.predictionId??newId('pred'),worldStateDigest:input.worldStateDigest,hypothesis:input.hypothesis,expectedDirection:input.expectedDirection,magnitudeRange:input.magnitudeRange??null,confidence:input.confidence??null,alternatives:input.alternatives??[],windowStart,windowEnd,falsificationRule:input.falsificationRule,maximumClaimCeiling:input.maximumClaimCeiling??'PREDICTIVE_ASSOCIATION_ONLY',createdAt:iso(input.createdAt??new Date())};
  return sealPlain({...body,lockDigest:digest(body,'prediction-lock'),status:'LOCKED'});
}
export async function settlePrediction(prediction,outcomeReceiptDigest,evidenceAdapter,now=new Date()){
  assert(prediction.status==='LOCKED','only locked predictions can settle');assert(new Date(now)>=new Date(prediction.windowEnd),'prediction window has not closed','PREMATURE_PREDICTION_SETTLEMENT');
  const outcome=await resolveCanonicalReceipt(evidenceAdapter,outcomeReceiptDigest,{kind:'PREDICTION_OUTCOME',subjectDigest:prediction.lockDigest,minimumRealm:'VERIFIED_LOCAL'});const delta=Number(outcome.payload?.actualDelta);assert(Number.isFinite(delta),'prediction outcome actualDelta required','PREDICTION_OUTCOME_INVALID');
  const actualDirection=delta>0?'UP':delta<0?'DOWN':'FLAT';const directionalCorrect=actualDirection===prediction.expectedDirection;const magnitudeCorrect=prediction.magnitudeRange?delta>=prediction.magnitudeRange[0]&&delta<=prediction.magnitudeRange[1]:null;
  const result={...prediction,status:'SCORED',outcomeReceiptDigest:outcome.receiptDigest,actualDelta:delta,actualDirection,directionalCorrect,magnitudeCorrect,scoredAt:iso(now)};
  return sealPlain({...result,settlementDigest:digest({predictionLock:prediction.lockDigest,outcomeReceiptDigest:outcome.receiptDigest,actualDelta:delta,directionalCorrect,magnitudeCorrect},'prediction-settlement')});
}
