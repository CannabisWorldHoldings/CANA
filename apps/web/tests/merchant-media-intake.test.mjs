import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewMediaUpload, composeDeal, ASSET_CLASSES } from '../src/lib/merchant-media-intake.mjs';

/**
 * Business-side contracts. The owner's CLEAN_CREATIVE_LAW is the centerpiece:
 * "they didn't allow nobody to write their deals on the image of the product —
 * the deals have to be in the writing of the description." Enforced by name.
 */

const NOW = '2026-08-09T03:20:00-04:00';
const rights = { holder: 'Potomac Provisions LLC', granted_at: '2026-08-09T00:00:00-04:00', scope: 'marketplace display' };
const upload = (over = {}) => ({
  asset_id: 'a1', merchant_id: 'potomac-provisions', asset_class: 'PRODUCT_IMAGE',
  sha256: 'ab12cd34ef56ab12', width: 1200, height: 1200, rights_attestation: rights,
  image_text_court: { verdict: 'CLEAN', evidence: 'ocr:none', decided_at: NOW },
  ...over,
});

test('OWNER CLEAN_CREATIVE_LAW: baked deal text on a product image is REJECTED by name, with guidance to the structured fields', () => {
  const r = reviewMediaUpload(upload({ image_text_court: { verdict: 'BAKED_DEAL_TEXT', evidence: 'ocr:"WEEKEND DEALS $340"', decided_at: NOW } }), { now: NOW });
  assert.equal(r.state, 'REJECTED');
  assert.ok(r.reasons.some((x) => x.startsWith('BAKED_DEAL_TEXT')));
  assert.match(r.guidance, /structured fields|deal composer/);
});

test('clean creative APPROVES and closes the merchant media gap for its class', () => {
  const r = reviewMediaUpload(upload(), { now: NOW });
  assert.equal(r.state, 'APPROVED');
  assert.equal(r.closes_media_gap, 'PRODUCT_IMAGE');
});

test('no court verdict yet → PENDING_REVIEW, never guessed at the pixels', () => {
  const r = reviewMediaUpload(upload({ image_text_court: undefined }), { now: NOW });
  assert.equal(r.state, 'PENDING_REVIEW');
  assert.ok(r.reasons[0].includes('never guessed'));
});

test('non-offer text (e.g. label on packaging) is not the same as baked deal text — court verdict TEXT_PRESENT_NON_OFFER approves', () => {
  const r = reviewMediaUpload(upload({ image_text_court: { verdict: 'TEXT_PRESENT_NON_OFFER', evidence: 'ocr:brand label only', decided_at: NOW } }), { now: NOW });
  assert.equal(r.state, 'APPROVED');
});

test('media intake rejects low-res, missing rights, unknown class — each by name', () => {
  assert.ok(reviewMediaUpload(upload({ width: 300, height: 300 }), { now: NOW }).reasons[0].startsWith('BELOW_MINIMUM_DIMENSIONS'));
  assert.ok(reviewMediaUpload(upload({ rights_attestation: undefined }), { now: NOW }).reasons.includes('MISSING_RIGHTS_ATTESTATION'));
  assert.ok(reviewMediaUpload(upload({ asset_class: 'MEME' }), { now: NOW }).reasons[0].startsWith('UNKNOWN_ASSET_CLASS'));
  assert.equal(ASSET_CLASSES.length, 6);
});

test('deal composer: offer language lives in terms_text; a clean approved own-merchant creative may attach', () => {
  const assets = [{ ...upload(), state: 'APPROVED' }];
  const r = composeDeal({
    merchant_id: 'potomac-provisions', title: 'Last call: 1/8 top-shelf', category: 'flower',
    price_usd: 35, validity: { start: '2026-08-09T00:00:00-04:00', end: '2026-08-09T21:00:00-04:00' },
    terms_text: 'One per customer. In-store and delivery. Ends 9 PM.',
    creative_asset: 'a1', floor_price_usd: 30,
  }, assets, { now: NOW });
  assert.equal(r.status, 'SUBMITTED_FOR_COURTS');
  assert.equal(r.deal.terms_text.includes('Ends 9 PM.'), true);
  assert.ok(r.notes.some((n) => /pricing lane respected/.test(n)));
  assert.ok(r.next.some((n) => /urgency-ranked/.test(n)));
});

test('deal composer REFUSES creative that carries baked deal text — even if someone approved it upstream', () => {
  const assets = [{ ...upload({ image_text_court: { verdict: 'BAKED_DEAL_TEXT', evidence: 'ocr:$340', decided_at: NOW } }), state: 'APPROVED' }];
  const r = composeDeal({
    merchant_id: 'potomac-provisions', title: 'x', category: 'flower', price_usd: 35,
    validity: { start: '2026-08-09T00:00:00-04:00', end: '2026-08-09T21:00:00-04:00' },
    terms_text: 'terms', creative_asset: 'a1',
  }, assets, { now: NOW });
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.reasons.includes('BAKED_DEAL_TEXT'));
});

test('deal composer refuses another merchant\'s creative and unapproved creative by name', () => {
  const assets = [{ ...upload(), state: 'APPROVED', merchant_id: 'someone-else' }, { ...upload({ asset_id: 'a2' }), state: 'PENDING_REVIEW' }];
  const r1 = composeDeal({ merchant_id: 'potomac-provisions', title: 'x', category: 'flower', price_usd: 10, validity: { start: NOW, end: '2026-08-09T21:00:00-04:00' }, terms_text: 't', creative_asset: 'a1' }, assets, { now: NOW });
  assert.ok(r1.reasons.includes('CREATIVE_NOT_OWNED_BY_MERCHANT'));
  const r2 = composeDeal({ merchant_id: 'potomac-provisions', title: 'x', category: 'flower', price_usd: 10, validity: { start: NOW, end: '2026-08-09T21:00:00-04:00' }, terms_text: 't', creative_asset: 'a2' }, assets, { now: NOW });
  assert.ok(r2.reasons.includes('CREATIVE_NOT_APPROVED:PENDING_REVIEW'));
});

test('PRICING COORDINATION: a deal below the merchant pricing-lane floor is refused as PRICING_LANE_VIOLATION, never silently published', () => {
  const r = composeDeal({
    merchant_id: 'potomac-provisions', title: 'Too deep', category: 'flower', price_usd: 20,
    validity: { start: '2026-08-09T00:00:00-04:00', end: '2026-08-09T21:00:00-04:00' },
    terms_text: 't', floor_price_usd: 30,
  }, [], { now: NOW });
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.reasons.some((x) => x.startsWith('PRICING_LANE_VIOLATION')));
});

test('no floor supplied → lane check honestly skipped and noted (DO NOT INVENT a floor)', () => {
  const r = composeDeal({
    merchant_id: 'potomac-provisions', title: 'x', category: 'flower', price_usd: 35,
    validity: { start: '2026-08-09T00:00:00-04:00', end: '2026-08-09T21:00:00-04:00' }, terms_text: 't',
  }, [], { now: NOW });
  assert.equal(r.status, 'SUBMITTED_FOR_COURTS');
  assert.ok(r.notes.some((n) => /lane check skipped/.test(n)));
});

test('DUTCHIE-PRECEDENT GUARDRAIL: below-cost deal refused even when the lane floor is absent', () => {
  const r = composeDeal({
    merchant_id: 'm', title: 'Loss leader', category: 'flower', price_usd: 18,
    validity: { start: '2026-08-09T00:00:00-04:00', end: '2026-08-09T21:00:00-04:00' },
    terms_text: 't', cost_basis_usd: 22,
  }, [], { now: NOW });
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.reasons.some((x) => /below cost basis/.test(x)));
});

test('research-grade floors: campaign creative below 1920x1080 rejected; product image 1024 floor holds', () => {
  const camp = reviewMediaUpload(upload({ asset_class: 'CAMPAIGN_CREATIVE', width: 1280, height: 720 }), { now: NOW });
  assert.ok(camp.reasons[0].startsWith('BELOW_MINIMUM_DIMENSIONS'));
  const prod = reviewMediaUpload(upload({ width: 1000, height: 1000 }), { now: NOW });
  assert.ok(prod.reasons[0].startsWith('BELOW_MINIMUM_DIMENSIONS'));
});

test('nothing auto-publishes: composer output is a courts submission with explicit next steps; deterministic', () => {
  const draft = { merchant_id: 'm', title: 'x', category: 'flower', price_usd: 35, validity: { start: '2026-08-09T00:00:00-04:00', end: '2026-08-09T21:00:00-04:00' }, terms_text: 't' };
  const a = composeDeal(draft, [], { now: NOW });
  const b = composeDeal(draft, [], { now: NOW });
  assert.deepEqual(a, b);
  assert.equal(a.status, 'SUBMITTED_FOR_COURTS');
  assert.ok(a.next.length >= 2);
});
