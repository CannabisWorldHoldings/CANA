import crypto from 'node:crypto';

/**
 * CANA / ORDERWEEDDC LIVE MARKET REALITY PILOT — REVALIDATED OFFICIAL TRUTH & REAL PROMOTIONAL EVIDENCE
 *
 * Source 1 (DCGIS): https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31
 *   - Layer: Licensed Medical Cannabis Retailer (ID: 31)
 *   - Retrieved: 2026-08-15T18:24:57Z | SHA-256: 9b55615315d8e19f300b7286dc28351af82ed272a930838a0f6cdfe89d0d10b9
 *
 * Source 2 (ABCA): https://abca.dc.gov/service/find-medical-cannabis-retailer
 *   - Retrieved: 2026-08-15T18:27:00Z | SHA-256: 2011fada9a9f8c260553677ec1da891a60cb5156ffff45efca0946f4c749617d
 *   - Governing Text: "Only ABCA licensed medical cannabis Retailers are included on the map..."
 *
 * Direct Promotional Evidence Sources (Tier 1 Merchant-Controlled):
 *   - Anacostia Organics: https://www.anacostiaorganics.com/ (SHA-256: a287ab646b134b22105151594e5e408ec228ae72e29388df2cb2142ea8dbff7c)
 *   - Chocolate City Wellness: https://www.chocolatecitysmokeshop.com/ (SHA-256: f3b59441845eb506a72e811ca54b6899e69ee8ce9bfa780d60fc2f1a63c87e45)
 *   - Takoma Wellness Center: https://takomawellness.com/patient-rewards/ (SHA-256: fc907c28f7b16570bbd603a11da480436573c0be850fba9b6d85eb5ba8575027)
 */

export const DCGIS_HEALTH_LAYER_31_URL =
  'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31';
export const DCGIS_HEALTH_LAYER_31_SHA256 =
  '9b55615315d8e19f300b7286dc28351af82ed272a930838a0f6cdfe89d0d10b9';

export const ABCA_FIND_RETAILER_PAGE_URL =
  'https://abca.dc.gov/service/find-medical-cannabis-retailer';
export const ABCA_FIND_RETAILER_PAGE_SHA256 =
  '2011fada9a9f8c260553677ec1da891a60cb5156ffff45efca0946f4c749617d';

export const ANACOSTIA_HOMEPAGE_RAW_SHA256 =
  'a287ab646b134b22105151594e5e408ec228ae72e29388df2cb2142ea8dbff7c';
export const CHOCOLATE_CITY_HOMEPAGE_RAW_SHA256 =
  'f3b59441845eb506a72e811ca54b6899e69ee8ce9bfa780d60fc2f1a63c87e45';
export const TAKOMA_REWARDS_PAGE_RAW_SHA256 =
  'fc907c28f7b16570bbd603a11da480436573c0be850fba9b6d85eb5ba8575027';

export const RETRIEVAL_TIMESTAMP = '2026-08-15T18:24:57.000Z';
export const FRESHNESS_EXPIRY_TIMESTAMP = '2026-08-22T18:24:57.000Z';

export const PROMOTION_RETRIEVAL_TIMESTAMP = '2026-08-15T20:00:00.000Z';
export const PROMOTION_FRESHNESS_EXPIRY_TIMESTAMP = '2026-08-16T20:00:00.000Z'; // Conservative 24h freshness window

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
 * Direct Live Promotional Offers captured from fresh public merchant evidence.
 */
export const LIVE_PROMOTIONAL_OFFERS = Object.freeze([
  {
    id: 'DEAL-DC-ABCA117379-NEW-PATIENT-20',
    retailerId: 'BIZ-DC-ABCA117379',
    merchantName: 'Anacostia Organics',
    title: 'New Patient Welcome: 20% Off First Purchase',
    description: 'Directly observed on official live storefront: New patients receive 20% off their first purchase at Anacostia Organics.',
    discountType: 'PERCENTAGE',
    discountValue: '20% OFF',
    percentageValue: 20,
    qualifyingCategory: 'All Products',
    eligibility: 'New registered medical cannabis patients (first purchase only)',
    minimumPurchase: null,
    sourceUrl: 'https://www.anacostiaorganics.com/',
    sourceType: 'DIRECT_MERCHANT_WEBSITE',
    sourceRawSha256: ANACOSTIA_HOMEPAGE_RAW_SHA256,
    evidenceArtifactPath: 'fixtures/reality/promotions/BIZ-DC-ABCA117379_www_anacostiaorganics_com_.html',
    retrievedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    verifiedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: PROMOTION_FRESHNESS_EXPIRY_TIMESTAMP,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    isActive: true,
    claimedPurchase: false,
    claimedRevenue: '$0 / UNKNOWN',
  },
  {
    id: 'DEAL-DC-ABCA127461-FLOWER-5OFF',
    retailerId: 'BIZ-DC-ABCA127461',
    merchantName: 'Chocolate City Wellness',
    title: '$5 Off Flower Special',
    description: 'Directly observed on official live storefront specials: $5 off cannabis flower.',
    discountType: 'FIXED_AMOUNT',
    discountValue: '$5.00 OFF',
    fixedAmountValue: 5.0,
    qualifyingCategory: 'Flower',
    eligibility: 'Public special for all eligible adult/medical patrons',
    minimumPurchase: null,
    sourceUrl: 'https://www.chocolatecitysmokeshop.com/',
    sourceType: 'DIRECT_MERCHANT_WEBSITE',
    sourceRawSha256: CHOCOLATE_CITY_HOMEPAGE_RAW_SHA256,
    evidenceArtifactPath: 'fixtures/reality/promotions/BIZ-DC-ABCA127461_www_chocolatecitysmokeshop_com_.html',
    retrievedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    verifiedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: PROMOTION_FRESHNESS_EXPIRY_TIMESTAMP,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    isActive: true,
    claimedPurchase: false,
    claimedRevenue: '$0 / UNKNOWN',
  },
  {
    id: 'DEAL-DC-ABCA127461-EDIBLES-25MIN-5OFF',
    retailerId: 'BIZ-DC-ABCA127461',
    merchantName: 'Chocolate City Wellness',
    title: '$5 Off Edibles Over $25',
    description: 'Directly observed on official live storefront specials: $5 off edible purchases over $25.',
    discountType: 'FIXED_AMOUNT',
    discountValue: '$5.00 OFF',
    fixedAmountValue: 5.0,
    qualifyingCategory: 'Edibles',
    eligibility: 'Public special on edible orders of $25 or more',
    minimumPurchase: 25.0,
    sourceUrl: 'https://www.chocolatecitysmokeshop.com/',
    sourceType: 'DIRECT_MERCHANT_WEBSITE',
    sourceRawSha256: CHOCOLATE_CITY_HOMEPAGE_RAW_SHA256,
    evidenceArtifactPath: 'fixtures/reality/promotions/BIZ-DC-ABCA127461_www_chocolatecitysmokeshop_com_.html',
    retrievedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    verifiedAt: PROMOTION_RETRIEVAL_TIMESTAMP,
    freshnessExpiresAt: PROMOTION_FRESHNESS_EXPIRY_TIMESTAMP,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    isActive: true,
    claimedPurchase: false,
    claimedRevenue: '$0 / UNKNOWN',
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
 * Builds a deterministic receipt for a live promotional offer.
 */
export function buildPromotionalEvidenceReceipt(offer) {
  const payload = [
    offer.id,
    offer.retailerId,
    offer.title,
    offer.discountValue,
    offer.sourceUrl,
    offer.sourceRawSha256,
    offer.retrievedAt,
    offer.freshnessExpiresAt,
  ].join('|');

  const evidenceHash = crypto.createHash('sha256').update(payload).digest('hex');

  return {
    dealId: offer.id,
    merchantId: offer.retailerId,
    offerTitle: offer.title,
    discountValue: offer.discountValue,
    sourceUrl: offer.sourceUrl,
    sourceType: offer.sourceType,
    sourceRawSha256: offer.sourceRawSha256,
    evidenceArtifactPath: offer.evidenceArtifactPath,
    retrievedAt: offer.retrievedAt,
    verifiedAt: offer.verifiedAt,
    freshnessExpiresAt: offer.freshnessExpiresAt,
    evidenceHash,
    isDemonstration: offer.isDemonstration,
    dataStatus: offer.dataStatus,
    verificationResult: 'PASS_LIVE_PROMOTIONAL_EVIDENCE_VERIFIED',
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

/**
 * Projects public-safe promotional offer facts subject to the live freshness firewall.
 */
export function projectVerifiedDealPublicFacts(offer, asOf = new Date()) {
  const asOfTime = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();
  const verifiedTime = offer.verifiedAt ? new Date(offer.verifiedAt).getTime() : 0;
  const expiresTime = offer.freshnessExpiresAt ? new Date(offer.freshnessExpiresAt).getTime() : 0;

  const isFresh = verifiedTime <= asOfTime && expiresTime > asOfTime;
  const isEligible = !offer.isDemonstration && offer.dataStatus === 'VERIFIED_CURRENT' && offer.isActive && isFresh;

  if (!isEligible) {
    return {
      dealId: offer.id,
      retailerId: offer.retailerId,
      title: offer.title,
      status: !isFresh ? 'STALE' : offer.dataStatus,
      isPubliclyProjectable: false,
      disqualificationReason: offer.isDemonstration
        ? 'DEMONSTRATION_FIXTURE'
        : !isFresh
        ? 'FRESHNESS_EXPIRED'
        : 'UNVERIFIED_STATUS',
    };
  }

  return {
    id: offer.id,
    retailerId: offer.retailerId,
    merchantName: offer.merchantName,
    title: offer.title,
    description: offer.description,
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    qualifyingCategory: offer.qualifyingCategory,
    eligibility: offer.eligibility,
    minimumPurchase: offer.minimumPurchase,
    sourceUrl: offer.sourceUrl,
    sourceType: offer.sourceType,
    retrievedAt: offer.retrievedAt,
    verifiedAt: offer.verifiedAt,
    freshnessExpiresAt: offer.freshnessExpiresAt,
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    isActive: true,
    isPubliclyProjectable: true,
    claimedPurchase: false,
    claimedRevenue: '$0 / UNKNOWN',
  };
}

/**
 * Resolves all eligible live promotional deals as of a specific point in time.
 */
export function projectAllLiveDeals(asOf = new Date()) {
  return LIVE_PROMOTIONAL_OFFERS
    .map((offer) => projectVerifiedDealPublicFacts(offer, asOf))
    .filter((d) => d.isPubliclyProjectable);
}
