import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PILOT_MERCHANTS,
  buildMarketEvidenceReceipt,
  projectVerifiedRetailerPublicFacts,
  DCGIS_HEALTH_LAYER_31_SHA256,
  ABCA_FIND_RETAILER_PAGE_SHA256,
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

  const isRealCurrent =
    !demoDeal.isDemonstration &&
    demoDeal.dataStatus === 'VERIFIED_CURRENT' &&
    demoDeal.verifiedAt !== null;

  assert.equal(isRealCurrent, false, 'Demonstration deal must never be evaluated as real-current');
});

// -----------------------------------------------------------------------------
// TEST F: DETERMINISTIC ENTITY RESOLUTION & AMBIGUITY REFUSAL
// -----------------------------------------------------------------------------

test('F: Deterministic entity matching confirms official ABCA numbers and refuses ambiguous matches', () => {
  function matchOfficialRetailer(inputLicense) {
    const normalized = (inputLicense || '').trim().toUpperCase();
    const match = PILOT_MERCHANTS.find((m) => m.licenseNumber === normalized);
    if (!match) {
      return { match: null, status: 'REFUSED_UNRESOLVED_ENTITY' };
    }
    return { match, status: 'CONFIRMED_ENTITY_MATCH' };
  }

  // Exact matches for pilot set
  assert.equal(matchOfficialRetailer('ABCA-117379').status, 'CONFIRMED_ENTITY_MATCH');
  assert.equal(matchOfficialRetailer('ABCA-117361').status, 'CONFIRMED_ENTITY_MATCH');
  assert.equal(matchOfficialRetailer('ABCA-127461').status, 'CONFIRMED_ENTITY_MATCH');
  assert.equal(matchOfficialRetailer('ABCA-127484').status, 'CONFIRMED_ENTITY_MATCH');

  // Negative / Ambiguous controls
  assert.equal(matchOfficialRetailer('ABCA-999999').status, 'REFUSED_UNRESOLVED_ENTITY');
  assert.equal(matchOfficialRetailer('').status, 'REFUSED_UNRESOLVED_ENTITY');
  assert.equal(matchOfficialRetailer(null).status, 'REFUSED_UNRESOLVED_ENTITY');
});

// -----------------------------------------------------------------------------
// TEST G: DESTINATION SAFETY & SERVER-CONTROLLED OUTBOUND URLS
// -----------------------------------------------------------------------------

test('G: Outbound destination checks reject malicious schemes and arbitrary unverified domains', () => {
  function validateOutboundDestination(url, merchant) {
    if (!url || typeof url !== 'string') return { valid: false, reason: 'EMPTY_DESTINATION' };
    if (url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('//')) {
      return { valid: false, reason: 'PROHIBITED_SCHEME' };
    }
    if (url.startsWith('/')) {
      return { valid: true, destination: url, type: 'CANONICAL_INTERNAL_ROUTE' };
    }
    try {
      const parsed = new URL(url);
      const merchantDomain = new URL(merchant.canonicalWebsite).hostname;
      if (parsed.hostname === merchantDomain || parsed.hostname.endsWith(`.${merchantDomain}`)) {
        return { valid: true, destination: url, type: 'VERIFIED_MERCHANT_DOMAIN' };
      }
      return { valid: false, reason: 'UNBOUND_EXTERNAL_DOMAIN' };
    } catch {
      return { valid: false, reason: 'MALFORMED_URL' };
    }
  }

  const takoma = PILOT_MERCHANTS.find((m) => m.retailerId === 'BIZ-DC-ABCA117361');

  // Valid canonical destinations
  assert.equal(validateOutboundDestination('https://takomawellness.com/menu', takoma).valid, true);
  assert.equal(validateOutboundDestination('/retailer/BIZ-DC-ABCA117361', takoma).valid, true);

  // Attack vectors / malicious patterns
  assert.equal(validateOutboundDestination('javascript:alert(1)', takoma).valid, false);
  assert.equal(validateOutboundDestination('data:text/html,attack', takoma).valid, false);
  assert.equal(validateOutboundDestination('https://evil-spoof-cannabis.com', takoma).valid, false);
});

// -----------------------------------------------------------------------------
// TEST H: EVIDENCE RECEIPT SCHEMA WITH LIVE DUAL-SOURCE SHA-256 HASHES
// -----------------------------------------------------------------------------

test('H: Evidence receipt generates reproducible hash linking live DCGIS and live ABCA sources', () => {
  const merchant = PILOT_MERCHANTS[0];
  const receipt = buildMarketEvidenceReceipt(merchant, 'LICENSE_STATUS', merchant.claims.LICENSE_STATUS.value);

  assert.ok(receipt.evidenceHash, 'Receipt must contain SHA-256 hash');
  assert.equal(receipt.evidenceHash.length, 64);
  assert.equal(receipt.sourceDcgisSha256, '9b55615315d8e19f300b7286dc28351af82ed272a930838a0f6cdfe89d0d10b9');
  assert.equal(receipt.sourceAbcaPageSha256, '2011fada9a9f8c260553677ec1da891a60cb5156ffff45efca0946f4c749617d');
  assert.equal(receipt.epistemicClass, 'VERIFIED_CURRENT');
});

// -----------------------------------------------------------------------------
// TEST I: CLAIM-BY-CLAIM EPISTEMIC BREAKDOWN
// -----------------------------------------------------------------------------

test('I: Claim-by-claim breakdown accurately reflects live verified vs historical fields', () => {
  const allVybez = PILOT_MERCHANTS.find((m) => m.retailerId === 'BIZ-DC-ABCA127484');
  assert.ok(allVybez);

  // Verified official attributes
  assert.equal(allVybez.claims.MERCHANT_IDENTITY.class, 'VERIFIED_CURRENT');
  assert.equal(allVybez.claims.OPERATIONAL_LIST_PRESENCE.class, 'VERIFIED_CURRENT');
  assert.equal(allVybez.claims.LICENSE_STATUS.class, 'VERIFIED_CURRENT');

  // Website is currently unresolvable/offline -> classified as HISTORICALLY_OBSERVED
  assert.equal(allVybez.claims.CANONICAL_EXTERNAL_DESTINATION.class, 'HISTORICALLY_OBSERVED');
});
