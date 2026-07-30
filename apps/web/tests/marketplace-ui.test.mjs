import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');

test('canonical homepage renders the recovered marketplace interface', () => {
  const homeSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/page.tsx'),
    'utf8',
  );

  for (const component of [
    'MarketplaceHomeHero',
    'MarketplaceSearchPanel',
    'MarketplaceCategoryRail',
    'MarketplaceFeaturedRetailers',
  ]) {
    assert.match(homeSource, new RegExp(`<${component}`));
  }
  assert.match(homeSource, /isCanonicalBrand &&/);
  assert.match(homeSource, /!isCanonicalBrand &&/);
});

test('marketplace sponsorship labels use verified entitlement, not intent flags', () => {
  const homeSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/page.tsx'),
    'utf8',
  );
  const featuredSource = fs.readFileSync(
    path.join(webRoot, 'src/components/marketplace-featured-retailers.tsx'),
    'utf8',
  );
  assert.match(homeSource, /sponsorshipFor\(retailer\.id\)\?\.state/);
  assert.match(featuredSource, /sponsorshipState === 'ACTIVE'/);
  assert.doesNotMatch(featuredSource, /retailer\.isSponsored/);
});

test('marketplace components and artwork are present in the canonical workspace', () => {
  for (const relativePath of [
    'src/components/marketplace-home-hero.tsx',
    'src/components/marketplace-search-panel.tsx',
    'src/components/marketplace-category-rail.tsx',
    'src/components/marketplace-featured-retailers.tsx',
    'public/marketplace/hero-marketplace-v2.webp',
    'public/marketplace/product-0.webp',
    'public/marketplace/product-1.webp',
    'public/marketplace/product-2.webp',
    'public/marketplace/product-3.webp',
  ]) {
    const file = path.join(webRoot, relativePath);
    assert.equal(fs.existsSync(file), true, `${relativePath} must exist`);
    assert.ok(fs.statSync(file).size > 500, `${relativePath} is unexpectedly small`);
  }
});
