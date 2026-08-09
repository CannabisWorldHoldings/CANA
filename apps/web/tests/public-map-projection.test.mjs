/**
 * PublicMapProjection tests — the evidence gate the customer map sits behind.
 *
 * Dependency-free (pure functions, no database, no Prisma), so this suite
 * runs with bare `node --test` and belongs in every gate.
 *
 * The negative cases ARE the point: most of these tests prove the projection
 * REFUSES to render, because "a row exists" must never become "the fact is
 * true" on a public surface.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectClaim,
  projectRetailerMarker,
  projectMarkers,
  PUBLIC_CLAIM_TYPES,
} from '../src/lib/geo/public-map-projection.mjs';

const NOW = new Date('2026-08-08T12:00:00Z');
const FUTURE = new Date('2026-08-09T12:00:00Z');
const PAST = new Date('2026-08-07T12:00:00Z');

function eligibleClaim(overrides = {}) {
  return {
    claimType: 'operating_status',
    claimValue: 'open',
    decisionEligible: true,
    verification: 'VERIFIED',
    freshnessExpiresAt: FUTURE,
    observedAt: PAST,
    source: 'partner-feed',
    confidence: 0.95,
    ...overrides,
  };
}

function verifiedRetailer(overrides = {}) {
  return {
    id: 'r1',
    name: 'Dupont Dispensary',
    type: 'storefront',
    lat: 38.9097,
    lng: -77.0434,
    dataStatus: 'VERIFIED_CURRENT',
    isDemonstration: false,
    verifiedAt: PAST,
    freshnessExpiresAt: FUTURE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// projectClaim — the eligibility gate
// ---------------------------------------------------------------------------

test('eligible VERIFIED claim projects with its evidence metadata', () => {
  const projected = projectClaim(eligibleClaim(), NOW);
  assert.ok(projected);
  assert.equal(projected.type, 'operating_status');
  assert.equal(projected.value, 'open');
  assert.equal(projected.verification, 'VERIFIED');
  assert.equal(projected.source, 'partner-feed');
});

test('FALSIFICATION: decisionEligible=false is refused regardless of verification', () => {
  assert.equal(projectClaim(eligibleClaim({ decisionEligible: false }), NOW), null);
});

test('FALSIFICATION: UNKNOWN/HYPOTHESIS/CONTRADICTED/REFUTED/STALE are refused', () => {
  for (const verification of ['UNKNOWN', 'HYPOTHESIS', 'CONTRADICTED', 'REFUTED', 'STALE']) {
    assert.equal(
      projectClaim(eligibleClaim({ verification }), NOW),
      null,
      `verification=${verification} must not render publicly`,
    );
  }
});

test('FALSIFICATION: expired freshness is refused even when VERIFIED', () => {
  assert.equal(projectClaim(eligibleClaim({ freshnessExpiresAt: PAST }), NOW), null);
});

test('FALSIFICATION: claim types outside the public allowlist are refused', () => {
  assert.equal(
    projectClaim(eligibleClaim({ claimType: 'internal_revenue_estimate' }), NOW),
    null,
    'internal intelligence must never leak through the public projection',
  );
  assert.ok(!PUBLIC_CLAIM_TYPES.includes('internal_revenue_estimate'));
});

test('claim with no freshnessExpiresAt does not auto-expire', () => {
  assert.ok(projectClaim(eligibleClaim({ freshnessExpiresAt: null }), NOW));
});

// ---------------------------------------------------------------------------
// projectRetailerMarker — coordinates and truth badges
// ---------------------------------------------------------------------------

test('marker prefers canonical geo entity coordinates over legacy floats', () => {
  const marker = projectRetailerMarker({
    retailer: verifiedRetailer({ lat: 1, lng: 1 }),
    geoEntity: { id: 'g1', lat: 38.9097, lng: -77.0434, h3R9: '892aa84edabffff', verification: 'VERIFIED' },
    asOf: NOW,
  });
  assert.equal(marker.lat, 38.9097);
  assert.equal(marker.coordinateSource, 'geo_entity');
  assert.equal(marker.canaLocationId, 'g1');
  assert.equal(marker.h3R9, '892aa84edabffff');
});

test('legacy coordinates still map during transition, marked as legacy + UNKNOWN', () => {
  const marker = projectRetailerMarker({ retailer: verifiedRetailer(), asOf: NOW });
  assert.equal(marker.coordinateSource, 'legacy_retailer');
  assert.equal(marker.coordinateVerification, 'UNKNOWN');
  assert.equal(marker.canaLocationId, null);
});

test('FALSIFICATION: Null Island and non-finite coordinates are unmappable, not defaulted', () => {
  assert.equal(projectRetailerMarker({ retailer: verifiedRetailer({ lat: 0, lng: 0 }), asOf: NOW }), null);
  assert.equal(projectRetailerMarker({ retailer: verifiedRetailer({ lat: NaN, lng: -77 }), asOf: NOW }), null);
});

test('unverified retailer maps but carries publiclyVerified=false, never a fake badge', () => {
  const marker = projectRetailerMarker({
    retailer: verifiedRetailer({ dataStatus: 'AWAITING_VERIFICATION', verifiedAt: null }),
    asOf: NOW,
  });
  assert.equal(marker.publiclyVerified, false);
  assert.equal(marker.dataStatus, 'AWAITING_VERIFICATION');
});

test('missing claims render as ABSENT keys (UNKNOWN), never as defaults', () => {
  const marker = projectRetailerMarker({ retailer: verifiedRetailer(), claims: [], asOf: NOW });
  assert.deepEqual(marker.claims, {});
  assert.ok(!('operating_status' in marker.claims), 'no eligible claim => no operating_status key => UI must show unknown');
});

test('strongest claim per type wins; weaker duplicates do not overwrite', () => {
  const marker = projectRetailerMarker({
    retailer: verifiedRetailer(),
    geoEntity: { id: 'g1', lat: 38.9, lng: -77.04, verification: 'VERIFIED' },
    claims: [
      eligibleClaim({ claimValue: 'open', verification: 'VERIFIED' }),
      eligibleClaim({ claimValue: 'closed', verification: 'SUPPORTED' }),
    ],
    asOf: NOW,
  });
  assert.equal(marker.claims.operating_status.value, 'open');
  assert.equal(marker.claims.operating_status.verification, 'VERIFIED');
});

// ---------------------------------------------------------------------------
// projectMarkers — set-level accounting
// ---------------------------------------------------------------------------

test('set projection drops unmappable retailers and counts them honestly', () => {
  const result = projectMarkers({
    retailers: [
      verifiedRetailer({ id: 'ok' }),
      verifiedRetailer({ id: 'null-island', lat: 0, lng: 0 }),
    ],
    asOf: NOW,
  });
  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.mapped, 1);
  assert.equal(result.stats.unmappable, 1);
  assert.equal(result.markers[0].retailerId, 'ok');
});

test('set projection reports canonicalization progress', () => {
  const geoEntities = new Map([['a', { id: 'g-a', lat: 38.9, lng: -77.0, verification: 'VERIFIED' }]]);
  const result = projectMarkers({
    retailers: [verifiedRetailer({ id: 'a' }), verifiedRetailer({ id: 'b' })],
    geoEntitiesByRetailerId: geoEntities,
    asOf: NOW,
  });
  assert.equal(result.stats.canonicalCoordinates, 1);
});
