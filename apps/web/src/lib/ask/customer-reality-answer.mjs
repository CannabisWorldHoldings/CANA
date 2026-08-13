import { compileRetailerTruth } from '../reality/market-claim-adapter.mjs';
import { buildAnswerabilityFrontier } from './answerability-frontier.mjs';
import {
  CUSTOMER_DISCOVERY_REALITY_GATE_VERSION,
  CUSTOMER_UNSUPPORTED_DIMENSIONS,
  CUSTOMER_REALITY_RULES,
  customerDiscoveryFailure,
  projectionClock,
} from './customer-discovery-contract.mjs';

const MAX_CANDIDATES = 10;

function frontier({ tenantDomain, intent, claimDecisions, marketId, now }) {
  const rule = CUSTOMER_REALITY_RULES[marketId];
  if (!rule) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_UNSUPPORTED');
  return buildAnswerabilityFrontier({
    tenant: tenantDomain,
    intent,
    claimDecisions,
    asOf: now,
    predicateOverrides: { location: rule.required },
    evidenceGateVersion: CUSTOMER_DISCOVERY_REALITY_GATE_VERSION,
  });
}

function opportunity({ tenantDomain, intent, currentFrontier, unsupported, now }) {
  const location = intent.dimensions.location;
  if (unsupported.length > 0) {
    return {
      tenant: tenantDomain, kind: 'CAPABILITY_GAP', retailerId: null, signal: 'MINIMIZED_INTENT_IR',
      evidence: JSON.stringify({
        decision_eligible: false, unsupported_known_dimensions: unsupported,
        answerability_frontier: currentFrontier, observed_at: now.toISOString(),
      }),
      observedState: JSON.stringify({
        location: location.value, unsupported_known_dimensions: unsupported, verified_candidate_count: null,
      }),
      hypothesizedValue: null, confidence: null,
      recommendedAction: `Add evidence-gated support for ${unsupported.join(', ')} before this ASK can return decision-eligible candidates.`,
      requiredAuthority: 'PROPOSE_ONLY',
      risk: 'LOW — proposal only; no market claim or customer action is inferred',
      rollback: 'Dismiss the capability gap; no market state changes',
      measurementPlan: 'Re-run the exact intent after the missing dimensions consume canonical verified truth.',
    };
  }
  return {
    tenant: tenantDomain, kind: 'MARKET_GAP', retailerId: null, signal: 'MINIMIZED_INTENT_IR',
    evidence: JSON.stringify({
      answerability_frontier: currentFrontier, query_gate: CUSTOMER_DISCOVERY_REALITY_GATE_VERSION,
      verified_candidates: 0, observed_at: now.toISOString(),
    }),
    observedState: JSON.stringify({ location: location.value, verified_candidate_count: 0 }),
    hypothesizedValue: null, confidence: null,
    recommendedAction: `Verify merchant coverage for "${location.value}" before exposing customer supply.`,
    requiredAuthority: 'PROPOSE_ONLY',
    risk: 'LOW — proposal only; no customer-facing or merchant-facing effect until authorized',
    rollback: 'Dismiss the opportunity; no state to roll back',
    measurementPlan: 'Re-run this intent against canonical current claim decisions.',
  };
}

function address(value, jurisdiction) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = value.trim().match(/^(.*),\s*([^,]+),\s*(DC|MD|VA)\s+(\d{5})(?:-\d{4})?$/i);
  if (!match || match[3].toUpperCase() !== jurisdiction) return null;
  return Object.freeze({
    address: match[1].trim(), city: match[2].trim(),
    state: match[3].toUpperCase(), postal_code: match[4],
  });
}

function coordinates(value) {
  if (typeof value !== 'string') return { latitude: null, longitude: null };
  try {
    const parsed = JSON.parse(value);
    return Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lng)
      ? { latitude: parsed.lat, longitude: parsed.lng }
      : { latitude: null, longitude: null };
  } catch {
    return { latitude: null, longitude: null };
  }
}

function validateDecisions(decisions, market, tenantDomain, clock) {
  if (!Array.isArray(decisions)) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_REALITY_INVALID');
  for (const decision of decisions) {
    const observed = new Date(decision?.observed_at);
    const verified = new Date(decision?.verified_at);
    const expires = new Date(decision?.freshness_expires_at);
    if (decision?.tenant !== tenantDomain
      || decision?.market_id !== market.market_id
      || decision?.contract_digest !== market.evidence.contract_digest
      || decision?.source_id !== market.evidence.source_key
      || decision?.source_url !== market.evidence.source_url) {
      customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_REALITY_PROVENANCE_MISMATCH');
    }
    if (typeof decision?.subject_ref !== 'string' || !decision.subject_ref
      || decision.verification !== 'VERIFIED' || decision.decision_eligible !== true
      || !Number.isFinite(observed.getTime()) || observed > clock
      || !Number.isFinite(verified.getTime()) || verified > clock
      || !Number.isFinite(expires.getTime()) || expires <= clock) {
      customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_REALITY_NOT_CURRENT');
    }
  }
}

function candidate(subjectRef, decisions, market, now) {
  const truth = compileRetailerTruth({ retailer: { id: subjectRef }, claimDecisions: decisions, asOf: now });
  if (truth.name.state !== 'KNOWN' || truth.address.state !== 'KNOWN') return null;
  const location = address(truth.address.value, market.jurisdiction_code);
  if (!location) return null;
  const rule = CUSTOMER_REALITY_RULES[market.market_id];
  const listing = rule.listing ? decisions.find((decision) => decision.predicate === rule.listing) : null;
  const license = truth.license.state === 'KNOWN' ? truth.license.value : null;
  const licenseStatus = license && typeof license === 'object' ? license.license_status ?? null : null;
  if (market.market_id === 'US-DC' && (licenseStatus !== 'ACTIVE' || truth.is_open.value !== 'ACTIVE')) return null;
  const verifiedTimes = decisions.map((decision) => new Date(decision.verified_at).getTime());
  const retrievedTimes = decisions.map((decision) => new Date(decision.retrieved_at).getTime()).filter(Number.isFinite);
  const expiresTimes = decisions.map((decision) => new Date(decision.freshness_expires_at).getTime());
  const point = truth.location.state === 'KNOWN' ? coordinates(truth.location.value) : coordinates(null);
  return {
    id: subjectRef, name: truth.name.value, type: listing?.value ?? null,
    location: { ...location, ...point },
    contact: {
      phone: truth.phone.state === 'KNOWN' ? truth.phone.value : null,
      website: truth.website.state === 'KNOWN' ? truth.website.value : null,
    },
    hours: { text: truth.hours.state === 'KNOWN' ? truth.hours.value : null, source: null },
    regulatory: { license_status: licenseStatus },
    provenance: {
      data_status: 'VERIFIED_CURRENT', source: market.evidence.source_id,
      source_key: market.evidence.source_key, source_url: market.evidence.source_url,
      retrieved_at: retrievedTimes.length > 0 ? new Date(Math.max(...retrievedTimes)).toISOString() : null,
      verified_at: new Date(Math.max(...verifiedTimes)).toISOString(),
      freshness_expires_at: new Date(Math.min(...expiresTimes)).toISOString(),
      confidence: null, is_demonstration: false,
    },
  };
}

export function answerVerifiedRealityIntent({ intent, market, tenantDomain, claimDecisions = [], now = new Date() }) {
  const clock = projectionClock(now);
  const location = intent?.dimensions?.location;
  const unsupported = CUSTOMER_UNSUPPORTED_DIMENSIONS
    .filter((name) => intent?.dimensions?.[name]?.status === 'KNOWN');
  const emptyFrontier = frontier({ tenantDomain, intent, claimDecisions: [], marketId: market.market_id, now: clock });
  if (location?.status !== 'KNOWN' || unsupported.length > 0) {
    return {
      market_id: market.market_id, candidates: [], verified_candidate_count: 0, zero_verified_result: true,
      zero_result_reason: location?.status !== 'KNOWN'
        ? 'REQUIRED_INTENT_DIMENSION_UNKNOWN' : 'UNSUPPORTED_VERIFIED_DIMENSION',
      unsupported_known_dimensions: unsupported, answerability_frontier: emptyFrontier,
      opportunitySpec: location?.status !== 'KNOWN'
        ? null : opportunity({ tenantDomain, intent, currentFrontier: emptyFrontier, unsupported, now: clock }),
      truth_gate: 'selectCurrentClaimDecisions + buildAnswerabilityFrontier',
    };
  }
  validateDecisions(claimDecisions, market, tenantDomain, clock);
  const grouped = new Map();
  for (const decision of claimDecisions) {
    const entries = grouped.get(decision.subject_ref) ?? [];
    entries.push(decision);
    grouped.set(decision.subject_ref, entries);
  }
  const matched = new Map();
  const needle = String(location.value).toLowerCase();
  for (const [subjectRef, decisions] of grouped) {
    const result = candidate(subjectRef, decisions, market, clock);
    if (!result) continue;
    const searchable = `${result.name} ${result.location.address} ${result.location.city}`.toLowerCase();
    if (searchable.includes(needle)) matched.set(subjectRef, { candidate: result, decisions });
  }
  const currentFrontier = frontier({
    tenantDomain, intent, claimDecisions: [...matched.values()].flatMap((entry) => entry.decisions),
    marketId: market.market_id, now: clock,
  });
  const candidates = currentFrontier.subject_coverage
    .filter((subject) => subject.current_predicates.length === currentFrontier.required_predicates.length)
    .map((subject) => matched.get(subject.subject_ref)?.candidate).filter(Boolean).slice(0, MAX_CANDIDATES);
  return {
    market_id: market.market_id, candidates, verified_candidate_count: candidates.length,
    zero_verified_result: candidates.length === 0,
    zero_result_reason: candidates.length === 0 ? 'NO_VERIFIED_CURRENT_MATCH' : null,
    unsupported_known_dimensions: [], answerability_frontier: currentFrontier,
    opportunitySpec: candidates.length === 0
      ? opportunity({ tenantDomain, intent, currentFrontier, unsupported: [], now: clock }) : null,
    truth_gate: 'selectCurrentClaimDecisions + buildAnswerabilityFrontier',
  };
}
