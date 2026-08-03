import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isPubliclyDiscoverable,
  publicRetailerWhere,
} from '../src/lib/public-retailer.mjs';

const AS_OF = new Date('2026-07-17T20:00:00.000Z');
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');

test('new real submissions remain private until evidence has been reviewed', () => {
  assert.equal(
    isPubliclyDiscoverable({
      isDemonstration: false,
      dataStatus: 'AWAITING_VERIFICATION',
      verifiedAt: null,
    }, AS_OF),
    false,
  );
  assert.equal(
    isPubliclyDiscoverable({
      isDemonstration: false,
      dataStatus: 'STALE',
      verifiedAt: new Date('2026-06-17T20:00:00.000Z'),
    }, AS_OF),
    true,
  );
  assert.equal(
    isPubliclyDiscoverable({
      isDemonstration: false,
      verifiedAt: new Date('2026-07-18T20:00:00.000Z'),
    }, AS_OF),
    false,
  );
  assert.equal(
    isPubliclyDiscoverable({
      isDemonstration: true,
      verifiedAt: null,
    }, AS_OF),
    true,
  );
});

test('Prisma discovery policy mirrors the in-memory release boundary', () => {
  assert.deepEqual(publicRetailerWhere(AS_OF), {
    OR: [
      { isDemonstration: true },
      {
        isDemonstration: false,
        verifiedAt: {
          not: null,
          lte: AS_OF,
        },
      },
    ],
  });
});

test('every public retailer discovery route imports the shared policy', () => {
  const directory = fs.readFileSync(
    path.join(webRoot, 'src/lib/directory-search.mjs'),
    'utf8',
  );
  const tenant = fs.readFileSync(
    path.join(webRoot, 'src/lib/tenant-retailer.mjs'),
    'utf8',
  );
  const neighborhood = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/neighborhoods/[slug]/page.tsx'),
    'utf8',
  );
  const neighborhoodSearch = fs.readFileSync(
    path.join(webRoot, 'src/lib/neighborhood-search.mjs'),
    'utf8',
  );
  const customerMarketplace = fs.readFileSync(
    path.join(webRoot, 'src/lib/customer-marketplace-data.ts'),
    'utf8',
  );

  assert.match(directory, /publicRetailerWhere\(timestamp\)/);
  assert.match(tenant, /publicRetailerWhere\(asOf\)/);
  assert.match(neighborhood, /neighborhoodCandidateWhere/);
  assert.match(neighborhoodSearch, /publicRetailerWhere\(timestamp\)/);
  assert.match(neighborhood, /currentDealWhere\(asOf\)/);
  assert.match(customerMarketplace, /\.\.\.publicRetailerWhere\(asOf\)/);
  assert.match(customerMarketplace, /\.\.\.publicCatalogRecordWhere\(asOf\)/);
  assert.match(
    customerMarketplace,
    /prisma\.article\.findMany\(\{\s*where: publicCatalogRecordWhere\(asOf\)/,
  );
  assert.match(
    customerMarketplace,
    /menuEntries:\s*\{\s*some: brandMenuEntryScope\(brand\.id, asOf\)/,
  );
});
