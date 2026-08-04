import { isLocalPlatformHostname } from './tenant-host.mjs';
import {
  OWNER_CAMPAIGN_SEEDS,
  VARIANT_DEFINITIONS,
} from '@orderweeddc/ad-creative/dynamic-foundation';

const prototypes = VARIANT_DEFINITIONS.map((genome) => Object.freeze({
  id: genome.id,
  eyebrow: genome.eyebrow,
  headline: genome.headline,
  body: genome.body,
  cta: genome.cta,
  desktopAsset: `/creative/review/${genome.id}-desktop.svg`,
  mobileAsset: `/creative/review/${genome.id}-mobile.svg`,
  alt: genome.alt,
  strategy: genome.strategy,
  decision: 'PENDING',
}));
const primaryFallback = OWNER_CAMPAIGN_SEEDS.find((seed) => seed.decision === 'APPROVED_PRIMARY');
if (!primaryFallback) throw new Error('approved primary house fallback seed is missing');

export const DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS = Object.freeze([
  ...prototypes,
  Object.freeze({
    id: primaryFallback.id.replace(/^owd-/, ''),
    eyebrow: primaryFallback.eyebrow,
    headline: primaryFallback.headline,
    body: primaryFallback.body,
    cta: primaryFallback.cta,
    desktopAsset: primaryFallback.desktopAsset,
    mobileAsset: primaryFallback.mobileAsset,
    alt: primaryFallback.alt,
    strategy: primaryFallback.strategy,
    decision: primaryFallback.decision,
  }),
]);

export function resolveDynamicCreativeReview({ id, hostname, mode }) {
  if (mode !== 'LOCAL_ONLY' || !isLocalPlatformHostname(hostname)) return null;
  if (typeof id !== 'string') return null;
  return DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS.find((campaign) => campaign.id === id) ?? null;
}
