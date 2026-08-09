import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITY_CLASSES, MERCHANT_KINDS, normalizeMerchantKind,
  validateEntity, validateEntityGraph,
} from '../src/lib/entity-genome.mjs';

/**
 * D8 entity genome — the canonical market graph the customer projections
 * (market-page-compiler, discovery-command) read from. SL-001 lesson baked in:
 * the class set is explicit and extensible; a new class is data, not surgery.
 */

const FRESH = '2026-08-08T15:00:00-04:00';
const env = (status = 'VERIFIED_CURRENT') => ({ verified: { status, checked_at: FRESH } });
const merchant = (id, over = {}) => ({ class: 'merchant', id, name: id, kind: 'STOREFRONT', ...env(), ...over });

test('genome covers every D8 class the owner spec enumerated', () => {
  for (const c of ['merchant', 'doctor_provider', 'brand', 'product', 'category', 'strain_cultivar',
    'deal', 'campaign', 'menu', 'amenity', 'neighborhood', 'service_area', 'guide', 'article',
    'faq_answer', 'sponsored_media_unit']) {
    assert.ok(ENTITY_CLASSES.has(c), c);
  }
});

test('law 3: unknown class throws — we never fabricate structure', () => {
  assert.throws(() => validateEntity({ class: 'unicorn', id: 'x' }), /unknown class/);
});

test('law 3: missing required field throws, never defaulted', () => {
  assert.throws(() => validateEntity({ class: 'merchant', id: 'm', kind: 'STOREFRONT' }), /missing required field "name"/);
});

test('merchant kinds: canonical set + rail aliases normalize (DISPENSARY→STOREFRONT, DELIVERY→DELIVERY_OPERATOR)', () => {
  assert.ok(MERCHANT_KINDS.has('DELIVERY_OPERATOR'));
  assert.equal(normalizeMerchantKind('DISPENSARY'), 'STOREFRONT');
  assert.equal(normalizeMerchantKind('DELIVERY'), 'DELIVERY_OPERATOR');
  assert.equal(normalizeMerchantKind('HYBRID'), 'HYBRID');
  assert.equal(normalizeMerchantKind('spaceship'), null);
  assert.doesNotThrow(() => validateEntity(merchant('m1', { kind: 'DELIVERY' })), 'compiler alias is valid at the boundary');
  assert.throws(() => validateEntity(merchant('m2', { kind: 'spaceship' })), /not in the genome/);
});

test('law 1: envelope-required classes are marked verified only with a VERIFIED envelope', () => {
  assert.equal(validateEntity(merchant('m')).verified, true);
  const noEnv = validateEntity({ class: 'merchant', id: 'm', name: 'm', kind: 'STOREFRONT' });
  assert.equal(noEnv.verified, false);
  assert.ok(noEnv.reasons.some((r) => /god-eye/.test(r)), 'unverified exists for owner, excluded downstream');
  const pending = validateEntity(merchant('m', env('PENDING')));
  assert.equal(pending.verified, false);
});

test('law 1: non-envelope classes (brand/category/article) need no envelope and are verified', () => {
  assert.equal(validateEntity({ class: 'brand', id: 'b', name: 'B' }).verified, true);
  assert.equal(validateEntity({ class: 'category', id: 'c', label: 'Flower' }).verified, true);
});

test('law 2: only sponsored_media_unit may carry sponsorship; anything else throws', () => {
  assert.throws(() => validateEntity(merchant('m', { sponsored: true })), /only sponsored_media_unit/);
  assert.throws(() => validateEntity({ class: 'category', id: 'c', label: 'x', boost: 3 }), /only sponsored_media_unit/);
});

test('law 2: sponsored_media_unit must be sponsored + court_passed + windowed', () => {
  const good = { class: 'sponsored_media_unit', id: 's1', placement_class: 'MARKET_HERO', creative: { asset_hash: 'a' }, window: { start: FRESH, end: '2026-08-10T00:00:00-04:00' }, sponsored: true, court_passed: true };
  assert.equal(validateEntity(good).valid, true);
  assert.throws(() => validateEntity({ ...good, court_passed: false }), /court_passed/);
  assert.throws(() => validateEntity({ ...good, window: null }), /missing required field "window"/); // required-field gate fires first
  assert.throws(() => validateEntity({ ...good, window: { start: FRESH } }), /requires a window/); // present but incomplete → law-2 gate
});

test('law 4: identity is a deterministic content digest', () => {
  const a = validateEntity(merchant('m'));
  const b = validateEntity(merchant('m'));
  assert.equal(a.digest, b.digest);
  assert.match(a.digest, /^[a-f0-9]{64}$/);
  assert.notEqual(a.digest, validateEntity(merchant('other')).digest);
});

test('faq_answer must cite a source_ref — never hallucinate law', () => {
  assert.throws(() => validateEntity({ class: 'faq_answer', id: 'q', question: 'legal?', answer: 'yes' }), /missing required field "source_ref"/);
  assert.equal(validateEntity({ class: 'faq_answer', id: 'q', question: 'legal?', answer: 'yes', source_ref: 'dc-law#i71' }).valid, true);
});

test('law 5: a deal resolves to a real merchant + typed campaign/product refs', () => {
  const graph = [
    merchant('anchor', { kind: 'DISPENSARY' }),
    { class: 'campaign', id: 'camp1', merchant_ref: 'anchor', objective: 'lift' },
    { class: 'category', id: 'flower', label: 'Flower' },
    { class: 'deal', id: 'd1', merchant_ref: 'anchor', campaign_ref: 'camp1', category_ref: 'flower', title: 'Tonight', validity: { start: FRESH, end: '2026-08-09T00:00:00-04:00' }, ...env() },
  ];
  const res = validateEntityGraph(graph);
  assert.equal(res.byClass.deal, 1);
  // projection-eligible = has a VERIFIED envelope OR needs none: merchant+deal (enveloped) + campaign+category (no envelope required) = 4
  assert.equal(res.verifiedCount, 4);
  assert.equal(res.unverifiedCount, 0);
});

test('law 5: a dangling deal→merchant reference throws', () => {
  const graph = [{ class: 'deal', id: 'd1', merchant_ref: 'ghost', title: 't', validity: { start: FRESH, end: '2026-08-09T00:00:00-04:00' }, ...env() }];
  assert.throws(() => validateEntityGraph(graph), /dangling/);
});

test('law 5: a mistyped reference (deal→category as merchant) throws', () => {
  const graph = [
    { class: 'category', id: 'flower', label: 'Flower' },
    { class: 'deal', id: 'd1', merchant_ref: 'flower', title: 't', validity: { start: FRESH, end: '2026-08-09T00:00:00-04:00' }, ...env() },
  ];
  assert.throws(() => validateEntityGraph(graph), /expected merchant/);
});

test('graph: duplicate ids are rejected', () => {
  assert.throws(() => validateEntityGraph([merchant('m'), merchant('m')]), /duplicate id/);
});

test('graph: verified vs unverified counts feed the owner god-eye', () => {
  const graph = [
    merchant('ok'),
    { class: 'merchant', id: 'nolic', name: 'No License', kind: 'DELIVERY' }, // no envelope
    { class: 'service_area', id: 'sa1', merchant_ref: 'ok', neighborhoods: ['Navy Yard'], ...env() },
  ];
  const res = validateEntityGraph(graph);
  assert.equal(res.verifiedCount, 2);
  assert.equal(res.unverifiedCount, 1);
  assert.deepEqual(res.byClass, { merchant: 2, service_area: 1 });
});

test('T2 vocabulary adoption: ONLY the HOST status VERIFIED_CURRENT crosses — forge-era and non-current statuses are all unverified', () => {
  for (const status of ['VERIFIED', 'AWAITING_VERIFICATION', 'STALE', 'DISPUTED', 'DEMONSTRATION_ONLY', 'PENDING']) {
    const r = validateEntity(merchant('m-' + status.toLowerCase(), env(status)));
    assert.equal(r.verified, false, status + ' must not cross to customer projections');
    assert.match(r.reasons.join(' '), /VERIFIED_CURRENT/, 'refusal names the one true status');
  }
  const ok = validateEntity(merchant('m-current'));
  assert.equal(ok.verified, true, 'VERIFIED_CURRENT crosses');
});
