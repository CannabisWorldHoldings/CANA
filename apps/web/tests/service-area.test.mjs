import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ELIGIBILITY,
  evaluateDeliveryEligibility,
  isOpenAt,
  rankDeliveryRelevance,
} from '../src/lib/service-area.mjs';

/**
 * D13 / M-012 — delivery relevance is verified ELIGIBILITY, not radius.
 * The owner's sentence is the first test in this file, verbatim as law.
 */

const NOW = '2026-08-08T19:30:00-04:00'; // Saturday evening ET
const FRESH = '2026-08-08T12:00:00-04:00'; // verified this morning

const merchant = (id, over = {}) => {
  const { delivery: deliveryOver, ...rest } = over;
  return {
    merchant_id: id,
    name: id,
    license: { status: 'VERIFIED_CURRENT', checked_at: FRESH },
    distance_miles: 3,
    delivery: {
      service_area: { neighborhoods: ['Navy Yard', 'Capitol Hill'] },
      hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], // Sat 10:00 → 4am
      minimum_usd: 40,
      fee_usd: 5,
      eta_minutes: [30, 60],
      verified_at: FRESH,
      ...(deliveryOver || {}),
    },
    ...rest,
  };
};

test('OWNER LAW: a business 3 miles away that does not deliver to the customer ranks BELOW a business 8 miles away that does', () => {
  const near = merchant('near-3mi', {
    distance_miles: 3,
    delivery: { service_area: { neighborhoods: ['Georgetown'] }, hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], verified_at: FRESH },
  });
  const far = merchant('far-8mi', { distance_miles: 8 });
  const ranked = rankDeliveryRelevance([near, far], { neighborhood: 'Navy Yard', now: NOW });
  assert.equal(ranked[0].merchant.merchant_id, 'far-8mi');
  assert.equal(ranked[0].verdict.status, ELIGIBILITY.ELIGIBLE_OPEN);
  assert.equal(ranked[1].verdict.status, ELIGIBILITY.OUT_OF_AREA);
});

test('law 1: missing delivery record fails closed to UNVERIFIED with an honest reason', () => {
  const m = merchant('no-record');
  delete m.delivery;
  const v = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW });
  assert.equal(v.status, ELIGIBILITY.UNVERIFIED);
  assert.ok(v.reasons.some((r) => /fail closed/.test(r)));
});

test('law 1: stale verification fails closed — freshness is a hard gate', () => {
  const m = merchant('stale', { delivery: { verified_at: '2026-08-05T12:00:00-04:00' } });
  const v = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW });
  assert.equal(v.status, ELIGIBILITY.UNVERIFIED);
  assert.ok(v.reasons.some((r) => /stale/.test(r)));
});

test('law 2: unlicensed merchant is never eligible, whatever its service data says', () => {
  const m = merchant('unlicensed', { license: { status: 'PENDING', checked_at: FRESH } });
  const v = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW });
  assert.equal(v.status, ELIGIBILITY.UNVERIFIED);
  assert.ok(v.reasons.some((r) => /license/.test(r)));
});

test('law 3: open-state resolves against the clock; spill-past-midnight hours honored', () => {
  // Saturday window 10:00 → 28:00 (4am Sunday). 1:30am Sunday = still open.
  const hours = [{ day: 6, open_minutes: 600, close_minutes: 1680 }];
  assert.equal(isOpenAt(hours, '2026-08-09T01:30:00-04:00'), true, '1:30am Sunday inside Saturday spill');
  assert.equal(isOpenAt(hours, '2026-08-09T05:00:00-04:00'), false, '5am Sunday after spill close');
  assert.equal(isOpenAt(hours, '2026-08-08T09:00:00-04:00'), false, 'before Saturday open');
});

test('law 3: in-area but closed = ELIGIBLE_CLOSED, never claimed open', () => {
  const m = merchant('closed-now', { delivery: { hours: [{ day: 6, open_minutes: 600, close_minutes: 720 }] } }); // Sat 10:00-12:00
  const v = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW }); // 19:30
  assert.equal(v.status, ELIGIBILITY.ELIGIBLE_CLOSED);
});

test('law 3: unknown hours stay unknown — eligible but never claimed open', () => {
  const m = merchant('no-hours', { delivery: { hours: [] } });
  const v = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW });
  assert.equal(v.status, ELIGIBILITY.ELIGIBLE_CLOSED);
  assert.ok(v.reasons.some((r) => /never claimed open/.test(r)));
});

test('law 4: full class ordering — ELIGIBLE_OPEN > ELIGIBLE_CLOSED > UNVERIFIED > OUT_OF_AREA', () => {
  const open = merchant('a-open', { distance_miles: 9 });
  const closed = merchant('b-closed', { distance_miles: 1, delivery: { hours: [{ day: 6, open_minutes: 600, close_minutes: 720 }] } });
  const unverified = merchant('c-unverified', { distance_miles: 0.5 });
  delete unverified.delivery;
  const outOfArea = merchant('d-out', { distance_miles: 0.2, delivery: { service_area: { neighborhoods: ['Georgetown'] } } });
  const ranked = rankDeliveryRelevance([outOfArea, unverified, closed, open], { neighborhood: 'Navy Yard', now: NOW });
  assert.deepEqual(ranked.map((r) => r.merchant.merchant_id), ['a-open', 'b-closed', 'c-unverified', 'd-out'],
    'distance never jumps a class boundary');
});

test('law 4: distance tiebreaks INSIDE a class only; then fee; then id — total determinism', () => {
  const a = merchant('m2', { distance_miles: 4 });
  const b = merchant('m1', { distance_miles: 4 });
  const c = merchant('m0', { distance_miles: 2 });
  const ranked = rankDeliveryRelevance([a, b, c], { neighborhood: 'Navy Yard', now: NOW });
  assert.deepEqual(ranked.map((r) => r.merchant.merchant_id), ['m0', 'm1', 'm2']);
});

test('law 5: minimum/fee/ETA pass through only when present — absent facts stay absent', () => {
  const m = merchant('facts');
  const v = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW });
  assert.deepEqual(v.facts, { minimum_usd: 40, fee_usd: 5, eta_minutes: [30, 60] });
  const bare = merchant('bare', { delivery: { minimum_usd: undefined, fee_usd: undefined, eta_minutes: undefined } });
  const vb = evaluateDeliveryEligibility(bare, { neighborhood: 'Navy Yard', now: NOW });
  assert.deepEqual(vb.facts, {}, 'nothing invented');
});

test('service-area matching is case/whitespace tolerant but never fuzzy', () => {
  const m = merchant('case');
  const v = evaluateDeliveryEligibility(m, { neighborhood: '  navy yard ', now: NOW });
  assert.equal(v.status, ELIGIBILITY.ELIGIBLE_OPEN);
  const miss = evaluateDeliveryEligibility(m, { neighborhood: 'Navy', now: NOW });
  assert.equal(miss.status, ELIGIBILITY.OUT_OF_AREA, 'partial names never match');
});

test('deterministic: same inputs same verdicts', () => {
  const m = merchant('det');
  const a = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW });
  const b = evaluateDeliveryEligibility(m, { neighborhood: 'Navy Yard', now: NOW });
  assert.deepEqual(a, b);
});
