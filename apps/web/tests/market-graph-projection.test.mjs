import assert from 'node:assert/strict';
import test from 'node:test';

import { projectGraphToRecords } from '../src/lib/market-graph-projection.mjs';
import { DATA_STATUS } from '../src/lib/data-status.mjs';

/**
 * D12 boundary — ONE entity graph (D8 genome) → projection records. This is
 * the T2 (projection-side) subset of the forge's 13-test junction file: the
 * six tests that pipe records through compileMarketPage travel with T3,
 * which brings the compiler. Nothing is dropped — the split is declared in
 * both PR bodies and T3 restores the full junction end-to-end.
 *
 * Vocabulary: the host's DATA_STATUS.VERIFIED_CURRENT is the ONE crossing
 * status (adopted in this branch; forge-era 'VERIFIED' does not cross).
 */

const NOW = '2026-08-08T19:30:00-04:00';
const FRESH = '2026-08-08T15:00:00-04:00';
const env = (status = DATA_STATUS.VERIFIED_CURRENT) => ({ verified: { status, checked_at: FRESH } });
const LIC = { number: 'R-2023-DC-0031', authority: 'DC ABCA', source_url: 'https://abca.dc.gov/licenses/R-2023-DC-0031' };

const graph = () => [
  { class: 'merchant', id: 'anchor', name: 'Anchor Dispensary', kind: 'STOREFRONT', neighborhood: 'Shaw', license: LIC, ...env() },
  { class: 'merchant', id: 'green-line', name: 'Green Line', kind: 'DELIVERY_OPERATOR', distance_miles: 8, license: { ...LIC, number: 'C-2024-DC-0142' }, ...env() },
  { class: 'merchant', id: 'near-noserve', name: 'Near But Elsewhere', kind: 'DELIVERY_OPERATOR', distance_miles: 3, license: { ...LIC, number: 'C-2024-DC-0999' }, ...env() },
  { class: 'merchant', id: 'ghost-shop', name: 'Unverified Shop', kind: 'STOREFRONT' }, // no envelope — god-eye only
  { class: 'merchant', id: 'web-only', name: 'Web Only Seller', kind: 'INTERNET_RETAILER', license: LIC, ...env() },
  { class: 'service_area', id: 'sa-green', merchant_ref: 'green-line', neighborhoods: ['Navy Yard'], hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], minimum_usd: 45, fee_usd: 0, eta_minutes: [35, 55], ...env() },
  { class: 'service_area', id: 'sa-noserve', merchant_ref: 'near-noserve', neighborhoods: ['Georgetown'], hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], ...env() },
  { class: 'category', id: 'cat-flower', label: 'Flower' },
  { class: 'deal', id: 'd1', merchant_ref: 'anchor', category_ref: 'cat-flower', title: 'Tonight only', price_usd: 35, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-08T23:00:00-04:00' }, ...env() },
  { class: 'deal', id: 'd-ghost', merchant_ref: 'ghost-shop', title: 'Ghost deal', price_usd: 10, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-09T23:00:00-04:00' }, ...env() },
  { class: 'faq_answer', id: 'q1', question: 'Is it legal?', answer: 'Under I-71…', source_ref: 'dc-law-register#i71' },
  { class: 'sponsored_media_unit', id: 'ad1', placement_class: 'MARKET_HERO', advertiser: 'anchor', creative: { asset_hash: 'abc' }, window: { start: FRESH, end: '2026-08-10T00:00:00-04:00' }, sponsored: true, court_passed: true },
  { class: 'brand', id: 'b1', name: 'Some Brand' }, // not consumed by the market page
];

test('law 1 boundary: unverified merchant never crosses; counted, not silent', () => {
  const { records, projection } = projectGraphToRecords(graph(), { now: NOW });
  assert.ok(!records.merchants.some((m) => m.merchant_id === 'ghost-shop'));
  assert.ok(projection.excluded_unverified.some((x) => x.id === 'ghost-shop'));
});

test('law 1 vocabulary: only the HOST status crosses — a forge-era VERIFIED envelope is excluded', () => {
  const g = graph().map((e) => (e.id === 'anchor' ? { ...e, verified: { status: 'VERIFIED', checked_at: FRESH } } : e));
  const { records, projection } = projectGraphToRecords(g, { now: NOW });
  assert.ok(!records.merchants.some((m) => m.merchant_id === 'anchor'), 'lookalike status must not cross');
  assert.ok(projection.excluded_unverified.some((x) => x.id === 'anchor'), 'and the exclusion is counted');
});

test('law 2: structural violations throw BEFORE any record is produced (dangling ref)', () => {
  const bad = graph();
  bad.push({ class: 'deal', id: 'd-dangling', merchant_ref: 'nobody', title: 'x', validity: { start: FRESH, end: '2026-08-09T00:00:00-04:00' }, ...env() });
  assert.throws(() => projectGraphToRecords(bad, { now: NOW }), /dangling/);
});

test('law 2: sponsorship on an organic entity throws at the genome gate', () => {
  const bad = graph();
  bad.find((e) => e.id === 'd1').sponsored = true;
  assert.throws(() => projectGraphToRecords(bad, { now: NOW }), /only sponsored_media_unit/);
});

test('law 3: INTERNET_RETAILER is honestly unprojected with a reason — never faked, never silent', () => {
  const { records, projection } = projectGraphToRecords(graph(), { now: NOW });
  assert.ok(!records.merchants.some((m) => m.merchant_id === 'web-only'));
  const row = projection.unprojected.find((x) => x.id === 'web-only');
  assert.equal(row.kind, 'INTERNET_RETAILER');
  assert.match(row.reason, /never faked/);
});

test('law 4: the auditable license datum rides the projection (MM-008, compiler render lands with T3)', () => {
  const { records } = projectGraphToRecords(graph(), { now: NOW });
  const anchor = records.merchants.find((m) => m.merchant_id === 'anchor');
  assert.equal(anchor.license.number, 'R-2023-DC-0031');
  assert.equal(anchor.license.authority, 'DC ABCA');
  assert.equal(anchor.license.status, DATA_STATUS.VERIFIED_CURRENT);
  assert.equal(anchor.license.checked_at, FRESH);
});

test('unverified service_area never crosses: merchant projects WITHOUT delivery; exclusion counted', () => {
  const g = graph().map((e) => (e.id === 'sa-green' ? { ...e, verified: { status: DATA_STATUS.AWAITING_VERIFICATION, checked_at: FRESH } } : e));
  const { records, projection } = projectGraphToRecords(g, { now: NOW });
  const gl = records.merchants.find((m) => m.merchant_id === 'green-line');
  assert.equal(gl.delivery, undefined, 'no verified service area → no delivery record');
  assert.ok(projection.excluded_unverified.some((x) => x.id === 'sa-green'));
});

test('verified service_area joins its merchant with the full delivery record', () => {
  const { records } = projectGraphToRecords(graph(), { now: NOW });
  const gl = records.merchants.find((m) => m.merchant_id === 'green-line');
  assert.deepEqual(gl.delivery.service_area, { neighborhoods: ['Navy Yard'] });
  assert.equal(gl.delivery.verified_at, FRESH);
  assert.equal(gl.delivery.minimum_usd, 45);
  assert.equal(gl.delivery.fee_usd, 0);
  assert.deepEqual(gl.delivery.eta_minutes, [35, 55]);
});

test('category_ref resolves to the category label on the projected deal', () => {
  const { records } = projectGraphToRecords(graph(), { now: NOW });
  assert.equal(records.deals.find((d) => d.id === 'd1').category, 'flower');
});

test('cited law travels: faq_answer → questions with source_ref intact', () => {
  const { records } = projectGraphToRecords(graph(), { now: NOW });
  assert.deepEqual(records.questions, [{ id: 'q1', question: 'Is it legal?', answer: 'Under I-71…', source_ref: 'dc-law-register#i71' }]);
});

test('sponsored media unit projects ONLY into placements (quarantine holds through the boundary)', () => {
  const { records } = projectGraphToRecords(graph(), { now: NOW });
  assert.equal(records.placements.length, 1);
  assert.equal(records.placements[0].id, 'ad1');
  assert.equal(records.placements[0].sponsored, true);
  assert.ok(!records.merchants.some((m) => m.merchant_id === 'ad1'));
  assert.ok(!records.deals.some((d) => d.id === 'ad1'));
});

test('non-market classes are reserved for other surfaces, not dropped silently', () => {
  const { projection } = projectGraphToRecords(graph(), { now: NOW });
  assert.ok(projection.reserved_for_other_surfaces.some((x) => x.id === 'b1' && x.class === 'brand'));
});

test('deterministic: same graph + clock → identical projection', () => {
  const a = projectGraphToRecords(graph(), { now: NOW });
  const b = projectGraphToRecords(graph(), { now: NOW });
  assert.deepEqual(a, b);
});
