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

test('public discovery accepts only current, non-demo evidence verified by asOf', () => {
  const currentRecord = {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: new Date('2026-07-16T20:00:00.000Z'),
    freshnessExpiresAt: new Date('2026-07-18T20:00:00.000Z'),
  };

  for (const [label, retailer] of [
    ['awaiting verification', {
      ...currentRecord,
      dataStatus: 'AWAITING_VERIFICATION',
    }],
    ['stale', {
      ...currentRecord,
      dataStatus: 'STALE',
      freshnessExpiresAt: new Date('2026-07-16T20:00:00.000Z'),
    }],
    ['missing freshness', {
      ...currentRecord,
      freshnessExpiresAt: null,
    }],
    ['expired freshness', {
      ...currentRecord,
      freshnessExpiresAt: AS_OF,
    }],
    ['demonstration', {
      ...currentRecord,
      isDemonstration: true,
    }],
    ['future verification', {
      ...currentRecord,
      verifiedAt: new Date('2026-07-18T20:00:00.000Z'),
    }],
  ]) {
    assert.equal(isPubliclyDiscoverable(retailer, AS_OF), false, label);
  }

  assert.equal(isPubliclyDiscoverable(currentRecord, AS_OF), true);
});

test('Prisma discovery policy mirrors the in-memory release boundary', () => {
  assert.deepEqual(publicRetailerWhere(AS_OF), {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: AS_OF },
    freshnessExpiresAt: { gt: AS_OF },
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

  assert.match(directory, /publicRetailerWhere\(timestamp\)/);
  assert.match(tenant, /publicRetailerWhere\(asOf\)/);
  assert.match(neighborhood, /neighborhoodCandidateWhere/);
  assert.match(neighborhoodSearch, /publicRetailerWhere\(timestamp\)/);
  assert.match(neighborhood, /currentDealWhere\(asOf\)/);
});
