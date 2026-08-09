import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MERCHANT_CATALOG_QUERY_MAX_LENGTH,
  MERCHANT_PAGE_SIZE,
  availableCatalogWhere,
  clampMerchantPage,
  merchantDashboardHref,
  merchantPageCount,
  merchantPageOffset,
  parseMerchantDashboardSearch,
} from '../src/lib/merchant-dashboard.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');

test('merchant collection pages and catalog search are normalized and preserved', () => {
  const parsed = parseMerchantDashboardSearch({
    menuPage: '2',
    dealPage: ['3', '8'],
    catalogPage: '9999',
    catalogQuery: `  Sour\u0000   ${'x'.repeat(100)} `,
  });
  assert.deepEqual(parsed, {
    menuPage: 2,
    dealPage: 3,
    catalogPage: 1_000,
    catalogQuery: `Sour ${'x'.repeat(75)}`,
  });
  assert.equal(
    parsed.catalogQuery.length,
    MERCHANT_CATALOG_QUERY_MAX_LENGTH,
  );
  assert.equal(
    merchantDashboardHref(parsed, 'menuPage', 1),
    `/business/dashboard?catalogQuery=${encodeURIComponent(parsed.catalogQuery).replaceAll('%20', '+')}&dealPage=3&catalogPage=1000`,
  );
});

test('merchant offsets use a fixed page size and clamp to available records', () => {
  assert.equal(MERCHANT_PAGE_SIZE, 25);
  assert.equal(merchantPageCount(0), 1);
  assert.equal(merchantPageCount(26), 2);
  assert.equal(clampMerchantPage(99, 26), 2);
  assert.equal(merchantPageOffset(2), 25);
});

test('catalog selection excludes the current tenant inventory and bounds search fields', () => {
  assert.deepEqual(availableCatalogWhere('retailer-one', '  Edibles '), {
    menuEntries: {
      none: {
        retailerId: 'retailer-one',
      },
    },
    // mode:'insensitive' is REQUIRED on PostgreSQL: SQLite matched
    // case-insensitively by default, PostgreSQL does not. See
    // docs/migration/SQLITE_TO_POSTGRES.md §1 and tests/postgres-semantics.test.mjs.
    OR: [
      { name: { contains: 'Edibles', mode: 'insensitive' } },
      { category: { contains: 'Edibles', mode: 'insensitive' } },
      { description: { contains: 'Edibles', mode: 'insensitive' } },
    ],
  });
  assert.throws(() => availableCatalogWhere('../retailer', ''), TypeError);
});

test('the merchant dashboard uses tenant-scoped counts and bounded collection reads', () => {
  const source = fs.readFileSync(
    path.join(webRoot, 'src/app/business/dashboard/page.tsx'),
    'utf8',
  );

  assert.doesNotMatch(source, /include:\s*\{\s*deals:\s*true,\s*menus:/);
  assert.match(source, /prisma\.menuEntry\.count/);
  assert.match(source, /prisma\.deal\.count/);
  assert.match(source, /prisma\.product\.count/);
  assert.match(source, /where: \{ retailerId \}/);
  assert.match(source, /take: MERCHANT_PAGE_SIZE/g);
  assert.match(source, /skip: merchantPageOffset\(/g);
  assert.match(source, /<DashboardPagination/g);
  assert.match(source, /name="catalogQuery"/);
});
