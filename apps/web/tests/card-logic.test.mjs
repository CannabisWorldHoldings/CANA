import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dealTemporalState,
  gateProductPrice,
  neighborhoodCountsLine,
  railDisplayPlan,
  selectMerchantFactChip,
} from '../src/lib/card-logic.mjs';

const HOUR = 3_600_000;

test('merchant card carries exactly one fact chip with truth-first priority', () => {
  assert.deepEqual(
    selectMerchantFactChip({ evidenceState: 'VERIFIED_CURRENT', activeDealTitle: '20% off', distanceLabel: '0.4 mi' }),
    { kind: 'evidence', value: 'VERIFIED_CURRENT' },
  );
  assert.deepEqual(
    selectMerchantFactChip({ activeDealTitle: '20% off', distanceLabel: '0.4 mi' }),
    { kind: 'deal', value: '20% off' },
  );
  assert.deepEqual(
    selectMerchantFactChip({ distanceLabel: '0.4 mi' }),
    { kind: 'distance', value: '0.4 mi' },
  );
});

test('merchant card renders no chip rather than a fabricated one', () => {
  assert.equal(selectMerchantFactChip({}), null);
  assert.equal(selectMerchantFactChip({ evidenceState: '   ', activeDealTitle: '' }), null);
  assert.equal(selectMerchantFactChip(), null);
});

test('product price renders only when sourced, verified and fresh', () => {
  const now = Date.parse('2026-08-14T00:00:00Z');
  const fresh = new Date(now + 24 * HOUR).toISOString();
  assert.deepEqual(
    gateProductPrice({ priceCents: 4000, sourceVerified: true, freshnessExpiresAt: fresh, now }),
    { show: true, label: '$40' },
  );
  assert.deepEqual(
    gateProductPrice({ priceCents: 4550, sourceVerified: true, freshnessExpiresAt: fresh, now }),
    { show: true, label: '$45.50' },
  );
});

test('product price refuses every unlawful condition', () => {
  const now = Date.parse('2026-08-14T00:00:00Z');
  const fresh = new Date(now + HOUR).toISOString();
  const stale = new Date(now - HOUR).toISOString();
  assert.equal(gateProductPrice({ sourceVerified: true, freshnessExpiresAt: fresh, now }).show, false);
  assert.equal(gateProductPrice({ priceCents: 0, sourceVerified: true, freshnessExpiresAt: fresh, now }).show, false);
  assert.equal(gateProductPrice({ priceCents: 4000, sourceVerified: false, freshnessExpiresAt: fresh, now }).reason, 'SOURCE_UNVERIFIED');
  assert.equal(gateProductPrice({ priceCents: 4000, sourceVerified: true, freshnessExpiresAt: stale, now }).reason, 'FRESHNESS_EXPIRED');
  assert.equal(gateProductPrice({ priceCents: 4000, sourceVerified: true, now }).reason, 'FRESHNESS_EXPIRED');
});

test('deal temporal state never lies about time', () => {
  const now = Date.parse('2026-08-14T00:00:00Z');
  assert.deepEqual(dealTemporalState({ isActive: false, now }), { state: 'INACTIVE' });
  assert.deepEqual(
    dealTemporalState({ isActive: true, expiresAt: new Date(now - 1).toISOString(), now }),
    { state: 'EXPIRED' },
  );
  const soon = dealTemporalState({ isActive: true, expiresAt: new Date(now + 5 * HOUR).toISOString(), now });
  assert.equal(soon.state, 'EXPIRING_SOON');
  assert.equal(soon.hoursLeft >= 0, true);
  const active = dealTemporalState({ isActive: true, expiresAt: new Date(now + 96 * HOUR).toISOString(), now });
  assert.equal(active.state, 'ACTIVE');
  assert.deepEqual(dealTemporalState({ isActive: true, now }), { state: 'ACTIVE', hoursLeft: null });
});

test('neighborhood counts stay honest at zero and never inflate', () => {
  assert.equal(neighborhoodCountsLine({ verifiedCount: 0 }), 'Verification in progress');
  assert.equal(neighborhoodCountsLine({}), 'Verification in progress');
  assert.equal(neighborhoodCountsLine({ verifiedCount: -3 }), 'Verification in progress');
  assert.equal(neighborhoodCountsLine({ verifiedCount: 1 }), '1 verified option');
  assert.equal(neighborhoodCountsLine({ verifiedCount: 12 }), '12 verified options');
});

test('rails refuse to render below their minimum instead of padding with filler', () => {
  assert.deepEqual(railDisplayPlan({ itemCount: 6, minItems: 4 }), { render: true, reason: 'AT_OR_ABOVE_MINIMUM' });
  assert.deepEqual(railDisplayPlan({ itemCount: 4, minItems: 4 }), { render: true, reason: 'AT_OR_ABOVE_MINIMUM' });
  assert.deepEqual(railDisplayPlan({ itemCount: 3, minItems: 4 }), { render: false, reason: 'BELOW_MINIMUM' });
  assert.deepEqual(railDisplayPlan({ itemCount: 0, minItems: 4 }), { render: false, reason: 'EMPTY' });
  assert.deepEqual(railDisplayPlan({}), { render: false, reason: 'EMPTY' });
});
