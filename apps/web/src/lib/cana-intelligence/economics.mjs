import { assert, canonicalJson, newId, sealPlain } from './core.mjs';
import {
  makeReceipt,
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
  validateReceiptShape,
} from './receipts.mjs';
export async function issueValueReceipt({settlement,economics,evidenceAdapter,issuer='canonical-economic-settlement'}){
  assert(settlement?.status==='SETTLED'&&settlement?.receipt,'canonical settled experiment receipt required','VALUE_SETTLEMENT_REQUIRED');
  validateReceiptShape(settlement.receipt,{kind:'EXPERIMENT_SETTLEMENT',subjectDigest:settlement.preRegDigest,minimumRealm:'VERIFIED_LOCAL'});
  assert(settlement.settlementDigest===settlement.receipt.receiptDigest,'settlement projection digest mismatch','VALUE_SETTLEMENT_PROJECTION_MISMATCH');
  const canonicalSettlement=await resolveCanonicalReceipt(evidenceAdapter,settlement.settlementDigest,{kind:'EXPERIMENT_SETTLEMENT',subjectDigest:settlement.preRegDigest,minimumRealm:'VERIFIED_LOCAL'});
  assert(canonicalJson(canonicalSettlement)===canonicalJson(settlement.receipt),'settlement receipt does not exactly replay canonical evidence','VALUE_SETTLEMENT_PROJECTION_MISMATCH');
  const settlementProjection=Object.fromEntries(Object.entries(settlement).filter(([key])=>!['settlementDigest','receipt'].includes(key)));
  assert(canonicalJson(settlementProjection)===canonicalJson(canonicalSettlement.payload),'settlement projection does not exactly replay canonical evidence','VALUE_SETTLEMENT_PROJECTION_MISMATCH');
  const settled=canonicalSettlement.payload;const causalSupported=settled.causalStatus==='CAUSALLY_SUPPORTED';let aov=null,aovReceipt=null;
  if(economics?.attributedAovReceiptDigest){aovReceipt=await resolveCanonicalReceipt(evidenceAdapter,economics.attributedAovReceiptDigest,{kind:'ECONOMIC_OBSERVATION',subjectDigest:canonicalSettlement.receiptDigest,minimumRealm:'VERIFIED_LOCAL'});requireExactEvidenceRealm(aovReceipt,canonicalSettlement.realm);assert(aovReceipt.payload?.metric==='AOV_USD','AOV receipt metric mismatch','AOV_RECEIPT_INVALID');aov=Number(aovReceipt.payload?.valueUsd);assert(Number.isFinite(aov),'AOV receipt value invalid','AOV_RECEIPT_INVALID');}
  const incrementalConversions=settled.stats?settled.stats.lift*settled.outcome.treatmentN:null;const revenueImpactUsd=causalSupported&&aov!==null&&incrementalConversions!==null?incrementalConversions*aov:null;
  const payload={receiptId:newId('value'),experimentId:settled.experimentId,settlementDigest:canonicalSettlement.receiptDigest,estimatedEffect:settled.stats,causalStatus:settled.causalStatus,revenueImpactUsd,costUsd:Number.isFinite(economics?.costUsd)?economics.costUsd:null,economicStatus:revenueImpactUsd===null?'UNMEASURED_OR_UNSUPPORTED':'MEASURED_WITH_CAUSAL_SUPPORT',uncertainty:settled.sufficient?'BOUNDED_BY_EXPERIMENT':'HIGH',attributedAovReceiptDigest:aovReceipt?.receiptDigest??null,createdAt:new Date().toISOString()};
  const receipt=makeReceipt({kind:'VALUE',subjectDigest:canonicalSettlement.receiptDigest,realm:revenueImpactUsd===null?'IMPLEMENTED_UNVERIFIED':canonicalSettlement.realm,issuer,payload,parentDigests:[canonicalSettlement.receiptDigest,...(aovReceipt?[aovReceipt.receiptDigest]:[])]});return sealPlain({...payload,receiptDigest:receipt.receiptDigest,receipt});
}

const ECONOMIC_METRICS = new Set([
  'INCREMENTAL_REVENUE_USD',
  'INCREMENTAL_MARGIN_USD',
  'MARGIN_RATE',
  'DISCOUNT_COST_USD',
  'MEDIA_COST_USD',
  'FULFILLMENT_COST_USD',
  'PLATFORM_COST_USD',
  'OTHER_DIRECT_COST_USD',
]);

export async function issueRealityCellValueReceipt({
  settlement,
  intervention,
  economicObservationReceiptDigests = [],
  evidenceAdapter,
  issuer = 'canonical-reality-cell-economic-settlement',
}) {
  assert(settlement?.status === 'SETTLED' && settlement?.receipt, 'Reality Cell settlement receipt required', 'VALUE_SETTLEMENT_REQUIRED');
  validateReceiptShape(settlement.receipt, {
    kind: 'EXPERIMENT_SETTLEMENT',
    subjectDigest: settlement.preregistrationDigest,
  });
  assert(
    settlement.settlementDigest === settlement.receipt.receiptDigest,
    'settlement projection digest mismatch',
    'VALUE_SETTLEMENT_PROJECTION_MISMATCH',
  );
  const canonicalSettlement = await resolveCanonicalReceipt(evidenceAdapter, settlement.settlementDigest, {
    kind: 'EXPERIMENT_SETTLEMENT',
    subjectDigest: settlement.preregistrationDigest,
  });
  assert(
    canonicalJson(canonicalSettlement) === canonicalJson(settlement.receipt),
    'settlement receipt does not exactly replay canonical evidence',
    'VALUE_SETTLEMENT_PROJECTION_MISMATCH',
  );
  const settlementProjection = Object.fromEntries(
    Object.entries(settlement).filter(([key]) => !['status', 'settlementDigest', 'receipt'].includes(key)),
  );
  assert(
    canonicalJson(settlementProjection) === canonicalJson(canonicalSettlement.payload),
    'settlement projection does not exactly replay canonical evidence',
    'VALUE_SETTLEMENT_PROJECTION_MISMATCH',
  );
  const settled = canonicalSettlement.payload;
  const settlementRealm = canonicalSettlement.realm;
  requireExactEvidenceRealm(canonicalSettlement, settlementRealm);
  assert(
    intervention?.candidateDigest === settled.treatmentCandidateDigest,
    'ValueReceipt intervention candidate does not match canonical settlement',
    'VALUE_INTERVENTION_MISMATCH',
  );
  assert(
    intervention?.rollbackContract?.digest === settled.rollbackContractDigest,
    'ValueReceipt rollback contract does not match canonical settlement',
    'VALUE_INTERVENTION_MISMATCH',
  );
  assert(Array.isArray(economicObservationReceiptDigests), 'economic observation receipt digests must be an array', 'ECONOMIC_INPUT_INVALID');
  const observations = new Map();
  for (const receiptDigest of economicObservationReceiptDigests) {
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, {
      kind: 'ECONOMIC_OBSERVATION',
      subjectDigest: canonicalSettlement.receiptDigest,
    });
    requireExactEvidenceRealm(receipt, settlementRealm);
    const metric = receipt.payload?.metric;
    assert(ECONOMIC_METRICS.has(metric), `unsupported economic metric ${metric}`, 'ECONOMIC_INPUT_INVALID');
    assert(!observations.has(metric), `duplicate economic metric ${metric}`, 'ECONOMIC_INPUT_DUPLICATE');
    const value = Number(receipt.payload?.value);
    assert(Number.isFinite(value), 'economic observation value invalid', 'ECONOMIC_INPUT_INVALID');
    assert(receipt.payload?.source && receipt.payload?.observedAt, 'economic observation provenance required', 'ECONOMIC_INPUT_INVALID');
    observations.set(metric, { value, receipt });
  }
  const read = (metric) => observations.get(metric)?.value ?? null;
  const revenue = read('INCREMENTAL_REVENUE_USD');
  const observedMargin = read('INCREMENTAL_MARGIN_USD');
  const marginRate = read('MARGIN_RATE');
  const grossMargin = observedMargin ?? (revenue !== null && marginRate !== null ? revenue * marginRate : null);
  const costMetrics = [
    'DISCOUNT_COST_USD',
    'MEDIA_COST_USD',
    'FULFILLMENT_COST_USD',
    'PLATFORM_COST_USD',
    'OTHER_DIRECT_COST_USD',
  ];
  const costs = Object.fromEntries(costMetrics.map((metric) => [metric, read(metric)]));
  const costsComplete = costMetrics.every((metric) => costs[metric] !== null);
  const totalCostUsd = costsComplete
    ? Object.values(costs).reduce((sum, value) => sum + value, 0)
    : null;
  const causal = settled.classification === 'CAUSAL_SUPPORTED';
  const complete = causal
    && settled.claimCeiling === 'ECONOMIC_EFFECT'
    && grossMargin !== null
    && totalCostUsd !== null;
  const economicEffectUsd = complete ? grossMargin - totalCostUsd : null;
  const fixture = settlementRealm !== 'VERIFIED_REAL';
  const economicStatus = !complete
    ? 'UNMEASURED'
    : fixture
      ? 'SIMULATED_FIXTURE_ONLY'
      : 'MEASURED_CAUSAL_ECONOMIC_EFFECT';
  const payload = {
    receiptId: newId('value'),
    merchantId: settled.merchantId,
    tenantId: settled.tenantId,
    experimentId: settled.experimentId,
    intervention,
    preregistrationDigest: canonicalSettlement.subjectDigest,
    verifiedExposure: {
      count: settled.counts?.verifiedExposures ?? 0,
      exposureReceiptDigests: settled.evidenceDigests?.exposures ?? [],
    },
    settlementClassification: settled.classification,
    settlementDigest: canonicalSettlement.receiptDigest,
    effectEstimate: settled.effectEstimate,
    uncertainty: settled.sufficient ? settled.effectEstimate : null,
    economicStatus,
    economicEffectUsd,
    incrementalRevenueUsd: revenue,
    incrementalMarginUsd: observedMargin,
    marginRate,
    costs: { ...costs, totalCostUsd },
    guardrailResults: settled.guardrailResults,
    claimCeiling: settled.claimCeiling,
    evidenceRealm: settlementRealm,
    evidenceDigests: {
      settlement: canonicalSettlement.receiptDigest,
      economics: economicObservationReceiptDigests,
    },
    rollback: intervention?.rollbackContract ?? null,
    limitations: [
      ...(settled.limitations ?? []),
      ...(!complete ? ['Economic effect is UNMEASURED because causal settlement or observed margin/cost inputs are incomplete'] : []),
      ...(fixture ? ['Fixture economics cannot establish merchant ROI or real economic value'] : []),
    ],
    realEconomicValueEstablished: complete && !fixture,
    createdAt: new Date().toISOString(),
  };
  const receipt = makeReceipt({
    kind: 'VALUE',
    subjectDigest: canonicalSettlement.receiptDigest,
    realm: settlementRealm,
    issuer,
    payload,
    parentDigests: [canonicalSettlement.receiptDigest, ...economicObservationReceiptDigests],
  });
  return sealPlain({
    ...payload,
    causalStatus: settled.classification,
    receiptDigest: receipt.receiptDigest,
    receipt,
  });
}
