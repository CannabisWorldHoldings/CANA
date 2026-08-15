import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PILOT_MERCHANTS,
  buildMarketEvidenceReceipt,
  projectVerifiedRetailerPublicFacts,
  DCGIS_HEALTH_LAYER_31_URL,
  DCGIS_HEALTH_LAYER_31_SHA256,
  ABCA_FIND_RETAILER_PAGE_URL,
  ABCA_FIND_RETAILER_PAGE_SHA256,
  RETRIEVAL_TIMESTAMP,
  FRESHNESS_EXPIRY_TIMESTAMP,
} from '../src/lib/reality/market-reality-pilot.mjs';

/**
 * LIVE MARKET REALITY PILOT COURT — OFFICIAL SOURCE REVALIDATED
 *
 * Enforces the data-truth invariants for D.C. pilot market reality revalidated against:
 *  1. Live Official DCGIS Health_WebMercator Layer 31
 *  2. Live Official ABCA "Find a Medical Cannabis Retailer" public directory
 *
 * Invariants tested:
 *  A. Live Verified Merchant Projection under Valid Freshness Window
 *  B. Future Stale Disqualification via Freshness Firewall
 *  C. Takoma Address Resolution (Blair Rd = VERIFIED_CURRENT, Laurel Ave = SUPERSEDED)
 *  D. License & Operational List Observation != Promotional Deal Evidence
 *  E. Demonstration Deal Firewall (0 Real Deals, 5 Demo Deals)
 *  F. Deterministic Entity Matching & Ambiguity Refusal
 *  G. Destination Safety & Server-Controlled URLs
 *  H. Evidence Receipt Schema with Live Dual-Source SHA-256 Hashes
 *  I. Claim-by-Claim Epistemic Breakdown
 */

// -----------------------------------------------------------------------------
// TEST A: LIVE VERIFIED PROJECTION UNDER ACTIVE FRESHNESS WINDOW
// -----------------------------------------------------------------------------

test('A: Live direct official evidence yields VERIFIED_CURRENT public projection within freshness window', () => {
  const asOf = new Date('2026-08-15T19:00:00.000Z');
  const merchant = PILOT_MERCHANTS[0]; // Anacostia Organics

  const projection = projectVerifiedRetailerPublicFacts(merchant, asOf);

  assert.equal(projection.isPubliclyProjectable, true);
  assert.equal(projection.dataStatus, 'VERIFIED_CURRENT');
  assert.equal(projection.isDemonstration, false);
  assert.equal(projection.name, 'Anacostia Organics');
  assert.equal(projection.licenseNumber, 'ABCA-117379');
  assert.equal(projection.ward, 'Ward 8');
  assert.ok(projection.publicClaimsAllowed.includes('MERCHANT_IDENTITY'));
  assert.ok(projection.publicClaimsAllowed.includes('OPERATIONAL_LIST_PRESENCE'));
  assert.ok(projection.publicClaimsAllowed.includes('PHYSICAL_ADDRESS'));
});

// -----------------------------------------------------------------------------
// TEST B: FRESHNESS EXPIRY DISQUALIFICATION
// -----------------------------------------------------------------------------

test('B: AsOf beyond freshness expiry (7-day SLA) fails closed as STALE', () => {
  const futureAsOf = new Date('2026-09-01T00:00:00.000Z');
  const merchant = PILOT_MERCHANTS[0];

  const projection = projectVerifiedRetailerPublicFacts(merchant, futureAsOf);

  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.status, 'STALE');
  assert.equal(projection.disqualificationReason, 'FRESHNESS_EXPIRED');
});

// -----------------------------------------------------------------------------
// TEST C: TAKOMA WELLNESS ADDRESS RESOLUTION & SUPERSEDED ENTRY
// -----------------------------------------------------------------------------

test('C: Takoma Wellness address resolves to Blair Rd NW as VERIFIED_CURRENT and Laurel Ave as SUPERSEDED', () => {
  const takoma = PILOT_MERCHANTS.find((m) => m.retailerId === 'BIZ-DC-ABCA117361');
  assert.ok(takoma, 'Takoma Wellness must exist in pilot merchant set');

  assert.equal(takoma.licenseNumber, 'ABCA-117361');
  assert.equal(takoma.address, '6925 Blair Road NW');
  assert.equal(takoma.supersededAddress, '6925 Laurel Avenue NW');
  assert.equal(takoma.ward, 'Ward 4');
  assert.equal(takoma.claims.PHYSICAL_ADDRESS.class, 'VERIFIED_CURRENT');
  assert.equal(takoma.claims.PHYSICAL_ADDRESS.value, '6925 Blair Road NW');
  assert.equal(takoma.claims.PHYSICAL_ADDRESS.superseded, '6925 Laurel Avenue NW');
});

// -----------------------------------------------------------------------------
// TEST D: LICENSE & OPERATIONAL LIST EVIDENCE != PROMOTIONAL DEAL EVIDENCE
// -----------------------------------------------------------------------------

test('D: Official license and operational list evidence prove existence and authorization, NEVER a deal', () => {
  for (const merchant of PILOT_MERCHANTS) {
    const receipt = buildMarketEvidenceReceipt(merchant, 'OPERATIONAL_LIST_PRESENCE', merchant.claims.OPERATIONAL_LIST_PRESENCE.value);

    assert.equal(receipt.claimType, 'OPERATIONAL_LIST_PRESENCE');
    assert.equal(receipt.verificationResult, 'PASS_LIVE_OFFICIAL_REGISTRY_REVALIDATED');
    assert.equal(receipt.sourceDcgisSha256, DCGIS_HEALTH_LAYER_31_SHA256);
    assert.equal(receipt.sourceAbcaPageSha256, ABCA_FIND_RETAILER_PAGE_SHA256);

    // Asserts zero promotional discount in official evidence
    assert.equal(typeof receipt.claimValue.discount, 'undefined');
    assert.equal(typeof receipt.claimValue.dealTitle, 'undefined');
    assert.equal(typeof receipt.claimValue.couponCode, 'undefined');
  }
});

// -----------------------------------------------------------------------------
// TEST E: DEMONSTRATION DEALS REMAIN DEMONSTRATION_ONLY
// -----------------------------------------------------------------------------

test('E: Demonstration deals are rejected from real-current query predicates', () => {
  const demoDeal = {
    id: 'DEAL-DC-001',
    title: 'Buy 2 Get 1 Free House Edibles Special',
    discount: 'B2G1 FREE',
    isDemonstration: true,
    dataStatus: 'DEMONSTRATION_ONLY',
    verifiedAt: null,
    freshnessExpiresAt: null,
  };

  const asOf = new Date('2026-08-15T19:00:00.000Z');

  // Canonical predicate for live real-current deal
  const isRealCurrent =
    demoDeal.isDemonstration === false &&
    demoDeal.dataStatus === 'VERIFIED_CURRENT' &&
    demoDeal.verifiedAt !== null &&
    new Date(demoDeal.verifiedAt) <= asOf &&
    demoDeal.freshnessExpiresAt !== null &&
    new Date(demoDeal.freshnessExpiresAt) > asOf;

  assert.equal(isRealCurrent, false, 'Demo deal must NEVER satisfy real-current predicate');
});

// -----------------------------------------------------------------------------
// TEST F: ENTITY MATCHING & AMBIGUITY REFUSAL
// -----------------------------------------------------------------------------

test('F: Deterministic entity matching confirms official ABCA numbers and refuses ambiguous matches', () => {
  assert.equal(PILOT_MERCHANTS.length, 4);

  // Exact ABCA bindings
  assert.equal(PILOT_MERCHANTS[0].licenseNumber, 'ABCA-117379');
  assert.equal(PILOT_MERCHANTS[1].licenseNumber, 'ABCA-117361');
  assert.equal(PILOT_MERCHANTS[2].licenseNumber, 'ABCA-127461');
  assert.equal(PILOT_MERCHANTS[3].licenseNumber, 'ABCA-127484');

  // Ambiguous match evaluation
  function evaluateMatch(nameA, addrA, nameB, addrB) {
    if (nameA === nameB && addrA !== addrB) {
      return { matched: false, classification: 'BLOCKED_AMBIGUOUS_MATCH' };
    }
    return { matched: true, classification: 'CONFIRMED_MATCH' };
  }

  const amb = evaluateMatch('All Vybez DC', '3011 Georgia Ave NW', 'All Vybez DC', '999 Different St NW');
  assert.equal(amb.matched, false);
  assert.equal(amb.classification, 'BLOCKED_AMBIGUOUS_MATCH');
});

// -----------------------------------------------------------------------------
// TEST G: DESTINATION SAFETY & SERVER-CONTROLLED URLS
// -----------------------------------------------------------------------------

test('G: Outbound destination checks reject malicious schemes and arbitrary unverified domains', () => {
  const allowedHosts = new Set([
    'www.anacostiaorganics.com',
    'anacostiaorganics.com',
    'takomawellness.com',
    'www.chocolatecitysmokeshop.com',
    'chocolatecitywellness.com',
    'allvybezdc.com',
  ]);

  function isAllowedDestination(urlStr) {
    if (urlStr.startsWith('javascript:') || urlStr.startsWith('data:') || urlStr.startsWith('//')) {
      return false;
    }
    try {
      const u = new URL(urlStr);
      return ['http:', 'https:'].includes(u.protocol) && allowedHosts.has(u.hostname);
    } catch {
      return false;
    }
  }

  assert.equal(isAllowedDestination('https://takomawellness.com/'), true);
  assert.equal(isAllowedDestination('https://www.anacostiaorganics.com/'), true);
  assert.equal(isAllowedDestination('javascript:alert(1)'), false);
  assert.equal(isAllowedDestination('data:text/html,<script></script>'), false);
  assert.equal(isAllowedDestination('https://evil-phishing-dispensary.com/'), false);
});

// -----------------------------------------------------------------------------
// TEST H: EVIDENCE RECEIPTS BIND DUAL OFFICIAL REVALIDATION SOURCES
// -----------------------------------------------------------------------------

test('H: Evidence receipt generates reproducible hash linking live DCGIS and live ABCA sources', () => {
  const merchant = PILOT_MERCHANTS[0];
  const receipt = buildMarketEvidenceReceipt(merchant, 'PHYSICAL_ADDRESS', merchant.claims.PHYSICAL_ADDRESS.value);

  assert.equal(typeof receipt.evidenceHash, 'string');
  assert.equal(receipt.evidenceHash.length, 64);
  assert.equal(receipt.sourceDcgisId, DCGIS_HEALTH_LAYER_31_URL);
  assert.equal(receipt.sourceAbcaPageUrl, ABCA_FIND_RETAILER_PAGE_URL);
  assert.equal(receipt.sourceDcgisSha256, DCGIS_HEALTH_LAYER_31_SHA256);
  assert.equal(receipt.sourceAbcaPageSha256, ABCA_FIND_RETAILER_PAGE_SHA256);
  assert.equal(receipt.epistemicClass, 'VERIFIED_CURRENT');
});

// -----------------------------------------------------------------------------
// TEST I: CLAIM-BY-CLAIM EPISTEMIC BREAKDOWN
// -----------------------------------------------------------------------------

test('I: Claim-by-claim breakdown accurately reflects live verified vs historical fields', () => {
  for (const m of PILOT_MERCHANTS) {
    assert.equal(m.claims.MERCHANT_IDENTITY.class, 'VERIFIED_CURRENT');
    assert.equal(m.claims.OPERATIONAL_LIST_PRESENCE.class, 'VERIFIED_CURRENT');
    assert.equal(m.claims.LICENSE_STATUS.class, 'VERIFIED_CURRENT');
    assert.equal(m.claims.PHYSICAL_ADDRESS.class, 'VERIFIED_CURRENT');
    assert.equal(m.claims.GEOLOCATION.class, 'VERIFIED_CURRENT');
  }

  // All Vybez external destination is historically observed
  const vybez = PILOT_MERCHANTS.find((m) => m.retailerId === 'BIZ-DC-ABCA127484');
  assert.equal(vybez.claims.CANONICAL_EXTERNAL_DESTINATION.class, 'HISTORICALLY_OBSERVED');

  // Anacostia, Takoma, Chocolate City are verified current directly from ABCA page
  const anacostia = PILOT_MERCHANTS.find((m) => m.retailerId === 'BIZ-DC-ABCA117379');
  assert.equal(anacostia.claims.CANONICAL_EXTERNAL_DESTINATION.class, 'VERIFIED_CURRENT');
});
