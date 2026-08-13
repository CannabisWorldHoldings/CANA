import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_DEAL_PREVIEW_LIMIT,
  RETAILER_DEAL_PAGE_SIZE,
  RETAILER_MENU_PAGE_SIZE,
  clampRetailerDetailPage,
  parseRetailerDetailSearch,
  retailerDetailHref,
  retailerDetailPageCount,
  retailerDetailPageOffset,
} from '../src/lib/retailer-detail-search.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');

test('retailer detail collection pages are bounded and independently preserved', () => {
  assert.deepEqual(
    parseRetailerDetailSearch({
      menuPage: ['2', 'ignored'],
      dealPage: '9999',
    }),
    { menuPage: 2, dealPage: 1_000 },
  );
  assert.equal(
    retailerDetailPageCount(RETAILER_MENU_PAGE_SIZE + 1, 'menuPage'),
    2,
  );
  assert.equal(
    retailerDetailPageCount(RETAILER_DEAL_PAGE_SIZE * 2, 'dealPage'),
    2,
  );
  assert.equal(
    clampRetailerDetailPage(99, RETAILER_DEAL_PAGE_SIZE + 1, 'dealPage'),
    2,
  );
  assert.equal(
    retailerDetailPageOffset(3, 'menuPage'),
    RETAILER_MENU_PAGE_SIZE * 2,
  );
  assert.equal(
    retailerDetailHref(
      'retailer-one',
      { menuPage: 2, dealPage: 3 },
      'menuPage',
      4,
    ),
    '/retailer/retailer-one?menuPage=4&dealPage=3',
  );
  assert.throws(
    () => retailerDetailHref('../retailer', {}, 'menuPage', 2),
    /invalid format/,
  );
  assert.throws(
    () => retailerDetailPageCount(1, 'unknownPage'),
    /Unknown retailer detail collection/,
  );
});

test('public retailer collections and card previews use fixed database limits', () => {
  const detailSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/retailer/[id]/page.tsx'),
    'utf8',
  );
  const customerHomeSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/page.tsx'),
    'utf8',
  );
  const neighborhoodSource = fs.readFileSync(
    path.join(
      webRoot,
      'src/app/[domain]/neighborhoods/[slug]/page.tsx',
    ),
    'utf8',
  );

  assert.match(detailSource, /prisma\.deal\.count/);
  assert.match(detailSource, /prisma\.menuEntry\.count/);
  assert.match(
    detailSource,
    /skip: retailerDetailPageOffset\(search\.dealPage, 'dealPage'\)/,
  );
  assert.match(
    detailSource,
    /skip: retailerDetailPageOffset\(search\.menuPage, 'menuPage'\)/,
  );
  assert.match(detailSource, /take: RETAILER_DEAL_PAGE_SIZE/);
  assert.match(detailSource, /take: RETAILER_MENU_PAGE_SIZE/);
  assert.match(neighborhoodSource, /take: PUBLIC_DEAL_PREVIEW_LIMIT/);
  assert.match(customerHomeSource, /loadCustomerWorld/);
  assert.doesNotMatch(customerHomeSource, /PUBLIC_DEAL_PREVIEW_LIMIT|prisma\.retailer/);
  assert.equal(PUBLIC_DEAL_PREVIEW_LIMIT, 3);
});
