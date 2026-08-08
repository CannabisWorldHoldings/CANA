import {
  resolveSponsorship,
  SPONSORSHIP_STATES,
} from './sponsorship-entitlement.mjs';
import { getCompetitiveReviewCampaigns } from '../../../../packages/ad-creative/src/competitive-campaigns.mjs';

const PRIMARY_BANNER_PLACEMENT = 'NEIGHBORHOOD_BANNER';

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
  mobileMedia: '/marketplace/hero-marketplace-v2-mobile.webp',
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

function repositoryMedia(media) {
  return (
    typeof media === 'string' &&
    /^\/(?:art|brand|marketplace)\/[A-Za-z0-9._/-]+$/.test(media) &&
    !media.includes('..')
  );
}

function hasCanonicalPaidEntitlement(campaign, entitlement) {
  return Boolean(
    entitlement &&
    entitlement.state === SPONSORSHIP_STATES.ACTIVE &&
    entitlement.affectsOrganicOrder === false &&
    entitlement.evidence &&
    entitlement.label === campaign.disclosure,
  );
}

function evaluateBannerCampaignWithEntitlement(campaign, asOf, entitlement) {
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
    !repositoryMedia(campaign.desktopMedia) ||
    !repositoryMedia(campaign.mobileMedia) ||
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
    if (!hasCanonicalPaidEntitlement(campaign, entitlement)) {
      return Object.freeze({ eligible: false, reason: 'PAID_ENTITLEMENT_REQUIRED' });
    }
  }

  return Object.freeze({ eligible: true, reason: 'ELIGIBLE' });
}

/**
 * Public policy inspection never accepts caller-shaped paid authority. Only the
 * server selector below can supply a persisted-ledger resolution.
 */
export function evaluateBannerCampaign(campaign, asOf) {
  return evaluateBannerCampaignWithEntitlement(campaign, asOf, null);
}

/** @typedef {typeof HOUSE_BANNER_CAMPAIGN & { sponsorMerchantId?: string }} BannerCampaign */
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

/**
 * Resolve paid candidates from persisted Demand Credit rows before selection.
 * A campaign object cannot mint its own ACTIVE state or evidence shape.
 *
 * @param {{ prisma: object, campaigns?: readonly BannerCampaign[], houseCampaign?: BannerCampaign | null, asOf: Date }} input
 * @returns {Promise<BannerCampaign | null>}
 */
export async function selectPrimaryBannerForServer({
  prisma,
  campaigns = [],
  houseCampaign = null,
  asOf,
}) {
  const paidCandidates = campaigns.filter(
    (campaign) =>
      campaign?.fundingKind === 'PAID' &&
      typeof campaign.sponsorMerchantId === 'string' &&
      campaign.sponsorMerchantId.trim().length > 0,
  );
  let rows = [];
  let ledgerAvailable = true;
  if (paidCandidates.length > 0) {
    try {
      rows = await prisma.demandCreditEntry.findMany({
        where: {
          merchantId: {
            in: [...new Set(paidCandidates.map((campaign) => campaign.sponsorMerchantId))],
          },
        },
        orderBy: { seq: 'asc' },
      });
    } catch {
      ledgerAvailable = false;
    }
  }

  for (const campaign of campaigns) {
    const entitlement = campaign?.fundingKind === 'PAID'
      ? resolveSponsorship({
          merchantId: campaign.sponsorMerchantId,
          entries: rows,
          placement: PRIMARY_BANNER_PLACEMENT,
          now: asOf,
          ledgerAvailable,
        })
      : null;
    if (evaluateBannerCampaignWithEntitlement(campaign, asOf, entitlement).eligible) {
      return campaign;
    }
  }
  if (
    houseCampaign &&
    evaluateBannerCampaignWithEntitlement(houseCampaign, asOf, null).eligible
  ) {
    return houseCampaign;
  }
  return null;
}

/**
 * Owner-review candidates are deliberately excluded from the live campaign
 * selector. They can render only on a local host with the server-only review
 * gate enabled and remain unapproved throughout the review.
 *
 * @param {{ campaignId?: string | null, hostname: string, reviewMode?: string }} input
 * @returns {BannerCampaign | null}
 */
export function selectOwnerReviewBanner({ campaignId, hostname, reviewMode }) {
  if (reviewMode !== 'LOCAL_ONLY') return null;
  if (!['orderweeddc.localhost', 'localhost', '127.0.0.1'].includes(hostname)) return null;
  if (typeof campaignId !== 'string' || !/^[a-z0-9-]+$/.test(campaignId)) return null;

  const campaign = getCompetitiveReviewCampaigns().find((candidate) => candidate.id === campaignId);
  if (!campaign) return null;
  if (campaign.approvalStatus !== 'OWNER_REVIEW_PENDING') return null;
  if (campaign.policyResult !== 'PASS_FOR_OWNER_REVIEW') return null;
  if (!internalDestination(campaign.destination)) return null;
  if (
    !campaign.desktopMedia.startsWith('/competitive-evolution/') ||
    !campaign.mobileMedia.startsWith('/competitive-evolution/') ||
    campaign.desktopMedia.includes('..') ||
    campaign.mobileMedia.includes('..')
  ) return null;

  return campaign;
}
