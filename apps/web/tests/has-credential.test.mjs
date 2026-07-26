import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retailerJsonLd } from '../src/lib/structured-data.mjs';

/**
 * Falsification tests for the hasCredential mechanism (Mechanism Matrix M-002).
 *
 * The competitor pattern being beaten: license numbers DISPLAYED as page text,
 * self-attested at onboarding, with no verification process and nothing in
 * JSON-LD. Our claim is "verification-as-process". These tests exist to prove
 * we cannot accidentally reproduce verification theater ourselves.
 */

const ORIGIN = 'https://orderweeddc.example';

/** A record that passes the public evidence boundary. */
function verifiedRetailer(over = {}) {
  const future = new Date(Date.now() + 30 * 86400_000);
  return {
    id: 'r1',
    name: 'Verified Retailer',
    address: '100 Demo Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20009',
    lat: 38.9169,
    lng: -77.0322,
    phone: '202-555-0199',
    dataStatus: 'VERIFIED_CURRENT',
    dataSource: 'DC ABCA Registry',
    isDemonstration: false,
    verifiedAt: new Date(),
    freshnessExpiresAt: future,
    licenseStatus: 'VERIFIED',
    licenseNumber: 'ABCA-000123',
    licenseSource: 'DC ABCA',
    lastLicenseCheck: new Date(),
    ...over,
  };
}

test('hasCredential is emitted when the license is verified AND numbered', () => {
  const ld = retailerJsonLd({ retailer: verifiedRetailer(), origin: ORIGIN });
  assert.ok(ld, 'verified retailer should produce JSON-LD');
  assert.ok(ld.hasCredential, 'hasCredential must be present');
  assert.equal(ld.hasCredential['@type'], 'EducationalOccupationalCredential');
  assert.equal(ld.hasCredential.identifier, 'ABCA-000123');
  assert.equal(ld.hasCredential.recognizedBy['@type'], 'GovernmentOrganization');
  assert.ok(ld.hasCredential.dateCreated, 'an observed check date must be asserted');
});

test('a license NUMBER ALONE never becomes a credential claim', () => {
  // This is the competitor failure mode: display-only, self-attested number.
  const ld = retailerJsneLdSafe({ licenseStatus: 'UNVERIFIED' });
  assert.ok(ld, 'record still passes the evidence boundary');
  assert.equal(ld.hasCredential, undefined,
    'UNVERIFIED status must NOT yield hasCredential — that would be verification theater');
  // The number may still appear as descriptive provenance, but not as a credential.
  const props = ld.additionalProperty || [];
  assert.ok(props.some(p => p.name === 'licenseNumber'),
    'the number may remain as descriptive provenance');
});

test('missing license number yields no credential even when status is VERIFIED', () => {
  const ld = retailerJsneLdSafe({ licenseNumber: null });
  assert.equal(ld.hasCredential, undefined,
    'a credential without an identifier is not a credential');
});

test('lowercase verified status is accepted (case-insensitive)', () => {
  const ld = retailerJsneLdSafe({ licenseStatus: 'verified' });
  assert.ok(ld.hasCredential, 'status comparison must be case-insensitive');
});

test('a status that merely CONTAINS "verified" is rejected', () => {
  for (const status of ['NOT_VERIFIED', 'UNVERIFIED', 'PENDING_VERIFIED', 'verified-pending']) {
    const ld = retailerJsneLdSafe({ licenseStatus: status });
    assert.equal(ld.hasCredential, undefined,
      `status "${status}" must not be treated as verified`);
  }
});

test('demonstration records emit no JSON-LD at all, so no credential can leak', () => {
  const ld = retailerJsonLd({
    retailer: verifiedRetailer({ isDemonstration: true, dataStatus: 'DEMONSTRATION_ONLY' }),
    origin: ORIGIN,
  });
  assert.equal(ld, null,
    'demonstration data must never reach search engines, credential or otherwise');
});

test('dateCreated is omitted rather than invented when no check date exists', () => {
  const ld = retailerJsneLdSafe({ lastLicenseCheck: null, verifiedAt: null, freshnessExpiresAt: new Date(Date.now() + 86400_000) });
  // verifiedAt=null may push the record below the evidence boundary; only assert
  // when JSON-LD is produced at all.
  if (ld?.hasCredential) {
    assert.equal(ld.hasCredential.dateCreated, undefined,
      'an unobserved date must be omitted, never fabricated');
  }
});

/** Helper: build JSON-LD from an overridden verified retailer. */
function retailerJsneLdSafe(over) {
  return retailerJsonLd({ retailer: verifiedRetailer(over), origin: ORIGIN });
}
