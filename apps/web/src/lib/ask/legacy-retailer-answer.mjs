/**
 * Legacy Retailer-backed ASK answer path.
 *
 * Customer discovery uses the canonical MarketClaim graph in the sibling
 * customer-discovery modules. This path remains for existing callers that
 * still consume the verified public Retailer projection.
 */

import { isPubliclyVerified } from '../data-status.mjs';
import { currentPublicRecordWhere } from '../seo-truth.mjs';
import {
  buildAnswerabilityFrontier,
  projectionClaimDecisions,
} from './answerability-frontier.mjs';
import { admittedMarketContext } from './customer-discovery-contract.mjs';
import { persistenceSafeIntent } from './intent-ir.mjs';

const MAX_CANDIDATES = 10;

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
    where.OR = [
      { address: { contains: location.value, mode: 'insensitive' } },
      { city: { contains: location.value, mode: 'insensitive' } },
    ];
  }
  return where;
}

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

  const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
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
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      location: {
        address: row.address,
        city: row.city,
        state: row.state,
        postal_code: row.zip,
        latitude: row.lat,
        longitude: row.lng,
      },
      contact: { phone: row.phone, website: row.website },
      hours: { text: row.hours, source: row.hoursSource },
      regulatory: { license_status: row.licenseStatus },
      provenance: {
        data_status: row.dataStatus,
        source: row.dataSource,
        source_key: market?.evidence?.source_key ?? null,
        source_url: row.sourceUrl,
        retrieved_at: iso(row.retrievedAt),
        verified_at: iso(row.verifiedAt),
        freshness_expires_at: iso(row.freshnessExpiresAt),
        confidence: row.confidence,
        is_demonstration: !!row.isDemonstration,
      },
    }));

  let opportunitySpec = null;
  if (candidates.length === 0) {
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
      hypothesizedValue: null,
      confidence: null,
      recommendedAction:
        `Verify merchant coverage for "${location.value}": recruit or verify a merchant serving this area, `
        + 'or verify existing-but-unverified records so real supply becomes answerable.',
      requiredAuthority: 'PROPOSE_ONLY',
      risk: 'LOW — proposal only; no customer-facing or merchant-facing effect until authorized',
      rollback: 'Dismiss the opportunity; no state to roll back',
      measurementPlan:
        'Re-run this intent against the evidence-gated store on each follow-up tick; '
        + 'the gap is CLOSED when verified candidates > 0, PERSISTENT otherwise.',
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
