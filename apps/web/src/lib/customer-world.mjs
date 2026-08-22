// @ts-check

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

/**
 * @template T
 * @typedef {Readonly<
 *   | { status: 'KNOWN', value: T, matched_token: string | null }
 *   | { status: 'UNKNOWN', value: null, matched_token: null }
 * >} CustomerAskDimension
 */

/**
 * @typedef {Readonly<{
 *   schema_version: string,
 *   tenant: string,
 *   frontier_key: string,
 *   evidence_digest: string,
 *   intent_scope: Readonly<Partial<{
 *     location: string,
 *     category: string,
 *     price_max_usd: number,
 *     fulfillment: string,
 *     open_now: boolean,
 *   }>>,
 *   required_predicates: ReadonlyArray<string>,
 *   blocking_predicates: ReadonlyArray<string>,
 *   stale_predicates: ReadonlyArray<string>,
 *   contradicted_predicates: ReadonlyArray<string>,
 * }>} CustomerAskFrontier
 */

/**
 * @typedef {Readonly<{
 *   kind: string,
 *   retailerId: null,
 *   hypothesizedValue: null,
 *   confidence: null,
 *   recommendedAction: string,
 *   requiredAuthority: string,
 *   risk: string,
 *   rollback: string,
 *   measurementPlan: string,
 * }>} CustomerAskOpportunity
 */

/**
 * @typedef {Readonly<{
 *   market_id: string,
 *   verified_candidate_count: number,
 *   zero_verified_result: boolean,
 *   zero_result_reason: string | null,
 *   unsupported_known_dimensions: ReadonlyArray<string>,
 *   answerability_frontier: CustomerAskFrontier,
 *   opportunitySpec: CustomerAskOpportunity | null,
 * }>} CustomerAskAnswer
 */

/**
 * @typedef {Readonly<{
 *   ir_version: number,
 *   raw_query: string,
 *   compiled_at: string,
 *   compiler: string,
 *   dimensions: Readonly<{
 *     location: CustomerAskDimension<string>,
 *     category: CustomerAskDimension<string>,
 *     price_max_usd: CustomerAskDimension<number>,
 *     fulfillment: CustomerAskDimension<string>,
 *     open_now: CustomerAskDimension<boolean>,
 *   }>,
 *   unknown_dimensions: ReadonlyArray<string>,
 * }>} CustomerAskIntent
 */

/** @typedef {Readonly<{ answer: CustomerAskAnswer, intent: CustomerAskIntent }>} CustomerAskObservation */

/**
 * @typedef {Readonly<{
 *   journey?: 'HOME' | 'SEARCH' | 'DELIVERY' | 'DISPENSARIES',
 *   market?: string | ReadonlyArray<string>,
 *   query?: string | ReadonlyArray<string>,
 *   view?: string | ReadonlyArray<string>,
 *   tenantDomain: string,
 *   now?: Date,
 *   recordAsk?: (observation: CustomerAskObservation) => unknown,
 * }>} CustomerWorldOptions
 */

/**
 * @typedef {Readonly<{
 *   merchantId: string,
 *   market?: string | ReadonlyArray<string>,
 *   query?: string | ReadonlyArray<string>,
 *   tenantDomain: string,
 *   now?: Date,
 * }>} CustomerMerchantOptions
 */

/** @typedef {Readonly<{ state: 'UNKNOWN' | 'CAPABILITY_GAP', value: null, reason?: string }>} UnknownField */
/** @template T @typedef {Readonly<{ state: 'KNOWN', value: T }>} KnownField */
/** @template T @typedef {KnownField<T>|UnknownField} CustomerField */
/** @typedef {Readonly<{ latitude: number, longitude: number }>} CustomerCoordinates */
/** @typedef {Readonly<{ id?: string, title?: string, category?: string, price_usd?: number }>} CustomerDeal */
/** @typedef {Readonly<{ verified_at: string, retrieved_at?: string, freshness_expires_at?: string }>} CustomerFreshness */
/** @typedef {Readonly<{ source?: string, source_url?: string, data_status?: string, is_demonstration?: boolean }>} CustomerProvenance */
/**
 * @typedef {Readonly<{
 *   address: CustomerField<string>,
 *   city: CustomerField<string>,
 *   region: CustomerField<string>,
 *   postal_code: CustomerField<string>,
 *   coordinates: CustomerField<CustomerCoordinates>,
 * }>} CustomerLocation
 */
/**
 * @typedef {Readonly<{
 *   merchant_id: string,
 *   customer_facing_name: CustomerField<string>,
 *   business_type: CustomerField<unknown>,
 *   regulatory_state: CustomerField<unknown>,
 *   verification_state: KnownField<string>,
 *   location: CustomerLocation,
 *   distance: CustomerField<number>,
 *   fulfillment_type: CustomerField<unknown>,
 *   delivery_authority: CustomerField<unknown>,
 *   delivery_eligibility: CustomerField<unknown>,
 *   price: CustomerField<unknown>,
 *   category: CustomerField<unknown>,
 *   open_now: CustomerField<unknown>,
 *   deal: CustomerField<CustomerDeal>,
 *   freshness: CustomerField<CustomerFreshness>,
 *   provenance: CustomerProvenance,
 *   unknown_dimensions: ReadonlyArray<string>,
 *   capability_gaps: unknown,
 * }>} CustomerDiscoveryResult
 */
/**
 * @typedef {Readonly<{
 *   journey: 'HOME' | 'SEARCH' | 'DELIVERY' | 'DISPENSARIES',
 *   market_id: string,
 *   customer_query: string,
 *   effective_query: string,
 *   requested_view: 'list' | 'map',
 * }>} CustomerWorldRequest
 */
/**
 * @typedef {Readonly<{
 *   truth: Readonly<{ zero_result_reason: string | null }>,
 *   results: ReadonlyArray<CustomerDiscoveryResult>,
 *   capability_gaps?: ReadonlyArray<Readonly<{ dimension: string }>>,
 *   intent?: Readonly<{ unknown_dimensions?: ReadonlyArray<string> }>,
 *   market?: Readonly<{ market_id?: string }>,
 *   opportunity_signal?: unknown,
 *   generated_at: string,
 * }>} CustomerWorldProjection
 */
/**
 * @typedef {{
 *   merchant_id: string,
 *   name: string,
 *   kind: string,
 *   license: { status: string, checked_at: string, authority?: string, source_url?: string },
 *   distance_miles?: number,
 * }} MarketPageMerchant
 */

const CUSTOMER_WORLD_VIEWS = new Set(['list', 'map']);
const QUERY_LIMIT = 160;
const MERCHANT_ID_LIMIT = 200;

/** @param {string} value @returns {value is CustomerWorldRequest['journey']} */
function isCustomerWorldJourney(value) {
  return CUSTOMER_WORLD_JOURNEYS.includes(value);
}

/** @param {string} value @returns {value is CustomerWorldRequest['requested_view']} */
function isCustomerWorldView(value) {
  return CUSTOMER_WORLD_VIEWS.has(value);
}

/** @param {unknown} value */
function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** @param {unknown} value @param {number} limit */
function clean(value, limit) {
  const candidate = first(value);
  return typeof candidate === 'string' ? candidate.trim().slice(0, limit) : '';
}

/** @param {unknown} value */
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

/** @param {string} reason @returns {UnknownField} */
function unknown(reason) {
  return Object.freeze({ state: 'UNKNOWN', value: null, reason });
}

/** @template T @param {CustomerField<T> | null | undefined} field @returns {T | null} */
function knownValue(field) {
  return field?.state === 'KNOWN' ? field.value : null;
}

/** @param {{ merchant_id: string }} result @param {CustomerWorldRequest} request */
function profileHref(result, request) {
  const params = new URLSearchParams({
    market: request.market_id,
    query: request.customer_query,
  });
  return `/merchant/${encodeURIComponent(result.merchant_id)}?${params}`;
}

/** @param {CustomerDiscoveryResult} result @param {CustomerWorldRequest} request */
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

/** @param {ReadonlyArray<ReturnType<typeof customerCard>>} results */
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
      verification_state: result.verification_state.value,
    })];
  });
  Object.freeze(markers);
  return Object.freeze({
    state: markers.length > 0 ? 'KNOWN' : 'UNKNOWN',
    markers,
    result_count: results.length,
    unmappable_count: results.length - markers.length,
    explanation: markers.length > 0
      ? 'Map markers are the same canonical discovery identities shown in the list.'
      : 'No verified coordinates are available for these results. The list remains usable.',
  });
}

/** @type {Readonly<Record<string, string>>} */
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
/** @param {ReadonlyArray<ReturnType<typeof customerCard>>} cards */
export function marketPageRecordsFromCards(cards) {
  /** @type {MarketPageMerchant[]} */
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
    /** @type {MarketPageMerchant} */
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

/**
 * @param {{
 *   request: CustomerWorldRequest,
 *   results: ReadonlyArray<ReturnType<typeof customerCard>>,
 *   projection: CustomerWorldProjection,
 * }} input
 */
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

/**
 * @param {{ journey?: unknown, market?: unknown, query?: unknown, view?: unknown }} [input]
 * @returns {CustomerWorldRequest}
 */
export function normalizeCustomerWorldRequest({
  journey = 'SEARCH', market, query, view,
} = {}) {
  const normalizedJourney = clean(journey, 24).toUpperCase();
  if (!isCustomerWorldJourney(normalizedJourney)) {
    throw new Error('CANA_CUSTOMER_WORLD_JOURNEY_UNSUPPORTED');
  }
  const marketId = clean(market, 16) || 'US-DC';
  if (!CUSTOMER_DISCOVERY_MARKETS.includes(marketId)) {
    throw new Error('CANA_CUSTOMER_WORLD_MARKET_UNSUPPORTED');
  }
  const customerQuery = clean(query, QUERY_LIMIT);
  const normalizedView = clean(view, 8);
  const requestedView = isCustomerWorldView(normalizedView) ? normalizedView : 'list';
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

/**
 * @param {{ request: CustomerWorldRequest, projection: CustomerWorldProjection }} input
 * @returns {import('../components/customer-world-results').CustomerWorld}
 */
export function buildCustomerWorldView({ request, projection }) {
  if (!projection?.truth || !Array.isArray(projection.results)) {
    throw new Error('CANA_CUSTOMER_WORLD_PROJECTION_INVALID');
  }
  const results = projection.results.map((result) => customerCard(result, request));
  Object.freeze(results);
  const unsupportedDimensions = (projection.capability_gaps ?? []).map((gap) => gap.dimension);
  Object.freeze(unsupportedDimensions);
  const unknownDimensions = [...(projection.intent?.unknown_dimensions ?? [])];
  Object.freeze(unknownDimensions);
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
    unknown_dimensions: unknownDimensions,
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

/** @param {unknown} prisma @param {CustomerWorldOptions} options */
export async function resolveCustomerWorld(prisma, options) {
  const request = normalizeCustomerWorldRequest(options);
  const discovery = await resolveCustomerDiscovery(prisma, {
    rawQuery: request.effective_query,
    marketId: request.market_id,
    tenantDomain: options.tenantDomain,
    now: options.now,
  });
  // A typed search is real first-party demand, but the public result must never
  // depend on analytics storage. The injected recorder is the existing ASK
  // work path, which minimizes the Intent IR and stores a digest instead of raw
  // customer language. Default page views are not demand and stay silent.
  if (request.customer_query && typeof options.recordAsk === 'function') {
    try {
      /** @type {CustomerAskObservation} */
      const observation = Object.freeze({
        answer: discovery.answer,
        intent: discovery.intent,
      });
      await options.recordAsk(observation);
    } catch {
      // Observation is auxiliary. Canonical Reality still answers truthfully
      // when its bounded instrumentation store is unavailable.
    }
  }
  return buildCustomerWorldView({ request, projection: discovery.projection });
}

/** @param {unknown} prisma @param {CustomerMerchantOptions} options */
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
