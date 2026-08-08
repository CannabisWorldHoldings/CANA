import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const source = (relativePath) => fs.readFileSync(path.join(webRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(webRoot, relativePath));

const sovereignFiles = [
  'src/app/[domain]/layout.tsx',
  'src/app/[domain]/page.tsx',
  'src/app/[domain]/delivery/page.tsx',
  'src/app/[domain]/dispensaries/page.tsx',
  'src/app/[domain]/search/page.tsx',
  'src/components/customer-directory-page.tsx',
  'src/components/customer-home-discovery.tsx',
  'src/components/customer-home-hero.tsx',
  'src/components/customer-home-market.tsx',
  'src/components/customer-home-trust.tsx',
  'src/components/customer-listing-row.tsx',
  'src/components/customer-sponsored-banner.tsx',
];
const combined = sovereignFiles.map(source).join('\n');

const bannerPolicy = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/customer-banner.mjs')).href
);
const marketplace = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/customer-marketplace.mjs')).href
);
const demandCredits = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/demand-credits.mjs')).href
);

test('customer sovereign surfaces contain no decorative divider-line utilities', () => {
  assert.doesNotMatch(combined, /<hr\b/i);
  assert.doesNotMatch(combined, /\bdivide-[xy](?:-|\b)/);
  assert.doesNotMatch(combined, /\bborder-(?:t|b|l|r|x|y)(?:-|\b)/);
  assert.doesNotMatch(combined, /(?:before|after):[^"'\s]*border/);
});

test('customer marketplace sections use white or neutral canvas and no green background utilities', () => {
  const customerSections = sovereignFiles
    .filter((file) => file.includes('customer-') || file.endsWith('/page.tsx'))
    .map(source)
    .join('\n');
  assert.doesNotMatch(customerSections, /\bbg-(?:green|emerald|lime|teal)(?:-|\/|\b)/);
  assert.doesNotMatch(customerSections, /\bbg-brand-(?:primary|secondary)(?:-|\/|\b)/);
  assert.doesNotMatch(customerSections, /\b(?:from|via|to)-(?:green|emerald|lime|teal|brand)/);
});

test('customer homepage does not regress into card walls, gradients, glows, or shadows', () => {
  const homeSources = [
    'src/app/[domain]/page.tsx',
    'src/components/customer-home-discovery.tsx',
    'src/components/customer-home-hero.tsx',
    'src/components/customer-home-market.tsx',
    'src/components/customer-home-trust.tsx',
    'src/components/customer-listing-row.tsx',
    'src/components/customer-sponsored-banner.tsx',
  ].map(source).join('\n');
  assert.doesNotMatch(homeSources, /record-card|glass-panel|hero-aurora/);
  assert.doesNotMatch(homeSources, /\b(?:bg-)?gradient|\bshadow(?:-|\b)|\bglow/);
  assert.doesNotMatch(homeSources, /grid[^"']*(?:rounded[^"']*border|border[^"']*rounded)/);
});

test('delivery is first-class in navigation, homepage copy, and a dedicated route', () => {
  assert.equal(exists('src/app/[domain]/delivery/page.tsx'), true);
  assert.match(source('src/app/[domain]/layout.tsx'), /href: '\/delivery', label: 'Delivery'/);
  assert.match(source('src/components/customer-home-market.tsx'), /Delivery gets its own front door/);
  assert.match(source('src/app/[domain]/delivery/page.tsx'), /type: 'delivery'/);
  assert.doesNotMatch(source('src/components/customer-listing-row.tsx'), /listing\.address/);
});

test('sponsored banner eligibility requires persisted canonical entitlement', async () => {
  const asOf = new Date('2026-08-03T12:00:00.000Z');
  const merchantId = 'merchant_banner_fixture';
  const issueDraft = {
    merchantId,
    kind: 'ISSUE',
    seq: 0,
    amount: 500,
    authorizationRef: 'banner-fixture-approval',
    expiresAt: '2026-09-03T12:00:00.000Z',
    prevHash: demandCredits.GENESIS_HASH,
  };
  const issue = {
    ...issueDraft,
    entryHash: demandCredits.hashBody(issueDraft, issueDraft.prevHash),
  };
  const spendDraft = {
    merchantId,
    kind: 'SPEND',
    seq: 1,
    amount: -100,
    placement: 'NEIGHBORHOOD_BANNER',
    disclosureLabel: 'Sponsored placement',
    affectsOrganicOrder: false,
    prevHash: issue.entryHash,
  };
  const spend = {
    ...spendDraft,
    entryHash: demandCredits.hashBody(spendDraft, spendDraft.prevHash),
  };
  const refundDraft = {
    merchantId,
    kind: 'REFUND',
    seq: 2,
    amount: 100,
    originalSeq: 1,
    reason: 'campaign cancelled',
    prevHash: spend.entryHash,
  };
  const refund = {
    ...refundDraft,
    entryHash: demandCredits.hashBody(refundDraft, refundDraft.prevHash),
  };
  const paid = {
    ...bannerPolicy.HOUSE_BANNER_CAMPAIGN,
    id: 'paid-fixture',
    sponsorMerchantId: merchantId,
    disclosure: 'Sponsored placement',
    fundingKind: 'PAID',
    approvalStatus: 'APPROVED',
  };
  const prisma = {
    demandCreditEntry: {
      findMany: async () => [issue, spend],
    },
  };
  assert.equal(bannerPolicy.evaluateBannerCampaign({
    ...paid,
    sponsorship: {
      state: 'ACTIVE',
      label: 'Sponsored placement',
      affectsOrganicOrder: false,
      evidence: { entitlement_digest: 'forged' },
    },
  }, asOf).reason, 'PAID_ENTITLEMENT_REQUIRED');
  assert.equal((await bannerPolicy.selectPrimaryBannerForServer({
    prisma,
    campaigns: [paid],
    houseCampaign: null,
    asOf,
  })).id, paid.id);
  assert.equal(bannerPolicy.evaluateBannerCampaign({ ...paid, disclosure: 'Partner' }, asOf).reason, 'DISCLOSURE_MISSING');
  assert.equal(bannerPolicy.evaluateBannerCampaign({ ...paid, approvalStatus: 'APPROVED_FOR_REVIEW' }, asOf).reason, 'UNAPPROVED');
  assert.equal(bannerPolicy.evaluateBannerCampaign({ ...paid, endAt: '2026-08-03T00:00:00.000Z' }, asOf).reason, 'EXPIRED');
  assert.equal(bannerPolicy.evaluateBannerCampaign({ ...paid, mobileMedia: '' }, asOf).reason, 'MEDIA_INCOMPLETE');
  assert.equal(bannerPolicy.evaluateBannerCampaign({ ...paid, mobileMedia: 'https://tracker.example/banner.png' }, asOf).reason, 'MEDIA_INCOMPLETE');
  assert.equal(bannerPolicy.evaluateBannerCampaign({ ...paid, destination: 'https://example.com' }, asOf).reason, 'DESTINATION_BLOCKED');
  assert.equal(await bannerPolicy.selectPrimaryBannerForServer({
    prisma: { demandCreditEntry: { findMany: async () => [issue, { ...spend, entryHash: 'forged' }] } },
    campaigns: [paid],
    houseCampaign: null,
    asOf,
  }), null);
  assert.equal(await bannerPolicy.selectPrimaryBannerForServer({
    prisma: { demandCreditEntry: { findMany: async () => [issue, spend] } },
    campaigns: [{ ...paid, sponsorMerchantId: 'different-merchant' }],
    houseCampaign: null,
    asOf,
  }), null);
  assert.equal(await bannerPolicy.selectPrimaryBannerForServer({
    prisma: { demandCreditEntry: { findMany: async () => [issue, { ...spend, placement: 'FEATURED_CARD' }] } },
    campaigns: [paid],
    houseCampaign: null,
    asOf,
  }), null);
  const expiredIssueDraft = {
    ...issueDraft,
    expiresAt: '2026-08-03T00:00:00.000Z',
  };
  const expiredIssue = {
    ...expiredIssueDraft,
    entryHash: demandCredits.hashBody(expiredIssueDraft, expiredIssueDraft.prevHash),
  };
  assert.equal(await bannerPolicy.selectPrimaryBannerForServer({
    prisma: { demandCreditEntry: { findMany: async () => [expiredIssue, spend] } },
    campaigns: [paid],
    houseCampaign: null,
    asOf,
  }), null);
  assert.equal(await bannerPolicy.selectPrimaryBannerForServer({
    prisma: { demandCreditEntry: { findMany: async () => [issue, spend, refund] } },
    campaigns: [paid],
    houseCampaign: null,
    asOf,
  }), null);
  assert.equal(await bannerPolicy.selectPrimaryBannerForServer({
    prisma: { demandCreditEntry: { findMany: async () => { throw new Error('ledger unavailable'); } } },
    campaigns: [paid],
    houseCampaign: null,
    asOf,
  }), null);
  assert.equal(bannerPolicy.selectPrimaryBanner({ campaigns: [], houseCampaign: bannerPolicy.HOUSE_BANNER_CAMPAIGN, asOf }).fundingKind, 'HOUSE');
  assert.equal(bannerPolicy.selectPrimaryBanner({ campaigns: [], houseCampaign: null, asOf }), null);
});

test('pending competitive campaigns render only through the local owner-review gate', () => {
  const allowed = bannerPolicy.selectOwnerReviewBanner({
    campaignId: 'owd-block-by-block',
    hostname: 'orderweeddc.localhost',
    reviewMode: 'LOCAL_ONLY',
  });
  assert.equal(allowed?.approvalStatus, 'OWNER_REVIEW_PENDING');
  assert.equal(allowed?.desktopMedia, '/competitive-evolution/block-by-block-desktop.svg');
  assert.equal(bannerPolicy.evaluateBannerCampaign(allowed, new Date('2026-08-03T12:00:00.000Z')).reason, 'UNAPPROVED');
  assert.equal(bannerPolicy.selectOwnerReviewBanner({
    campaignId: 'owd-block-by-block',
    hostname: 'orderweeddc.com',
    reviewMode: 'LOCAL_ONLY',
  }), null);
  assert.equal(bannerPolicy.selectOwnerReviewBanner({
    campaignId: 'owd-block-by-block',
    hostname: 'orderweeddc.localhost',
    reviewMode: undefined,
  }), null);
  assert.equal(bannerPolicy.selectOwnerReviewBanner({
    campaignId: '../owd-block-by-block',
    hostname: 'orderweeddc.localhost',
    reviewMode: 'LOCAL_ONLY',
  }), null);
});

test('banner reserves dimensions, selects mobile media, and has no rotation or sound', () => {
  const banner = source('src/components/customer-sponsored-banner.tsx');
  const wordmark = source('src/components/brand-wordmark.tsx');
  const rootLayout = source('src/app/layout.tsx');
  assert.match(banner, /<source media="\(max-width: 639px\)" srcSet=\{campaign\.mobileMedia\}/);
  assert.match(banner, /width=\{1680\}/);
  assert.match(banner, /height=\{720\}/);
  assert.match(banner, /fetchPriority="high"/);
  assert.match(banner, /campaign\.disclosure/);
  assert.equal(bannerPolicy.HOUSE_BANNER_CAMPAIGN.mobileMedia, '/marketplace/hero-marketplace-v2-mobile.webp');
  assert.ok(fs.statSync(path.join(webRoot, 'public/marketplace/hero-marketplace-v2-mobile.webp')).size < 80_000);
  assert.equal(wordmark.match(/priority=\{priority\}/g)?.length, 1);
  assert.doesNotMatch(rootLayout, /href="\/fonts\/geist-mono-latin\.woff2"/);
  assert.doesNotMatch(banner, /setInterval|autoPlay|<audio|<video/);
});

test('mobile layout has dedicated banner crop, large targets, breakpoints, and no forced desktop width', () => {
  assert.match(combined, /sm:/);
  assert.match(combined, /lg:/);
  assert.match(combined, /min-h-(?:11|12|14)/);
  assert.match(source('src/components/customer-sponsored-banner.tsx'), /aspect-\[16\/7\]/);
  assert.doesNotMatch(combined, /min-w-\[(?:[4-9]\d{2}|\d{4,})px\]/);
});

test('customer controls and content expose accessible names and semantic states', () => {
  assert.match(source('src/components/customer-sponsored-banner.tsx'), /aria-label=/);
  assert.match(source('src/components/customer-home-hero.tsx'), /className="sr-only"/);
  assert.match(source('src/components/customer-directory-page.tsx'), /role="status"/);
  assert.match(source('src/components/customer-home-trust.tsx'), /<details/);
  assert.match(source('src/components/customer-home-trust.tsx'), /<summary/);
  assert.match(source('src/components/age-gate.tsx'), /aria-modal="true"/);
  assert.match(source('src/components/age-gate.tsx'), /keepFocusInside/);
});

test('customer route integrity includes new routes while business and admin remain separate', () => {
  for (const route of ['delivery', 'dispensaries', 'search']) {
    assert.equal(exists(`src/app/[domain]/${route}/page.tsx`), true);
  }
  const sitemind = source('src/lib/sitemind.mjs');
  assert.match(sitemind, /route: '\/delivery'/);
  assert.match(sitemind, /route: '\/dispensaries'/);
  assert.match(sitemind, /route: '\/search'/);
  assert.match(source('src/app/sitemap.ts'), /\$\{canonicalBase\}\/delivery/);
  assert.match(source('src/app/sitemap.ts'), /\$\{canonicalBase\}\/dispensaries/);
  assert.doesNotMatch(source('src/app/[domain]/layout.tsx'), /Admin portal|\/admin/);
  assert.doesNotMatch(source('src/app/[domain]/layout.tsx'), /CartDrawer|Order Staging/);
  assert.equal(exists('src/app/business/dashboard/page.tsx'), true);
  assert.equal(exists('src/app/admin/page.tsx'), true);
});

test('truthful labels prevent synthetic, service-area, and analytics overclaims', () => {
  assert.match(combined, /Demonstration record · not a real business or availability claim/);
  assert.match(combined, /Demo offer · not redeemable/);
  assert.match(combined, /confirm service area/i);
  assert.match(combined, /No paid campaign is live/);
  assert.doesNotMatch(combined, /guaranteed|best in D\.C\.|real-time delivery|customers served|conversion rate|revenue generated/i);
});

test('page intelligence and Hermes boundaries are frozen, complete, and invisible to customer copy', () => {
  assert.equal(Object.isFrozen(marketplace.CUSTOMER_PAGE_INTELLIGENCE), true);
  for (const page of marketplace.CUSTOMER_PAGE_INTELLIGENCE) {
    for (const field of ['route', 'audience', 'intent', 'businessPurpose', 'primaryConversion', 'sections', 'mediaSlots', 'trustRequirements', 'sourceRequirements', 'seoIntent', 'visualConstraints', 'legalConstraints', 'permittedTransformations', 'prohibitedTransformations', 'experimentEligibility', 'rollbackStrategy']) {
      assert.ok(field in page, `${page.route} missing ${field}`);
    }
  }
  assert.ok(marketplace.HERMES_CUSTOMER_ACTION_BOUNDARY.prohibited.includes('DIRECT_PUBLISH'));
  assert.ok(marketplace.HERMES_CUSTOMER_ACTION_BOUNDARY.prohibited.includes('SPEND_AUTHORIZATION'));
  assert.doesNotMatch(combined, /SiteMind|Hermes|RSI|schema|model routing|confidence score/);
});
