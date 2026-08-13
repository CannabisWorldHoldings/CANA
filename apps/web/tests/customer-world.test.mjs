import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCustomerWorldView,
  normalizeCustomerWorldRequest,
  resolveCustomerWorld,
} from '../src/lib/customer-world.mjs';

const NOW = new Date('2026-08-13T08:30:00.000Z');

function field(state, value = null, reason = null) {
  return { state, value, ...(reason ? { reason } : {}) };
}

function projection(overrides = {}) {
  const result = {
    merchant_id: 'merchant-md-1',
    customer_facing_name: field('KNOWN', 'Bethesda Wellness'),
    business_type: field('UNKNOWN', null, 'BUSINESS_TYPE_UNKNOWN'),
    regulatory_state: field('UNKNOWN', null, 'REGULATORY_STATE_UNKNOWN'),
    verification_state: field('KNOWN', 'VERIFIED_CURRENT'),
    location: {
      address: field('KNOWN', '1 Wisconsin Ave'),
      city: field('KNOWN', 'Bethesda'),
      region: field('KNOWN', 'MD'),
      postal_code: field('KNOWN', '20814'),
      coordinates: field('KNOWN', { latitude: 38.9847, longitude: -77.0947 }),
    },
    market: field('KNOWN', 'US-MD'),
    distance: field('UNKNOWN', null, 'CUSTOMER_COORDINATES_AND_ROUTE_DISTANCE_NOT_PROVEN'),
    fulfillment_type: field('UNKNOWN', null, 'FULFILLMENT_INTENT_UNKNOWN'),
    delivery_authority: field('UNKNOWN', null, 'NO_DECISION_ELIGIBLE_DELIVERY_AUTHORITY_CLAIM'),
    delivery_eligibility: field('UNKNOWN', null, 'CUSTOMER_LOCATION_AND_SERVICE_AREA_NOT_PROVEN'),
    price: field('UNKNOWN', null, 'PRICE_INTENT_UNKNOWN'),
    category: field('UNKNOWN', null, 'CATEGORY_INTENT_UNKNOWN'),
    open_now: field('UNKNOWN', null, 'OPEN_NOW_INTENT_UNKNOWN'),
    deal: field('UNKNOWN', null, 'NO_DECISION_ELIGIBLE_DEAL_EVIDENCE'),
    freshness: field('KNOWN', {
      retrieved_at: '2026-08-13T06:00:00.000Z',
      verified_at: '2026-08-13T06:05:00.000Z',
      freshness_expires_at: '2026-08-14T06:05:00.000Z',
    }),
    provenance: {
      source: 'Maryland Cannabis Administration',
      source_url: 'https://cannabis.maryland.gov/',
      data_status: 'VERIFIED_CURRENT',
      is_demonstration: false,
    },
    unknown_dimensions: [
      'distance', 'fulfillment_type', 'delivery_authority', 'delivery_eligibility',
      'price', 'category', 'open_now', 'deal',
    ],
    capability_gaps: [],
  };
  return {
    schema_version: 'cana-customer-discovery-projection/v1',
    generated_at: NOW.toISOString(),
    market: {
      state: 'KNOWN', market_id: 'US-MD', jurisdiction_code: 'MD',
      evidence: {
        source_key: 'md-mca-dispensaries', source_id: 'Maryland Cannabis Administration',
        source_url: 'https://cannabis.maryland.gov/', contract_digest: 'digest-md',
      },
    },
    intent: {
      ir_version: 1, compiler: 'deterministic',
      dimensions: { location: { status: 'KNOWN', value: 'bethesda' } },
      unknown_dimensions: ['category', 'price_max_usd', 'fulfillment', 'open_now'],
    },
    results: [result],
    capability_gaps: [],
    opportunity_signal: { state: 'NONE' },
    truth: {
      projection_decides_truth: false, unknown_policy: 'PRESERVE_UNKNOWN',
      verified_candidate_count: 1, zero_verified_result: false,
      zero_result_reason: null, answerability_frontier: { state: 'ANSWERABLE' },
    },
    ...overrides,
  };
}

test('one request contract bounds market, query, journey, and view', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'SEARCH', market: ['US-MD', 'US-VA'], query: '  Bethesda  ', view: 'map',
  });
  assert.deepEqual({ ...request }, {
    journey: 'SEARCH', market_id: 'US-MD', customer_query: 'Bethesda',
    effective_query: 'Bethesda', requested_view: 'map',
  });
  assert.equal(Object.isFrozen(request), true);
  assert.throws(
    () => normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-PA', query: 'Erie' }),
    /CANA_CUSTOMER_WORLD_MARKET_UNSUPPORTED/,
  );
});

test('delivery is a first-class route intent, not a retailer type query alias', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'DELIVERY', market: 'US-MD', query: 'Bethesda',
  });
  assert.equal(request.customer_query, 'Bethesda');
  assert.equal(request.effective_query, 'delivery in Bethesda');
  assert.equal(request.journey, 'DELIVERY');
});

test('the same verified result identity powers list, map, and merchant profile discovery', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'DISPENSARIES', market: 'US-MD', query: 'Bethesda', view: 'list',
  });
  const view = buildCustomerWorldView({ request, projection: projection() });
  assert.equal(view.state, 'RESULTS');
  assert.deepEqual(view.results.map((entry) => entry.id), ['merchant-md-1']);
  assert.deepEqual(view.map.markers.map((entry) => entry.id), ['merchant-md-1']);
  assert.equal(view.map.unmappable_count, 0);
  assert.match(view.results[0].profile_href, /^\/merchant\/merchant-md-1\?/);
  assert.match(view.results[0].profile_href, /market=US-MD/);
  assert.match(view.results[0].profile_href, /query=Bethesda/);
});

test('unknown coordinates stay out of the map without removing the list record', () => {
  const withoutCoordinates = projection();
  withoutCoordinates.results[0].location.coordinates = field(
    'UNKNOWN', null, 'VERIFIED_COORDINATES_NOT_AVAILABLE',
  );
  withoutCoordinates.results[0].unknown_dimensions = [
    'location.coordinates', ...withoutCoordinates.results[0].unknown_dimensions,
  ];
  const request = normalizeCustomerWorldRequest({
    journey: 'SEARCH', market: 'US-MD', query: 'Bethesda', view: 'map',
  });
  const view = buildCustomerWorldView({ request, projection: withoutCoordinates });
  assert.equal(view.results.length, 1);
  assert.equal(view.map.markers.length, 0);
  assert.equal(view.map.unmappable_count, 1);
  assert.equal(view.map.state, 'UNKNOWN');
});

test('delivery capability gaps render no merchant as delivery-capable', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'DELIVERY', market: 'US-MD', query: 'Bethesda',
  });
  const deliveryProjection = projection({
    results: [],
    capability_gaps: [{ state: 'CAPABILITY_GAP', dimension: 'fulfillment', opportunity_signal: true }],
    truth: {
      ...projection().truth,
      verified_candidate_count: 0,
      zero_verified_result: true,
      zero_result_reason: 'UNSUPPORTED_VERIFIED_DIMENSION',
    },
  });
  const view = buildCustomerWorldView({ request, projection: deliveryProjection });
  assert.equal(view.state, 'CAPABILITY_GAP');
  assert.deepEqual(view.unsupported_dimensions, ['fulfillment']);
  assert.equal(view.results.length, 0);
  assert.equal(view.delivery_eligibility.state, 'CAPABILITY_GAP');
});

test('input-required and empty states do not turn absence into market truth', () => {
  const inputRequest = normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-DC' });
  const inputView = buildCustomerWorldView({
    request: inputRequest,
    projection: projection({
      intent: {
        ir_version: 1, compiler: 'deterministic',
        dimensions: { location: { status: 'UNKNOWN', value: null } },
        unknown_dimensions: ['location'],
      },
      results: [],
      truth: {
        ...projection().truth, verified_candidate_count: 0, zero_verified_result: true,
        zero_result_reason: 'REQUIRED_INTENT_DIMENSION_UNKNOWN',
      },
    }),
  });
  assert.equal(inputView.state, 'INPUT_REQUIRED');

  const emptyView = buildCustomerWorldView({
    request: normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-MD', query: 'Bethesda' }),
    projection: projection({
      results: [],
      truth: {
        ...projection().truth, verified_candidate_count: 0, zero_verified_result: true,
        zero_result_reason: 'NO_VERIFIED_CURRENT_MATCH',
      },
    }),
  });
  assert.equal(emptyView.state, 'EMPTY');
  assert.match(emptyView.state_explanation, /not proof/i);
});

test('customer cards expose only projection facts and explicit unknown fields', () => {
  const request = normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-MD', query: 'Bethesda' });
  const view = buildCustomerWorldView({ request, projection: projection() });
  const card = view.results[0];
  assert.equal(card.name.value, 'Bethesda Wellness');
  assert.equal(card.open_now.state, 'UNKNOWN');
  assert.equal(card.price.state, 'UNKNOWN');
  assert.equal(card.inventory.state, 'UNKNOWN');
  assert.equal(card.eta.state, 'UNKNOWN');
  assert.equal(card.service_area.state, 'UNKNOWN');
  assert.equal(card.popularity.state, 'UNKNOWN');
});

test('resolver reads canonical Reality and never falls back to Retailer', async () => {
  let marketClaimReads = 0;
  let retailerReads = 0;
  const prisma = {
    brand: { findUnique: async () => ({ name: 'ORDERWEEDDC' }) },
    marketClaim: { findMany: async () => { marketClaimReads += 1; return []; } },
    marketVerificationEvent: { findMany: async () => [] },
    marketSourceAcquisitionEvent: { findMany: async () => [] },
    marketSourceContentArtifact: { findMany: async () => [] },
    marketSourceSnapshot: { findMany: async () => [] },
    marketEvidenceRevocationEvent: { findMany: async () => [] },
    retailer: { findMany: async () => { retailerReads += 1; return []; } },
  };
  const world = await resolveCustomerWorld(prisma, {
    journey: 'DISPENSARIES', market: 'US-MD', query: 'Bethesda',
    tenantDomain: 'orderweeddc.localhost', now: NOW,
  });
  assert.equal(world.state, 'EMPTY');
  assert.equal(marketClaimReads, 1);
  assert.equal(retailerReads, 0);
});
