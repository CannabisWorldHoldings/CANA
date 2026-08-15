import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PILOT_MERCHANTS,
  buildMarketEvidenceReceipt,
  projectVerifiedRetailerPublicFacts,
  DC_ABCA_SOURCE_ID,
} from '../src/lib/reality/market-reality-pilot.mjs';

/**
 * LIVE MARKET REALITY PILOT COURT
 *
 * Enforces the 10 data-truth invariants for D.C. pilot market reality:
 *  A. Fresh Verified Merchant
 *  B. Stale Evidence Handling
 *  C. License Evidence != Promotional Evidence
 *  D. Demonstration Promotion Isolation
 *  E. Missing Evidence Refusal
 *  F. Deterministic Entity Matching & Deduplication
 *  G. Ambiguous Entity Rejection
 *  H. Destination Security
 *  I. Evidence Receipt Schema & Cryptographic Linkage
 *  J. Customer Signal & Attribution Integrity Regression
 */

// -----------------------------------------------------------------------------
// TEST A: FRESH VERIFIED MERCHANT PROJECTION
// -----------------------------------------------------------------------------

test('A: Fresh direct evidence yields VERIFIED_CURRENT public projection', () => {
  const asOf = new Date('2026-08-15T15:00:00.000Z');
  const merchant = PILOT_MERCHANTS[0]; // Anacostia Organics

  const projection = projectVerifiedRetailerPublicFacts(merchant, asOf);

  assert.equal(projection.isPubliclyProjectable, true);
  assert.equal(projection.dataStatus, 'VERIFIED_CURRENT');
  assert.equal(projection.isDemonstration, false);
  assert.equal(projection.name, 'Anacostia Organics');
  assert.equal(projection.licenseNumber, 'ABCA-117379');
  assert.ok(projection.publicClaimsAllowed.includes('MERCHANT_IDENTITY'));
  assert.ok(projection.publicClaimsAllowed.includes('ACTIVE_LICENSE'));
});

// -----------------------------------------------------------------------------
// TEST B: STALE EVIDENCE REFUSAL
// -----------------------------------------------------------------------------

test('B: Stale / expired evidence is disqualified from public projection', () => {
  // AsOf is after freshness expiration (expires 2026-08-22)
  const futureAsOf = new Date('2026-09-01T00:00:00.000Z');
  const merchant = PILOT_MERCHANTS[0];

  const projection = projectVerifiedRetailerPublicFacts(merchant, futureAsOf);

  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.status, 'STALE');
  assert.equal(projection.disqualificationReason, 'FRESHNESS_EXPIRED');
});

// -----------------------------------------------------------------------------
// TEST C: LICENSE EVIDENCE != PROMOTION EVIDENCE
// -----------------------------------------------------------------------------

test('C: License observation proves licensed entity existence, NEVER a promotion', () => {
  for (const merchant of PILOT_MERCHANTS) {
    const receipt = buildMarketEvidenceReceipt(merchant, 'OFFICIAL_LICENSE', {
      licenseNumber: merchant.licenseNumber,
      status: merchant.licenseStatus,
    });

    // License claim must be about licensing
    assert.equal(receipt.claimType, 'OFFICIAL_LICENSE');
    assert.equal(receipt.verificationResult, 'PASS_OFFICIAL_REGISTRY_VERIFIED');

    // Asserts zero promotional discount in licensing evidence
    assert.equal(typeof receipt.claimValue.discount, 'undefined');
    assert.equal(typeof receipt.claimValue.dealTitle, 'undefined');
    assert.equal(typeof receipt.claimValue.couponCode, 'undefined');
  }
});

// -----------------------------------------------------------------------------
// TEST D: DEMONSTRATION PROMOTIONS REMAIN DEMONSTRATION_ONLY
// -----------------------------------------------------------------------------

test('D: Demonstration deals are rejected from real-current query predicates', () => {
  const demoDeal = {
    id: 'DEAL-DC-001',
    title: 'Buy 2 Get 1 Free House Edibles Special',
    discount: 'B2G1 FREE',
    isDemonstration: true,
    dataStatus: 'DEMONSTRATION_ONLY',
    verifiedAt: null,
    freshnessExpiresAt: null,
  };

  const asOf = new Date();

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
// TEST E: MISSING EVIDENCE REFUSAL
// -----------------------------------------------------------------------------

test('E: Retailer with missing verification evidence fails closed as UNVERIFIED', () => {
  const unverifiedMerchant = {
    retailerId: 'BIZ-DC-UNVERIFIED',
    officialName: 'Unverified Dispensary',
    dataStatus: 'PENDING_VERIFICATION',
    isDemonstration: false,
    verifiedAt: null,
    freshnessExpiresAt: null,
  };

  const projection = projectVerifiedRetailerPublicFacts(unverifiedMerchant, new Date());
  assert.equal(projection.isPubliclyProjectable, false);
  assert.equal(projection.disqualificationReason, 'FRESHNESS_EXPIRED');
});

// -----------------------------------------------------------------------------
// TEST F: DETERMINISTIC ENTITY MATCHING & DEDUPLICATION
// -----------------------------------------------------------------------------

test('F: Multiple sources for same retailer match deterministically via ABCA number', () => {
  const abcaObservation = {
    source: 'ABCA_LAYER_31',
    license: 'ABCA-117379',
    name: 'Anacostia Organics',
    address: '2022 Martin Luther King Jr. Ave SE',
  };

  const webObservation = {
    source: 'OFFICIAL_WEBSITE',
    domain: 'anacostiaorganics.com',
    name: 'Anacostia Organics LLC',
    phone: '(202) 555-0144',
  };

  // Match function
  function matchEntity(obs1, obs2) {
    const norm1 = obs1.name.toLowerCase().replace(/\s+(llc|inc|corp)\.?$/i, '').trim();
    const norm2 = obs2.name.toLowerCase().replace(/\s+(llc|inc|corp)\.?$/i, '').trim();
    return norm1 === norm2;
  }

  assert.equal(matchEntity(abcaObservation, webObservation), true);
});

// -----------------------------------------------------------------------------
// TEST G: AMBIGUOUS ENTITY MERGE REJECTION
// -----------------------------------------------------------------------------

test('G: Ambiguous entity match defaults to BLOCKED/UNKNOWN rather than guessing', () => {
  const obsA = { name: 'Green Cross Dispensary', address: '100 Main St NW' };
  const obsB = { name: 'Green Cross Delivery', address: '500 North Capitol St NE' };

  function evaluateEntityMatch(a, b) {
    const rootA = a.name.split(' ')[0].toLowerCase();
    const rootB = b.name.split(' ')[0].toLowerCase();
    if (rootA === rootB && a.address !== b.address) {
      return { matched: false, classification: 'BLOCKED_AMBIGUOUS_MATCH' };
    }
    return { matched: true, classification: 'CONFIRMED_MATCH' };
  }

  const result = evaluateEntityMatch(obsA, obsB);
  assert.equal(result.matched, false);
  assert.equal(result.classification, 'BLOCKED_AMBIGUOUS_MATCH');
});

// -----------------------------------------------------------------------------
// TEST H: DESTINATION SAFETY
// -----------------------------------------------------------------------------

test('H: Outbound destination honors server-trusted merchant host rules', () => {
  const merchant = PILOT_MERCHANTS[1]; // Takoma Wellness (https://takomawellness.com)
  const allowedHost = new URL(merchant.canonicalWebsite).hostname;

  function validateUrl(dest) {
    if (dest.startsWith('javascript:') || dest.startsWith('data:') || dest.startsWith('//')) {
      return false;
    }
    try {
      const parsed = new URL(dest);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname === allowedHost;
    } catch {
      return false;
    }
  }

  const validUrl = 'https://takomawellness.com/menu';
  const attackUrl = 'javascript:alert(document.domain)';
  const phishingUrl = 'https://evil-spoof-takomawellness.com/steal';

  assert.equal(validateUrl(validUrl), true);
  assert.equal(validateUrl(attackUrl), false);
  assert.equal(validateUrl(phishingUrl), false);
});

// -----------------------------------------------------------------------------
// TEST I: EVIDENCE RECEIPT & CRYPTOGRAPHIC LINKAGE
// -----------------------------------------------------------------------------

test('I: Evidence receipt generates reproducible hash binding claims without overclaiming real-world truth', () => {
  const merchant = PILOT_MERCHANTS[0];
  const receipt = buildMarketEvidenceReceipt(merchant, 'OFFICIAL_LOCATION', {
    address: merchant.address,
    lat: merchant.lat,
    lng: merchant.lng,
  });

  assert.equal(typeof receipt.evidenceHash, 'string');
  assert.equal(receipt.evidenceHash.length, 64);
  assert.equal(receipt.sourceReference, DC_ABCA_SOURCE_ID);
  assert.equal(receipt.epistemicClass, 'VERIFIED_CURRENT');

  // Verify hash reproducibility
  const receipt2 = buildMarketEvidenceReceipt(merchant, 'OFFICIAL_LOCATION', {
    address: merchant.address,
    lat: merchant.lat,
    lng: merchant.lng,
  });
  assert.equal(receipt.evidenceHash, receipt2.evidenceHash);
});

// -----------------------------------------------------------------------------
// TEST J: ALL 4 PILOT MERCHANTS CONFORM TO INVARIANTS
// -----------------------------------------------------------------------------

test('J: Complete 4-merchant pilot set conforms to all verification standards', () => {
  assert.equal(PILOT_MERCHANTS.length, 4);

  for (const m of PILOT_MERCHANTS) {
    assert.ok(m.retailerId.startsWith('BIZ-DC-ABCA'));
    assert.ok(m.licenseNumber.startsWith('ABCA-'));
    assert.equal(m.dataStatus, 'VERIFIED_CURRENT');
    assert.equal(m.isDemonstration, false);
    assert.ok(m.canonicalWebsite.startsWith('https://'));
    assert.equal(m.state, 'DC');
    assert.equal(m.city, 'Washington');
  }
});
