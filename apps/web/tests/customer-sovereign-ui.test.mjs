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

const marketplace = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/customer-marketplace.mjs')).href
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

test('sponsored banner eligibility fails closed and uses a truthful house fallback', () => {
  const asOf = new Date('2026-08-03T12:00:00.000Z');
  const paid = {
    ...marketplace.HOUSE_BANNER_CAMPAIGN,
    id: 'paid-fixture',
    disclosure: 'Sponsored',
    fundingKind: 'PAID',
    approvalStatus: 'APPROVED',
  };
  assert.deepEqual(marketplace.evaluateBannerCampaign(paid, asOf), { eligible: true, reason: 'ELIGIBLE' });
  assert.equal(marketplace.evaluateBannerCampaign({ ...paid, disclosure: 'Partner' }, asOf).reason, 'DISCLOSURE_MISSING');
  assert.equal(marketplace.evaluateBannerCampaign({ ...paid, approvalStatus: 'DRAFT' }, asOf).reason, 'UNAPPROVED');
  assert.equal(marketplace.evaluateBannerCampaign({ ...paid, endAt: '2026-08-03T00:00:00.000Z' }, asOf).reason, 'EXPIRED');
  assert.equal(marketplace.evaluateBannerCampaign({ ...paid, mobileMedia: '' }, asOf).reason, 'MEDIA_INCOMPLETE');
  assert.equal(marketplace.evaluateBannerCampaign({ ...paid, destination: 'https://example.com' }, asOf).reason, 'DESTINATION_BLOCKED');
  assert.equal(marketplace.selectPrimaryBanner({ campaigns: [], houseCampaign: marketplace.HOUSE_BANNER_CAMPAIGN, asOf }).fundingKind, 'HOUSE');
  assert.equal(marketplace.selectPrimaryBanner({ campaigns: [], houseCampaign: null, asOf }), null);
});

test('banner reserves dimensions, selects mobile media, and has no rotation or sound', () => {
  const banner = source('src/components/customer-sponsored-banner.tsx');
  assert.match(banner, /<source media="\(max-width: 639px\)" srcSet=\{campaign\.mobileMedia\}/);
  assert.match(banner, /width=\{1680\}/);
  assert.match(banner, /height=\{720\}/);
  assert.match(banner, /fetchPriority="high"/);
  assert.match(banner, /campaign\.disclosure/);
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
