const INTERNAL_DESTINATIONS = Object.freeze([
  '/',
  '/deals',
  '/delivery',
  '/dispensaries',
  '/education',
  '/neighborhoods',
  '/products',
  '/search',
]);

const REQUIRED_CAMPAIGN_FIELDS = Object.freeze([
  'id',
  'sponsor',
  'disclosure',
  'headline',
  'supportingText',
  'cta',
  'destination',
  'desktopMedia',
  'mobileMedia',
  'altText',
  'startAt',
  'endAt',
  'audience',
  'locationRelevance',
  'approvalStatus',
  'rightsAndProvenance',
  'policyResult',
  'impressionEvent',
  'clickEvent',
  'frequencyCap',
  'fundingKind',
  'fallbackBehavior',
]);

export const HOUSE_BANNER_CAMPAIGN = Object.freeze({
  id: 'owd-house-delivery-guide-2026-08',
  sponsor: 'ORDERWEEDDC',
  disclosure: 'House campaign',
  headline: 'Delivery starts with your part of D.C.',
  supportingText:
    'Explore source-labeled delivery records, then confirm the service area with the business.',
  cta: 'Explore delivery',
  destination: '/delivery',
  desktopMedia: '/art/hero-dc.webp',
  mobileMedia: '/marketplace/hero-marketplace-v2.webp',
  altText: 'Illustrative view of Washington, D.C. used for a local delivery guide',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2027-08-01T00:00:00.000Z',
  audience: 'Adults exploring D.C. delivery options',
  locationRelevance: 'Washington, D.C.',
  approvalStatus: 'APPROVED_FOR_REVIEW',
  rightsAndProvenance: 'Repository-owned illustrative marketplace artwork',
  policyResult: 'PASS',
  impressionEvent: 'HOUSE_BANNER_VIEW',
  clickEvent: 'HOUSE_BANNER_CLICK',
  frequencyCap: null,
  fundingKind: 'HOUSE',
  fallbackBehavior: 'COLLAPSE',
});

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function internalDestination(destination) {
  return INTERNAL_DESTINATIONS.some(
    (route) =>
      destination === route ||
      (route !== '/' && destination.startsWith(`${route}?`)),
  );
}

export function evaluateBannerCampaign(campaign, asOf) {
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
    return Object.freeze({ eligible: false, reason: 'INVALID_CAMPAIGN' });
  }

  for (const field of REQUIRED_CAMPAIGN_FIELDS) {
    if (!(field in campaign)) {
      return Object.freeze({ eligible: false, reason: `MISSING_${field.toUpperCase()}` });
    }
  }

  const now = validDate(asOf);
  const starts = validDate(campaign.startAt);
  const ends = validDate(campaign.endAt);
  if (!now || !starts || !ends || starts >= ends) {
    return Object.freeze({ eligible: false, reason: 'INVALID_WINDOW' });
  }
  if (now < starts) {
    return Object.freeze({ eligible: false, reason: 'NOT_STARTED' });
  }
  if (now >= ends) {
    return Object.freeze({ eligible: false, reason: 'EXPIRED' });
  }
  if (!['APPROVED', 'APPROVED_FOR_REVIEW'].includes(campaign.approvalStatus)) {
    return Object.freeze({ eligible: false, reason: 'UNAPPROVED' });
  }
  if (campaign.policyResult !== 'PASS') {
    return Object.freeze({ eligible: false, reason: 'POLICY_BLOCKED' });
  }
  if (
    !campaign.desktopMedia ||
    !campaign.mobileMedia ||
    !campaign.altText ||
    !campaign.rightsAndProvenance
  ) {
    return Object.freeze({ eligible: false, reason: 'MEDIA_INCOMPLETE' });
  }
  if (!internalDestination(campaign.destination)) {
    return Object.freeze({ eligible: false, reason: 'DESTINATION_BLOCKED' });
  }
  if (!['HOUSE', 'PAID'].includes(campaign.fundingKind)) {
    return Object.freeze({ eligible: false, reason: 'FUNDING_UNCLEAR' });
  }
  if (campaign.fundingKind === 'PAID' && campaign.disclosure !== 'Sponsored') {
    return Object.freeze({ eligible: false, reason: 'DISCLOSURE_MISSING' });
  }

  return Object.freeze({ eligible: true, reason: 'ELIGIBLE' });
}

/** @typedef {typeof HOUSE_BANNER_CAMPAIGN} BannerCampaign */
/**
 * @param {{ campaigns?: readonly BannerCampaign[], houseCampaign?: BannerCampaign | null, asOf: Date }} input
 * @returns {BannerCampaign | null}
 */
export function selectPrimaryBanner({ campaigns = [], houseCampaign = null, asOf }) {
  for (const campaign of campaigns) {
    if (evaluateBannerCampaign(campaign, asOf).eligible) return campaign;
  }
  if (houseCampaign && evaluateBannerCampaign(houseCampaign, asOf).eligible) {
    return houseCampaign;
  }
  return null;
}

const SHARED_TRUST = Object.freeze([
  'Disclose sponsored placement separately from verification',
  'Show source and freshness only when supported by the record',
  'Never infer availability, licensure, delivery eligibility, price, or outcome',
]);

const SHARED_PROHIBITIONS = Object.freeze([
  'No green or mint section backgrounds',
  'No gradients, glows, decorative divider lines, or card walls',
  'No customer-facing SiteMind, RSI, Hermes, schema, model, or confidence jargon',
  'No direct publishing or deployment',
]);

function pageIntelligence({
  route,
  intent,
  purpose,
  primaryConversion,
  secondaryConversions,
  sections,
  mediaSlots,
  bannerSlots = [],
  seoIntent,
  experimentEligibility,
}) {
  return Object.freeze({
    route,
    audience: 'Adults 21+ exploring the Washington, D.C. cannabis marketplace',
    intent,
    businessPurpose: purpose,
    primaryConversion,
    secondaryConversions: Object.freeze(secondaryConversions),
    sections: Object.freeze(sections),
    contentSlots: Object.freeze(sections.map((section) => `${route}:${section}`)),
    mediaSlots: Object.freeze(mediaSlots),
    bannerSlots: Object.freeze(bannerSlots),
    trustRequirements: SHARED_TRUST,
    sourceRequirements: Object.freeze([
      'Record-level source label',
      'Freshness or unavailable state',
      'Demonstration data disclosed before action',
    ]),
    seoIntent,
    visualConstraints: SHARED_PROHIBITIONS.slice(0, 2),
    legalConstraints: Object.freeze([
      'No unsupported medical or legal claims',
      'No audience targeting to minors',
      'ORDERWEEDDC is not represented as seller, fulfiller, or carrier',
    ]),
    permittedTransformations: Object.freeze([
      'Reorder declared sections in an isolated variant',
      'Rewrite non-claim copy while preserving the truth contract',
      'Replace approved illustrative media with equivalent approved media',
    ]),
    prohibitedTransformations: SHARED_PROHIBITIONS,
    experimentEligibility,
    rollbackStrategy: 'Revert the isolated variant to the last approved route manifest.',
  });
}

export const CUSTOMER_PAGE_INTELLIGENCE = Object.freeze([
  pageIntelligence({
    route: '/',
    intent: 'Choose a discovery path',
    purpose: 'Orient a customer and route them to a supported marketplace journey',
    primaryConversion: 'SEARCH_SUBMITTED',
    secondaryConversions: ['DELIVERY_OPENED', 'DISPENSARY_OPENED', 'DEAL_OPENED'],
    sections: [
      'primary-banner',
      'discovery-search',
      'deals',
      'delivery',
      'dispensaries',
      'products',
      'neighborhoods',
      'trust',
      'learn',
      'faq',
    ],
    mediaSlots: ['banner-desktop', 'banner-mobile', 'product-category', 'guide'],
    bannerSlots: ['customer-primary'],
    seoIntent: 'D.C. cannabis marketplace discovery',
    experimentEligibility: 'COPY_AND_SECTION_ORDER_AFTER_OWNER_APPROVAL',
  }),
  pageIntelligence({
    route: '/delivery',
    intent: 'Find a delivery participant',
    purpose: 'Present delivery as a first-class marketplace mode without inventing eligibility',
    primaryConversion: 'DELIVERY_PROFILE_OPENED',
    secondaryConversions: ['SERVICE_AREA_PROMPT_USED', 'MENU_OPENED'],
    sections: ['intro', 'filters', 'delivery-results', 'delivery-explainer'],
    mediaSlots: ['delivery-result'],
    seoIntent: 'D.C. cannabis delivery discovery',
    experimentEligibility: 'FILTER_COPY_ONLY_AFTER_OWNER_APPROVAL',
  }),
  pageIntelligence({
    route: '/dispensaries',
    intent: 'Find a storefront dispensary',
    purpose: 'Present source-labeled storefront records and supported next actions',
    primaryConversion: 'DISPENSARY_PROFILE_OPENED',
    secondaryConversions: ['MENU_OPENED', 'DEAL_OPENED'],
    sections: ['intro', 'filters', 'dispensary-results', 'verification-explainer'],
    mediaSlots: ['dispensary-result'],
    seoIntent: 'D.C. dispensary discovery',
    experimentEligibility: 'FILTER_COPY_ONLY_AFTER_OWNER_APPROVAL',
  }),
  pageIntelligence({
    route: '/search',
    intent: 'Search across marketplace record types',
    purpose: 'Return grouped, truth-labeled customer results without blending entity types',
    primaryConversion: 'SEARCH_RESULT_OPENED',
    secondaryConversions: ['SEARCH_REFINED'],
    sections: ['query', 'retailers', 'products', 'deals', 'neighborhoods'],
    mediaSlots: [],
    seoIntent: 'Non-indexed marketplace search',
    experimentEligibility: 'NOT_ELIGIBLE',
  }),
]);

export const CUSTOMER_MEDIA_SLOTS = Object.freeze([
  Object.freeze({
    id: 'banner-desktop', route: '/', purpose: 'Primary campaign',
    audience: 'D.C. marketplace visitors', expectedSubject: 'Approved D.C. editorial campaign',
    aspectRatio: '16:5', mobileRatio: '16:7', focalPoint: 'center', textSafeRegion: 'left 45%',
    minimumDimensions: '1440x450', maximumFileSize: 320000, acceptedFormats: ['avif', 'webp'],
    compressionTarget: 'quality 72-82', altText: 'Required and campaign-specific',
    rightsAndProvenance: 'Required before approval', generatedImageDisclosure: 'Required when generated',
    prohibitedContent: ['minors', 'medical claims', 'real-person impersonation', 'unapproved brands'],
    approvalRequirement: 'Owner-approved campaign and policy PASS', replacementPolicy: 'Fail closed or house fallback',
  }),
  Object.freeze({
    id: 'banner-mobile', route: '/', purpose: 'Primary campaign mobile crop',
    audience: 'Mobile D.C. marketplace visitors', expectedSubject: 'Approved D.C. editorial campaign',
    aspectRatio: '16:7', mobileRatio: '16:7', focalPoint: 'center', textSafeRegion: 'center 70%',
    minimumDimensions: '960x420', maximumFileSize: 220000, acceptedFormats: ['avif', 'webp'],
    compressionTarget: 'quality 70-80', altText: 'Required and campaign-specific',
    rightsAndProvenance: 'Required before approval', generatedImageDisclosure: 'Required when generated',
    prohibitedContent: ['minors', 'tiny embedded text', 'flashing content', 'unsupported claims'],
    approvalRequirement: 'Owner-approved campaign and policy PASS', replacementPolicy: 'Fail closed or house fallback',
  }),
  ...['delivery-result', 'dispensary-result', 'product-category', 'neighborhood', 'guide', 'trust', 'social-og'].map(
    (id) => Object.freeze({
      id, route: 'declared by page record', purpose: id.replaceAll('-', ' '),
      audience: 'D.C. marketplace visitors', expectedSubject: 'Illustrative or source-approved subject',
      aspectRatio: '4:3', mobileRatio: '4:3', focalPoint: 'center', textSafeRegion: 'none',
      minimumDimensions: '800x600', maximumFileSize: 240000, acceptedFormats: ['avif', 'webp'],
      compressionTarget: 'quality 70-82', altText: 'Required unless decorative',
      rightsAndProvenance: 'Required', generatedImageDisclosure: 'Required when generated',
      prohibitedContent: ['invented storefront', 'invented product', 'invented employee', 'unauthorized branding'],
      approvalRequirement: 'Source or owner approval', replacementPolicy: 'Use a neutral illustrative fallback or omit',
    }),
  ),
]);

export const HERMES_CUSTOMER_ACTION_BOUNDARY = Object.freeze({
  allowedProposals: Object.freeze([
    'INSERT_SECTION', 'REMOVE_SECTION', 'MOVE_SECTION', 'REPLACE_SECTION',
    'MERGE_SECTIONS', 'SPLIT_SECTION', 'REWRITE_COPY', 'REPLACE_MEDIA',
    'CHANGE_CTA', 'CREATE_VARIANT', 'CREATE_BANNER_VARIANT', 'REPLACE_BANNER_MEDIA',
  ]),
  requiredPath: Object.freeze([
    'PROPOSAL', 'ISOLATED_VARIANT', 'DESKTOP_RENDER', 'MOBILE_RENDER',
    'NO_DIVIDER_CHECK', 'VISUAL_CONSTITUTION_CHECK', 'CLAIM_SOURCE_CHECK',
    'ACCESSIBILITY_CHECK', 'PERFORMANCE_CHECK', 'ROUTE_CHECK', 'OWNER_APPROVAL',
    'EXISTING_RELEASE_PROCESS',
  ]),
  prohibited: Object.freeze([
    'DIRECT_PUBLISH', 'DIRECT_DEPLOY', 'PRODUCTION_JSX_REWRITE', 'SPEND_AUTHORIZATION',
    'TRUTH_LABEL_CHANGE', 'ORGANIC_ORDER_CHANGE', 'CUSTOMER_IDENTITY_ACCESS',
  ]),
});
