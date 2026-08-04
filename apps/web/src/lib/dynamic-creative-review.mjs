import { isLocalPlatformHostname } from './tenant-host.mjs';

export const DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS = Object.freeze([
  Object.freeze({
    id: 'district-signal',
    eyebrow: 'District signal',
    headline: 'Find the signal on your side of D.C.',
    body: 'A civic-grid campaign system that makes local orientation and verified comparison the lead mechanism.',
    cta: 'Compare verified options',
    desktopAsset: '/creative/review/district-signal-desktop.svg',
    mobileAsset: '/creative/review/district-signal-mobile.svg',
    alt: 'Abstract D.C. signal grid with a central verified marker',
    strategy: 'local-orientation',
    decision: 'PENDING',
  }),
  Object.freeze({
    id: 'evening-index',
    eyebrow: 'Evening index',
    headline: 'A shorter path to a confident choice.',
    body: 'An editorial index system that reduces choice overload without presenting competitor performance as fact.',
    cta: 'Build a verified shortlist',
    desktopAsset: '/creative/review/evening-index-desktop.svg',
    mobileAsset: '/creative/review/evening-index-mobile.svg',
    alt: 'Abstract evening arches with a compact editorial index',
    strategy: 'bounded-choice',
    decision: 'PENDING',
  }),
  Object.freeze({
    id: 'receipt-rhythm',
    eyebrow: 'Receipt rhythm',
    headline: 'See the source before the storefront.',
    body: 'A receipt-led system that turns source evidence, freshness, and transparent handoff into the premium idea.',
    cta: 'Check the receipts',
    desktopAsset: '/creative/review/receipt-rhythm-desktop.svg',
    mobileAsset: '/creative/review/receipt-rhythm-mobile.svg',
    alt: 'Abstract source receipt with a circular verification seal',
    strategy: 'trust-before-handoff',
    decision: 'PENDING',
  }),
  Object.freeze({
    id: 'source-before-hype',
    eyebrow: 'Approved house fallback',
    headline: 'Source before hype.',
    body: 'The owner-approved primary house seed and deterministic rollback target whenever a dynamic placement is not fully eligible.',
    cta: 'See how evidence is labeled',
    desktopAsset: '/creative/house/source-before-hype-desktop.svg',
    mobileAsset: '/creative/house/source-before-hype-mobile.svg',
    alt: 'Source records leading to an open doorway',
    strategy: 'approved-house-fallback',
    decision: 'APPROVED_PRIMARY',
  }),
]);

export function resolveDynamicCreativeReview({ id, hostname, mode }) {
  if (mode !== 'LOCAL_ONLY' || !isLocalPlatformHostname(hostname)) return null;
  if (typeof id !== 'string') return null;
  return DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS.find((campaign) => campaign.id === id) ?? null;
}
