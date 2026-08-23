import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildOfficialRetailerIdentityCandidate,
  OFFICIAL_RETAILER_IDENTITY_ADMISSION_VERSION,
} from '../src/lib/reality/market-identity-admission.mjs';

function officialRecord(overrides = {}) {
  return {
    ABCA_NUMBER: 'ABCA-117361',
    FACILITY_NAME: 'Takoma Wellness Center',
    TRADE_NAME: 'Takoma Wellness Center',
    ADDRESS: '6925 Blair Road NW, Washington, DC 20012',
    LATITUDE: 38.97495088,
    LONGITDUE: -77.02047814,
    GLOBALID: '{TAKOMA-117361}',
    geometry: { x: -77.02047814, y: 38.97495088 },
    ...overrides,
  };
}

test('official identity admission creates only pending, provenance-bound candidate state', () => {
  const candidate = buildOfficialRetailerIdentityCandidate({
    record: officialRecord(),
    fetchedAt: new Date('2026-08-22T20:00:00.000Z'),
  });

  assert.equal(candidate.schema_version, OFFICIAL_RETAILER_IDENTITY_ADMISSION_VERSION);
  assert.equal(candidate.license_number, 'ABCA-117361');
  assert.equal(candidate.retailer.licenseStatus, 'PENDING');
  assert.equal(candidate.retailer.dataStatus, 'AWAITING_VERIFICATION');
  assert.equal(candidate.retailer.verifiedAt, null);
  assert.equal(candidate.retailer.freshnessExpiresAt, null);
  assert.equal(candidate.retailer.confidence, null);
  assert.equal(candidate.retailer.hours, '');
  assert.equal(candidate.retailer.hoursSource, '');
  assert.equal(candidate.retailer.isOpen, false);
  assert.equal(candidate.retailer.isDemonstration, false);
  assert.equal(candidate.geo.verification, 'UNKNOWN');
});

test('official identity admission refuses missing identity, location, or coordinates', () => {
  for (const [overrides, reason] of [
    [{ FACILITY_NAME: '', TRADE_NAME: '' }, 'CANA_REALITY_IDENTITY_NAME_REQUIRED'],
    [{ ADDRESS: '' }, 'CANA_REALITY_IDENTITY_ADDRESS_REQUIRED'],
    [{ LATITUDE: 0 }, 'CANA_REALITY_IDENTITY_COORDINATES_REQUIRED'],
  ]) {
    assert.throws(
      () => buildOfficialRetailerIdentityCandidate({
        record: officialRecord(overrides),
        fetchedAt: new Date('2026-08-22T20:00:00.000Z'),
      }),
      new RegExp(reason),
    );
  }
});
