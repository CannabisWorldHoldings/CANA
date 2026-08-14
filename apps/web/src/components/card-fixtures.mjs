// DEMONSTRATION FIXTURES — for the /lab/design styleguide route (P0.7) and
// visual-court screenshot states ONLY. Nothing here may render on a public
// route; every object is synthetic and says so. The demonstration-banner
// law applies wherever these appear.

export const FIXTURE_DISCLAIMER =
  'DEMONSTRATION fixtures — synthetic records for the internal styleguide and visual court. Never render on public routes.';

export const merchantCardStates = {
  full: {
    href: '#fixture',
    name: 'Demonstration Dispensary',
    neighborhood: 'Fixture Heights',
    photoUrl: '/marketplace/retailer-0.webp',
    photoAlt: 'DEMONSTRATION storefront fixture',
    evidence: { dataStatus: 'VERIFIED_CURRENT', isDemonstration: true },
    distanceLabel: '0.4 mi',
  },
  partial: {
    href: '#fixture',
    name: 'Demonstration Delivery Co.',
    type: 'delivery',
    evidence: { dataStatus: 'AWAITING_VERIFICATION', isDemonstration: true },
  },
  zero: {
    href: '#fixture',
    name: 'Demonstration Merchant (no photo, no chips)',
  },
};

export const productCardStates = {
  full: {
    href: '#fixture',
    name: 'Demonstration Flower Eighth',
    brandName: 'Fixture Farms',
    category: 'Flower',
    photoUrl: '/marketplace/product-0.webp',
    photoAlt: 'DEMONSTRATION product fixture',
    priceCents: 4000,
    priceSourceVerified: true,
    priceFreshnessExpiresAt: '2099-01-01T00:00:00Z',
    carrierCount: 3,
  },
  partial: {
    href: '#fixture',
    name: 'Demonstration Vape (price lawfully hidden)',
    brandName: 'Fixture Labs',
    category: 'Vapes',
    priceCents: 3500,
    priceSourceVerified: false,
  },
  zero: { href: '#fixture', name: 'Demonstration Product (no photo, no price)' },
};

export const dealCardStates = {
  full: {
    href: '#fixture',
    title: '20% off first verified order',
    merchantName: 'Demonstration Dispensary',
    termsSummary: 'Synthetic terms for styleguide rendering only.',
    isActive: true,
    expiresAt: '2099-01-01T00:00:00Z',
  },
  expiringSoon: {
    href: '#fixture',
    title: 'Fixture flash deal',
    merchantName: 'Demonstration Delivery Co.',
    isActive: true,
    expiresAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  },
  expired: {
    href: '#fixture',
    title: 'Fixture expired deal (must render as expired)',
    merchantName: 'Demonstration Dispensary',
    isActive: true,
    expiresAt: '2020-01-01T00:00:00Z',
  },
};

export const editorialCardStates = {
  full: {
    href: '#fixture',
    title: 'Demonstration guide: reading a verification receipt',
    topic: 'Trust',
    publishedAt: '2026-08-01T00:00:00Z',
    imageUrl: '/marketplace/retailer-1.webp',
    imageAlt: 'DEMONSTRATION editorial fixture',
  },
  zero: {
    href: '#fixture',
    title: 'Demonstration article without imagery',
    publishedAt: '2026-08-01T00:00:00Z',
  },
};

export const neighborhoodTileStates = {
  full: {
    href: '#fixture',
    name: 'Fixture Heights',
    verifiedCount: 6,
    photoUrl: '/marketplace/retailer-2.webp',
    photoAlt: 'DEMONSTRATION neighborhood fixture',
  },
  zero: { href: '#fixture', name: 'Fixture Flats (honest zero)', verifiedCount: 0 },
};
