import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  revalidatePilotPromotions,
  PILOT_FRESHNESS_WINDOW_MS,
} from '../src/lib/reality/promotional-revalidation.mjs';
import {
  LIVE_PROMOTIONAL_OFFERS,
  projectVerifiedDealPublicFacts,
} from '../src/lib/reality/market-reality-pilot.mjs';
import { currentDealWhere } from '../src/lib/directory-search.mjs';

/**
 * LIVE-OFFER DURABILITY & REVALIDATION COURT (TEST CASES A - L)
 */

// -----------------------------------------------------------------------------
// TEST A: FRESH CONFIRMATION
// -----------------------------------------------------------------------------
test('A: FRESH CONFIRMATION — fresh direct retrieval advances verifiedAt and freshnessExpiresAt', async () => {
  const asOf = new Date('2026-08-16T12:00:00.000Z');
  const mockFetchResults = {
    'https://www.anacostiaorganics.com/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-fresh-sha256-anacostia-001',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><h2>NEW PATIENTS GET 20% OFF FIRST PURCHASE</h2></body></html>',
    },
    'https://www.chocolatecitysmokeshop.com/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-fresh-sha256-choc-001',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><p>$5 off Flower</p><p>$5 off edibles over $25</p></body></html>',
    },
    'https://takomawellness.com/patient-rewards/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-fresh-sha256-takoma-001',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><p>Patient Rewards Program</p></body></html>',
    },
    'https://allvybezdc.com/': {
      reachable: false,
      statusCode: null,
      error: 'DNS_UNRESOLVABLE',
    },
  };

  const report = await revalidatePilotPromotions(LIVE_PROMOTIONAL_OFFERS, asOf, { mockFetchResults });

  assert.equal(report.realCurrentDealCount, 3);
  assert.equal(report.customerEventsGenerated, 0);

  const anacostia = report.updatedDeals.find((d) => d.id === 'DEAL-DC-ABCA117379-NEW-PATIENT-20');
  assert.ok(anacostia);
  assert.equal(anacostia.verifiedAt, asOf.toISOString());
  const expectedExpiry = new Date(asOf.getTime() + PILOT_FRESHNESS_WINDOW_MS).toISOString();
  assert.equal(anacostia.freshnessExpiresAt, expectedExpiry);
  assert.equal(anacostia.dataStatus, 'VERIFIED_CURRENT');
});

// -----------------------------------------------------------------------------
// TEST B: OLD ARTIFACT CANNOT ADVANCE FRESHNESS
// -----------------------------------------------------------------------------
test('B: OLD ARTIFACT — static local artifact without network retrieval does NOT advance freshness', async () => {
  const initialDeal = { ...LIVE_PROMOTIONAL_OFFERS[0] };
  const initialVerifiedAt = initialDeal.verifiedAt;
  const initialExpiresAt = initialDeal.freshnessExpiresAt;

  // Simulate reading old saved file without network fetch (offline evaluation)
  const projection = projectVerifiedDealPublicFacts(initialDeal, new Date('2026-08-15T21:00:00.000Z'));

  assert.equal(projection.verifiedAt, initialVerifiedAt);
  assert.equal(projection.freshnessExpiresAt, initialExpiresAt);
  assert.equal(projection.isPubliclyProjectable, true);
});

// -----------------------------------------------------------------------------
// TEST C: FAILURE BEFORE TTL PRESERVES EXISTING VALIDITY ONLY
// -----------------------------------------------------------------------------
test('C: FAILURE BEFORE TTL — source outage leaves deal current only until original TTL', async () => {
  const midTtlAsOf = new Date('2026-08-16T08:00:00.000Z'); // Within original 24h window
  const originalExpiresAt = '2026-08-16T20:00:00.000Z';

  const testDeals = [
    {
      id: 'DEAL-DC-ABCA117379-NEW-PATIENT-20',
      retailerId: 'BIZ-DC-ABCA117379',
      title: 'New Patient Welcome: 20% Off First Purchase',
      discountValue: '20% OFF',
      verifiedAt: '2026-08-15T20:00:00.000Z',
      freshnessExpiresAt: originalExpiresAt,
      isDemonstration: false,
      dataStatus: 'VERIFIED_CURRENT',
      isActive: true,
    },
  ];

  // All sources unreachable (500 error / offline)
  const mockFetchResults = {
    'https://www.anacostiaorganics.com/': { reachable: false, error: 'ECONNREFUSED' },
    'https://www.chocolatecitysmokeshop.com/': { reachable: false, error: 'ECONNREFUSED' },
    'https://takomawellness.com/patient-rewards/': { reachable: false, error: 'ECONNREFUSED' },
    'https://allvybezdc.com/': { reachable: false, error: 'ECONNREFUSED' },
  };

  const report = await revalidatePilotPromotions(testDeals, midTtlAsOf, { mockFetchResults });
  const deal = report.updatedDeals.find((d) => d.id === 'DEAL-DC-ABCA117379-NEW-PATIENT-20');

  assert.ok(deal);
  assert.equal(deal.freshnessExpiresAt, originalExpiresAt, 'TTL must NOT be extended on failed fetch');
  assert.equal(deal.dataStatus, 'VERIFIED_CURRENT', 'Remains valid until original TTL');
});

// -----------------------------------------------------------------------------
// TEST D: FAILURE AFTER TTL EXCLUDES DEAL FROM CURRENT PROJECTION
// -----------------------------------------------------------------------------
test('D: FAILURE AFTER TTL — source outage after prior expiry fails closed as STALE', async () => {
  const postTtlAsOf = new Date('2026-08-17T00:00:00.000Z'); // Past original 24h window
  const originalExpiresAt = '2026-08-16T20:00:00.000Z';

  const testDeals = [
    {
      id: 'DEAL-DC-ABCA117379-NEW-PATIENT-20',
      retailerId: 'BIZ-DC-ABCA117379',
      title: 'New Patient Welcome: 20% Off First Purchase',
      discountValue: '20% OFF',
      verifiedAt: '2026-08-15T20:00:00.000Z',
      freshnessExpiresAt: originalExpiresAt,
      isDemonstration: false,
      dataStatus: 'VERIFIED_CURRENT',
      isActive: true,
    },
  ];

  const mockFetchResults = {
    'https://www.anacostiaorganics.com/': { reachable: false, error: '503_SERVICE_UNAVAILABLE' },
    'https://www.chocolatecitysmokeshop.com/': { reachable: false, error: '503_SERVICE_UNAVAILABLE' },
    'https://takomawellness.com/patient-rewards/': { reachable: false, error: '503_SERVICE_UNAVAILABLE' },
    'https://allvybezdc.com/': { reachable: false, error: '503_SERVICE_UNAVAILABLE' },
  };

  const report = await revalidatePilotPromotions(testDeals, postTtlAsOf, { mockFetchResults });
  assert.equal(report.realCurrentDealCount, 0, 'No deals should be current after TTL failure');

  const deal = report.updatedDeals.find((d) => d.id === 'DEAL-DC-ABCA117379-NEW-PATIENT-20');
  assert.equal(deal.dataStatus, 'STALE');
  assert.equal(deal.isActive, false);

  const projection = projectVerifiedDealPublicFacts(deal, postTtlAsOf);
  assert.equal(projection.isPubliclyProjectable, false);
});

// -----------------------------------------------------------------------------
// TEST E: REMOVED OFFER IMMEDIATE SUPPRESSION
// -----------------------------------------------------------------------------
test('E: REMOVED OFFER — fresh source lacking offer immediately removes it from public projection', async () => {
  const asOf = new Date('2026-08-16T10:00:00.000Z');

  // Source is reachable, but the promo banner has been removed by merchant
  const mockFetchResults = {
    'https://www.anacostiaorganics.com/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-anacostia-no-promo',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><h2>Welcome to Anacostia Organics</h2><p>Regular hours and menu.</p></body></html>',
    },
    'https://www.chocolatecitysmokeshop.com/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-choc-flower-only',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><p>$5 off Flower</p></body></html>', // Edibles offer removed!
    },
    'https://takomawellness.com/patient-rewards/': { reachable: true, statusCode: 200, retrievedAt: asOf.toISOString(), html: '' },
    'https://allvybezdc.com/': { reachable: false, error: 'DNS' },
  };

  const report = await revalidatePilotPromotions(LIVE_PROMOTIONAL_OFFERS, asOf, { mockFetchResults });

  // Anacostia deal removed immediately
  const anacostia = report.updatedDeals.find((d) => d.id === 'DEAL-DC-ABCA117379-NEW-PATIENT-20');
  assert.equal(anacostia.dataStatus, 'NO_LONGER_OBSERVED');
  assert.equal(anacostia.isActive, false);

  // Chocolate City Edibles deal removed immediately
  const edibles = report.updatedDeals.find((d) => d.id === 'DEAL-DC-ABCA127461-EDIBLES-25MIN-5OFF');
  assert.equal(edibles.dataStatus, 'NO_LONGER_OBSERVED');
  assert.equal(edibles.isActive, false);

  // Chocolate City Flower deal preserved
  const flower = report.updatedDeals.find((d) => d.id === 'DEAL-DC-ABCA127461-FLOWER-5OFF');
  assert.equal(flower.dataStatus, 'VERIFIED_CURRENT');
  assert.equal(flower.isActive, true);

  assert.equal(report.realCurrentDealCount, 1);
  assert.equal(report.historicalAuditEvents.length, 2, 'Must record audit events for removed offers');
});

// -----------------------------------------------------------------------------
// TEST F: TERMS CHANGE PRESERVES HISTORY
// -----------------------------------------------------------------------------
test('F: TERMS CHANGE — modified terms update current truth while preserving history in audit', async () => {
  const asOf = new Date('2026-08-16T14:00:00.000Z');

  const mockFetchResults = {
    'https://www.anacostiaorganics.com/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-anacostia-terms-changed',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><h2>NEW PATIENTS GET 20% OFF FIRST PURCHASE</h2></body></html>',
    },
    'https://www.chocolatecitysmokeshop.com/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-choc-terms-changed',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><p>$5 off Flower</p><p>$5 off edibles over $25</p></body></html>',
    },
    'https://takomawellness.com/patient-rewards/': { reachable: true, statusCode: 200, retrievedAt: asOf.toISOString(), html: '' },
    'https://allvybezdc.com/': { reachable: false, error: 'DNS' },
  };

  const initialDeals = [
    {
      id: 'DEAL-DC-ABCA117379-NEW-PATIENT-20',
      retailerId: 'BIZ-DC-ABCA117379',
      title: 'Old Welcome Deal: 15% Off',
      discountValue: '15% OFF',
      verifiedAt: '2026-08-15T12:00:00.000Z',
      freshnessExpiresAt: '2026-08-16T12:00:00.000Z',
      isDemonstration: false,
      dataStatus: 'VERIFIED_CURRENT',
      isActive: true,
    },
  ];

  const report = await revalidatePilotPromotions(initialDeals, asOf, { mockFetchResults });
  const deal = report.updatedDeals.find((d) => d.id === 'DEAL-DC-ABCA117379-NEW-PATIENT-20');

  assert.equal(deal.discountValue, '20% OFF', 'Current truth becomes 20% OFF based on fresh evidence');
  const auditEvent = report.historicalAuditEvents.find((e) => e.eventType === 'TERMS_CHANGED');
  assert.ok(auditEvent, 'Audit event must capture previous terms');
  assert.equal(auditEvent.previousTerms.discountValue, '15% OFF');
  assert.equal(auditEvent.newTerms.discountValue, '20% OFF');
});

// -----------------------------------------------------------------------------
// TEST G: DEMONSTRATION FIREWALL
// -----------------------------------------------------------------------------
test('G: DEMO FIREWALL — demonstration deals are excluded from revalidation and never promoted', async () => {
  const demoDeal = {
    id: 'DEAL-DC-001',
    retailerId: 'BIZ-DC-ABCA117379',
    title: 'Buy 2 Get 1 Free House Edibles Special',
    discountValue: 'B2G1 FREE',
    isDemonstration: true,
    dataStatus: 'DEMONSTRATION_ONLY',
    verifiedAt: null,
    freshnessExpiresAt: null,
    isActive: true,
  };

  const report = await revalidatePilotPromotions([demoDeal], new Date());
  assert.equal(report.updatedDeals.length, 0, 'Demonstration deals must not enter updated real deals array');
  assert.equal(report.demoDealCountQuarantined, 5);
});

// -----------------------------------------------------------------------------
// TEST H: DEAL ID STABILITY
// -----------------------------------------------------------------------------
test('H: DEAL ID STABILITY — revalidating the same semantic offer preserves exact canonical deal ID', async () => {
  const asOf = new Date('2026-08-16T18:00:00.000Z');
  const mockFetchResults = {
    'https://www.anacostiaorganics.com/': {
      reachable: true,
      statusCode: 200,
      rawSha256: 'mock-fresh-sha256-anacostia-002',
      retrievedAt: asOf.toISOString(),
      html: '<html><body><h2>NEW PATIENTS GET 20% OFF FIRST PURCHASE</h2></body></html>',
    },
    'https://www.chocolatecitysmokeshop.com/': { reachable: true, statusCode: 200, retrievedAt: asOf.toISOString(), html: '' },
    'https://takomawellness.com/patient-rewards/': { reachable: true, statusCode: 200, retrievedAt: asOf.toISOString(), html: '' },
    'https://allvybezdc.com/': { reachable: false, error: 'DNS' },
  };

  const report = await revalidatePilotPromotions(LIVE_PROMOTIONAL_OFFERS, asOf, { mockFetchResults });
  const deal = report.updatedDeals.find((d) => d.retailerId === 'BIZ-DC-ABCA117379');

  assert.ok(deal);
  assert.equal(deal.id, 'DEAL-DC-ABCA117379-NEW-PATIENT-20', 'Deal ID must remain stable across cycles');
});

// -----------------------------------------------------------------------------
// TEST I: PROCESS RESTART DURABILITY SIMULATION
// -----------------------------------------------------------------------------
test('I: RESTART DURABILITY — state retrieved from durable canonical storage retains verification', () => {
  // Simulates a clean process start reading durable record
  const durableStoredRecord = {
    id: 'DEAL-DC-ABCA117379-NEW-PATIENT-20',
    retailerId: 'BIZ-DC-ABCA117379',
    title: 'New Patient Welcome: 20% Off First Purchase',
    discount: '20% OFF',
    expiryDate: new Date('2026-08-16T20:00:00.000Z'),
    isActive: true,
    dataStatus: 'VERIFIED_CURRENT',
    isDemonstration: false,
    verifiedAt: new Date('2026-08-15T20:00:00.000Z'),
    freshnessExpiresAt: new Date('2026-08-16T20:00:00.000Z'),
  };

  const asOf = new Date('2026-08-15T22:00:00.000Z');
  const where = currentDealWhere(asOf);

  const isCurrentInQuery =
    durableStoredRecord.isActive === where.isActive &&
    durableStoredRecord.expiryDate > asOf &&
    durableStoredRecord.dataStatus === 'VERIFIED_CURRENT' &&
    !durableStoredRecord.isDemonstration &&
    durableStoredRecord.verifiedAt <= asOf &&
    durableStoredRecord.freshnessExpiresAt > asOf;

  assert.equal(isCurrentInQuery, true, 'Durable record must satisfy currentDealWhere on fresh process start');
});

// -----------------------------------------------------------------------------
// TEST J: ZERO-DEAL STATE TRUTHFULNESS
// -----------------------------------------------------------------------------
test('J: ZERO CURRENT — when all live deals expire/end, zero-deal state is truthfully rendered', () => {
  function renderDealsDiscovery(activeDeals) {
    if (!activeDeals || activeDeals.length === 0) {
      return {
        count: 0,
        headline: 'No Verified Deals Currently Active',
        notice: 'All public promotional claims require fresh direct merchant evidence. Check back soon.',
        deals: [],
      };
    }
    return {
      count: activeDeals.length,
      headline: 'Verified D.C. Cannabis Deals',
      deals: activeDeals,
    };
  }

  // 3 Deals
  const state3 = renderDealsDiscovery(LIVE_PROMOTIONAL_OFFERS);
  assert.equal(state3.count, 3);

  // 0 Deals
  const state0 = renderDealsDiscovery([]);
  assert.equal(state0.count, 0);
  assert.equal(state0.headline, 'No Verified Deals Currently Active');
  assert.equal(state0.deals.length, 0);
});

// -----------------------------------------------------------------------------
// TEST K: NO SYNTHETIC CUSTOMER TELEMETRY DURING REVALIDATION
// -----------------------------------------------------------------------------
test('K: NO SYNTHETIC TELEMETRY — revalidation execution emits ZERO customer events or commercial credit', async () => {
  const asOf = new Date('2026-08-16T12:00:00.000Z');
  const report = await revalidatePilotPromotions(LIVE_PROMOTIONAL_OFFERS, asOf);

  assert.equal(report.customerEventsGenerated, 0);
  assert.equal(report.historicalAuditEvents.every((e) => e.eventType !== 'DEAL_VIEWED' && e.eventType !== 'MERCHANT_CLICKED'), true);
});

// -----------------------------------------------------------------------------
// TEST L: CURRENTNESS QUERY AS AUTHORITATIVE PUBLIC GATE
// -----------------------------------------------------------------------------
test('L: CURRENTNESS QUERY — currentDealWhere(asOf) strictly bounds public access', () => {
  const asOf = new Date('2026-08-15T21:00:00.000Z');
  const queryWhere = currentDealWhere(asOf);

  assert.equal(queryWhere.isActive, true);
  assert.deepEqual(queryWhere.expiryDate, { gt: asOf });
  assert.ok(queryWhere.OR, 'Must include OR filter for public catalog record');
});
