import { SPONSORSHIP_STATES } from './sponsorship-entitlement.mjs';

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
  approvalStatus: 'APPROVED',
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

function hasCanonicalPaidEntitlement(campaign) {
  const entitlement = campaign.sponsorship;
  return Boolean(
    entitlement &&
    entitlement.state === SPONSORSHIP_STATES.ACTIVE &&
    entitlement.affectsOrganicOrder === false &&
    entitlement.evidence &&
    entitlement.label === campaign.disclosure,
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
  if (now < starts) return Object.freeze({ eligible: false, reason: 'NOT_STARTED' });
  if (now >= ends) return Object.freeze({ eligible: false, reason: 'EXPIRED' });
  if (campaign.approvalStatus !== 'APPROVED') {
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
  if (campaign.fundingKind === 'PAID') {
    if (!/^(Sponsored|Ad)\b/.test(campaign.disclosure)) {
      return Object.freeze({ eligible: false, reason: 'DISCLOSURE_MISSING' });
    }
    if (!hasCanonicalPaidEntitlement(campaign)) {
      return Object.freeze({ eligible: false, reason: 'PAID_ENTITLEMENT_REQUIRED' });
    }
  }

  return Object.freeze({ eligible: true, reason: 'ELIGIBLE' });
}

/** @typedef {typeof HOUSE_BANNER_CAMPAIGN & { sponsorship?: object }} BannerCampaign */
/**
 * Paid candidates must already carry the canonical persisted-entitlement result.
 * This selector performs final display checks; it never creates paid authority.
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
