import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

let resolver;
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

before(async () => {
  try {
    resolver = await import('../src/lib/reality/entity-resolution.mjs');
  } catch (error) {
    assert.fail(`Sovereign entity resolver is not implemented: ${error.message}`);
  }
});

const retailers = [
  { id: 'r-1', licenseNumber: 'ABRA-123456', name: 'Green' },
  { id: 'r-2', licenseNumber: 'ABRA-654321', name: 'Green Guard' },
];

test('exact normalized ABCA license is the sovereign automatic identity', () => {
  const result = resolver.resolveAbcaEntity({
    record: { ABCA_NUMBER: '  abra-123456 ', TRADE_NAME: 'Different Trade Name' },
    retailers,
    aliases: [],
  });
  assert.equal(result.status, 'EXACT_MATCH');
  assert.equal(result.retailer_id, 'r-1');
  assert.equal(result.method, 'EXACT_LICENSE');
});

test('same name, substring name, missing identifier, and conflicts never auto-link', () => {
  const cases = [
    { record: { ABCA_NUMBER: 'ABRA-999999', TRADE_NAME: 'Green' }, expected: 'UNMATCHED' },
    { record: { ABCA_NUMBER: '', TRADE_NAME: 'Green Guard' }, expected: 'MALFORMED' },
    { record: { ABCA_NUMBER: 'ABRA-123456', TRADE_NAME: 'Green' }, retailers: [...retailers, { id: 'r-3', licenseNumber: 'abra-123456', name: 'Collision' }], expected: 'REVIEW_REQUIRED' },
  ];
  for (const fixture of cases) {
    const result = resolver.resolveAbcaEntity({
      record: fixture.record,
      retailers: fixture.retailers ?? retailers,
      aliases: [],
    });
    assert.equal(result.status, fixture.expected);
    assert.equal(result.retailer_id ?? null, null);
  }
});

test('an exact but unlinked alias is quarantined for review', () => {
  const resolution = resolver.resolveAbcaEntity({
    record: { ABCA_NUMBER: 'ABRA-123456' },
    aliases: [{ id: 'alias-1', namespace: 'dc_abca_license', externalId: 'ABRA-123456', geoEntityId: 'geo-1' }],
  });

  assert.equal(resolution.status, 'REVIEW_REQUIRED');
  assert.equal(resolution.method, 'EXACT_ALIAS_UNLINKED');
  assert.deepEqual(resolution.candidate_ids, ['alias-1']);
});

test('coordinates are either exact usable observations or explicit UNKNOWN', () => {
  const valid = resolver.normalizeCoordinates({ LATITUDE: '38.906', LONGITDUE: '-77.02' });
  assert.deepEqual(valid, { state: 'KNOWN', lat: 38.906, lng: -77.02 });

  for (const fixture of [
    { LATITUDE: '', LONGITDUE: '' },
    { LATITUDE: '38.9junk', LONGITDUE: '-77.0' },
    { LATITUDE: '91', LONGITDUE: '-77' },
    { LATITUDE: '0', LONGITDUE: '0' },
  ]) {
    const result = resolver.normalizeCoordinates(fixture);
    assert.equal(result.state, 'UNKNOWN');
    assert.equal('lat' in result, false);
    assert.equal('lng' in result, false);
    assert.notDeepEqual(result, { state: 'KNOWN', lat: 38.9, lng: -77 });
  }
});

test('entity-resolution benchmark keeps false sovereign automatic links at zero', () => {
  const report = resolver.runEntityResolutionBenchmark({
    records: [
      { ABCA_NUMBER: 'ABRA-123456', TRADE_NAME: 'Renamed' },
      { ABCA_NUMBER: 'ABRA-999999', TRADE_NAME: 'Green' },
      { ABCA_NUMBER: '', TRADE_NAME: 'Green Guard' },
    ],
    retailers,
    aliases: [],
  });
  assert.equal(report.false_automatic_links, 0);
  assert.equal(report.exact_matches, 1);
  assert.equal(report.unmatched_records, 1);
  assert.equal(report.malformed_records, 1);
});

test('legacy ABCA writers are retired before imports, parsing, or mutation', () => {
  const etl = fs.readFileSync(path.join(WEB, 'scripts', 'etl-abca-retailers.mjs'), 'utf8');
  const ingest = fs.readFileSync(path.join(WEB, 'scripts', 'ingest-abca-feed.mjs'), 'utf8');
  const seed = fs.readFileSync(path.join(WEB, 'scripts', 'seed-abca-retailers.mjs'), 'utf8');
  for (const source of [etl, ingest, seed]) {
    assert.match(source, /CANA_LEGACY_ABCA_PATH_RETIRED/);
    assert.doesNotMatch(source, /@prisma\/client|PrismaClient|readFile|fetch\(|contains:/);
  }
});
