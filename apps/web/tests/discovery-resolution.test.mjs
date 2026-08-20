import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDiscovery } from '../src/lib/discovery-resolution.mjs';

/**
 * D15/D12 second junction — language → intent → graph → verified-eligible set.
 * The owner's D15 sentence is the law under test: resolve intent/price/
 * fulfillment/time/product-context/merchant-eligibility ONLY where data
 * supports it; unverifiable → DO NOT INVENT.
 */

const NOW = '2026-08-08T19:30:00-04:00'; // Saturday evening
const FRESH = '2026-08-08T15:00:00-04:00';
const env = (status = 'VERIFIED_CURRENT') => ({ verified: { status, checked_at: FRESH } });
const LIC = (n) => ({ number: n, authority: 'DC ABCA', source_url: 'https://abca.dc.gov/licenses/' + n });

const graph = () => [
  // serves Navy Yard, open Saturday until 4am
  { class: 'merchant', id: 'servez', name: 'Servez', kind: 'DELIVERY_OPERATOR', distance_miles: 8, license: LIC('C-1'), ...env() },
  { class: 'service_area', id: 'sa-servez', merchant_ref: 'servez', neighborhoods: ['Navy Yard'], hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], minimum_usd: 40, fee_usd: 0, eta_minutes: [30, 50], ...env() },
  // serves Georgetown only — definite cannot-serve for Navy Yard
  { class: 'merchant', id: 'gtown-only', name: 'Georgetown Only', kind: 'DELIVERY_OPERATOR', distance_miles: 3, license: LIC('C-2'), ...env() },
  { class: 'service_area', id: 'sa-gtown', merchant_ref: 'gtown-only', neighborhoods: ['Georgetown'], hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], ...env() },
  // serves Navy Yard but CLOSED Saturday evening (10:00-12:00 window)
  { class: 'merchant', id: 'closed-now', name: 'Closed Now', kind: 'DELIVERY_OPERATOR', distance_miles: 5, license: LIC('C-3'), ...env() },
  { class: 'service_area', id: 'sa-closed', merchant_ref: 'closed-now', neighborhoods: ['Navy Yard'], hours: [{ day: 6, open_minutes: 600, close_minutes: 720 }], ...env() },
  // delivery operator with NO verified service area — must fail closed, not guess
  { class: 'merchant', id: 'unknown-area', name: 'Unknown Area', kind: 'DELIVERY_OPERATOR', distance_miles: 1, license: LIC('C-4'), ...env() },
  // storefront (not delivery)
  { class: 'merchant', id: 'shopfront', name: 'Shopfront', kind: 'STOREFRONT', neighborhood: 'Navy Yard', license: LIC('R-1'), ...env() },
  // unverified merchant — god-eye only
  { class: 'merchant', id: 'ghost', name: 'Ghost', kind: 'DELIVERY_OPERATOR' },
  // deals
  { class: 'category', id: 'cat-flower', label: 'Flower' },
  { class: 'deal', id: 'deal-flower-cheap', merchant_ref: 'servez', category_ref: 'cat-flower', title: 'Eighth tonight', price_usd: 35, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-08T23:00:00-04:00' }, ...env() },
  { class: 'deal', id: 'deal-flower-pricey', merchant_ref: 'servez', category_ref: 'cat-flower', title: 'Top shelf oz', price_usd: 220, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-09T23:00:00-04:00' }, ...env() },
  { class: 'deal', id: 'deal-edible', merchant_ref: 'servez', title: 'Gummies', category: 'edibles', price_usd: 30, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-09T23:00:00-04:00' }, ...env() },
];

test('OWNER D15 e2e: "flower delivered near Navy Yard tonight" → only the verified-eligible open server, with its facts', () => {
  const r = resolveDiscovery('flower delivered near Navy Yard tonight', graph(), { now: NOW });
  assert.equal(r.command.category, 'flower');
  assert.equal(r.command.business_type, 'delivery');
  assert.deepEqual(r.merchants.map((m) => m.merchant_id), ['servez', 'unknown-area'],
    'Georgetown-only EXCLUDED (definite cannot-serve); closed-now EXCLUDED (tonight); unknown-area kept but ranked below (fail closed, surfaced)');
  assert.equal(r.merchants[0].eligibility, 'ELIGIBLE_OPEN');
  assert.deepEqual(r.merchants[0].facts, { minimum_usd: 40, fee_usd: 0, eta_minutes: [30, 50] });
  assert.equal(r.merchants[1].eligibility, 'UNVERIFIED');
  assert.ok(r.merchants[1].reasons.some((x) => /fail closed/.test(x)));
});

test('law 2: the 3-mile Georgetown-only operator never appears for a Navy Yard delivery intent', () => {
  const r = resolveDiscovery('delivery near Navy Yard', graph(), { now: NOW });
  assert.ok(!r.merchants.some((m) => m.merchant_id === 'gtown-only'));
});

test('unverified merchants never surface (genome law 1 through the whole pipeline)', () => {
  const r = resolveDiscovery('delivery near Navy Yard', graph(), { now: NOW });
  assert.ok(!r.merchants.some((m) => m.merchant_id === 'ghost'));
  assert.equal(r.provenance.graph_excluded_unverified, 1);
});

test('deals resolve on verified facts: category + price cap + validity', () => {
  const r = resolveDiscovery('flower delivered near Navy Yard under $50', graph(), { now: NOW });
  assert.deepEqual(r.deals.map((d) => d.id), ['deal-flower-cheap'], 'pricey flower and edibles filtered by verified fields');
});

test('law 1: free-text effect-intent is surfaced as unresolved, never used to narrow', () => {
  const withText = resolveDiscovery('something relaxing delivered near Navy Yard', graph(), { now: NOW });
  const without = resolveDiscovery('delivered near Navy Yard', graph(), { now: NOW });
  assert.ok(withText.unresolved.some((u) => /relaxing.*never guessed/.test(u)));
  assert.deepEqual(withText.merchants.map((m) => m.merchant_id), without.merchants.map((m) => m.merchant_id),
    'unverifiable words change NOTHING about the result set');
});

test('law 1: storefront open-state without verified hours is unresolved, not guessed', () => {
  const r = resolveDiscovery('dispensaries near me', graph(), { now: NOW });
  const shop = r.merchants.find((m) => m.merchant_id === 'shopfront');
  assert.ok(shop, 'storefront surfaces for dispensary intent');
  assert.equal(shop.eligibility, 'MARKET_WIDE');
  assert.ok(shop.reasons.some((x) => /open-state unresolved, not guessed/.test(x)));
});

test('time intent removes only KNOWN-closed; unknown-hours merchants stay with the unknown surfaced', () => {
  const r = resolveDiscovery('delivery near Navy Yard tonight', graph(), { now: NOW });
  assert.ok(!r.merchants.some((m) => m.merchant_id === 'closed-now'), 'verified-closed excluded for tonight');
  assert.ok(r.merchants.some((m) => m.merchant_id === 'unknown-area'), 'unknown hours NOT silently dropped');
  assert.ok(r.unresolved.some((u) => /unknown hours remain listed/.test(u)));
});

test('law 3: the resolution carries the compiled command — intent persists to the next surface', () => {
  const r = resolveDiscovery('edibles around Dupont under $50', graph(), { now: NOW });
  assert.equal(r.command.location.name, 'Dupont Circle');
  assert.equal(r.command.price_cap, 50);
  assert.ok(Array.isArray(r.command.chips) && r.command.chips.every((c) => c.editable === true));
});

test('MM-008 datum rides through resolution: surfaced merchants carry the auditable license', () => {
  const r = resolveDiscovery('flower delivered near Navy Yard tonight', graph(), { now: NOW });
  assert.equal(r.merchants[0].verified.license.number, 'C-1');
  assert.equal(r.merchants[0].verified.license.authority, 'DC ABCA');
});

test('rank basis is stated and payment-free; deterministic end to end', () => {
  const a = resolveDiscovery('flower delivered near Navy Yard tonight', graph(), { now: NOW });
  const b = resolveDiscovery('flower delivered near Navy Yard tonight', graph(), { now: NOW });
  assert.deepEqual(a, b);
  assert.match(a.provenance.rank_basis, /never applause, never payment/);
});
