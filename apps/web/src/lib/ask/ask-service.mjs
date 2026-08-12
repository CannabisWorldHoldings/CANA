/**
 * ASK ORDERWEEDDC — answer + opportunity service (Track A, Slice 1).
 *
 * REAL USER INTENT -> USEFUL, EVIDENCE-GATED ANSWER -> MERCHANT OPPORTUNITY.
 *
 * Truth commitments (same gates as every rendered page and v1 endpoint):
 *  - Candidates pass currentPublicRecordWhere() AND isPubliclyVerified() —
 *    the identical double gate the UI uses. Demonstration data cannot answer
 *    a real customer.
 *  - Location matching is case-insensitive `contains` (the documented
 *    SQLite->PostgreSQL silent-failure class: "dupont" must match
 *    "Dupont Circle").
 *  - A zero-candidate answer is an HONEST answer, not a failure — and it is
 *    exactly the evidence from which a MARKET_GAP opportunity is emitted.
 *  - Opportunity value claims default verification UNKNOWN. Nothing here
 *    manufactures demand, revenue or certainty.
 *
 * The continuation kernel wiring (follow-up monitoring of an emitted
 * opportunity) lives in the route so this module stays read-only over
 * market truth.
 */

import { currentPublicRecordWhere } from '../seo-truth.mjs';
import { isPubliclyVerified } from '../data-status.mjs';
import { MARKET_CONTRACT_REGISTRY } from '../reality/market-contract-registry.mjs';
import {
  buildAnswerabilityFrontier,
  projectionClaimDecisions,
} from './answerability-frontier.mjs';
import { compileIntent, persistenceSafeIntent } from './intent-ir.mjs';

const MAX_CANDIDATES = 10;
export const CUSTOMER_DISCOVERY_PROJECTION_VERSION = 'cana-customer-discovery-projection/v1';

const CUSTOMER_MARKET_JURISDICTIONS = Object.freeze({
  'US-DC': 'DC',
  'US-MD': 'MD',
  'US-VA': 'VA',
});

export const CUSTOMER_DISCOVERY_MARKETS = Object.freeze(Object.keys(CUSTOMER_MARKET_JURISDICTIONS));

function customerDiscoveryFailure(code) {
  throw new Error(code);
}

function projectionClock(asOf) {
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_CLOCK_INVALID');
  return clock;
}

export function resolveCustomerMarketContext(marketId) {
  if (!Object.hasOwn(CUSTOMER_MARKET_JURISDICTIONS, marketId)) {
    customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_UNSUPPORTED');
  }
  const contract = MARKET_CONTRACT_REGISTRY.find((entry) => entry.market_id === marketId);
  if (!contract) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_CONTRACT_MISSING');
  return Object.freeze({
    state: 'KNOWN',
    market_id: marketId,
    jurisdiction_code: CUSTOMER_MARKET_JURISDICTIONS[marketId],
    evidence: Object.freeze({
      source_key: contract.source_key,
      source_id: contract.source_id,
      source_url: contract.source_url,
      contract_digest: contract.contract_digest,
    }),
  });
}

function admittedMarketContext(market) {
  const expected = resolveCustomerMarketContext(market?.market_id);
  if (
    market?.state !== expected.state
    || market?.jurisdiction_code !== expected.jurisdiction_code
    || market?.evidence?.source_key !== expected.evidence.source_key
    || market?.evidence?.source_id !== expected.evidence.source_id
    || market?.evidence?.source_url !== expected.evidence.source_url
    || market?.evidence?.contract_digest !== expected.evidence.contract_digest
  ) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_CONTEXT_INVALID');
  return expected;
}

function knownProjection(value, evidenceRef = null) {
  return Object.freeze({
    state: 'KNOWN',
    value,
    ...(evidenceRef ? { evidence_ref: evidenceRef } : {}),
  });
}

function unknownProjection(reason) {
  return Object.freeze({ state: 'UNKNOWN', value: null, reason });
}

function capabilityGapProjection(dimension) {
  return Object.freeze({
    state: 'CAPABILITY_GAP',
    value: null,
    dimension,
    reason: 'NO_DECISION_ELIGIBLE_CUSTOMER_PROJECTION',
  });
}

function scalarProjection(value, reason, evidenceRef = null) {
  return typeof value === 'string' && value.trim()
    ? knownProjection(value, evidenceRef)
    : unknownProjection(reason);
}

function intentProjection(intent, dimension, unknownReason) {
  return intent?.dimensions?.[dimension]?.status === 'KNOWN'
    ? capabilityGapProjection(dimension)
    : unknownProjection(unknownReason);
}

function verifiedProjectionCandidate(candidate, market, clock) {
  if (candidate?.location?.state !== market.jurisdiction_code) {
    customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_MISMATCH');
  }
  const provenance = candidate?.provenance;
  if (
    provenance?.source !== market.evidence.source_id
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
  const { verifiedAt, freshnessExpiresAt } = verifiedProjectionCandidate(candidate, market, clock);
  const coordinates = Number.isFinite(candidate.location.latitude) && Number.isFinite(candidate.location.longitude)
    ? knownProjection(Object.freeze({ latitude: candidate.location.latitude, longitude: candidate.location.longitude }))
    : unknownProjection('VERIFIED_COORDINATES_NOT_AVAILABLE');
  const sourceRef = candidate.provenance.source_url ?? candidate.provenance.source ?? null;
  const result = {
    merchant_id: candidate.id,
    customer_facing_name: scalarProjection(candidate.name, 'CUSTOMER_FACING_NAME_UNKNOWN', sourceRef),
    business_type: scalarProjection(candidate.type, 'BUSINESS_TYPE_UNKNOWN', sourceRef),
    regulatory_state: scalarProjection(candidate.regulatory?.license_status, 'REGULATORY_STATE_UNKNOWN', sourceRef),
    verification_state: knownProjection(candidate.provenance.data_status, sourceRef),
    location: Object.freeze({
      address: scalarProjection(candidate.location.address, 'ADDRESS_UNKNOWN', sourceRef),
      city: scalarProjection(candidate.location.city, 'CITY_UNKNOWN', sourceRef),
      region: scalarProjection(candidate.location.state, 'REGION_UNKNOWN', sourceRef),
      postal_code: scalarProjection(candidate.location.postal_code, 'POSTAL_CODE_UNKNOWN', sourceRef),
      coordinates,
    }),
    market: knownProjection(market.market_id, market.evidence.contract_digest),
    distance: unknownProjection('CUSTOMER_COORDINATES_AND_ROUTE_DISTANCE_NOT_PROVEN'),
    fulfillment_type: intentProjection(intent, 'fulfillment', 'FULFILLMENT_INTENT_UNKNOWN'),
    delivery_authority: intent?.dimensions?.fulfillment?.status === 'KNOWN'
      ? capabilityGapProjection('fulfillment')
      : unknownProjection('NO_DECISION_ELIGIBLE_DELIVERY_AUTHORITY_CLAIM'),
    delivery_eligibility: intent?.dimensions?.fulfillment?.status === 'KNOWN'
      ? capabilityGapProjection('fulfillment')
      : unknownProjection('CUSTOMER_LOCATION_AND_SERVICE_AREA_NOT_PROVEN'),
    price: intentProjection(intent, 'price_max_usd', 'PRICE_INTENT_UNKNOWN'),
    category: intentProjection(intent, 'category', 'CATEGORY_INTENT_UNKNOWN'),
    open_now: intentProjection(intent, 'open_now', 'OPEN_NOW_INTENT_UNKNOWN'),
    deal: unknownProjection('NO_DECISION_ELIGIBLE_DEAL_EVIDENCE'),
    freshness: knownProjection(Object.freeze({
      retrieved_at: candidate.provenance.retrieved_at ?? null,
      verified_at: verifiedAt.toISOString(),
      freshness_expires_at: freshnessExpiresAt.toISOString(),
    }), sourceRef),
    provenance: Object.freeze({ ...candidate.provenance }),
  };
  const stateFields = [
    'distance',
    'fulfillment_type',
    'delivery_authority',
    'delivery_eligibility',
    'price',
    'category',
    'open_now',
    'deal',
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
    projectCandidate(candidate, admittedMarket, intent, clock)
  )));
  const capabilityGaps = Object.freeze((answer.unsupported_known_dimensions ?? []).map((dimension) => Object.freeze({
    state: 'CAPABILITY_GAP',
    dimension,
    opportunity_signal: answer.opportunitySpec?.kind === 'CAPABILITY_GAP',
  })));
  const opportunitySignal = answer.opportunitySpec
    ? Object.freeze({
        state: 'PROPOSE_ONLY',
        kind: answer.opportunitySpec.kind,
        signal: answer.opportunitySpec.signal,
        required_authority: answer.opportunitySpec.requiredAuthority,
        verification: 'UNKNOWN',
        customer_effect: 'NONE',
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
      gate: 'currentPublicRecordWhere + isPubliclyVerified',
      projection_decides_truth: false,
      unknown_policy: 'PRESERVE_UNKNOWN',
      verified_candidate_count: results.length,
      zero_verified_result: results.length === 0,
      zero_result_reason: answer.zero_result_reason,
      answerability_frontier: answer.answerability_frontier,
    }),
  });
}

/**
 * Build the Prisma `where` for an intent. Pure — unit-testable without a
 * database. Tenancy runs through the menu graph exactly like the UI and the
 * v1 retailers endpoint (Retailer has no brandId column).
 */
export function buildCandidateWhere(intent, { brandId, now = new Date(), market = null }) {
  const where = {
    ...currentPublicRecordWhere(now),
    menus: { some: { brandMenus: { some: { brandId } } } },
  };
  if (market) {
    const admittedMarket = admittedMarketContext(market);
    where.state = admittedMarket.jurisdiction_code;
    where.dataSource = admittedMarket.evidence.source_id;
    where.sourceUrl = admittedMarket.evidence.source_url;
  }
  const location = intent?.dimensions?.location;
  if (location?.status === 'KNOWN' && typeof location.value === 'string') {
    // Case-insensitive by explicit mode — never rely on collation defaults.
    where.OR = [
      { address: { contains: location.value, mode: 'insensitive' } },
      { city: { contains: location.value, mode: 'insensitive' } },
    ];
  }
  return where;
}

/**
 * Answer an intent from the evidence-gated store.
 * Returns candidates (verified only, provenance attached), plus an
 * opportunity spec when the evidence itself exposes a market gap.
 */
export async function answerIntent(prisma, { intent, brandId, tenantDomain, now = new Date(), market = null }) {
  const dimensions = intent?.dimensions ?? {};
  const persistedIntent = persistenceSafeIntent(intent);
  const location = dimensions.location;
  const unsupportedKnownDimensions = ['category', 'price_max_usd', 'fulfillment', 'open_now']
    .filter((name) => dimensions[name]?.status === 'KNOWN');
  const emptyFrontier = buildAnswerabilityFrontier({
    tenant: tenantDomain,
    intent,
    claimDecisions: [],
    asOf: now,
  });

  if (location?.status !== 'KNOWN') {
    return {
      candidates: [],
      verified_candidate_count: 0,
      zero_verified_result: true,
      zero_result_reason: 'REQUIRED_INTENT_DIMENSION_UNKNOWN',
      unsupported_known_dimensions: unsupportedKnownDimensions,
      answerability_frontier: emptyFrontier,
      opportunitySpec: null,
    };
  }

  if (unsupportedKnownDimensions.length > 0) {
    return {
      candidates: [],
      verified_candidate_count: 0,
      zero_verified_result: true,
      zero_result_reason: 'UNSUPPORTED_VERIFIED_DIMENSION',
      unsupported_known_dimensions: unsupportedKnownDimensions,
      answerability_frontier: emptyFrontier,
      opportunitySpec: {
        tenant: tenantDomain,
        kind: 'CAPABILITY_GAP',
        retailerId: null,
        signal: 'MINIMIZED_INTENT_IR',
        evidence: JSON.stringify({
          intent_ir: persistedIntent,
          decision_eligible: false,
          unsupported_known_dimensions: unsupportedKnownDimensions,
          answerability_frontier: emptyFrontier,
          observed_at: now.toISOString(),
        }),
        observedState: JSON.stringify({
          location: location.value,
          unsupported_known_dimensions: unsupportedKnownDimensions,
          verified_candidate_count: null,
        }),
        hypothesizedValue: null,
        confidence: null,
        recommendedAction:
          `Add evidence-gated support for ${unsupportedKnownDimensions.join(', ')} before this ASK can return decision-eligible candidates.`,
        requiredAuthority: 'PROPOSE_ONLY',
        risk: 'LOW — proposal only; no market claim or customer action is inferred',
        rollback: 'Dismiss the capability gap; no market state changes',
        measurementPlan:
          'Re-run the exact intent after the missing dimensions consume canonical verified truth; answerability improves only when the query becomes decision-eligible.',
      },
    };
  }

  const where = buildCandidateWhere(intent, { brandId, now, market });

  const rows = await prisma.retailer.findMany({
    where,
    select: {
      id: true, name: true, type: true, address: true, city: true, state: true, zip: true,
      lat: true, lng: true, phone: true, website: true, hours: true, hoursSource: true,
      licenseStatus: true, dataStatus: true, dataSource: true, sourceUrl: true,
      retrievedAt: true, verifiedAt: true, freshnessExpiresAt: true, confidence: true,
      isDemonstration: true,
    },
    orderBy: [
      { isDemonstration: 'asc' }, { verifiedAt: 'desc' },
      { freshnessExpiresAt: 'desc' }, { id: 'asc' },
    ],
    take: MAX_CANDIDATES,
  });

  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

  // Belt and braces: the same post-query publication gate as the UI/API.
  const eligibleRows = rows.filter((row) => isPubliclyVerified(row, now));
  const frontier = buildAnswerabilityFrontier({
    tenant: tenantDomain,
    intent,
    claimDecisions: projectionClaimDecisions(eligibleRows, emptyFrontier.required_predicates),
    asOf: now,
  });
  const candidates = eligibleRows
    .filter((row) => frontier.subject_coverage.some((subject) => (
      subject.subject_ref === row.id
      && subject.current_predicates.length === frontier.required_predicates.length
    )))
    .map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    location: { address: r.address, city: r.city, state: r.state, postal_code: r.zip, latitude: r.lat, longitude: r.lng },
    contact: { phone: r.phone, website: r.website },
    hours: { text: r.hours, source: r.hoursSource },
    regulatory: { license_status: r.licenseStatus },
    provenance: {
      data_status: r.dataStatus,
      source: r.dataSource,
      source_url: r.sourceUrl,
      retrieved_at: iso(r.retrievedAt),
      verified_at: iso(r.verifiedAt),
      freshness_expires_at: iso(r.freshnessExpiresAt),
      confidence: r.confidence,
      is_demonstration: !!r.isDemonstration,
    },
  }));

  // MERCHANT-ACTIONABLE OPPORTUNITY from the SAME evidence.
  // Slice 1 emits exactly one class: a located intent that verified supply
  // cannot answer is a MARKET_GAP. The observed state IS the evidence.
  let opportunitySpec = null;
  if (candidates.length === 0 && location?.status === 'KNOWN') {
    opportunitySpec = {
      tenant: tenantDomain,
      kind: 'MARKET_GAP',
      retailerId: null,
      signal: 'MINIMIZED_INTENT_IR',
      evidence: JSON.stringify({
        intent_ir: persistedIntent,
        answerability_frontier: frontier,
        query_gate: 'currentPublicRecordWhere + isPubliclyVerified',
        verified_candidates: 0,
        observed_at: now.toISOString(),
      }),
      observedState: JSON.stringify({
        location: location.value,
        category: intent.dimensions.category?.value ?? null,
        verified_candidate_count: 0,
      }),
      hypothesizedValue: null, // no invented dollar figure — UNKNOWN stays UNKNOWN
      confidence: null,
      recommendedAction:
        `Verify merchant coverage for "${location.value}": recruit or verify a merchant serving this area, ` +
        'or verify existing-but-unverified records so real supply becomes answerable.',
      requiredAuthority: 'PROPOSE_ONLY',
      risk: 'LOW — proposal only; no customer-facing or merchant-facing effect until authorized',
      rollback: 'Dismiss the opportunity; no state to roll back',
      measurementPlan:
        'Re-run this intent against the evidence-gated store on each follow-up tick; ' +
        'the gap is CLOSED when verified candidates > 0, PERSISTENT otherwise.',
    };
  }

  return {
    candidates,
    verified_candidate_count: candidates.length,
    zero_verified_result: candidates.length === 0,
    zero_result_reason: candidates.length === 0 ? 'NO_VERIFIED_CURRENT_MATCH' : null,
    unsupported_known_dimensions: [],
    answerability_frontier: frontier,
    opportunitySpec,
  };
}

export async function answerCustomerDiscovery(prisma, {
  rawQuery,
  marketId,
  brandId,
  tenantDomain,
  now = new Date(),
}) {
  const market = resolveCustomerMarketContext(marketId);
  const intent = compileIntent(rawQuery, { now, marketId });
  const answer = await answerIntent(prisma, {
    intent,
    brandId,
    tenantDomain,
    now,
    market,
  });
  return projectCustomerDiscovery({ intent, market, answer, asOf: now });
}
