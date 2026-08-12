/**
 * ASK ORDERWEEDDC — candidate `where` falsification (pure).
 *
 * The query gate is the truth boundary: these tests prove the ask surface
 * cannot drift from the UI's publication gate, and that location matching is
 * explicitly case-insensitive (the documented SQLite->PostgreSQL silent-
 * failure class: "dupont" must match "Dupont Circle").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { answerIntent, buildCandidateWhere } from '../src/lib/ask/ask-service.mjs';
import * as askService from '../src/lib/ask/ask-service.mjs';
import { askPersistenceScope } from '../src/lib/ask/ask-work.mjs';
import { compileIntent } from '../src/lib/ask/intent-ir.mjs';
import {
  checkPublicSubmissionThrottle,
  PUBLIC_SUBMISSION_POLICY,
  PUBLIC_SUBMISSION_SURFACES,
} from '../src/lib/public-submission.mjs';

const NOW = new Date('2026-08-09T12:00:00Z');
const BRAND = 'brand-1';

test('ASK persistence scope is tenant-controlled, never a caller-supplied proxy identity', () => {
  assert.equal(askPersistenceScope('orderweeddc.com'), 'tenant:orderweeddc.com');
  for (const untrusted of [
    '',
    'ORDERWEEDDC.COM',
    'orderweeddc.com, 203.0.113.4',
    '../tenant',
    '.orderweeddc.com',
    'orderweeddc.com.',
    'orderweeddc..com',
    '-orderweeddc.com',
    'orderweeddc-.com',
  ]) {
    assert.throws(() => askPersistenceScope(untrusted), /canonical tenant domain/);
  }
});

test('ASK tenant budgets cannot exhaust one another through the shared public surface quota', async () => {
  const db = {
    publicSubmissionEvent: {
      async count({ where }) {
        return where.clientDigest
          ? PUBLIC_SUBMISSION_POLICY.clientLimit - 1
          : PUBLIC_SUBMISSION_POLICY.surfaceLimit + 1;
      },
    },
  };
  const decision = await checkPublicSubmissionThrottle(db, {
    clientIdentity: askPersistenceScope('orderweeddc.com'),
    surface: PUBLIC_SUBMISSION_SURFACES.ASK,
    now: NOW,
  });
  assert.equal(decision.clientCount, PUBLIC_SUBMISSION_POLICY.clientLimit - 1);
  assert.equal(decision.surfaceCount, PUBLIC_SUBMISSION_POLICY.surfaceLimit + 1);
  assert.equal(decision.allowed, true);
});

test('the evidence gate travels with every ask query, verbatim', () => {
  const where = buildCandidateWhere(compileIntent('anything', { now: NOW }), { brandId: BRAND, now: NOW });
  assert.equal(where.isDemonstration, false);
  assert.equal(where.dataStatus, 'VERIFIED_CURRENT');
  assert.deepEqual(where.verifiedAt, { not: null, lte: NOW });
  assert.ok(where.freshnessExpiresAt.gt instanceof Date);
  assert.deepEqual(where.menus, { some: { brandMenus: { some: { brandId: BRAND } } } });
});

test('a KNOWN location becomes an EXPLICITLY case-insensitive contains match', () => {
  const where = buildCandidateWhere(compileIntent('flower in dupont', { now: NOW }), { brandId: BRAND, now: NOW });
  assert.ok(Array.isArray(where.OR));
  for (const clause of where.OR) {
    const field = Object.values(clause)[0];
    assert.equal(field.mode, 'insensitive', 'never rely on collation defaults');
    assert.equal(field.contains, 'dupont circle');
  }
});

test('an UNKNOWN location adds NO location filter — the compiler never guessed one', () => {
  const where = buildCandidateWhere(compileIntent('weed near me', { now: NOW }), { brandId: BRAND, now: NOW });
  assert.equal(where.OR, undefined);
});

test('known unsupported decision dimensions produce an honest CAPABILITY_GAP, not fabricated matches', async () => {
  let reads = 0;
  const prisma = { retailer: { findMany: async () => { reads += 1; return []; } } };
  const intent = compileIntent('delivery flower under $30 in dupont open now', { now: NOW });
  const answer = await answerIntent(prisma, {
    intent, brandId: BRAND, tenantDomain: 'orderweeddc.com', now: NOW,
  });
  assert.equal(reads, 0, 'an ineligible query must not be disguised as a market-store result');
  assert.deepEqual(answer.candidates, []);
  assert.equal(answer.zero_result_reason, 'UNSUPPORTED_VERIFIED_DIMENSION');
  assert.deepEqual(answer.unsupported_known_dimensions, ['category', 'price_max_usd', 'fulfillment', 'open_now']);
  assert.equal(answer.opportunitySpec.kind, 'CAPABILITY_GAP');
});

test('unknown location yields an honest zero without inventing nearby supply or market work', async () => {
  let reads = 0;
  const prisma = { retailer: { findMany: async () => { reads += 1; return []; } } };
  const intent = compileIntent('weed near me', { now: NOW });
  const answer = await answerIntent(prisma, {
    intent, brandId: BRAND, tenantDomain: 'orderweeddc.com', now: NOW,
  });
  assert.equal(reads, 0);
  assert.deepEqual(answer.candidates, []);
  assert.equal(answer.zero_result_reason, 'REQUIRED_INTENT_DIMENSION_UNKNOWN');
  assert.equal(answer.opportunitySpec, null, 'missing customer context is not fabricated into a market gap');
});

test('ASK returns only a subject-complete current Answerability Frontier', async () => {
  const prisma = {
    retailer: {
      async findMany() {
        return [{
          id: 'retailer-1',
          name: 'Evidence Retailer',
          type: 'MEDICAL',
          address: '100 Truth Ave NW',
          city: 'Dupont Circle',
          state: 'DC',
          zip: '20036',
          lat: 38.91,
          lng: -77.04,
          phone: null,
          website: null,
          hours: null,
          hoursSource: null,
          licenseStatus: 'ACTIVE',
          dataStatus: 'VERIFIED_CURRENT',
          dataSource: 'DC_ABCA',
          sourceUrl: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31',
          retrievedAt: new Date('2026-08-09T00:00:00.000Z'),
          verifiedAt: new Date('2026-08-09T00:00:00.000Z'),
          freshnessExpiresAt: new Date('2026-09-09T00:00:00.000Z'),
          confidence: 1,
          isDemonstration: false,
        }];
      },
    },
  };
  const answer = await answerIntent(prisma, {
    intent: compileIntent('dispensary in dupont', { now: NOW }),
    brandId: BRAND,
    tenantDomain: 'orderweeddc.com',
    now: NOW,
  });
  assert.equal(answer.verified_candidate_count, 1);
  assert.equal(answer.answerability_frontier.answerable, true);
  assert.equal(answer.answerability_frontier.answerable_subject_ref, 'retailer-1');
  assert.deepEqual(answer.answerability_frontier.blocking_predicates, []);
  assert.equal(answer.opportunitySpec, null);
});

function verifiedCandidate({ marketId, state, latitude = null, longitude = null } = {}) {
  const source = askService.resolveCustomerMarketContext(marketId).evidence;
  return {
    id: `retailer-${marketId}`,
    name: `${marketId} Evidence Retailer`,
    type: 'storefront',
    location: {
      address: '100 Truth Ave',
      city: state === 'DC' ? 'Washington' : state === 'MD' ? 'Baltimore' : 'Richmond',
      state,
      postal_code: state === 'DC' ? '20001' : state === 'MD' ? '21201' : '23219',
      latitude,
      longitude,
    },
    contact: { phone: null, website: null },
    hours: { text: null, source: null },
    regulatory: { license_status: 'ACTIVE' },
    provenance: {
      data_status: 'VERIFIED_CURRENT',
      source: source.source_id,
      source_key: source.source_key,
      source_url: source.source_url,
      retrieved_at: '2026-08-08T00:00:00.000Z',
      verified_at: '2026-08-08T00:00:00.000Z',
      freshness_expires_at: '2026-09-10T00:00:00.000Z',
      confidence: 1,
      is_demonstration: false,
    },
  };
}

function verifiedAnswer(candidate, unsupportedKnownDimensions = []) {
  return {
    candidates: candidate ? [candidate] : [],
    verified_candidate_count: candidate ? 1 : 0,
    zero_verified_result: !candidate,
    zero_result_reason: candidate ? null : 'UNSUPPORTED_VERIFIED_DIMENSION',
    unsupported_known_dimensions: unsupportedKnownDimensions,
    answerability_frontier: {
      schema_version: 'cana-answerability-frontier/v1',
      frontier_key: 'sha256:frontier',
      evidence_digest: 'sha256:evidence',
      answerable: Boolean(candidate),
      blocking_predicates: [],
      unknown_predicates: [],
      missing_evidence: [],
    },
    opportunitySpec: unsupportedKnownDimensions.length > 0
      ? {
          kind: 'CAPABILITY_GAP',
          signal: 'MINIMIZED_INTENT_IR',
          requiredAuthority: 'PROPOSE_ONLY',
        }
      : null,
  };
}

function verifiedRealityDecisions(marketId, subjectRef, facts, overrides = {}) {
  const source = askService.resolveCustomerMarketContext(marketId).evidence;
  return facts.map(([predicate, value], index) => ({
    claim_id: `${subjectRef}:${index}`,
    tenant: 'orderweeddc.com',
    subject_ref: subjectRef,
    predicate,
    value,
    market_id: marketId,
    contract_digest: source.contract_digest,
    source_id: source.source_key,
    source_url: source.source_url,
    retrieved_at: '2026-08-08T00:00:00.000Z',
    observed_at: '2026-08-08T00:00:00.000Z',
    verified_at: '2026-08-08T00:00:00.000Z',
    freshness_expires_at: '2026-09-10T00:00:00.000Z',
    verification: 'VERIFIED',
    decision_eligible: true,
    ...overrides,
  }));
}

test('customer discovery projection exports the bounded canonical seam', () => {
  assert.equal(typeof askService.resolveCustomerMarketContext, 'function');
  assert.equal(typeof askService.projectCustomerDiscovery, 'function');
  assert.equal(typeof askService.answerCustomerDiscovery, 'function');
  assert.equal(typeof askService.answerCustomerDiscoveryFromReality, 'function');
});

test('customer market context admits exactly DC, Maryland and Virginia', () => {
  assert.deepEqual(
    ['US-DC', 'US-MD', 'US-VA'].map((marketId) => (
      askService.resolveCustomerMarketContext(marketId).market_id
    )).sort(),
    ['US-DC', 'US-MD', 'US-VA'],
  );
  assert.throws(
    () => askService.resolveCustomerMarketContext('US-PA'),
    /CANA_CUSTOMER_DISCOVERY_MARKET_UNSUPPORTED/,
  );
});

test('canonical D.C. claim decisions project only a complete active public cohort', () => {
  const facts = [
    ['facility_name', 'Dupont Circle Wellness'],
    ['license_number', 'ABRA-1'],
    ['license_status', 'ACTIVE'],
    ['operating_status', 'ACTIVE'],
    ['regulated_address', '100 Truth Ave NW, Washington, DC 20001'],
  ];
  const active = askService.answerCustomerDiscoveryFromReality({
    rawQuery: 'dispensary in dupont',
    marketId: 'US-DC',
    tenantDomain: 'orderweeddc.com',
    claimDecisions: verifiedRealityDecisions('US-DC', 'dc:dupont', facts),
    now: NOW,
  });
  assert.equal(active.results.length, 1);
  assert.equal(active.results[0].regulatory_state.value, 'ACTIVE');
  assert.equal(active.truth.answerability_frontier.answerable, true);

  const inactive = askService.answerCustomerDiscoveryFromReality({
    rawQuery: 'dispensary in dupont',
    marketId: 'US-DC',
    tenantDomain: 'orderweeddc.com',
    claimDecisions: verifiedRealityDecisions('US-DC', 'dc:dupont', facts.map(([predicate, value]) => (
      [predicate, predicate === 'operating_status' ? 'INACTIVE' : value]
    ))),
    now: NOW,
  });
  assert.equal(inactive.results.length, 0);
  assert.equal(inactive.opportunity_signal.state, 'PROPOSE_ONLY');

  const partial = askService.answerCustomerDiscoveryFromReality({
    rawQuery: 'dispensary in dupont',
    marketId: 'US-DC',
    tenantDomain: 'orderweeddc.com',
    claimDecisions: verifiedRealityDecisions('US-DC', 'dc:dupont', facts.slice(0, -1)),
    now: NOW,
  });
  assert.equal(partial.results.length, 0);
  assert.ok(partial.truth.answerability_frontier.blocking_predicates.includes('regulated_address'));
});

test('customer projection preserves one verified identity and market-specific unknowns across three markets', () => {
  const intent = compileIntent('dispensary in dupont', { now: NOW });
  const markets = [
    { marketId: 'US-DC', state: 'DC', latitude: 38.91, longitude: -77.04 },
    { marketId: 'US-MD', state: 'MD' },
    { marketId: 'US-VA', state: 'VA' },
  ];

  for (const input of markets) {
    const candidate = verifiedCandidate(input);
    const projection = askService.projectCustomerDiscovery({
      intent,
      market: askService.resolveCustomerMarketContext(input.marketId),
      answer: verifiedAnswer(candidate),
      asOf: NOW,
    });

    assert.equal(projection.schema_version, 'cana-customer-discovery-projection/v1');
    assert.equal(projection.market.market_id, input.marketId);
    assert.equal(projection.results[0].merchant_id, candidate.id);
    assert.equal(projection.results[0].market.value, input.marketId);
    assert.equal(projection.results[0].customer_facing_name.value, candidate.name);
    assert.equal(projection.results[0].regulatory_state.value, 'ACTIVE');
    assert.equal(projection.results[0].verification_state.value, 'VERIFIED_CURRENT');
    assert.equal(projection.results[0].location.coordinates.state, input.latitude ? 'KNOWN' : 'UNKNOWN');
    for (const field of ['distance', 'fulfillment_type', 'delivery_authority', 'delivery_eligibility', 'price', 'category', 'open_now', 'deal']) {
      assert.equal(projection.results[0][field].state, 'UNKNOWN');
      assert.ok(projection.results[0].unknown_dimensions.includes(field));
    }
  }
});

test('unsupported known intent dimensions survive as capability gaps and proposal-only opportunity', () => {
  const intent = compileIntent('delivery flower under $30 in dupont open now', { now: NOW });
  const unsupported = ['category', 'price_max_usd', 'fulfillment', 'open_now'];
  const projection = askService.projectCustomerDiscovery({
    intent,
    market: askService.resolveCustomerMarketContext('US-DC'),
    answer: verifiedAnswer(null, unsupported),
    asOf: NOW,
  });

  assert.deepEqual(projection.capability_gaps.map((gap) => gap.dimension), unsupported);
  assert.equal(projection.opportunity_signal.state, 'PROPOSE_ONLY');
  assert.equal(projection.opportunity_signal.verification, 'UNKNOWN');
  assert.deepEqual(projection.intent.unknown_dimensions, []);
  assert.deepEqual(projection.results, []);
});

test('projection fails closed on cross-market, stale or demonstration candidates', () => {
  const intent = compileIntent('dispensary in dupont', { now: NOW });
  const market = askService.resolveCustomerMarketContext('US-DC');
  const maryland = verifiedCandidate({ marketId: 'US-MD', state: 'MD' });
  assert.throws(
    () => askService.projectCustomerDiscovery({ intent, market, answer: verifiedAnswer(maryland), asOf: NOW }),
    /CANA_CUSTOMER_DISCOVERY_MARKET_MISMATCH/,
  );

  const stale = verifiedCandidate({ marketId: 'US-DC', state: 'DC' });
  stale.provenance.freshness_expires_at = '2026-08-01T00:00:00.000Z';
  assert.throws(
    () => askService.projectCustomerDiscovery({ intent, market, answer: verifiedAnswer(stale), asOf: NOW }),
    /CANA_CUSTOMER_DISCOVERY_UNVERIFIED_CANDIDATE/,
  );

  const demonstration = verifiedCandidate({ marketId: 'US-DC', state: 'DC' });
  demonstration.provenance.is_demonstration = true;
  assert.throws(
    () => askService.projectCustomerDiscovery({ intent, market, answer: verifiedAnswer(demonstration), asOf: NOW }),
    /CANA_CUSTOMER_DISCOVERY_UNVERIFIED_CANDIDATE/,
  );

  const foreignSource = verifiedCandidate({ marketId: 'US-DC', state: 'DC' });
  foreignSource.provenance.source = 'attacker-controlled-source';
  assert.throws(
    () => askService.projectCustomerDiscovery({ intent, market, answer: verifiedAnswer(foreignSource), asOf: NOW }),
    /CANA_CUSTOMER_DISCOVERY_MARKET_PROVENANCE_MISMATCH/,
  );
});

test('customer discovery orchestration compiles real DC, Maryland and Virginia locations and binds official source scope', async () => {
  const inputs = [
    { marketId: 'US-DC', state: 'DC', query: 'dispensary in dupont', location: 'dupont circle' },
    { marketId: 'US-MD', state: 'MD', query: 'dispensary in bethesda', location: 'bethesda' },
    { marketId: 'US-VA', state: 'VA', query: 'dispensary in richmond', location: 'richmond' },
  ];

  for (const input of inputs) {
    let capturedWhere = null;
    const source = askService.resolveCustomerMarketContext(input.marketId).evidence;
    const prisma = {
      retailer: {
        async findMany({ where }) {
          capturedWhere = where;
          return [{
            id: `retailer-${input.marketId}`, name: 'Evidence Retailer', type: 'storefront',
            address: '100 Truth Ave', city: input.location, state: input.state, zip: '00000',
            lat: null, lng: null, phone: null, website: null, hours: null, hoursSource: null,
            licenseStatus: 'ACTIVE', dataStatus: 'VERIFIED_CURRENT', dataSource: source.source_id,
            sourceUrl: source.source_url, retrievedAt: new Date('2026-08-08T00:00:00.000Z'),
            verifiedAt: new Date('2026-08-08T00:00:00.000Z'), freshnessExpiresAt: new Date('2026-09-10T00:00:00.000Z'),
            confidence: 1, isDemonstration: false,
          }];
        },
      },
    };
    const projection = await askService.answerCustomerDiscovery(prisma, {
      rawQuery: input.query,
      marketId: input.marketId,
      brandId: BRAND,
      tenantDomain: 'orderweeddc.com',
      now: NOW,
    });

    assert.equal(capturedWhere.state, input.state);
    assert.equal(capturedWhere.dataSource, source.source_id);
    assert.equal(capturedWhere.sourceUrl, source.source_url);
    assert.equal(projection.intent.dimensions.location.value, input.location);
    assert.equal(projection.results.length, 1);
    assert.equal(projection.truth.answerability_frontier.answerable, true);
  }
});
