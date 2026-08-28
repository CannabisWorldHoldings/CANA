import { assert, newId, sealPlain } from './core.mjs';
import {
  makeReceipt,
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
  validateReceiptShape,
} from './receipts.mjs';
export async function issueValueReceipt({settlement,economics,evidenceAdapter,issuer='canonical-economic-settlement'}){
  assert(settlement?.status==='SETTLED','settled experiment required');const causalSupported=settlement.causalStatus==='CAUSALLY_SUPPORTED';let aov=null,aovReceipt=null;
  if(economics?.attributedAovReceiptDigest){aovReceipt=await resolveCanonicalReceipt(evidenceAdapter,economics.attributedAovReceiptDigest,{kind:'ECONOMIC_OBSERVATION',minimumRealm:'VERIFIED_LOCAL'});assert(aovReceipt.payload?.metric==='AOV_USD','AOV receipt metric mismatch','AOV_RECEIPT_INVALID');aov=Number(aovReceipt.payload?.valueUsd);assert(Number.isFinite(aov),'AOV receipt value invalid','AOV_RECEIPT_INVALID');}
  const incrementalConversions=settlement.stats?settlement.stats.lift*settlement.outcome.treatmentN:null;const revenueImpactUsd=causalSupported&&aov!==null&&incrementalConversions!==null?incrementalConversions*aov:null;
  const payload={receiptId:newId('value'),experimentId:settlement.experimentId,settlementDigest:settlement.settlementDigest,estimatedEffect:settlement.stats,causalStatus:settlement.causalStatus,revenueImpactUsd,costUsd:Number.isFinite(economics?.costUsd)?economics.costUsd:null,economicStatus:revenueImpactUsd===null?'UNMEASURED_OR_UNSUPPORTED':'MEASURED_WITH_CAUSAL_SUPPORT',uncertainty:settlement.sufficient?'BOUNDED_BY_EXPERIMENT':'HIGH',attributedAovReceiptDigest:aovReceipt?.receiptDigest??null,createdAt:new Date().toISOString()};
  const receipt=makeReceipt({kind:'VALUE',subjectDigest:settlement.settlementDigest,realm:revenueImpactUsd===null?'IMPLEMENTED_UNVERIFIED':'VERIFIED_LOCAL',issuer,payload});return sealPlain({...payload,receiptDigest:receipt.receiptDigest,receipt});
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
  const canonicalSettlement = await resolveCanonicalReceipt(evidenceAdapter, settlement.settlementDigest, {
    kind: 'EXPERIMENT_SETTLEMENT',
    subjectDigest: settlement.preregistrationDigest,
  });
  requireExactEvidenceRealm(canonicalSettlement, settlement.evidenceRealm);
  assert(Array.isArray(economicObservationReceiptDigests), 'economic observation receipt digests must be an array', 'ECONOMIC_INPUT_INVALID');
  const observations = new Map();
  for (const receiptDigest of economicObservationReceiptDigests) {
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, {
      kind: 'ECONOMIC_OBSERVATION',
      subjectDigest: settlement.settlementDigest,
    });
    requireExactEvidenceRealm(receipt, settlement.evidenceRealm);
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
  const causal = settlement.classification === 'CAUSAL_SUPPORTED';
  const complete = causal
    && settlement.claimCeiling === 'ECONOMIC_EFFECT'
    && grossMargin !== null
    && totalCostUsd !== null;
  const economicEffectUsd = complete ? grossMargin - totalCostUsd : null;
  const fixture = settlement.evidenceRealm !== 'VERIFIED_REAL';
  const economicStatus = !complete
    ? 'UNMEASURED'
    : fixture
      ? 'SIMULATED_FIXTURE_ONLY'
      : 'MEASURED_CAUSAL_ECONOMIC_EFFECT';
  const payload = {
    receiptId: newId('value'),
    merchantId: settlement.merchantId,
    tenantId: settlement.tenantId,
    experimentId: settlement.experimentId,
    intervention,
    preregistrationDigest: settlement.preregistrationDigest,
    verifiedExposure: {
      count: settlement.counts?.verifiedExposures ?? 0,
      exposureReceiptDigests: settlement.evidenceDigests?.exposures ?? [],
    },
    settlementClassification: settlement.classification,
    settlementDigest: settlement.settlementDigest,
    effectEstimate: settlement.effectEstimate,
    uncertainty: settlement.sufficient ? settlement.effectEstimate : null,
    economicStatus,
    economicEffectUsd,
    incrementalRevenueUsd: revenue,
    incrementalMarginUsd: observedMargin,
    marginRate,
    costs: { ...costs, totalCostUsd },
    guardrailResults: settlement.guardrailResults,
    claimCeiling: settlement.claimCeiling,
    evidenceRealm: settlement.evidenceRealm,
    evidenceDigests: {
      settlement: settlement.settlementDigest,
      economics: economicObservationReceiptDigests,
    },
    rollback: intervention?.rollbackContract ?? null,
    limitations: [
      ...(settlement.limitations ?? []),
      ...(!complete ? ['Economic effect is UNMEASURED because causal settlement or observed margin/cost inputs are incomplete'] : []),
      ...(fixture ? ['Fixture economics cannot establish merchant ROI or real economic value'] : []),
    ],
    realEconomicValueEstablished: complete && !fixture,
    createdAt: new Date().toISOString(),
  };
  const receipt = makeReceipt({
    kind: 'VALUE',
    subjectDigest: settlement.settlementDigest,
    realm: settlement.evidenceRealm,
    issuer,
    payload,
    parentDigests: [settlement.settlementDigest, ...economicObservationReceiptDigests],
  });
  return sealPlain({
    ...payload,
    causalStatus: settlement.classification,
    receiptDigest: receipt.receiptDigest,
    receipt,
  });
}
