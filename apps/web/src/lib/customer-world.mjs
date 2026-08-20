import { CUSTOMER_DISCOVERY_MARKETS } from './ask/customer-discovery-contract.mjs';
import { compileMarketPage } from './market-page-compiler.mjs';
import {
  resolveCustomerDiscovery,
  resolveCustomerMerchantProfile,
} from './ask/customer-discovery.mjs';
import {
  CUSTOMER_WORLD_JOURNEYS,
  CUSTOMER_WORLD_JOURNEY_PATHS,
  customerWorldViewHref,
} from './customer-world-navigation.mjs';

export {
  CUSTOMER_WORLD_JOURNEYS,
  CUSTOMER_WORLD_JOURNEY_PATHS,
  customerWorldViewHref,
};

const CUSTOMER_WORLD_VIEWS = new Set(['list', 'map']);
const QUERY_LIMIT = 160;
const MERCHANT_ID_LIMIT = 200;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value, limit) {
  return typeof first(value) === 'string' ? first(value).trim().slice(0, limit) : '';
}

export function normalizeCustomerMerchantId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MERCHANT_ID_LIMIT) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0
      && decoded.length <= MERCHANT_ID_LIMIT
      && !/[\u0000-\u001f\u007f/\\]/.test(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

function unknown(reason) {
  return Object.freeze({ state: 'UNKNOWN', value: null, reason });
}

function knownValue(field) {
  return field?.state === 'KNOWN' ? field.value : null;
}

function profileHref(result, request) {
  const params = new URLSearchParams({
    market: request.market_id,
    query: request.customer_query,
  });
  return `/merchant/${encodeURIComponent(result.merchant_id)}?${params}`;
}

function customerCard(result, request) {
  return Object.freeze({
    id: result.merchant_id,
    name: result.customer_facing_name,
    business_type: result.business_type,
    regulatory_state: result.regulatory_state,
    verification_state: result.verification_state,
    location: result.location,
    distance: result.distance,
    fulfillment_type: result.fulfillment_type,
    delivery_authority: result.delivery_authority,
    delivery_eligibility: result.delivery_eligibility,
    price: result.price,
    category: result.category,
    open_now: result.open_now,
    deal: result.deal,
    inventory: unknown('NO_DECISION_ELIGIBLE_INVENTORY_EVIDENCE'),
    eta: unknown('NO_DECISION_ELIGIBLE_ETA_EVIDENCE'),
    service_area: unknown('NO_DECISION_ELIGIBLE_SERVICE_AREA_EVIDENCE'),
    popularity: unknown('NO_DECISION_ELIGIBLE_POPULARITY_EVIDENCE'),
    freshness: result.freshness,
    provenance: result.provenance,
    unknown_dimensions: Object.freeze([
      ...result.unknown_dimensions,
      'inventory', 'eta', 'service_area', 'popularity',
    ]),
    capability_gaps: result.capability_gaps,
    profile_href: profileHref(result, request),
  });
}

function customerMap(results) {
  const markers = results.flatMap((result) => {
    const coordinates = knownValue(result.location.coordinates);
    const name = knownValue(result.name);
    if (!coordinates || !Number.isFinite(coordinates.latitude)
      || !Number.isFinite(coordinates.longitude) || !name) return [];
    return [Object.freeze({
      id: result.id,
      name,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      profile_href: result.profile_href,
      verification_state: knownValue(result.verification_state),
    })];
  });
  return Object.freeze({
    state: markers.length > 0 ? 'KNOWN' : 'UNKNOWN',
    markers: Object.freeze(markers),
    result_count: results.length,
    unmappable_count: results.length - markers.length,
    explanation: markers.length > 0
      ? 'Map markers are the same canonical discovery identities shown in the list.'
      : 'No verified coordinates are available for these results. The list remains usable.',
  });
}

const HOME_MODULE_MARKET_LABELS = Object.freeze({
  'US-DC': 'Washington, D.C.',
  'US-MD': 'Maryland',
  'US-VA': 'Virginia',
});

/**
 * W-1 seam — HOME journey only: project verified customer cards into the
 * market-page compiler's record vocabulary. Only KNOWN, VERIFIED_CURRENT
 * facts cross the seam; every other dimension stays behind, and the
 * compiler's own laws decide module eligibility from there. Nothing here
 * invents placements, deals, questions, service areas, or license data the
 * projection did not carry — empty inputs produce the compiler's honest
 * UNSOLD / absent states rather than filler.
 */
export function marketPageRecordsFromCards(cards) {
  const merchants = [];
  const deals = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const name = knownValue(card.name);
    const verification = knownValue(card.verification_state);
    const freshness = knownValue(card.freshness);
    if (!name || verification !== 'VERIFIED_CURRENT' || !freshness?.verified_at) continue;
    const fulfillment = knownValue(card.fulfillment_type);
    const businessType = knownValue(card.business_type);
    const kind = /deliver/i.test(String(fulfillment ?? '')) || /deliver/i.test(String(businessType ?? ''))
      ? 'DELIVERY'
      : 'DISPENSARY';
    const provenance = card.provenance ?? null;
    const merchant = {
      merchant_id: card.id,
      name,
      kind,
      license: {
        status: 'VERIFIED_CURRENT',
        checked_at: freshness.verified_at,
        ...(provenance?.source ? { authority: provenance.source } : {}),
        ...(provenance?.source_url ? { source_url: provenance.source_url } : {}),
      },
    };
    const distance = knownValue(card.distance);
    if (Number.isFinite(distance)) merchant.distance_miles = distance;
    merchants.push(merchant);

    const deal = knownValue(card.deal);
    if (deal && typeof deal === 'object' && deal.id && deal.title) {
      deals.push({
        id: String(deal.id),
        merchant_id: card.id,
        title: String(deal.title),
        ...(deal.category ? { category: deal.category } : {}),
        ...(Number.isFinite(deal.price_usd) ? { price_usd: deal.price_usd } : {}),
        checked_at: freshness.verified_at,
        ...(deal.validity ? { validity: deal.validity } : {}),
      });
    }
  }
  return { placements: [], merchants, deals, questions: [] };
}

function compileHomeModules({ request, results, projection }) {
  if (request.journey !== 'HOME' || results.length === 0) return null;
  const records = marketPageRecordsFromCards(results);
  if (records.merchants.length === 0) return null;
  const marketId = projection.market?.market_id ?? request.market_id;
  return compileMarketPage(records, {
    market: HOME_MODULE_MARKET_LABELS[marketId] ?? marketId,
    now: projection.generated_at,
  });
}

export function normalizeCustomerWorldRequest({
  journey = 'SEARCH', market, query, view,
} = {}) {
  const normalizedJourney = clean(journey, 24).toUpperCase();
  if (!CUSTOMER_WORLD_JOURNEYS.includes(normalizedJourney)) {
    throw new Error('CANA_CUSTOMER_WORLD_JOURNEY_UNSUPPORTED');
  }
  const marketId = clean(market, 16) || 'US-DC';
  if (!CUSTOMER_DISCOVERY_MARKETS.includes(marketId)) {
    throw new Error('CANA_CUSTOMER_WORLD_MARKET_UNSUPPORTED');
  }
  const customerQuery = clean(query, QUERY_LIMIT);
  const requestedView = CUSTOMER_WORLD_VIEWS.has(clean(view, 8)) ? clean(view, 8) : 'list';
  return Object.freeze({
    journey: normalizedJourney,
    market_id: marketId,
    customer_query: customerQuery,
    effective_query: normalizedJourney === 'DELIVERY'
      ? `delivery${customerQuery ? ` in ${customerQuery}` : ''}`
      : customerQuery,
    requested_view: requestedView,
  });
}

export function buildCustomerWorldView({ request, projection }) {
  if (!projection?.truth || !Array.isArray(projection.results)) {
    throw new Error('CANA_CUSTOMER_WORLD_PROJECTION_INVALID');
  }
  const results = Object.freeze(projection.results.map((result) => customerCard(result, request)));
  const unsupportedDimensions = Object.freeze(
    (projection.capability_gaps ?? []).map((gap) => gap.dimension),
  );
  const inputRequired = projection.truth.zero_result_reason === 'REQUIRED_INTENT_DIMENSION_UNKNOWN';
  const state = inputRequired
    ? 'INPUT_REQUIRED'
    : unsupportedDimensions.length > 0
      ? 'CAPABILITY_GAP'
      : results.length > 0 ? 'RESULTS' : 'EMPTY';
  const stateExplanation = state === 'INPUT_REQUIRED'
    ? 'Enter a city or neighborhood to see verified options near you.'
    : state === 'CAPABILITY_GAP'
      ? `We can't verify ${unsupportedDimensions.join(', ')} yet, so we won't guess at it.`
      : state === 'EMPTY'
        ? "No verified match right now — which is not proof that nothing exists. We just won't show what we can't back up."
        : 'Every result here is backed by a current, verified source.';
  const homeModules = compileHomeModules({ request, results, projection });
  return Object.freeze({
    schema_version: 'cana-customer-world/v1',
    state,
    state_explanation: stateExplanation,
    home_modules: homeModules,
    request,
    market: projection.market,
    intent: projection.intent,
    results,
    map: customerMap(results),
    unsupported_dimensions: unsupportedDimensions,
    unknown_dimensions: Object.freeze(projection.intent?.unknown_dimensions ?? []),
    delivery_eligibility: request.journey === 'DELIVERY'
      ? Object.freeze({
          state: 'CAPABILITY_GAP', value: null, dimension: 'fulfillment',
          reason: 'NO_DECISION_ELIGIBLE_DELIVERY_AUTHORITY_OR_SERVICE_AREA',
        })
      : unknown('DELIVERY_JOURNEY_NOT_REQUESTED'),
    opportunity_signal: projection.opportunity_signal,
    truth: projection.truth,
    generated_at: projection.generated_at,
  });
}

export async function resolveCustomerWorld(prisma, options) {
  const request = normalizeCustomerWorldRequest(options);
  const discovery = await resolveCustomerDiscovery(prisma, {
    rawQuery: request.effective_query,
    marketId: request.market_id,
    tenantDomain: options.tenantDomain,
    now: options.now,
  });
  return buildCustomerWorldView({ request, projection: discovery.projection });
}

export async function resolveCustomerMerchant(prisma, options) {
  const merchantId = normalizeCustomerMerchantId(options.merchantId);
  if (!merchantId) throw new Error('CANA_CUSTOMER_MERCHANT_ID_INVALID');
  const requestedMarket = clean(options.market, 16) || null;
  if (requestedMarket !== null && !CUSTOMER_DISCOVERY_MARKETS.includes(requestedMarket)) {
    throw new Error('CANA_CUSTOMER_WORLD_MARKET_UNSUPPORTED');
  }
  const profile = await resolveCustomerMerchantProfile(prisma, {
    merchantId,
    marketId: requestedMarket,
    tenantDomain: options.tenantDomain,
    now: options.now,
  });
  if (!profile) return null;
  const request = normalizeCustomerWorldRequest({
    journey: 'SEARCH',
    market: profile.market.market_id,
    query: options.query,
  });
  return Object.freeze({
    merchant: customerCard(profile.result, request),
    request,
    market: profile.market,
  });
}
