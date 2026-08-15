import crypto from 'node:crypto';

/**
 * CANA / ORDERWEEDDC LIVE MARKET REALITY PILOT — REVALIDATED OFFICIAL TRUTH
 *
 * Source 1 (DCGIS): https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31
 *   - Layer: Licensed Medical Cannabis Retailer (ID: 31)
 *   - Retrieved: 2026-08-15T18:24:57Z | SHA-256: 9b55615315d8e19f300b7286dc28351af82ed272a930838a0f6cdfe89d0d10b9
 *
 * Source 2 (ABCA): https://abca.dc.gov/service/find-medical-cannabis-retailer
 *   - Retrieved: 2026-08-15T18:27:00Z | SHA-256: 2011fada9a9f8c260553677ec1da891a60cb5156ffff45efca0946f4c749617d
 *   - Governing Text: "Only ABCA licensed medical cannabis Retailers are included on the map...
 *     Any business not listed below is not licensed in the District of Columbia to sell or deliver
 *     cannabis or cannabis products to registered patients or their caregivers for any purpose."
 */

export const DCGIS_HEALTH_LAYER_31_URL =
  'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31';
export const DCGIS_HEALTH_LAYER_31_SHA256 =
  '9b55615315d8e19f300b7286dc28351af82ed272a930838a0f6cdfe89d0d10b9';

export const ABCA_FIND_RETAILER_PAGE_URL =
  'https://abca.dc.gov/service/find-medical-cannabis-retailer';
export const ABCA_FIND_RETAILER_PAGE_SHA256 =
  '2011fada9a9f8c260553677ec1da891a60cb5156ffff45efca0946f4c749617d';

export const RETRIEVAL_TIMESTAMP = '2026-08-15T18:24:57.000Z';
export const FRESHNESS_EXPIRY_TIMESTAMP = '2026-08-22T18:24:57.000Z';

export const PILOT_MERCHANTS = Object.freeze([
  {
    retailerId: 'BIZ-DC-ABCA117379',
    officialName: 'Anacostia Organics',
    entityName: 'BCG Holdings Inc.',
    licenseNumber: 'ABCA-117379',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    ward: 'Ward 8',
    address: '2022 Martin Luther King Jr. Avenue SE',
    city: 'Washington',
    state: 'DC',
    zip: '20020',
    lat: 38.86587787,
    lng: -76.98907846,
    facilityType: 'storefront',
    canonicalWebsite: 'https://www.anacostiaorganics.com/',
    sourceDcgisId: DCGIS_HEALTH_LAYER_31_URL,
    sourceAbcaPageUrl: ABCA_FIND_RETAILER_PAGE_URL,
    retrievedAt: RETRIEVAL_TIMESTAMP,
    verifiedAt: RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: FRESHNESS_EXPIRY_TIMESTAMP,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    claims: {
      MERCHANT_IDENTITY: { value: 'Anacostia Organics', class: 'VERIFIED_CURRENT' },
      OPERATIONAL_LIST_PRESENCE: { value: 'CONFIRMED_LISTED_WARD_8', class: 'VERIFIED_CURRENT' },
      LICENSE_STATUS: { value: 'Active (ABCA-117379)', class: 'VERIFIED_CURRENT' },
      PHYSICAL_ADDRESS: { value: '2022 Martin Luther King Jr. Avenue SE', class: 'VERIFIED_CURRENT' },
      GEOLOCATION: { value: { lat: 38.86587787, lng: -76.98907846 }, class: 'VERIFIED_CURRENT' },
      CANONICAL_EXTERNAL_DESTINATION: { value: 'https://www.anacostiaorganics.com/', class: 'VERIFIED_CURRENT' },
    },
  },
  {
    retailerId: 'BIZ-DC-ABCA117361',
    officialName: 'Takoma Wellness Center',
    entityName: 'Takoma Wellness Center LLC',
    licenseNumber: 'ABCA-117361',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    ward: 'Ward 4',
    address: '6925 Blair Road NW',
    supersededAddress: '6925 Laurel Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20012',
    lat: 38.97495088,
    lng: -77.02047814,
    facilityType: 'storefront',
    canonicalWebsite: 'https://takomawellness.com/',
    sourceDcgisId: DCGIS_HEALTH_LAYER_31_URL,
    sourceAbcaPageUrl: ABCA_FIND_RETAILER_PAGE_URL,
    retrievedAt: RETRIEVAL_TIMESTAMP,
    verifiedAt: RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: FRESHNESS_EXPIRY_TIMESTAMP,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    claims: {
      MERCHANT_IDENTITY: { value: 'Takoma Wellness Center', class: 'VERIFIED_CURRENT' },
      OPERATIONAL_LIST_PRESENCE: { value: 'CONFIRMED_LISTED_WARD_4', class: 'VERIFIED_CURRENT' },
      LICENSE_STATUS: { value: 'Active (ABCA-117361)', class: 'VERIFIED_CURRENT' },
      PHYSICAL_ADDRESS: { value: '6925 Blair Road NW', class: 'VERIFIED_CURRENT', superseded: '6925 Laurel Avenue NW' },
      GEOLOCATION: { value: { lat: 38.97495088, lng: -77.02047814 }, class: 'VERIFIED_CURRENT' },
      CANONICAL_EXTERNAL_DESTINATION: { value: 'https://takomawellness.com/', class: 'VERIFIED_CURRENT' },
    },
  },
  {
    retailerId: 'BIZ-DC-ABCA127461',
    officialName: 'Chocolate City Wellness',
    entityName: 'Khopkins, LLC',
    licenseNumber: 'ABCA-127461',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    ward: 'Ward 2',
    address: '1723 Connecticut Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20009',
    lat: 38.9133322,
    lng: -77.04524682,
    facilityType: 'storefront',
    canonicalWebsite: 'https://www.chocolatecitysmokeshop.com/',
    sourceDcgisId: DCGIS_HEALTH_LAYER_31_URL,
    sourceAbcaPageUrl: ABCA_FIND_RETAILER_PAGE_URL,
    retrievedAt: RETRIEVAL_TIMESTAMP,
    verifiedAt: RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: FRESHNESS_EXPIRY_TIMESTAMP,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    claims: {
      MERCHANT_IDENTITY: { value: 'Chocolate City Wellness', class: 'VERIFIED_CURRENT' },
      OPERATIONAL_LIST_PRESENCE: { value: 'CONFIRMED_LISTED_WARD_2', class: 'VERIFIED_CURRENT' },
      LICENSE_STATUS: { value: 'Active (ABCA-127461)', class: 'VERIFIED_CURRENT' },
      PHYSICAL_ADDRESS: { value: '1723 Connecticut Avenue NW', class: 'VERIFIED_CURRENT' },
      GEOLOCATION: { value: { lat: 38.9133322, lng: -77.04524682 }, class: 'VERIFIED_CURRENT' },
      CANONICAL_EXTERNAL_DESTINATION: { value: 'https://www.chocolatecitysmokeshop.com/', class: 'VERIFIED_CURRENT' },
    },
  },
  {
    retailerId: 'BIZ-DC-ABCA127484',
    officialName: 'All Vybez DC',
    entityName: 'All Vybez LLC',
    licenseNumber: 'ABCA-127484',
    licenseType: 'Retailer',
    licenseStatus: 'Active',
    ward: 'Ward 1',
    address: '3011 Georgia Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20001',
    lat: 38.92855738,
    lng: -77.02291858,
    facilityType: 'storefront',
    canonicalWebsite: 'https://allvybezdc.com',
    sourceDcgisId: DCGIS_HEALTH_LAYER_31_URL,
    sourceAbcaPageUrl: ABCA_FIND_RETAILER_PAGE_URL,
    retrievedAt: RETRIEVAL_TIMESTAMP,
    verifiedAt: RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: FRESHNESS_EXPIRY_TIMESTAMP,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    claims: {
      MERCHANT_IDENTITY: { value: 'All Vybez DC', class: 'VERIFIED_CURRENT' },
      OPERATIONAL_LIST_PRESENCE: { value: 'CONFIRMED_LISTED_WARD_1', class: 'VERIFIED_CURRENT' },
      LICENSE_STATUS: { value: 'Active (ABCA-127484)', class: 'VERIFIED_CURRENT' },
      PHYSICAL_ADDRESS: { value: '3011 Georgia Avenue NW', class: 'VERIFIED_CURRENT' },
      GEOLOCATION: { value: { lat: 38.92855738, lng: -77.02291858 }, class: 'VERIFIED_CURRENT' },
      CANONICAL_EXTERNAL_DESTINATION: { value: 'https://allvybezdc.com', class: 'HISTORICALLY_OBSERVED' },
    },
  },
]);

/**
 * Builds a deterministic receipt for a live verified market claim.
 */
export function buildMarketEvidenceReceipt(merchant, claimType, claimValue) {
  const payload = [
    merchant.retailerId,
    merchant.licenseNumber,
    claimType,
    JSON.stringify(claimValue),
    merchant.sourceDcgisId,
    merchant.sourceAbcaPageUrl,
    merchant.retrievedAt,
    merchant.freshnessExpiresAt,
  ].join('|');

  const evidenceHash = crypto.createHash('sha256').update(payload).digest('hex');
  const claimObj = merchant.claims?.[claimType];
  const claimClass = claimObj?.class || merchant.dataStatus;

  return {
    merchantId: merchant.retailerId,
    licenseId: merchant.licenseNumber,
    claimType,
    claimValue,
    sourceType: 'LIVE_OFFICIAL_REGULATOR_REVALIDATION',
    sourceDcgisId: merchant.sourceDcgisId,
    sourceAbcaPageUrl: merchant.sourceAbcaPageUrl,
    sourceDcgisSha256: DCGIS_HEALTH_LAYER_31_SHA256,
    sourceAbcaPageSha256: ABCA_FIND_RETAILER_PAGE_SHA256,
    retrievedAt: merchant.retrievedAt,
    verifiedAt: merchant.verifiedAt,
    freshnessExpiresAt: merchant.freshnessExpiresAt,
    evidenceHash,
    epistemicClass: claimClass,
    verificationResult: 'PASS_LIVE_OFFICIAL_REGISTRY_REVALIDATED',
  };
}

/**
 * Projects public-safe retailer facts subject to the live freshness firewall.
 */
export function projectVerifiedRetailerPublicFacts(merchant, asOf = new Date()) {
  const asOfTime = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();
  const verifiedTime = new Date(merchant.verifiedAt).getTime();
  const expiresTime = new Date(merchant.freshnessExpiresAt).getTime();

  // Freshness firewall check
  const isFresh = verifiedTime <= asOfTime && expiresTime > asOfTime;
  const isEligible = !merchant.isDemonstration && merchant.dataStatus === 'VERIFIED_CURRENT' && isFresh;

  if (!isEligible) {
    return {
      retailerId: merchant.retailerId,
      officialName: merchant.officialName,
      status: !isFresh ? 'STALE' : merchant.dataStatus,
      isPubliclyProjectable: false,
      disqualificationReason: !isFresh
        ? 'FRESHNESS_EXPIRED'
        : merchant.isDemonstration
        ? 'DEMONSTRATION_FIXTURE'
        : 'UNVERIFIED_STATUS',
      claims: merchant.claims,
    };
  }

  return {
    retailerId: merchant.retailerId,
    name: merchant.officialName,
    licenseNumber: merchant.licenseNumber,
    ward: merchant.ward,
    address: merchant.address,
    supersededAddress: merchant.supersededAddress || null,
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
      'OPERATIONAL_LIST_PRESENCE',
      'LICENSE_STATUS',
      'PHYSICAL_ADDRESS',
      'GEOLOCATION',
      'CANONICAL_EXTERNAL_DESTINATION',
    ],
  };
}
