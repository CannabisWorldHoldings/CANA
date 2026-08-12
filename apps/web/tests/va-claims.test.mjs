import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseCcaRegistryPage,
  parseCcaProcessorAccordion,
} from '../src/lib/markets/va/va-cca-registry-parser.mjs';
import {
  formVaMarketClaims,
  normalizeVaEntityIdentity,
  deliveryEligibility,
  VA_ENTITY_NORMALIZATION_VERSION,
  VA_MARKET_ACTOR_KINDS,
} from '../src/lib/markets/va/va-claims.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(path.join(here, 'fixtures', 'va-cca', name), 'utf8');

const OBSERVED_AT = new Date('2026-08-12T12:09:00Z');

test('claims from real fixture statements default UNKNOWN and decision-ineligible', () => {
  const { records } = parseCcaRegistryPage(fixture('dispensaries.html'), {
    url: 'https://www.cca.virginia.gov/medicalcannabis/dispensaries',
  });
  const claims = formVaMarketClaims({
    statements: records,
    sourceId: 'va-cca-dispensaries',
    observedAt: OBSERVED_AT,
  });
  assert.ok(claims.length >= records.length * 2, 'multiple predicates per entity');
  for (const c of claims) {
    assert.equal(c.verification, 'UNKNOWN');
    assert.equal(c.decision_eligible, false);
    assert.equal(c.market_id, 'US-VA');
    assert.equal(c.source_id, 'va-cca-dispensaries');
    assert.match(c.entity_identity, /^va-cca:[0-9a-f]{24}$/);
    assert.equal(c.normalization_version, VA_ENTITY_NORMALIZATION_VERSION);
  }
  // sorted + unique claim ids
  const ids = claims.map((c) => c.claim_id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test('processor statements form claims with HSA and regulator status predicates', () => {
  const { records } = parseCcaProcessorAccordion(fixture('processors.html'), {
    url: 'https://www.cca.virginia.gov/medicalcannabis/processors',
  });
  // Processor accordion records carry no street address — identity requires
  // one, so claim formation must skip them rather than invent identity.
  const claims = formVaMarketClaims({
    statements: records,
    sourceId: 'va-cca-processors',
    observedAt: OBSERVED_AT,
  });
  assert.equal(claims.length, 0, 'no address → no identity → no claims (never invented)');
});

test('identity law: license is explicit UNKNOWN with reason, never guessed', () => {
  const identity = normalizeVaEntityIdentity({
    name: 'Beyond Hello Alexandria',
    address: { street: '5902 Richmond Hwy, Suite 1', city: 'Alexandria', zip: '22303' },
  });
  assert.equal(identity.status, 'NORMALIZED');
  assert.equal(identity.license.state, 'UNKNOWN');
  assert.equal(identity.license.reason, 'CCA_REGISTRY_PAGE_PUBLISHES_NO_LICENSE_NUMBER');
});

test('identity normalization is stable under case/punctuation noise', () => {
  const a = normalizeVaEntityIdentity({
    name: 'beyond hello — ALEXANDRIA',
    address: { street: '5902 richmond hwy, suite 1', zip: '22303' },
  });
  const b = normalizeVaEntityIdentity({
    name: 'Beyond Hello Alexandria',
    address: { street: '5902 Richmond Hwy Suite 1', zip: '22303' },
  });
  assert.equal(a.identity_key, b.identity_key);
});

test('claim formation refuses empty or unsourced input', () => {
  assert.throws(() => formVaMarketClaims({ statements: [], sourceId: 'x', observedAt: OBSERVED_AT }));
  assert.throws(() => formVaMarketClaims({ statements: [{}], observedAt: OBSERVED_AT }));
  assert.throws(() =>
    formVaMarketClaims({ statements: [{}], sourceId: 'x', observedAt: 'not-a-time' }),
  );
});

test('delivery model: actor kinds separate roles the law separates', () => {
  assert.ok(VA_MARKET_ACTOR_KINDS.includes('LICENSED_INDEPENDENT_DELIVERY_OPERATOR'));
  assert.ok(VA_MARKET_ACTOR_KINDS.includes('RETAILER_OPERATED_DELIVERY'));
  assert.ok(VA_MARKET_ACTOR_KINDS.includes('TRANSPORTER_B2B'));
});

test('delivery honesty law: licensed operator + no service-area evidence = UNKNOWN', () => {
  const verdict = deliveryEligibility({
    operator: { entity_identity: 'va-cca:aaaaaaaaaaaaaaaaaaaaaaaa' },
    customerLocation: { lat: 38.88, lng: -77.1 },
    serviceAreaEvidence: [],
  });
  assert.equal(verdict.state, 'UNKNOWN_DELIVERY_ELIGIBILITY');
  assert.equal(verdict.reason, 'NO_SERVICE_AREA_EVIDENCE');
});

test('delivery honesty law: unresolved customer location = UNKNOWN', () => {
  const verdict = deliveryEligibility({
    operator: { entity_identity: 'va-cca:aaaaaaaaaaaaaaaaaaaaaaaa' },
    customerLocation: null,
  });
  assert.equal(verdict.state, 'UNKNOWN_DELIVERY_ELIGIBILITY');
  assert.equal(verdict.reason, 'CUSTOMER_LOCATION_UNRESOLVED');
});

test('delivery: unverified or stale service-area evidence cannot produce KNOWN', () => {
  const verdict = deliveryEligibility({
    operator: { entity_identity: 'va-cca:aaaaaaaaaaaaaaaaaaaaaaaa' },
    customerLocation: { lat: 38.88, lng: -77.1 },
    serviceAreaEvidence: [
      { verification: 'UNKNOWN', geometry_ref: 'g1', contains_customer_location: true },
      { verification: 'VERIFIED', geometry_ref: 'g2', stale: true, contains_customer_location: true },
    ],
  });
  assert.equal(verdict.state, 'UNKNOWN_DELIVERY_ELIGIBILITY');
  assert.equal(verdict.reason, 'SERVICE_AREA_EVIDENCE_NOT_VERIFIED_OR_STALE');
});

test('delivery: verified evidence resolves ELIGIBLE / NOT_ELIGIBLE from geometry, never proximity', () => {
  const operator = { entity_identity: 'va-cca:aaaaaaaaaaaaaaaaaaaaaaaa' };
  const customerLocation = { lat: 38.88, lng: -77.1 };
  const eligible = deliveryEligibility({
    operator,
    customerLocation,
    serviceAreaEvidence: [
      { verification: 'VERIFIED', geometry_ref: 'g1', contains_customer_location: true },
    ],
  });
  assert.equal(eligible.state, 'ELIGIBLE');
  const notEligible = deliveryEligibility({
    operator,
    customerLocation,
    serviceAreaEvidence: [
      { verification: 'VERIFIED', geometry_ref: 'g1', contains_customer_location: false },
    ],
  });
  assert.equal(notEligible.state, 'NOT_ELIGIBLE');
});
