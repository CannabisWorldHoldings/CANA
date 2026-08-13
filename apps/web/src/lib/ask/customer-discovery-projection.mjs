import { persistenceSafeIntent } from './intent-ir.mjs';
import {
  CUSTOMER_DISCOVERY_PROJECTION_VERSION,
  admittedMarketContext,
  customerDiscoveryFailure,
  projectionClock,
} from './customer-discovery-contract.mjs';

function known(value, evidenceRef = null) {
  return Object.freeze({ state: 'KNOWN', value, ...(evidenceRef ? { evidence_ref: evidenceRef } : {}) });
}

function unknown(reason) {
  return Object.freeze({ state: 'UNKNOWN', value: null, reason });
}

function capabilityGap(dimension) {
  return Object.freeze({
    state: 'CAPABILITY_GAP', value: null, dimension,
    reason: 'NO_DECISION_ELIGIBLE_CUSTOMER_PROJECTION',
  });
}

function scalar(value, reason, evidenceRef = null) {
  return typeof value === 'string' && value.trim() ? known(value, evidenceRef) : unknown(reason);
}

function intentDimension(intent, dimension, unknownReason) {
  return intent?.dimensions?.[dimension]?.status === 'KNOWN'
    ? capabilityGap(dimension)
    : unknown(unknownReason);
}

function verifyCandidate(candidate, market, clock) {
  if (candidate?.location?.state !== market.jurisdiction_code) {
    customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_MISMATCH');
  }
  const provenance = candidate?.provenance;
  if (
    provenance?.source_key !== market.evidence.source_key
    || provenance?.source !== market.evidence.source_id
    || provenance?.source_url !== market.evidence.source_url
  ) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_PROVENANCE_MISMATCH');
  const verifiedAt = new Date(provenance?.verified_at);
  const freshnessExpiresAt = new Date(provenance?.freshness_expires_at);
  if (
    provenance?.data_status !== 'VERIFIED_CURRENT'
    || provenance?.is_demonstration === true
    || !Number.isFinite(verifiedAt.getTime())
    || verifiedAt > clock
    || !Number.isFinite(freshnessExpiresAt.getTime())
    || freshnessExpiresAt <= clock
  ) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_UNVERIFIED_CANDIDATE');
  return { verifiedAt, freshnessExpiresAt };
}

function projectCandidate(candidate, market, intent, clock) {
  const { verifiedAt, freshnessExpiresAt } = verifyCandidate(candidate, market, clock);
  const coordinates = Number.isFinite(candidate.location.latitude) && Number.isFinite(candidate.location.longitude)
    ? known(Object.freeze({ latitude: candidate.location.latitude, longitude: candidate.location.longitude }))
    : unknown('VERIFIED_COORDINATES_NOT_AVAILABLE');
  const sourceRef = candidate.provenance.source_url ?? candidate.provenance.source ?? null;
  const result = {
    merchant_id: candidate.id,
    customer_facing_name: scalar(candidate.name, 'CUSTOMER_FACING_NAME_UNKNOWN', sourceRef),
    business_type: scalar(candidate.type, 'BUSINESS_TYPE_UNKNOWN', sourceRef),
    regulatory_state: scalar(candidate.regulatory?.license_status, 'REGULATORY_STATE_UNKNOWN', sourceRef),
    verification_state: known(candidate.provenance.data_status, sourceRef),
    location: Object.freeze({
      address: scalar(candidate.location.address, 'ADDRESS_UNKNOWN', sourceRef),
      city: scalar(candidate.location.city, 'CITY_UNKNOWN', sourceRef),
      region: scalar(candidate.location.state, 'REGION_UNKNOWN', sourceRef),
      postal_code: scalar(candidate.location.postal_code, 'POSTAL_CODE_UNKNOWN', sourceRef),
      coordinates,
    }),
    market: known(market.market_id, market.evidence.contract_digest),
    distance: unknown('CUSTOMER_COORDINATES_AND_ROUTE_DISTANCE_NOT_PROVEN'),
    fulfillment_type: intentDimension(intent, 'fulfillment', 'FULFILLMENT_INTENT_UNKNOWN'),
    delivery_authority: intent?.dimensions?.fulfillment?.status === 'KNOWN'
      ? capabilityGap('fulfillment') : unknown('NO_DECISION_ELIGIBLE_DELIVERY_AUTHORITY_CLAIM'),
    delivery_eligibility: intent?.dimensions?.fulfillment?.status === 'KNOWN'
      ? capabilityGap('fulfillment') : unknown('CUSTOMER_LOCATION_AND_SERVICE_AREA_NOT_PROVEN'),
    price: intentDimension(intent, 'price_max_usd', 'PRICE_INTENT_UNKNOWN'),
    category: intentDimension(intent, 'category', 'CATEGORY_INTENT_UNKNOWN'),
    open_now: intentDimension(intent, 'open_now', 'OPEN_NOW_INTENT_UNKNOWN'),
    deal: unknown('NO_DECISION_ELIGIBLE_DEAL_EVIDENCE'),
    freshness: known(Object.freeze({
      retrieved_at: candidate.provenance.retrieved_at ?? null,
      verified_at: verifiedAt.toISOString(),
      freshness_expires_at: freshnessExpiresAt.toISOString(),
    }), sourceRef),
    provenance: Object.freeze({ ...candidate.provenance }),
  };
  const stateFields = [
    'distance', 'fulfillment_type', 'delivery_authority', 'delivery_eligibility',
    'price', 'category', 'open_now', 'deal',
  ];
  return Object.freeze({
    ...result,
    unknown_dimensions: Object.freeze([
      ...(coordinates.state === 'UNKNOWN' ? ['location.coordinates'] : []),
      ...stateFields.filter((field) => result[field].state === 'UNKNOWN'),
    ]),
    capability_gaps: Object.freeze(stateFields.filter((field) => result[field].state === 'CAPABILITY_GAP')),
  });
}

export function projectCustomerDiscoveryCandidate({
  candidate,
  intent,
  market,
  asOf = new Date(),
}) {
  return projectCandidate(candidate, admittedMarketContext(market), intent, projectionClock(asOf));
}

export function projectCustomerDiscovery({ intent, market, answer, asOf = new Date() }) {
  const clock = projectionClock(asOf);
  const admittedMarket = admittedMarketContext(market);
  if (!answer?.answerability_frontier || !Array.isArray(answer?.candidates)) {
    customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_ANSWER_INVALID');
  }
  if (
    answer.verified_candidate_count !== answer.candidates.length
    || answer.zero_verified_result !== (answer.candidates.length === 0)
  ) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_ANSWER_COUNT_MISMATCH');
  const results = Object.freeze(answer.candidates.map((candidate) => (
    projectCustomerDiscoveryCandidate({ candidate, market: admittedMarket, intent, asOf: clock })
  )));
  const capabilityGaps = Object.freeze((answer.unsupported_known_dimensions ?? []).map((dimension) => Object.freeze({
    state: 'CAPABILITY_GAP',
    dimension,
    opportunity_signal: answer.opportunitySpec?.kind === 'CAPABILITY_GAP',
  })));
  const opportunitySignal = answer.opportunitySpec
    ? Object.freeze({
        state: 'PROPOSE_ONLY', kind: answer.opportunitySpec.kind,
        signal: answer.opportunitySpec.signal, required_authority: answer.opportunitySpec.requiredAuthority,
        verification: 'UNKNOWN', customer_effect: 'NONE',
      })
    : Object.freeze({ state: 'NONE' });
  return Object.freeze({
    schema_version: CUSTOMER_DISCOVERY_PROJECTION_VERSION,
    generated_at: clock.toISOString(),
    market: admittedMarket,
    intent: Object.freeze(persistenceSafeIntent(intent)),
    results,
    capability_gaps: capabilityGaps,
    opportunity_signal: opportunitySignal,
    truth: Object.freeze({
      gate: answer.truth_gate ?? 'currentPublicRecordWhere + isPubliclyVerified',
      projection_decides_truth: false,
      unknown_policy: 'PRESERVE_UNKNOWN',
      verified_candidate_count: results.length,
      zero_verified_result: results.length === 0,
      zero_result_reason: answer.zero_result_reason,
      answerability_frontier: answer.answerability_frontier,
    }),
  });
}
