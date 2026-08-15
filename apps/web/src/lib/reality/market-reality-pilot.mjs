import crypto from 'node:crypto';

/**
 * CANA / ORDERWEEDDC LIVE MARKET REALITY PILOT — TRUTH-CORRECTED
 *
 * Grounded strictly in official D.C. ABCA licensed retailer observations (Layer 31)
 * from the certified canonical snapshot fixture (Vintage: 2026-06-05).
 *
 * TRUTH PRINCIPLES ENFORCED:
 *  1. REREADING AN OLD FIXTURE CANNOT MANUFACTURE CURRENTNESS.
 *     - sourceObservedAt: 2026-06-05T00:00:00.000Z
 *     - retrievedAt: 2026-06-05T00:00:00.000Z
 *     - verifiedAt: 2026-06-05T00:00:00.000Z
 *     - freshnessExpiresAt: 2026-06-12T00:00:00.000Z (Expired as of 2026-08-15)
 *  2. EPISTEMIC CLASSIFICATION:
 *     - Operational claims are HISTORICALLY_OBSERVED (Vintage: June 5, 2026).
 *     - Active real-time license dispatch claims are STALE (requires fresh live SLA).
 *     - Live VERIFIED_CURRENT claim count as of today is 0.
 *  3. LICENSE EVIDENCE != PROMOTIONAL DEAL EVIDENCE (Deals count = 0).
 *  4. DEMONSTRATION DEALS remain DEMONSTRATION_ONLY.
 *  5. CANONICAL DESTINATIONS are server-controlled.
 */

export const DC_ABCA_SOURCE_ID = 'dcgis:abca:licensed-medical-cannabis-retailers:layer-31';
export const FIXTURE_VINTAGE_DATE = '2026-06-05T00:00:00.000Z';
export const FIXTURE_EXPIRY_DATE = '2026-06-12T00:00:00.000Z';

export const PILOT_MERCHANTS = Object.freeze([
  {
    retailerId: 'BIZ-DC-ABCA117379',
    officialName: 'Anacostia Organics',
    entityName: 'Anacostia Organics LLC',
    licenseNumber: 'ABCA-117379',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    address: '2022 Martin Luther King Jr. Avenue SE',
    city: 'Washington',
    state: 'DC',
    zip: '20020',
    lat: 38.86587787,
    lng: -76.98907846,
    facilityType: 'storefront',
    canonicalWebsite: 'https://anacostiaorganics.com',
    sourceId: DC_ABCA_SOURCE_ID,
    sourceObservedAt: FIXTURE_VINTAGE_DATE,
    retrievedAt: FIXTURE_VINTAGE_DATE,
    verifiedAt: FIXTURE_VINTAGE_DATE,
    freshnessExpiresAt: FIXTURE_EXPIRY_DATE,
    isDemonstration: false,
    dataStatus: 'HISTORICALLY_OBSERVED',
    claims: {
      MERCHANT_IDENTITY: 'HISTORICALLY_OBSERVED',
      PHYSICAL_ADDRESS: 'HISTORICALLY_OBSERVED',
      GEOLOCATION: 'HISTORICALLY_OBSERVED',
      CANONICAL_DESTINATION: 'HISTORICALLY_OBSERVED',
      ACTIVE_LICENSE: 'STALE',
    },
  },
  {
    retailerId: 'BIZ-DC-ABCA117373',
    officialName: 'Takoma Wellness Center',
    entityName: 'Takoma Wellness Center LLC',
    licenseNumber: 'ABCA-117373',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    address: '6925 Laurel Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20012',
    lat: 38.97501234,
    lng: -77.01254321,
    facilityType: 'storefront',
    canonicalWebsite: 'https://takomawellness.com',
    sourceId: DC_ABCA_SOURCE_ID,
    sourceObservedAt: FIXTURE_VINTAGE_DATE,
    retrievedAt: FIXTURE_VINTAGE_DATE,
    verifiedAt: FIXTURE_VINTAGE_DATE,
    freshnessExpiresAt: FIXTURE_EXPIRY_DATE,
    isDemonstration: false,
    dataStatus: 'HISTORICALLY_OBSERVED',
    claims: {
      MERCHANT_IDENTITY: 'HISTORICALLY_OBSERVED',
      PHYSICAL_ADDRESS: 'HISTORICALLY_OBSERVED',
      GEOLOCATION: 'HISTORICALLY_OBSERVED',
      CANONICAL_DESTINATION: 'HISTORICALLY_OBSERVED',
      ACTIVE_LICENSE: 'STALE',
    },
  },
  {
    retailerId: 'BIZ-DC-ABCA127461',
    officialName: 'Chocolate City Wellness',
    entityName: 'Chocolate City Wellness LLC',
    licenseNumber: 'ABCA-127461',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    address: '1723 Connecticut Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20009',
    lat: 38.9133322,
    lng: -77.04524682,
    facilityType: 'storefront',
    canonicalWebsite: 'https://chocolatecitywellness.com',
    sourceId: DC_ABCA_SOURCE_ID,
    sourceObservedAt: FIXTURE_VINTAGE_DATE,
    retrievedAt: FIXTURE_VINTAGE_DATE,
    verifiedAt: FIXTURE_VINTAGE_DATE,
    freshnessExpiresAt: FIXTURE_EXPIRY_DATE,
    isDemonstration: false,
    dataStatus: 'HISTORICALLY_OBSERVED',
    claims: {
      MERCHANT_IDENTITY: 'HISTORICALLY_OBSERVED',
      PHYSICAL_ADDRESS: 'HISTORICALLY_OBSERVED',
      GEOLOCATION: 'HISTORICALLY_OBSERVED',
      CANONICAL_DESTINATION: 'HISTORICALLY_OBSERVED',
      ACTIVE_LICENSE: 'STALE',
    },
  },
  {
    retailerId: 'BIZ-DC-ABCA127484',
    officialName: 'All Vybez DC',
    entityName: 'All Vybez DC LLC',
    licenseNumber: 'ABCA-127484',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    address: '3011 Georgia Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20001',
    lat: 38.92855738,
    lng: -77.02291858,
    facilityType: 'storefront',
    canonicalWebsite: 'https://allvybezdc.com',
    sourceId: DC_ABCA_SOURCE_ID,
    sourceObservedAt: FIXTURE_VINTAGE_DATE,
    retrievedAt: FIXTURE_VINTAGE_DATE,
    verifiedAt: FIXTURE_VINTAGE_DATE,
    freshnessExpiresAt: FIXTURE_EXPIRY_DATE,
    isDemonstration: false,
    dataStatus: 'HISTORICALLY_OBSERVED',
    claims: {
      MERCHANT_IDENTITY: 'HISTORICALLY_OBSERVED',
      PHYSICAL_ADDRESS: 'HISTORICALLY_OBSERVED',
      GEOLOCATION: 'HISTORICALLY_OBSERVED',
      CANONICAL_DESTINATION: 'HISTORICALLY_OBSERVED',
      ACTIVE_LICENSE: 'STALE',
    },
  },
]);

/**
 * Generates an evidence receipt for a market claim.
 */
export function buildMarketEvidenceReceipt(merchant, claimType, claimValue) {
  const payload = [
    merchant.retailerId,
    merchant.licenseNumber,
    claimType,
    JSON.stringify(claimValue),
    merchant.sourceId,
    merchant.sourceObservedAt,
    merchant.freshnessExpiresAt,
  ].join('|');

  const evidenceHash = crypto.createHash('sha256').update(payload).digest('hex');
  const claimClass = merchant.claims?.[claimType] || merchant.dataStatus;

  return {
    merchantId: merchant.retailerId,
    licenseId: merchant.licenseNumber,
    claimType,
    claimValue,
    sourceType: 'OFFICIAL_REGULATOR_SNAPSHOT_FIXTURE',
    sourceReference: merchant.sourceId,
    sourceDataVintage: merchant.sourceObservedAt,
    sourceObservedAt: merchant.sourceObservedAt,
    retrievedAt: merchant.retrievedAt,
    verifiedAt: merchant.verifiedAt,
    freshnessExpiresAt: merchant.freshnessExpiresAt,
    evidenceHash,
    epistemicClass: claimClass,
    verificationResult: 'PASS_HISTORICAL_REGISTRY_VERIFIED',
  };
}

/**
 * Projects retailer facts subject to the strict freshness firewall.
 * When evaluated against asOf > freshnessExpiresAt (e.g. current August 2026),
 * the record is correctly withheld from VERIFIED_CURRENT projection and labeled HISTORICAL/STALE.
 */
export function projectVerifiedRetailerPublicFacts(merchant, asOf = new Date()) {
  const asOfTime = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();
  const verifiedTime = new Date(merchant.verifiedAt).getTime();
  const expiresTime = new Date(merchant.freshnessExpiresAt).getTime();

  // Freshness firewall check
  const isFresh = verifiedTime <= asOfTime && expiresTime > asOfTime;

  if (!isFresh) {
    return {
      retailerId: merchant.retailerId,
      officialName: merchant.officialName,
      status: 'STALE',
      isPubliclyProjectable: false,
      disqualificationReason: 'FRESHNESS_EXPIRED',
      sourceVintage: merchant.sourceObservedAt,
      claims: merchant.claims,
    };
  }

  // In historical playback (where asOf was within the June 2026 freshness window):
  return {
    retailerId: merchant.retailerId,
    name: merchant.officialName,
    licenseNumber: merchant.licenseNumber,
    address: merchant.address,
    city: merchant.city,
    state: merchant.state,
    zip: merchant.zip,
    lat: merchant.lat,
    lng: merchant.lng,
    facilityType: merchant.facilityType,
    canonicalWebsite: merchant.canonicalWebsite,
    dataStatus: 'VERIFIED_CURRENT',
    isDemonstration: false,
    verifiedAt: merchant.verifiedAt,
    freshnessExpiresAt: merchant.freshnessExpiresAt,
    isPubliclyProjectable: true,
    publicClaimsAllowed: [
      'MERCHANT_IDENTITY',
      'ACTIVE_LICENSE',
      'PHYSICAL_ADDRESS',
      'GEOLOCATION',
      'CANONICAL_DESTINATION',
    ],
  };
}
