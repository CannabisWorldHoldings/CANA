import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RETAILER_COMPARE_INPUT_LIMIT,
  RETAILER_COMPARE_LIMIT,
  parseRetailerCompareSelection,
  retailerCompareHref,
  retailerCompareWhere,
} from '../src/lib/retailer-compare.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const AS_OF = new Date('2026-07-17T20:00:00.000Z');

test('comparison selection is unique, validated, and strictly bounded', () => {
  const parsed = parseRetailerCompareSelection([
    'retailer-one',
    'retailer-one',
    '../private',
    'retailer-two',
    'retailer-three',
    'retailer-four',
  ]);

  assert.deepEqual(parsed.ids, [
    'retailer-one',
    'retailer-two',
    'retailer-three',
  ]);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.invalidCount, 1);
  assert.equal(parsed.overLimitCount, 1);
  assert.equal(parsed.rejectedCount, 3);
  assert.equal(RETAILER_COMPARE_LIMIT, 3);
  assert.equal(RETAILER_COMPARE_INPUT_LIMIT, 12);

  assert.deepEqual(parseRetailerCompareSelection('retailer-one').ids, [
    'retailer-one',
  ]);
});

test('comparison query composes tenant and public evidence boundaries', () => {
  const where = retailerCompareWhere({
    brandId: 'brand-one',
    retailerIds: ['retailer-one', 'retailer-two'],
    asOf: AS_OF,
  });

  assert.deepEqual(where.id.in, ['retailer-one', 'retailer-two']);
  assert.equal(where.menus.some.brandMenus.some.brandId, 'brand-one');
  assert.deepEqual(where, {
    id: { in: ['retailer-one', 'retailer-two'] },
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: AS_OF },
    freshnessExpiresAt: { gt: AS_OF },
    menus: {
      some: {
        brandMenus: {
          some: {
            brandId: 'brand-one',
          },
        },
      },
    },
  });
  assert.throws(
    () =>
      retailerCompareWhere({
        brandId: '../brand',
        retailerIds: ['retailer-one'],
        asOf: AS_OF,
      }),
    /Brand ID/,
  );
  assert.throws(
    () =>
      retailerCompareWhere({
        brandId: 'brand-one',
        retailerIds: ['retailer-one'],
        asOf: new Date('invalid'),
      }),
    /comparison time/,
  );
});

test('comparison links contain only normalized bounded identifiers', () => {
  assert.equal(
    retailerCompareHref([
      'retailer-one',
      '../private',
      'retailer-two',
      'retailer-three',
      'retailer-four',
    ]),
    '/compare?retailer=retailer-one&retailer=retailer-two&retailer=retailer-three',
  );
  assert.equal(retailerCompareHref([]), '/compare');
});

test('comparison UI remains noindex, bounded, evidence-aware, and separate from canonical customer discovery', () => {
  const compareSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/compare/page.tsx'),
    'utf8',
  );
  const homeSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/page.tsx'),
    'utf8',
  );
  const robotsSource = fs.readFileSync(
    path.join(webRoot, 'src/app/robots.ts'),
    'utf8',
  );
  const siteBrainSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/site-intelligence.mjs'),
    'utf8',
  );

  assert.match(
    compareSource,
    /robots:\s*\{\s*index:\s*false,\s*follow:\s*false,\s*nocache:\s*true/,
  );
  assert.match(compareSource, /retailerCompareWhere/);
  assert.match(compareSource, /take: RETAILER_COMPARE_LIMIT/);
  assert.match(compareSource, /\.\.\.publicCatalogWhere/);
  assert.match(compareSource, /\.\.\.currentDealWhere\(asOf\)/);
  assert.match(compareSource, /safePublicReferenceUrl\(retailer\.sourceUrl\)/);
  assert.doesNotMatch(compareSource, /localStorage|sessionStorage|cookies\(/);
  assert.match(homeSource, /loadCustomerWorld/);
  assert.doesNotMatch(homeSource, /action="\/compare"|name="retailer"/);
  assert.doesNotMatch(homeSource, /prisma\.retailer/);
  assert.match(robotsSource, /'\/compare'/);
  assert.match(siteBrainSource, /id: 'compare'/);
});
