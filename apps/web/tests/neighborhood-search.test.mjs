import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  NEIGHBORHOOD_CANDIDATE_LIMIT,
  neighborhoodCandidateWhere,
} from '../src/lib/neighborhood-search.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const AS_OF = new Date('2026-07-17T18:00:00.000Z');

test('neighborhood candidates are tenant, evidence, ZIP, and coordinate bounded', () => {
  const where = neighborhoodCandidateWhere({
    brandId: 'brand-one',
    latitude: 38.9097,
    longitude: -77.0654,
    zips: ['20007', '20007'],
    asOf: AS_OF,
  });

  assert.equal(where.menus.some.brandMenus.some.brandId, 'brand-one');
  assert.deepEqual(where.AND[0].OR[0], { zip: { in: ['20007'] } });
  assert.deepEqual(where.AND[0].OR[1], {
    lat: { gte: 38.8697, lte: 38.9497 },
    lng: { gte: -77.1154, lte: -77.0154 },
  });
  assert.equal(where.isDemonstration, false);
  assert.equal(where.dataStatus, 'VERIFIED_CURRENT');
  assert.deepEqual(where.verifiedAt, {
    not: null,
    lte: AS_OF,
  });
  assert.deepEqual(where.freshnessExpiresAt, { gt: AS_OF });
});

test('neighborhood candidate inputs reject malformed scope and geography', () => {
  const valid = {
    brandId: 'brand-one',
    latitude: 38.9,
    longitude: -77,
    zips: ['20001'],
    asOf: AS_OF,
  };
  assert.throws(
    () => neighborhoodCandidateWhere({ ...valid, brandId: '../brand' }),
    /Brand ID/,
  );
  assert.throws(
    () => neighborhoodCandidateWhere({ ...valid, latitude: 91 }),
    /Latitude/,
  );
  assert.throws(
    () => neighborhoodCandidateWhere({ ...valid, zips: ['2000'] }),
    /ZIP/,
  );
  assert.throws(
    () =>
      neighborhoodCandidateWhere({
        ...valid,
        asOf: new Date('invalid'),
      }),
    /search time/,
  );
});

test('neighborhood route counts and caps stable database candidates', () => {
  const source = fs.readFileSync(
    path.join(
      webRoot,
      'src/app/[domain]/neighborhoods/[slug]/page.tsx',
    ),
    'utf8',
  );
  assert.match(source, /neighborhoodCandidateWhere/);
  assert.match(
    source,
    /prisma\.retailer\.count\(\{\s*where:\s*candidateWhere/,
  );
  assert.match(source, /take: NEIGHBORHOOD_CANDIDATE_LIMIT/);
  assert.match(source, /orderBy: \{ id: ['"]asc['"] \}/);
  assert.match(source, /candidateCount > NEIGHBORHOOD_CANDIDATE_LIMIT/);
  assert.equal(NEIGHBORHOOD_CANDIDATE_LIMIT, 200);
});
