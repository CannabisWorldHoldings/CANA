import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DIRECTORY_DEFAULT_SORT,
  DIRECTORY_MAX_PAGE,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_QUERY_MAX_LENGTH,
  currentDealWhere,
  directoryRetailerOrderBy,
  directoryRetailerWhere,
  directorySearchHref,
  parseDirectorySearch,
  publicCatalogRecordWhere,
} from '../src/lib/directory-search.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const AS_OF = new Date('2026-07-17T20:00:00.000Z');

test('directory inputs are normalized, allow-listed, and bounded', () => {
  const parsed = parseDirectorySearch({
    query: `  Demo\u0000   ${'x'.repeat(100)} `,
    type: 'delivery',
    status: 'VERIFIED_CURRENT',
    sort: 'RECENTLY_UPDATED',
    page: '9999',
  });

  assert.equal(parsed.query.length, DIRECTORY_QUERY_MAX_LENGTH);
  assert.match(parsed.query, /^Demo x+$/);
  assert.equal(parsed.type, 'delivery');
  assert.equal(parsed.status, 'VERIFIED_CURRENT');
  assert.equal(parsed.sort, 'RECENTLY_UPDATED');
  assert.equal(parsed.page, DIRECTORY_MAX_PAGE);

  assert.deepEqual(
    parseDirectorySearch({
      query: ['first query', 'ignored query'],
      type: 'unsupported-type',
      status: 'VERIFIED_FOREVER',
      page: '-5',
    }),
    {
      query: 'first query',
      type: '',
      status: '',
      neighborhood: '',
      sort: DIRECTORY_DEFAULT_SORT,
      page: 1,
    },
  );
});

test('verified search means non-demonstration evidence inside its freshness window', () => {
  const where = directoryRetailerWhere({
    brandId: 'brand-one',
    filters: {
      query: 'Blue Dream',
      type: 'storefront',
      status: 'VERIFIED_CURRENT',
    },
    asOf: AS_OF,
  });

  assert.equal(where.type, 'storefront');
  assert.equal(where.isDemonstration, false);
  assert.equal(where.dataStatus, 'VERIFIED_CURRENT');
  assert.deepEqual(where.verifiedAt, { not: null, lte: AS_OF });
  assert.deepEqual(where.freshnessExpiresAt, { gt: AS_OF });
  assert.equal(where.menus.some.brandMenus.some.brandId, 'brand-one');
  assert.equal(where.AND[0].OR[0].name.contains, 'Blue Dream');
  assert.equal(
    where.AND[0].OR[4].menus.some.brandMenus.some.brandId,
    'brand-one',
  );
  assert.deepEqual(where.AND[1], {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: AS_OF },
    freshnessExpiresAt: { gt: AS_OF },
  });
});

test('stale and awaiting filters mirror public truth-state resolution', () => {
  const stale = directoryRetailerWhere({
    brandId: 'brand-one',
    filters: { status: 'STALE' },
    asOf: AS_OF,
  });
  assert.deepEqual(stale.AND[0], {
    isDemonstration: false,
    OR: [
      { dataStatus: 'STALE' },
      {
        dataStatus: 'VERIFIED_CURRENT',
        verifiedAt: { not: null },
        freshnessExpiresAt: { lte: AS_OF },
      },
    ],
  });

  const awaiting = directoryRetailerWhere({
    brandId: 'brand-one',
    filters: { status: 'AWAITING_VERIFICATION' },
    asOf: AS_OF,
  });
  assert.deepEqual(awaiting.AND[0].OR[1], {
    dataStatus: 'VERIFIED_CURRENT',
    OR: [{ verifiedAt: null }, { freshnessExpiresAt: null }],
  });
});

test('directory deal chips include only labeled demonstrations or current verified offers', () => {
  const catalogRecordWhere = {
    OR: [
      { isDemonstration: true },
      {
        isDemonstration: false,
        dataStatus: 'VERIFIED_CURRENT',
        verifiedAt: { not: null, lte: AS_OF },
        freshnessExpiresAt: { gt: AS_OF },
      },
    ],
  };

  assert.deepEqual(publicCatalogRecordWhere(AS_OF), catalogRecordWhere);
  assert.deepEqual(currentDealWhere(AS_OF), {
    expiryDate: { gt: AS_OF },
    isActive: true,
    ...catalogRecordWhere,
  });
});

test('pagination links preserve only validated filters', () => {
  assert.equal(
    directorySearchHref(
      {
        query: 'Blue Dream',
        type: 'delivery',
        status: 'STALE',
        sort: 'NAME_ASC',
      },
      3,
    ),
    '/?query=Blue+Dream&type=delivery&status=STALE&sort=NAME_ASC&page=3',
  );
  assert.equal(
    directorySearchHref(
      {
        query: '',
        type: 'invalid',
        status: 'invalid',
      },
      1,
    ),
    '/',
  );
});

test('directory ordering is transparent and never ranks sponsorship', () => {
  assert.deepEqual(directoryRetailerOrderBy('TRUTH_FIRST'), [
    { isDemonstration: 'asc' },
    { verifiedAt: 'desc' },
    { freshnessExpiresAt: 'desc' },
    { updatedAt: 'desc' },
    { id: 'asc' },
  ]);
  assert.deepEqual(directoryRetailerOrderBy('RECENTLY_UPDATED'), [
    { updatedAt: 'desc' },
    { id: 'asc' },
  ]);
  assert.deepEqual(directoryRetailerOrderBy('NAME_ASC'), [
    { name: 'asc' },
    { id: 'asc' },
  ]);
  assert.deepEqual(
    directoryRetailerOrderBy('SPONSORED'),
    directoryRetailerOrderBy(DIRECTORY_DEFAULT_SORT),
  );
});

test('customer home delegates discovery to the canonical bounded Customer World', () => {
  const pageSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/page.tsx'),
    'utf8',
  );
  const customerWorldSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/customer-world.mjs'),
    'utf8',
  );
  const schema = fs.readFileSync(
    path.join(webRoot, 'prisma/schema.prisma'),
    'utf8',
  );

  assert.match(pageSource, /loadCustomerWorld/);
  assert.match(pageSource, /journey: 'HOME'/);
  assert.doesNotMatch(pageSource, /prisma\.retailer|directoryRetailerWhere/);
  assert.match(customerWorldSource, /resolveCustomerDiscovery/);
  assert.match(customerWorldSource, /const QUERY_LIMIT = 160/);
  assert.doesNotMatch(customerWorldSource, /prisma\.retailer|directoryRetailerWhere/);
  assert.doesNotMatch(pageSource, /isSponsored:\s*['"]desc['"]/);
  assert.equal(DIRECTORY_PAGE_SIZE, 20);
  assert.match(
    schema,
    /@@index\(\[dataStatus, isDemonstration, freshnessExpiresAt\]\)/,
  );
  assert.match(schema, /@@index\(\[type\]\)/);
});

test('retailer detail applies the public truth boundary to deals, menu entries, and products', () => {
  const detailSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/retailer/[id]/page.tsx'),
    'utf8',
  );

  assert.match(detailSource, /\.\.\.currentDealWhere\(asOf\)/);
  assert.match(
    detailSource,
    /const catalogRecordWhere = publicCatalogRecordWhere\(asOf\)/,
  );
  assert.match(detailSource, /\.\.\.catalogRecordWhere/);
  assert.match(detailSource, /product: catalogRecordWhere/);
  assert.doesNotMatch(
    detailSource,
    /deals:\s*\{\s*where:\s*\{\s*expiryDate:/,
  );
});
