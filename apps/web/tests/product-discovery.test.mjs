import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PRODUCT_DISCOVERY_MAX_PAGE,
  PRODUCT_DISCOVERY_PAGE_SIZE,
  PRODUCT_DISCOVERY_QUERY_MAX_LENGTH,
  clampProductDiscoveryPage,
  parseProductDiscoverySearch,
  productDiscoveryHref,
  productDiscoveryOrderBy,
  productDiscoveryPageCount,
  productDiscoveryPageOffset,
  productDiscoveryWhere,
} from '../src/lib/product-discovery.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const AS_OF = new Date('2026-07-17T20:00:00.000Z');

test('product discovery controls are scalar, normalized, allow-listed, and bounded', () => {
  const parsed = parseProductDiscoverySearch({
    query: [`  Blue\u0000   ${'x'.repeat(100)} `, 'ignored'],
    category: 'flower',
    strainType: 'hybrid',
    serviceType: 'delivery',
    evidence: 'VERIFIED_CURRENT',
    stock: 'IN_STOCK',
    priceBand: '25_TO_50',
    sort: 'PRICE_ASC',
    page: '9999',
  });

  assert.equal(parsed.query.length, PRODUCT_DISCOVERY_QUERY_MAX_LENGTH);
  assert.match(parsed.query, /^Blue x+$/);
  assert.equal(parsed.category, 'flower');
  assert.equal(parsed.strainType, 'hybrid');
  assert.equal(parsed.serviceType, 'delivery');
  assert.equal(parsed.evidence, 'VERIFIED_CURRENT');
  assert.equal(parsed.stock, 'IN_STOCK');
  assert.equal(parsed.priceBand, '25_TO_50');
  assert.equal(parsed.sort, 'PRICE_ASC');
  assert.equal(parsed.page, PRODUCT_DISCOVERY_MAX_PAGE);

  assert.deepEqual(
    parseProductDiscoverySearch({
      category: 'anything',
      strainType: 'effect-claim',
      serviceType: 'drone',
      evidence: 'VERIFIED_FOREVER',
      stock: 'LIVE_INVENTORY',
      priceBand: 'FREE',
      sort: 'SPONSORED',
      page: '-1',
    }),
    {
      query: '',
      category: '',
      strainType: '',
      serviceType: '',
      evidence: '',
      stock: '',
      priceBand: '',
      sort: 'TRUTH_FIRST',
      page: 1,
    },
  );
});

test('product discovery composes tenant, retailer, menu, product, and freshness boundaries', () => {
  const where = productDiscoveryWhere({
    brandId: 'brand-one',
    filters: {
      query: 'Blue Dream',
      category: 'flower',
      strainType: 'hybrid',
      serviceType: 'storefront',
      evidence: 'VERIFIED_CURRENT',
      stock: 'IN_STOCK',
      priceBand: '25_TO_50',
    },
    asOf: AS_OF,
  });

  assert.equal(where.brandMenus.some.brandId, 'brand-one');
  assert.equal(where.inStock, true);
  assert.deepEqual(where.price, { gte: 25, lt: 50 });
  assert.deepEqual(where.AND[0], {
    OR: [
      { isDemonstration: true },
      {
        isDemonstration: false,
        dataStatus: 'VERIFIED_CURRENT',
        verifiedAt: { not: null, lte: AS_OF },
        freshnessExpiresAt: { gt: AS_OF },
      },
    ],
  });
  assert.equal(
    where.AND[1].OR[0].product.name.contains,
    'Blue Dream',
  );
  assert.deepEqual(where.AND[2], {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: AS_OF },
    freshnessExpiresAt: { gt: AS_OF },
  });
  assert.deepEqual(where.product.AND[1], where.AND[2]);
  assert.deepEqual(where.product.AND[2], { category: 'flower' });
  assert.deepEqual(where.product.AND[3], { strainType: 'hybrid' });
  assert.deepEqual(where.retailer.AND[0], {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: AS_OF },
    freshnessExpiresAt: { gt: AS_OF },
  });
  assert.deepEqual(where.retailer.AND[1], where.AND[2]);
  assert.equal(where.retailer.type, 'storefront');

  const demonstration = productDiscoveryWhere({
    brandId: 'brand-one',
    filters: { evidence: 'DEMONSTRATION_ONLY' },
    asOf: AS_OF,
  });
  assert.deepEqual(demonstration.AND[1], {
    OR: [
      { isDemonstration: true },
      { product: { isDemonstration: true } },
      { retailer: { isDemonstration: true } },
    ],
  });

  assert.throws(
    () =>
      productDiscoveryWhere({
        brandId: '../private',
        filters: {},
        asOf: AS_OF,
      }),
    /Brand ID/,
  );
  assert.throws(
    () =>
      productDiscoveryWhere({
        brandId: 'brand-one',
        filters: {},
        asOf: new Date('invalid'),
      }),
    /discovery time/,
  );
});

test('product discovery uses explicit non-sponsored ordering and bounded pagination', () => {
  assert.deepEqual(productDiscoveryOrderBy('TRUTH_FIRST'), [
    { isDemonstration: 'asc' },
    { product: { isDemonstration: 'asc' } },
    { retailer: { isDemonstration: 'asc' } },
    { verifiedAt: 'desc' },
    { freshnessExpiresAt: 'desc' },
    { updatedAt: 'desc' },
    { id: 'asc' },
  ]);
  assert.deepEqual(productDiscoveryOrderBy('PRICE_ASC'), [
    { price: 'asc' },
    { id: 'asc' },
  ]);
  assert.deepEqual(productDiscoveryOrderBy('SPONSORED'), [
    { isDemonstration: 'asc' },
    { product: { isDemonstration: 'asc' } },
    { retailer: { isDemonstration: 'asc' } },
    { verifiedAt: 'desc' },
    { freshnessExpiresAt: 'desc' },
    { updatedAt: 'desc' },
    { id: 'asc' },
  ]);
  assert.equal(PRODUCT_DISCOVERY_PAGE_SIZE, 16);
  assert.equal(productDiscoveryPageCount(49), 4);
  assert.equal(clampProductDiscoveryPage(99, 49), 4);
  assert.equal(productDiscoveryPageOffset(3), 32);
  assert.throws(() => productDiscoveryPageCount(-1), /non-negative/);
});

test('product discovery links preserve only normalized controls', () => {
  assert.equal(
    productDiscoveryHref(
      {
        query: 'Blue Dream',
        category: 'flower',
        strainType: 'hybrid',
        serviceType: 'delivery',
        evidence: 'DEMONSTRATION_ONLY',
        stock: 'IN_STOCK',
        priceBand: '25_TO_50',
        sort: 'PRICE_ASC',
      },
      2,
    ),
    '/products?query=Blue+Dream&category=flower&strainType=hybrid&serviceType=delivery&evidence=DEMONSTRATION_ONLY&stock=IN_STOCK&priceBand=25_TO_50&sort=PRICE_ASC&page=2',
  );
  assert.equal(
    productDiscoveryHref(
      {
        category: '../private',
        evidence: 'VERIFIED_FOREVER',
        sort: 'SPONSORED',
      },
      1,
    ),
    '/products',
  );
});

test('product route is bounded, evidence-aware, canonical, and tracking-free', () => {
  const pageSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/products/page.tsx'),
    'utf8',
  );
  const sitemapSource = fs.readFileSync(
    path.join(webRoot, 'src/app/sitemap.ts'),
    'utf8',
  );
  const layoutSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/layout.tsx'),
    'utf8',
  );
  const siteBrainSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/site-intelligence.mjs'),
    'utf8',
  );

  assert.match(pageSource, /productDiscoveryWhere/);
  assert.match(pageSource, /take: PRODUCT_DISCOVERY_PAGE_SIZE/);
  assert.match(pageSource, /skip: productDiscoveryPageOffset\(currentPage\)/);
  assert.match(pageSource, /select:\s*\{/);
  assert.match(pageSource, /canonical: '\/products'/);
  assert.match(pageSource, /verifiedProductCount > 0/);
  assert.match(pageSource, /safePublicReferenceUrl/);
  assert.match(pageSource, /Default order does not use sponsorship/);
  assert.match(pageSource, /21\+ only/);
  assert.match(
    pageSource,
    /A\s+menu flag is not a real-time inventory guarantee/,
  );
  assert.doesNotMatch(
    pageSource,
    /localStorage|sessionStorage|cookies\(|LeadEvent/,
  );
  assert.match(sitemapSource, /verifiedProductCount > 0/);
  assert.match(sitemapSource, /url: `\$\{canonicalBase\}\/products`/);
  assert.match(layoutSource, /href="\/products"/);
  assert.match(siteBrainSource, /id: 'products'/);
});
