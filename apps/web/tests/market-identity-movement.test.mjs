import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildOfficialRetailerIdentityCandidate,
  compareOfficialRetailerIdentityCaptures,
} from '../src/lib/reality/market-identity-admission.mjs';
import { resolveAbcaEntity } from '../src/lib/reality/entity-resolution.mjs';

function officialRecord(overrides = {}) {
  return {
    ABCA_NUMBER: 'ABCA-117361',
    FACILITY_NAME: 'Takoma Wellness Center',
    ADDRESS: '6925 Blair Road NW, Washington, DC 20012',
    LATITUDE: 38.97495088,
    LONGITDUE: -77.02047814,
    GLOBALID: '{TAKOMA-117361}',
    geometry: { x: -77.02047814, y: 38.97495088 },
    ...overrides,
  };
}

function candidate(record, observedAt = '2026-08-22T20:00:00.000Z') {
  return buildOfficialRetailerIdentityCandidate({
    record,
    fetchedAt: new Date(observedAt),
  });
}

test('two unchanged official captures retain an exact, public-ineligible pending identity', () => {
  const captureA = candidate(officialRecord());
  const captureB = candidate(officialRecord({
    ADDRESS: '  6925 BLAIR ROAD nw, washington, dc 20012  ',
  }), '2026-08-23T20:00:00.000Z');
  const comparison = compareOfficialRetailerIdentityCaptures({ captureA, captureB });

  assert.equal(comparison.status, 'UNCHANGED');
  assert.equal(comparison.location.state, 'KNOWN');
  assert.deepEqual(comparison.changed_fields, []);
  assert.equal(captureA.retailer.address, '6925 Blair Road NW, Washington, DC 20012');
  assert.equal(captureB.geo.verification, 'UNKNOWN');

  const resolution = resolveAbcaEntity({
    record: officialRecord(),
    retailers: [{
      id: 'takoma',
      licenseNumber: captureA.license_number,
      address: captureA.retailer.address,
      lat: captureA.geo.lat,
      lng: captureA.geo.lng,
    }],
  });
  assert.equal(resolution.status, 'EXACT_MATCH');
  assert.equal(resolution.method, 'EXACT_LICENSE');
});

test('an incomplete persisted location baseline is quarantined instead of assumed unchanged', () => {
  const resolution = resolveAbcaEntity({
    record: officialRecord(),
    retailers: [{
      id: 'takoma',
      licenseNumber: 'ABCA-117361',
      address: '',
      lat: null,
      lng: null,
    }],
  });

  assert.equal(resolution.status, 'REVIEW_REQUIRED');
  assert.equal(resolution.method, 'EXACT_LICENSE_LOCATION_UNVERIFIABLE');
  assert.equal(resolution.location.state, 'UNKNOWN');
  assert.equal(resolution.public_eligible, false);
});

test('same-license moved capture is quarantined with UNKNOWN public location and preserved comparison evidence', () => {
  const captureA = candidate(officialRecord());
  const moved = officialRecord({
    ADDRESS: '1500 East Capitol Street NE, Washington, DC 20003',
    LATITUDE: 38.8899,
    LONGITDUE: -76.9824,
    geometry: { x: -76.9824, y: 38.8899 },
  });
  const captureB = candidate(moved, '2026-08-23T20:00:00.000Z');
  const comparison = compareOfficialRetailerIdentityCaptures({ captureA, captureB });

  assert.equal(comparison.status, 'REVIEW_REQUIRED');
  assert.equal(comparison.location.state, 'UNKNOWN');
  assert.equal(comparison.location.public_eligible, false);
  assert.deepEqual(comparison.changed_fields, ['address', 'coordinates']);
  assert.equal(comparison.previous.address, captureA.retailer.address);
  assert.equal(comparison.current.address, captureB.retailer.address);
  assert.equal(captureA.geo.lat, 38.97495088);

  const resolution = resolveAbcaEntity({
    record: moved,
    retailers: [{
      id: 'takoma',
      licenseNumber: captureA.license_number,
      address: captureA.retailer.address,
      lat: captureA.geo.lat,
      lng: captureA.geo.lng,
    }],
  });
  assert.equal(resolution.status, 'REVIEW_REQUIRED');
  assert.equal(resolution.method, 'EXACT_LICENSE_LOCATION_CHANGED');
  assert.equal(resolution.location.state, 'UNKNOWN');
  assert.equal(resolution.public_eligible, false);
  assert.deepEqual(resolution.changed_fields, ['address', 'coordinates']);
});

test('changed-license reissue is a separate unmatched identity, never a same-license movement decision', () => {
  const captureA = candidate(officialRecord());
  const reissued = officialRecord({ ABCA_NUMBER: 'ABCA-117362' });
  const captureB = candidate(reissued, '2026-08-23T20:00:00.000Z');
  const comparison = compareOfficialRetailerIdentityCaptures({ captureA, captureB });

  assert.equal(comparison.status, 'REISSUED_LICENSE');
  assert.equal(comparison.location.state, 'UNKNOWN');
  assert.equal(comparison.location.public_eligible, false);
  assert.equal(resolveAbcaEntity({
    record: reissued,
    retailers: [{ id: 'takoma', licenseNumber: captureA.license_number }],
  }).status, 'UNMATCHED');
});

test('missing, invalid, and conflicting coordinates cannot auto-resolve an existing located identity', () => {
  const captureA = candidate(officialRecord());
  const existing = [{
    id: 'takoma',
    licenseNumber: captureA.license_number,
    address: captureA.retailer.address,
    lat: captureA.geo.lat,
    lng: captureA.geo.lng,
  }];
  for (const record of [
    officialRecord({ LATITUDE: '', LONGITDUE: '', geometry: null }),
    officialRecord({ LATITUDE: 'not-a-number', geometry: null }),
    officialRecord({ geometry: { x: -77.02047814, y: 38.9 } }),
  ]) {
    const resolution = resolveAbcaEntity({ record, retailers: existing });
    assert.equal(resolution.status, 'REVIEW_REQUIRED');
    assert.equal(resolution.method, 'EXACT_LICENSE_LOCATION_UNVERIFIABLE');
    assert.equal(resolution.location.state, 'UNKNOWN');
    assert.equal(resolution.public_eligible, false);
  }
});
