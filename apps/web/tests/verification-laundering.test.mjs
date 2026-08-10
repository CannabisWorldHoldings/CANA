import assert from 'node:assert/strict';
import { before, test } from 'node:test';

let adapter;

before(async () => {
  try {
    adapter = await import('../src/lib/reality/market-claim-adapter.mjs');
  } catch (error) {
    assert.fail(`Public Market Truth Projection is not implemented: ${error.message}`);
  }
});

const AS_OF = new Date('2026-06-06T12:00:00.000Z');
const current = {
  verification: 'VERIFIED',
  decision_eligible: true,
  source_id: 'dcgis:abca:licensed-medical-cannabis-retailers:layer-31',
  observed_at: '2026-06-05T12:00:00.000Z',
  freshness_expires_at: '2026-07-05T12:00:00.000Z',
  confidence: 1,
};

test('verified license cannot launder unrelated retailer fields', () => {
  const projection = adapter.compileRetailerTruth({
    retailer: {
      id: 'r-1',
      licenseNumber: 'ABRA-123456',
      hours: 'Open 24 hours',
      phone: '202-555-0100',
      website: 'https://example.test',
      isOpen: true,
      delivery: true,
    },
    claimDecisions: [
      { ...current, predicate: 'license_number', value: 'ABRA-123456' },
      { ...current, predicate: 'license_status', value: 'ACTIVE' },
    ],
    asOf: AS_OF,
  });

  assert.equal(projection.license.state, 'KNOWN');
  for (const field of ['hours', 'phone', 'website', 'service_area', 'delivery', 'menu', 'price', 'availability', 'deals']) {
    assert.deepEqual(projection[field], {
      state: 'UNKNOWN',
      reason: 'NO_DECISION_ELIGIBLE_CLAIM',
    });
  }
});

test('stale and contradicted claims are UNKNOWN at the projection boundary', () => {
  const projection = adapter.compileRetailerTruth({
    retailer: { id: 'r-1' },
    claimDecisions: [
      { ...current, predicate: 'website', value: 'https://example.test', freshness_expires_at: '2026-06-06T12:00:00.000Z' },
      { ...current, predicate: 'hours', value: '9-5', verification: 'CONTRADICTED', decision_eligible: false },
    ],
    asOf: AS_OF,
  });
  assert.equal(projection.website.state, 'UNKNOWN');
  assert.equal(projection.hours.state, 'UNKNOWN');
});

test('newest eligible duplicate predicate wins in public projection and provenance', () => {
  const projection = adapter.compileRetailerTruth({
    retailer: { id: 'r-1' },
    claimDecisions: [
      { ...current, predicate: 'license_status', value: 'ACTIVE', observed_at: '2026-06-05T12:00:00.000Z' },
      { ...current, predicate: 'license_status', value: 'SUSPENDED', observed_at: '2026-06-06T11:00:00.000Z' },
    ],
    asOf: AS_OF,
  });
  assert.equal(projection.license.state, 'KNOWN');
  assert.equal(projection.license.value, 'SUSPENDED');
  assert.equal(projection.license.provenance.length, 1);
  assert.equal(projection.license.provenance[0].observed_at, '2026-06-06T11:00:00.000Z');
});

test('incomplete snapshots and source outages never become negative truth', () => {
  for (const completeness of ['UNKNOWN', 'PARTIAL', 'SOURCE_OUTAGE', 'PARSER_FAILED']) {
    const result = adapter.compileAbsenceClaim({
      predicate: 'license_status',
      completeness,
      sourceAllowsAbsenceInference: true,
    });
    assert.deepEqual(result, {
      state: 'UNKNOWN',
      reason: 'SNAPSHOT_NOT_COMPLETE',
    });
  }
});
