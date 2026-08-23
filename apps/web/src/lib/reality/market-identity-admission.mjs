import {
  compareOfficialRetailerLocation,
  normalizeAbcaLicense,
  normalizeCoordinates,
} from './entity-resolution.mjs';
import { ABCA_LAYER_URL, ABCA_SOURCE_ID } from './official-source-snapshot.mjs';

export const OFFICIAL_RETAILER_IDENTITY_ADMISSION_VERSION =
  'cana-official-retailer-identity-admission/v1';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sourceText(value, code, maximum) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ')
    : '';
  if (!normalized || normalized.length > maximum) fail(code);
  return normalized;
}

export function buildOfficialRetailerIdentityCandidate({ record, fetchedAt }) {
  const licenseNumber = normalizeAbcaLicense(record?.ABCA_NUMBER);
  if (!licenseNumber) fail('CANA_REALITY_IDENTITY_LICENSE_REQUIRED');
  const name = sourceText(
    record?.FACILITY_NAME || record?.TRADE_NAME,
    'CANA_REALITY_IDENTITY_NAME_REQUIRED',
    200,
  );
  const address = sourceText(
    record?.ADDRESS,
    'CANA_REALITY_IDENTITY_ADDRESS_REQUIRED',
    500,
  );
  const coordinates = normalizeCoordinates(record);
  if (coordinates.state !== 'KNOWN') {
    fail('CANA_REALITY_IDENTITY_COORDINATES_REQUIRED');
  }
  const observedAt = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (!Number.isFinite(observedAt.getTime())) fail('CANA_REALITY_IDENTITY_TIME_INVALID');
  const globalId = typeof record?.GLOBALID === 'string'
    ? record.GLOBALID.normalize('NFKC').trim().toUpperCase()
    : '';
  const aliases = [
    Object.freeze({ namespace: 'dc_abca_license', externalId: licenseNumber }),
    ...(globalId
      ? [Object.freeze({ namespace: 'dcgis_globalid', externalId: globalId })]
      : []),
  ];

  return Object.freeze({
    schema_version: OFFICIAL_RETAILER_IDENTITY_ADMISSION_VERSION,
    license_number: licenseNumber,
    observed_at: observedAt.toISOString(),
    retailer: Object.freeze({
      name,
      type: 'storefront',
      address,
      city: 'Washington',
      state: 'DC',
      zip: null,
      lat: coordinates.lat,
      lng: coordinates.lng,
      phone: null,
      website: null,
      email: null,
      hours: '',
      hoursSource: '',
      isOpen: false,
      licenseStatus: 'PENDING',
      licenseSource: ABCA_SOURCE_ID,
      licenseNumber,
      lastLicenseCheck: null,
      lastInfoCheck: null,
      dataStatus: 'AWAITING_VERIFICATION',
      dataSource: ABCA_SOURCE_ID,
      sourceUrl: ABCA_LAYER_URL,
      retrievedAt: observedAt,
      verifiedAt: null,
      freshnessExpiresAt: null,
      confidence: null,
      reviewedBy: null,
      isDemonstration: false,
    }),
    geo: Object.freeze({
      name,
      lat: coordinates.lat,
      lng: coordinates.lng,
      source: ABCA_SOURCE_ID,
      sourceUrl: ABCA_LAYER_URL,
      observedAt,
      confidence: 1,
      verification: 'UNKNOWN',
    }),
    aliases: Object.freeze(aliases),
  });
}

export function compareOfficialRetailerIdentityCaptures({ captureA, captureB }) {
  const previousLicense = normalizeAbcaLicense(captureA?.license_number);
  const currentLicense = normalizeAbcaLicense(captureB?.license_number);
  if (!previousLicense || !currentLicense) fail('CANA_REALITY_IDENTITY_LICENSE_REQUIRED');
  if (previousLicense !== currentLicense) {
    return Object.freeze({
      status: 'REISSUED_LICENSE',
      reason: 'OFFICIAL_LICENSE_CHANGED',
      previous_license_number: previousLicense,
      current_license_number: currentLicense,
      changed_fields: Object.freeze(['license_number']),
      previous: Object.freeze({ address: captureA.retailer.address, coordinates: captureA.geo }),
      current: Object.freeze({ address: captureB.retailer.address, coordinates: captureB.geo }),
      location: Object.freeze({ state: 'UNKNOWN', public_eligible: false }),
    });
  }
  return compareOfficialRetailerLocation({
    previous: captureA.retailer,
    record: {
      ADDRESS: captureB.retailer.address,
      LATITUDE: captureB.geo.lat,
      LONGITDUE: captureB.geo.lng,
    },
  });
}
