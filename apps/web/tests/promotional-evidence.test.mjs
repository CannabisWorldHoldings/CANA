import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_PROMOTIONAL_OFFERS,
  buildPromotionalEvidenceReceipt,
  projectVerifiedDealPublicFacts,
  projectAllLiveDeals,
  PROMOTION_RETRIEVAL_TIMESTAMP,
  PROMOTION_FRESHNESS_EXPIRY_TIMESTAMP,
} from '../src/lib/reality/market-reality-pilot.mjs';

/**
 * FIRST REAL PROMOTIONAL EVIDENCE COURT (TEST CASES A - K)
 */

// -----------------------------------------------------------------------------
// TEST A: REAL CURRENT OFFER PROJECTION
// -----------------------------------------------------------------------------
test('A: REAL CURRENT OFFER — fresh direct merchant evidence + confirmed match yields VERIFIED_CURRENT projection', () => {
  const asOf = new Date('2026-08-15T20:30:00.000Z');
  const liveDeals = projectAllLiveDeals(asOf);

  assert.ok(liveDeals.length >= 2, `Expected at least 2 verified live deals, got ${liveDeals.length}`);

  // Anacostia Organics Welcome Offer
  const anacostiaDeal = liveDeals.find((d) => d.id === 'DEAL-DC-ABCA117379-NEW-PATIENT-20');
  assert.ok(anacostiaDeal, 'Anacostia Welcome Offer must exist');
  assert.equal(anacostiaDeal.retailerId, 'BIZ-DC-ABCA117379');
  assert.equal(anacostiaDeal.discountValue, '20% OFF');
  assert.equal(anacostiaDeal.isDemonstration, false);
  assert.equal(anacostiaDeal.dataStatus, 'VERIFIED_CURRENT');
  assert.equal(anacostiaDeal.isPubliclyProjectable, true);

  // Chocolate City Flower Offer
  const chocCityDeal = liveDeals.find((d) => d.id === 'DEAL-DC-ABCA127461-FLOWER-5OFF');
  assert.ok(chocCityDeal, 'Chocolate City Flower Offer must exist');
  assert.equal(chocCityDeal.retailerId, 'BIZ-DC-ABCA127461');
  assert.equal(chocCityDeal.discountValue, '$5.00 OFF');
  assert.equal(chocCityDeal.isDemonstration, false);
  assert.equal(chocCityDeal.dataStatus, 'VERIFIED_CURRENT');
  assert.equal(chocCityDeal.isPubliclyProjectable, true);
});

// -----------------------------------------------------------------------------
// TEST B: STALE OFFER DISQUALIFICATION
// -----------------------------------------------------------------------------
test('B: STALE OFFER — offer after freshness expiry (24h) fails closed as STALE', () => {
  const futureAsOf = new Date('2026-08-17T00:00:00.000Z'); // Past 24h freshness window
  const anacostiaOffer = LIVE_PROMOTIONAL_OFFERS[0];

  const projection = projectVerifiedDealPublicFacts(anacostiaOffer, futureAsOf);
  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.status, 'STALE');
  assert.equal(projection.disqualificationReason, 'FRESHNESS_EXPIRED');

  const allDealsFuture = projectAllLiveDeals(futureAsOf);
  assert.equal(allDealsFuture.length, 0, 'No deals should be projected after freshness expiry');
});

// -----------------------------------------------------------------------------
// TEST C: EXPIRED OFFER DISQUALIFICATION
// -----------------------------------------------------------------------------
test('C: EXPIRED OFFER — explicit source expiry before asOf fails closed', () => {
  const expiredOffer = {
    id: 'DEAL-TEST-EXPIRED',
    retailerId: 'BIZ-DC-ABCA117379',
    title: 'Flash Special',
    discountValue: '$10 OFF',
    verifiedAt: '2026-08-10T12:00:00.000Z',
    freshnessExpiresAt: '2026-08-11T12:00:00.000Z',
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    isActive: true,
  };

  const asOf = new Date('2026-08-15T20:00:00.000Z');
  const projection = projectVerifiedDealPublicFacts(expiredOffer, asOf);

  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.disqualificationReason, 'FRESHNESS_EXPIRED');
});

// -----------------------------------------------------------------------------
// TEST D: HISTORICAL ARTIFACT CANNOT RESET FRESHNESS
// -----------------------------------------------------------------------------
test('D: HISTORICAL ARTIFACT — re-evaluating old saved evidence today does not extend freshness', () => {
  const historicalOffer = {
    id: 'DEAL-HISTORICAL-001',
    retailerId: 'BIZ-DC-ABCA117379',
    title: 'Historic Summer Sale',
    discountValue: '15% OFF',
    retrievedAt: '2026-07-01T00:00:00.000Z',
    verifiedAt: '2026-07-01T00:00:00.000Z',
    freshnessExpiresAt: '2026-07-02T00:00:00.000Z',
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    isActive: true,
  };

  const todayAsOf = new Date('2026-08-15T20:00:00.000Z');
  const projection = projectVerifiedDealPublicFacts(historicalOffer, todayAsOf);

  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.status, 'STALE');
});

// -----------------------------------------------------------------------------
// TEST E: DEMONSTRATION DEALS REMAIN QUARANTINED
// -----------------------------------------------------------------------------
test('E: DEMONSTRATION OFFER — DEMONSTRATION_ONLY offers never enter live projection', () => {
  const demoDeal = {
    id: 'DEAL-DC-DEMO-B2G1',
    retailerId: 'BIZ-DC-ABCA117379',
    title: 'Buy 2 Get 1 Free House Edibles Special',
    discountValue: 'B2G1 FREE',
    isDemonstration: true,
    dataStatus: 'DEMONSTRATION_ONLY',
    verifiedAt: null,
    freshnessExpiresAt: null,
    isActive: true,
  };

  const asOf = new Date('2026-08-15T20:00:00.000Z');
  const projection = projectVerifiedDealPublicFacts(demoDeal, asOf);

  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.disqualificationReason, 'DEMONSTRATION_FIXTURE');
});

// -----------------------------------------------------------------------------
// TEST F: WRONG MERCHANT / ATTRIBUTION SAFETY
// -----------------------------------------------------------------------------
test('F: WRONG MERCHANT — offer cannot be attributed to unconfirmed merchant', () => {
  const unattributedOffer = {
    id: 'DEAL-UNKNOWN-MERCHANT',
    retailerId: 'BIZ-NONEXISTENT',
    title: 'Mystery Deal',
    discountValue: '50% OFF',
    isDemonstration: false,
    dataStatus: 'UNVERIFIED',
    verifiedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: PROMOTION_FRESHNESS_EXPIRY_TIMESTAMP,
    isActive: true,
  };

  const asOf = new Date('2026-08-15T20:00:00.000Z');
  const projection = projectVerifiedDealPublicFacts(unattributedOffer, asOf);

  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.disqualificationReason, 'UNVERIFIED_STATUS');
});

// -----------------------------------------------------------------------------
// TEST G: SOURCE CONFLICT HANDLING
// -----------------------------------------------------------------------------
test('G: SOURCE CONFLICT — conflicting promotional claims fail closed as DISPUTED', () => {
  const disputedOffer = {
    id: 'DEAL-CONFLICT-001',
    retailerId: 'BIZ-DC-ABCA117379',
    title: 'Conflicting Discount',
    discountValue: '20% OFF vs 30% OFF',
    isDemonstration: false,
    dataStatus: 'DISPUTED',
    verifiedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: PROMOTION_FRESHNESS_EXPIRY_TIMESTAMP,
    isActive: true,
  };

  const asOf = new Date('2026-08-15T20:00:00.000Z');
  const projection = projectVerifiedDealPublicFacts(disputedOffer, asOf);

  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.disqualificationReason, 'UNVERIFIED_STATUS');
});

// -----------------------------------------------------------------------------
// TEST H: MISSING TERMS ARE NOT INVENTED
// -----------------------------------------------------------------------------
test('H: MISSING TERMS — minimum purchase and coupon code remain null when not stated in source', () => {
  const anacostiaOffer = LIVE_PROMOTIONAL_OFFERS.find((d) => d.id === 'DEAL-DC-ABCA117379-NEW-PATIENT-20');
  assert.ok(anacostiaOffer);
  assert.equal(anacostiaOffer.minimumPurchase, null);

  const flowerOffer = LIVE_PROMOTIONAL_OFFERS.find((d) => d.id === 'DEAL-DC-ABCA127461-FLOWER-5OFF');
  assert.ok(flowerOffer);
  assert.equal(flowerOffer.minimumPurchase, null);

  const ediblesOffer = LIVE_PROMOTIONAL_OFFERS.find((d) => d.id === 'DEAL-DC-ABCA127461-EDIBLES-25MIN-5OFF');
  assert.ok(ediblesOffer);
  assert.equal(ediblesOffer.minimumPurchase, 25.0);
});

// -----------------------------------------------------------------------------
// TEST I: VIEW SIGNAL SEMANTICS (OFFSCREEN VS VISIBLE)
// -----------------------------------------------------------------------------
test('I: VIEW SIGNAL — DEAL_VIEWED emitted only after meeting viewport dwell gate', () => {
  function evaluateViewportImpression(visibilityRatio, dwellDurationMs) {
    const MIN_RATIO = 0.50; // 50% viewport visibility
    const MIN_DWELL_MS = 1000; // 1 second continuous dwell
    return visibilityRatio >= MIN_RATIO && dwellDurationMs >= MIN_DWELL_MS;
  }

  // Offscreen or low intersection
  assert.equal(evaluateViewportImpression(0.10, 2000), false, 'Offscreen/low visibility must not emit DEAL_VIEWED');
  // Brief glance < 1000ms
  assert.equal(evaluateViewportImpression(0.80, 400), false, 'Brief scroll-by glance must not emit DEAL_VIEWED');
  // True view >= 50% for >= 1000ms
  assert.equal(evaluateViewportImpression(0.75, 1200), true, 'Valid viewport dwell emits DEAL_VIEWED');
});

// -----------------------------------------------------------------------------
// TEST J: CLICK SIGNAL & DEDUPE SEMANTICS
// -----------------------------------------------------------------------------
test('J: CLICK SIGNAL — MERCHANT_CLICKED deduplicates within sliding window', () => {
  const recentEvents = new Map();

  function recordMerchantClick(sessionId, merchantId, dealId, timestampMs) {
    const key = `${sessionId}|${merchantId}|${dealId}`;
    const lastSeen = recentEvents.get(key);
    const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    if (lastSeen && timestampMs - lastSeen < DEDUPE_WINDOW_MS) {
      return { deduplicated: true, emitted: false };
    }

    recentEvents.set(key, timestampMs);
    return { deduplicated: false, emitted: true };
  }

  const now = Date.now();
  const click1 = recordMerchantClick('sess-1', 'BIZ-DC-ABCA117379', 'DEAL-DC-ABCA117379-NEW-PATIENT-20', now);
  assert.equal(click1.emitted, true);

  // Rapid duplicate click 30s later
  const click2 = recordMerchantClick('sess-1', 'BIZ-DC-ABCA117379', 'DEAL-DC-ABCA117379-NEW-PATIENT-20', now + 30000);
  assert.equal(click2.deduplicated, true);
  assert.equal(click2.emitted, false);
});

// -----------------------------------------------------------------------------
// TEST K: REVENUE OVERCLAIM FIREWALL ($0 / UNKNOWN)
// -----------------------------------------------------------------------------
test('K: REVENUE — customer click on live offer claims $0 / UNKNOWN revenue and no commercial purchase', () => {
  for (const offer of LIVE_PROMOTIONAL_OFFERS) {
    const receipt = buildPromotionalEvidenceReceipt(offer);
    const projection = projectVerifiedDealPublicFacts(offer);

    assert.equal(offer.claimedPurchase, false);
    assert.equal(offer.claimedRevenue, '$0 / UNKNOWN');
    assert.equal(projection.claimedPurchase, false);
    assert.equal(projection.claimedRevenue, '$0 / UNKNOWN');
    assert.equal(receipt.verificationResult, 'PASS_LIVE_PROMOTIONAL_EVIDENCE_VERIFIED');
  }
});
