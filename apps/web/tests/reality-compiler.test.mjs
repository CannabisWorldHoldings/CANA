import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

let reality;
let court;
let officialSource;

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(WEB, 'fixtures', 'reality', 'dc-abca-layer-31', '2026-06-05');

before(async () => {
  try {
    reality = await import('../src/lib/reality/reality-compiler.mjs');
    court = await import('../src/lib/reality/market-claim-court.mjs');
    officialSource = await import('../src/lib/reality/official-source-snapshot.mjs');
  } catch (error) {
    assert.fail(`Reality Compiler is not implemented: ${error.message}`);
  }
});

test('committed official snapshot validates offline with exact hashes and ordering', () => {
  const beforeFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden in offline validation'); };
  try {
    const loaded = officialSource.loadOfficialSourceSnapshot(FIXTURE);
    assert.equal(loaded.source_id, reality.DC_ABCA_SOURCE.source_id);
    assert.ok(loaded.records.length > 0);
    assert.equal(loaded.record_count, loaded.records.length);
    assert.equal(loaded.records.every((record, index, records) => index === 0 || record.OBJECTID > records[index - 1].OBJECTID), true);
  } finally {
    globalThis.fetch = beforeFetch;
  }
});

test('official snapshot digest tampering and CI network capture fail closed', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-official-source-'));
  try {
    fs.cpSync(FIXTURE, scratch, { recursive: true });
    fs.appendFileSync(path.join(scratch, 'snapshot.json'), ' ');
    assert.throws(
      () => officialSource.loadOfficialSourceSnapshot(scratch),
      /CANA_OFFICIAL_SOURCE_SNAPSHOT_DIGEST_MISMATCH/,
    );

    const output = path.join(os.tmpdir(), `cana-official-source-refusal-${process.pid}`);
    const result = spawnSync(process.execPath, [
      path.join(WEB, 'scripts', 'capture-dc-abca-snapshot.mjs'),
      '--allow-network',
      '--output',
      output,
    ], { encoding: 'utf8', env: { ...process.env, CI: '1' } });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /CANA_OFFICIAL_SOURCE_NETWORK_REFUSED_IN_CI/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('live capture refuses an unversioned multi-page continuation', () => {
  assert.throws(
    () => officialSource.assertVersionBoundCapturePage({
      exceededTransferLimit: true,
      featureCount: 500,
      pageSize: 500,
    }),
    /CANA_OFFICIAL_SOURCE_UNVERSIONED_MULTIPAGE_REFUSED/,
  );
  assert.doesNotThrow(() => officialSource.assertVersionBoundCapturePage({
    exceededTransferLimit: false,
    featureCount: 74,
    pageSize: 500,
  }));
});

const FETCHED_AT = '2026-06-05T12:00:00.000Z';
const AS_OF = new Date('2026-06-06T12:00:00.000Z');

function payload(overrides = {}) {
  return Buffer.from(JSON.stringify({
    features: [
      {
        attributes: {
          OBJECTID: 3275,
          GLOBALID: '{11111111-1111-1111-1111-111111111111}',
          ABCA_NUMBER: 'ABRA-123456',
          FACILITY_NAME: 'Truthful Green',
          FACILITY_TYPE: 'Retailer',
          LICENSE_TYPE: 'Retailer',
          EXPIRATION_DATE: Date.parse('2027-06-05T00:00:00.000Z'),
          ADDRESS: '100 Truth Ave NW, Washington, DC 20001',
          LATITUDE: 38.906,
          LONGITDUE: -77.02,
          TRADE_NAME: 'Truthful Green',
          ENTITY_NAME: 'Truthful Green LLC',
          STATUS: 'Active',
          ISSUE_DATE: Date.parse('2025-06-05T00:00:00.000Z'),
          EDITED: Date.parse('2026-06-04T15:45:05.000Z'),
          WARD: 2,
          ENDORSEMENTS: null,
          ...overrides,
        },
        geometry: { x: -77.02, y: 38.906 },
      },
    ],
  }));
}

test('same official bytes compile to the same immutable snapshot digest', () => {
  const first = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: payload(),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const second = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: payload(),
    fetchedAt: '2026-06-06T12:00:00.000Z',
    completeness: 'COMPLETE',
  });

  assert.equal(first.sha256, second.sha256);
  assert.equal(first.byte_length, second.byte_length);
  assert.equal(first.payload_bytes.equals(payload()), true);
  assert.equal(Object.isFrozen(first), true);
});

test('ordered multi-page captures bind every page and reject incomplete pagination', () => {
  const first = JSON.parse(payload().toString('utf8'));
  first.exceededTransferLimit = true;
  const second = JSON.parse(payload({ OBJECTID: 3276, ABCA_NUMBER: 'ABRA-654321' }).toString('utf8'));
  second.exceededTransferLimit = false;
  const pages = [
    { offset: 0, bytes: Buffer.from(JSON.stringify(first)) },
    { offset: 1, bytes: Buffer.from(JSON.stringify(second)) },
  ];
  const snapshot = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadPages: pages,
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const replay = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadPages: pages,
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  assert.equal(snapshot.sha256, replay.sha256);
  assert.equal(reality.parseAbcaSnapshot(snapshot).records.length, 2);

  second.exceededTransferLimit = true;
  const incomplete = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadPages: [pages[0], { offset: 1, bytes: Buffer.from(JSON.stringify(second)) }],
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  assert.throws(() => reality.parseAbcaSnapshot(incomplete), /CANA_REALITY_PAGE_ENVELOPE_INCOMPLETE/);
});

test('parser output remains UNKNOWN and cannot make itself decision eligible', () => {
  const snapshot = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: payload(),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const parsed = reality.parseAbcaSnapshot(snapshot);

  assert.equal(parsed.invalid_observations.length, 0);
  assert.ok(parsed.observations.length >= 4);
  for (const observation of parsed.observations) {
    assert.equal(observation.verification, 'UNKNOWN');
    assert.equal(observation.decision_eligible, false);
    assert.equal('verified' in observation, false);
  }
});

test('malformed geometry and absent expiration stay UNKNOWN without epoch coercion', () => {
  const malformedPayload = JSON.parse(payload({ EXPIRATION_DATE: null }).toString('utf8'));
  malformedPayload.features[0].geometry.y = 'not-a-coordinate';
  const snapshot = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: Buffer.from(JSON.stringify(malformedPayload)),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const parsed = reality.parseAbcaSnapshot(snapshot);

  assert.equal(parsed.observations.some((entry) => entry.predicate === 'located_at'), false);
  assert.equal(parsed.observations.some((entry) => entry.predicate === 'license_expiration'), false);
  assert.equal(parsed.invalid_observations.some((entry) => entry.reason === 'ATTRIBUTE_GEOMETRY_CONFLICT'), true);
  assert.equal(parsed.invalid_observations.some((entry) => entry.predicate === 'license_expiration'), true);
  const compiled = reality.compileRealitySnapshot({
    snapshot,
    retailers: [{ id: 'retailer-1', licenseNumber: 'ABRA-123456' }],
  });
  assert.equal(compiled.claims.every((claim) => claim.freshness_expires_at === '2026-07-05T12:00:00.000Z'), true);
});

test('semantic source-record digests are canonical across object key ordering', () => {
  const firstPayload = JSON.parse(payload().toString('utf8'));
  const firstAttributes = firstPayload.features[0].attributes;
  const secondPayload = structuredClone(firstPayload);
  secondPayload.features[0].attributes = Object.fromEntries(Object.entries(firstAttributes).reverse());
  const first = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: Buffer.from(JSON.stringify(firstPayload)),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const second = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: Buffer.from(JSON.stringify(secondPayload)),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  assert.equal(reality.parseAbcaSnapshot(first).records[0].record_hash, reality.parseAbcaSnapshot(second).records[0].record_hash);
});

test('only the Verification Court admits supported current official claims', () => {
  const snapshot = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: payload(),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const retailers = [{ id: 'retailer-1', licenseNumber: 'abra-123456' }];
  const compiled = reality.compileRealitySnapshot({
    snapshot,
    retailers,
  });
  const decisions = compiled.claims.map((claim) => court.adjudicateMarketClaim({
    claim,
    snapshot,
    sourcePolicy: reality.DC_ABCA_SOURCE,
    identityContext: { retailers, aliases: [] },
    asOf: AS_OF,
  }));

  assert.ok(decisions.some((entry) => entry.predicate === 'license_number'));
  assert.ok(decisions.some((entry) => entry.predicate === 'license_status'));
  assert.ok(decisions.some((entry) => entry.predicate === 'regulated_address'));
  assert.ok(decisions.filter((entry) => entry.decision_eligible).every(
    (entry) => ['license_number', 'license_status', 'regulated_address', 'operating_status'].includes(entry.predicate),
  ));
  assert.ok(decisions.filter((entry) => entry.decision_eligible).every(
    (entry) => entry.verification === 'VERIFIED' && entry.court_version,
  ));
});

test('tampered, stale, incomplete, or unsupported evidence fails closed', () => {
  const snapshot = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: payload(),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const retailers = [{ id: 'retailer-1', licenseNumber: 'ABRA-123456' }];
  const [claim] = reality.compileRealitySnapshot({
    snapshot,
    retailers,
  }).claims;
  const identityContext = { retailers, aliases: [] };

  assert.equal(court.adjudicateMarketClaim({
    claim: { ...claim, predicate: 'hours' },
    snapshot,
    sourcePolicy: reality.DC_ABCA_SOURCE,
    identityContext,
    asOf: AS_OF,
  }).decision_eligible, false);
  assert.equal(court.adjudicateMarketClaim({
    claim,
    snapshot: { ...snapshot, sha256: '0'.repeat(64) },
    sourcePolicy: reality.DC_ABCA_SOURCE,
    identityContext,
    asOf: AS_OF,
  }).verification, 'REFUTED');
  assert.equal(court.adjudicateMarketClaim({
    claim,
    snapshot: { ...snapshot, completeness: 'UNKNOWN' },
    sourcePolicy: reality.DC_ABCA_SOURCE,
    identityContext,
    asOf: AS_OF,
  }).decision_eligible, false);
  assert.equal(court.adjudicateMarketClaim({
    claim,
    snapshot,
    sourcePolicy: reality.DC_ABCA_SOURCE,
    identityContext,
    asOf: new Date('2027-07-01T00:00:00.000Z'),
  }).verification, 'STALE');
});

test('court independently rejects forged subject resolution and observation linkage', () => {
  const snapshot = reality.createEvidenceSnapshot({
    sourceId: reality.DC_ABCA_SOURCE.source_id,
    payloadBytes: payload(),
    fetchedAt: FETCHED_AT,
    completeness: 'COMPLETE',
  });
  const retailers = [{ id: 'retailer-1', licenseNumber: 'ABRA-123456' }];
  const compiled = reality.compileRealitySnapshot({ snapshot, retailers });
  const claim = compiled.claims.find((entry) => entry.predicate === 'license_number');
  const observation = compiled.observations.find((entry) => entry.observation_id === claim.observation_ids[0]);
  const courtClaim = {
    ...claim,
    geo_entity_id: null,
    supporting_observations: [observation],
  };
  const input = {
    snapshot,
    sourcePolicy: reality.DC_ABCA_SOURCE,
    identityContext: { retailers, aliases: [] },
    asOf: AS_OF,
  };

  assert.equal(court.adjudicateMarketClaim({ claim: courtClaim, ...input }).decision, 'ALLOW');
  const forgedSubject = court.adjudicateMarketClaim({
    claim: { ...courtClaim, subject_id: 'victim-retailer' },
    ...input,
  });
  assert.equal(forgedSubject.decision_eligible, false);
  assert.equal(forgedSubject.reason, 'IDENTITY_RESOLUTION_MISMATCH');

  const forgedEvidence = court.adjudicateMarketClaim({
    claim: {
      ...courtClaim,
      supporting_observations: [{ ...observation, source_record_key: 'ABRA-FORGED' }],
    },
    ...input,
  });
  assert.equal(forgedEvidence.decision_eligible, false);
  assert.equal(forgedEvidence.reason, 'CLAIM_EVIDENCE_LINK_MISMATCH');

  const forgedFreshness = court.adjudicateMarketClaim({
    claim: { ...courtClaim, freshness_expires_at: '2027-06-05T00:00:00.000Z' },
    ...input,
    asOf: new Date('2026-07-20T00:00:00.000Z'),
  });
  assert.equal(forgedFreshness.decision_eligible, false);
  assert.equal(forgedFreshness.reason, 'FRESHNESS_BINDING_MISMATCH');

  const forgedObservedAt = court.adjudicateMarketClaim({
    claim: {
      ...courtClaim,
      observed_at: '2026-06-06T12:00:00.000Z',
      supporting_observations: [{ ...observation, observed_at: '2026-06-06T12:00:00.000Z' }],
    },
    ...input,
  });
  assert.equal(forgedObservedAt.decision_eligible, false);
  assert.equal(forgedObservedAt.reason, 'OBSERVATION_TIME_BINDING_MISMATCH');

  const firstDenied = court.adjudicateMarketClaim({
    claim: { ...courtClaim, value: 'FORGED-A' },
    ...input,
  });
  const secondDenied = court.adjudicateMarketClaim({
    claim: { ...courtClaim, value: 'FORGED-B' },
    ...input,
  });
  assert.notEqual(firstDenied.evidence_digest, secondDenied.evidence_digest);
});

test('changed claim values preserve every prior contradictory observation', () => {
  const prior = [
    { claimKey: 'retailer-1:license_status', claimValue: 'ACTIVE', observationIds: ['obs-b', 'obs-a'] },
    { claimKey: 'retailer-1:license_status', claimValue: 'CLOSED', observationIds: ['obs-c'] },
    { claimKey: 'retailer-2:license_status', claimValue: 'ACTIVE', observationIds: ['other-subject'] },
  ];
  assert.deepEqual(
    reality.contradictoryObservationIds(
      { claimKey: 'retailer-1:license_status', claimValue: 'CLOSED' },
      prior,
    ),
    ['obs-a', 'obs-b'],
  );
  assert.deepEqual(
    reality.contradictoryObservationIds(
      { claimKey: 'retailer-1:license_status', claimValue: 'ACTIVE' },
      prior,
    ),
    ['obs-c'],
  );
});
