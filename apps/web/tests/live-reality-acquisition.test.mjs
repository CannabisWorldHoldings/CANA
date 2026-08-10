import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { ABCA_FIELDS } from '../src/lib/reality/official-source-snapshot.mjs';

const ACQUISITION_MODULE = '../src/lib/reality/live-reality-acquisition.mjs';
const cleanEnv = Object.freeze({ CANA_LIVE_REALITY_NETWORK: '1' });

const digest = (value) => createHash('sha256').update(value).digest('hex');

function record(objectId = 3275) {
  return {
    attributes: {
      OBJECTID: objectId,
      GLOBALID: `{GLOBAL-${objectId}}`,
      ABCA_NUMBER: `ABCA-${objectId}`,
      FACILITY_NAME: 'Court Cannabis',
      FACILITY_TYPE: 'Retailer',
      LICENSE_TYPE: 'Medical Cannabis Retailer',
      EXPIRATION_DATE: 1798675200000,
      ADDRESS: '100 Test St NW',
      LATITUDE: 38.9,
      LONGITDUE: -77.03,
      TRADE_NAME: 'Court Cannabis',
      ENTITY_NAME: 'Court Cannabis LLC',
      STATUS: 'Active',
      ISSUE_DATE: 1752710400000,
      EDITED: 1780587905000,
      WARD: 2,
      ENDORSEMENTS: null,
    },
    geometry: { x: -77.03, y: 38.9 },
  };
}

function metadata(revision = 1781114729000, fields = ABCA_FIELDS, {
  omitTopLevelPagination = false,
  omitEditingInfo = false,
} = {}) {
  const value = {
    id: 31,
    name: 'Licensed Medical Cannabis Retailer',
    currentVersion: 11.5,
    maxRecordCount: 1000,
    capabilities: 'Map,Query,Data',
    advancedQueryCapabilities: {
      supportsPagination: true,
      supportsOrderBy: true,
    },
    fields: fields.map((name) => ({ name })),
  };
  if (!omitTopLevelPagination) value.supportsPagination = true;
  if (!omitEditingInfo) value.editingInfo = { lastEditDate: revision };
  return value;
}

function scriptedSource({
  preRevision = 1781114729000,
  postRevision = preRevision,
  preCount = 1,
  postCount = preCount,
  features = [record()],
  exceededTransferLimit = false,
  fields = ABCA_FIELDS,
  metadataOptions,
  failureAt = null,
  failureStatus = 500,
  retryAfter = null,
} = {}) {
  let call = 0;
  const calls = [];
  const bodies = [
    metadata(preRevision, fields, metadataOptions),
    { count: preCount },
    exceededTransferLimit === undefined ? { features } : { features, exceededTransferLimit },
    metadata(postRevision, fields, metadataOptions),
    { count: postCount },
  ];
  return {
    calls,
    lookup: async () => [{ address: '23.48.99.80', family: 4 }],
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      const index = call;
      call += 1;
      if (failureAt === index) {
        return new Response('source incident body must not persist', {
          status: failureStatus,
          headers: {
            'content-type': 'text/plain',
            ...(retryAfter === null ? {} : { 'retry-after': retryAfter }),
          },
        });
      }
      return new Response(JSON.stringify(bodies[index]), {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=UTF-8',
          etag: `"etag-${index}"`,
          date: 'Mon, 10 Aug 2026 14:21:16 GMT',
        },
      });
    },
  };
}

class MemoryAcquisitionStore {
  constructor() {
    this.events = [];
    this.contents = new Map();
    this.captures = [];
    this.capabilities = [];
    this.circuits = new Map();
    this.locks = [];
  }

  async runExclusive(scope, work) {
    this.locks.push(scope);
    return work(this);
  }

  async latestContent({ sourceKey, tenant }) {
    return [...this.events].reverse().find((entry) => (
      entry.context.state === 'COMPLETED'
      && entry.context.source_key === sourceKey
      && entry.context.tenant === tenant
      && entry.context.content_artifact_id
    ))?.context ?? null;
  }

  async appendAcquisitionEvent({ event, context }) {
    const row = { id: `event-${this.events.length + 1}`, event, context: structuredClone(context) };
    this.events.push(row);
    return row;
  }

  async persistContent({ capture }) {
    this.captures.push(capture);
    const existing = this.contents.get(capture.content_sha256);
    if (existing) return { ...existing, created: false };
    const row = {
      contentArtifactId: `content-${this.contents.size + 1}`,
      snapshotId: `snapshot-${this.contents.size + 1}`,
      contentSha256: capture.content_sha256,
      payloadBytes: capture.snapshot_bytes.length,
      created: true,
    };
    this.contents.set(capture.content_sha256, row);
    return row;
  }

  async appendCapabilityReceipt(receipt) {
    this.capabilities.push(structuredClone(receipt));
    return { id: `capability-${this.capabilities.length}` };
  }

  async latestCircuit(scope) {
    return this.circuits.get(`${scope.sourceKey}:${scope.tenant}:${scope.workClass}`) ?? null;
  }

  async appendCircuitEvent(scope, event) {
    this.circuits.set(`${scope.sourceKey}:${scope.tenant}:${scope.workClass}`, structuredClone(event));
    return event;
  }
}

function acquisitionOptions(source, {
  tenant = 'orderweeddc.com',
  attemptId = 'attempt-1',
  at = '2026-08-10T15:00:00.000Z',
} = {}) {
  let tick = Date.parse(at);
  return {
    tenant,
    attemptId,
    asOf: at,
    env: cleanEnv,
    lookup: source.lookup,
    fetchImpl: source.fetchImpl,
    clock: () => new Date(tick += 1000),
    versions: {
      repositoryCommitSha: 'e'.repeat(40),
      repositoryTreeSha: 'f'.repeat(40),
      adapterVersion: 'dc-abca-live-v1',
      parserVersion: 'cana-dc-abca-arcgis-snapshot-v1',
      compilerVersion: 'cana-reality-compiler-v1',
      entityResolverVersion: 'cana-market-entity-resolution-v1',
      authorityPolicyVersion: 'dc-abca-authority-v1',
      freshnessPolicyVersion: 'dc-abca-freshness-v1',
      verificationCourtVersion: 'cana-market-claim-court-v1',
    },
  };
}

test('acquisition refuses incomplete parser, compiler, resolver, and policy version provenance', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  for (const missing of [
    'parserVersion',
    'compilerVersion',
    'entityResolverVersion',
    'authorityPolicyVersion',
    'freshnessPolicyVersion',
    'verificationCourtVersion',
  ]) {
    const source = scriptedSource();
    const options = acquisitionOptions(source, { attemptId: `missing-${missing}` });
    delete options.versions[missing];
    await assert.rejects(
      acquireLiveMarketReality(new MemoryAcquisitionStore(), options),
      /CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED/,
    );
    assert.equal(source.calls.length, 0);
  }
});

test('changed then unchanged acquisition keeps one content identity and two independently timed attempts', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  const store = new MemoryAcquisitionStore();
  const firstSource = scriptedSource();
  const first = await acquireLiveMarketReality(store, acquisitionOptions(firstSource));
  assert.equal(first.state, 'COMPLETED');
  assert.equal(first.outcome, 'SOURCE_CHANGED');
  assert.equal(first.terminal_result, 'SUCCESS_CHANGED');
  assert.equal(first.may_compile, true);
  assert.equal(first.may_revalidate, true);
  assert.equal(first.may_mutate_truth, false);
  assert.equal(first.content_artifacts_created, 1);
  assert.equal(firstSource.calls.length, 5);

  const secondSource = scriptedSource();
  const second = await acquireLiveMarketReality(store, acquisitionOptions(secondSource, {
    attemptId: 'attempt-2',
    at: '2026-08-17T15:00:00.000Z',
  }));
  assert.equal(second.state, 'COMPLETED');
  assert.equal(second.outcome, 'SOURCE_UNCHANGED');
  assert.equal(second.terminal_result, 'SUCCESS_UNCHANGED');
  assert.equal(second.may_compile, false);
  assert.equal(second.may_revalidate, true);
  assert.equal(second.content_artifacts_created, 0);
  assert.equal(store.contents.size, 1);
  assert.equal(first.content_artifact_id, second.content_artifact_id);
  assert.notEqual(first.acquired_at, second.acquired_at);
  const terminal = store.events.filter((entry) => entry.context.state === 'COMPLETED');
  assert.equal(terminal.length, 2);
  assert.equal(terminal[0].context.content_artifact_id, terminal[1].context.content_artifact_id);
  assert.notEqual(terminal[0].context.attempt_id, terminal[1].context.attempt_id);
  assert.equal(store.capabilities.length, 2);
});

test('current live metadata shape stays complete while unavailable source revision remains UNKNOWN', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  const store = new MemoryAcquisitionStore();
  const source = scriptedSource({
    metadataOptions: { omitTopLevelPagination: true, omitEditingInfo: true },
    exceededTransferLimit: undefined,
  });
  const result = await acquireLiveMarketReality(store, acquisitionOptions(source));
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.outcome, 'SOURCE_CHANGED');
  assert.equal(result.revision_bound, false);
  assert.equal(result.may_compile, true);
  assert.equal(result.may_revalidate, false);
  assert.equal(source.calls.length, 5);
  const terminal = store.events.at(-1).context;
  assert.equal(terminal.source_revision, 'UNKNOWN');
  assert.equal(terminal.pre_revision, null);
  assert.equal(terminal.post_revision, null);
  assert.equal(store.capabilities[0].capabilities.revision, 'UNKNOWN');
  assert.equal(store.capabilities[0].capabilities.revision_state, 'UNKNOWN');
  assert.equal(store.captures[0].source_modified_at, null);
  assert.equal(store.captures[0].manifest.source_modified_at, null);
});

test('revision drift and count drift fail closed before any content artifact exists', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  for (const [source, code] of [
    [scriptedSource({ postRevision: 1781114730000 }), 'CANA_LIVE_REALITY_REVISION_DRIFT'],
    [scriptedSource({ postCount: 2 }), 'CANA_LIVE_REALITY_COUNT_DRIFT'],
  ]) {
    const store = new MemoryAcquisitionStore();
    const result = await acquireLiveMarketReality(store, acquisitionOptions(source));
    assert.equal(result.state, 'FAILED');
    assert.equal(result.error_code, code);
    assert.equal(result.may_compile, false);
    assert.equal(result.may_revalidate, false);
    assert.equal(result.may_create_negative_evidence, false);
    assert.equal(result.may_mutate_truth, false);
    assert.equal(store.contents.size, 0);
    assert.equal(store.capabilities.length, 0);
    assert.equal(store.events.at(-1).context.state, 'FAILED');
  }
});

test('transfer limit, partial count, record identity, and live fixture-metadata injection fail closed', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  const cases = [
    [scriptedSource({ exceededTransferLimit: true }), 'CANA_LIVE_REALITY_PARTIAL_REFUSED'],
    [scriptedSource({ preCount: 2, postCount: 2 }), 'CANA_LIVE_REALITY_RECORD_COUNT_MISMATCH'],
    [scriptedSource({ fields: ABCA_FIELDS.filter((field) => field !== 'GLOBALID') }), 'CANA_LIVE_REALITY_SCHEMA_CHANGED'],
    [scriptedSource({ features: [{ ...record(), attributes: { ...record().attributes, GLOBALID: '' } }] }), 'CANA_OFFICIAL_SOURCE_GLOBALID_DUPLICATE'],
  ];
  for (const [source, code] of cases) {
    const store = new MemoryAcquisitionStore();
    const result = await acquireLiveMarketReality(store, acquisitionOptions(source));
    assert.equal(result.state, 'FAILED');
    assert.equal(result.error_code, code);
    assert.equal(store.contents.size, 0);
  }
  const source = scriptedSource();
  const store = new MemoryAcquisitionStore();
  const result = await acquireLiveMarketReality(store, {
    ...acquisitionOptions(source),
    sourceCatalogModifiedDate: '2026-06-05',
  });
  assert.equal(result.state, 'FAILED');
  assert.equal(result.error_code, 'CANA_LIVE_REALITY_FIXTURE_METADATA_REFUSED');
  assert.equal(source.calls.length, 0);
});

test('source outage never mutates content and opens a tenant-scoped circuit after bounded failures', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  const store = new MemoryAcquisitionStore();
  let totalFetches = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const source = scriptedSource({ failureAt: 0 });
    const result = await acquireLiveMarketReality(store, acquisitionOptions(source, {
      attemptId: `outage-${attempt}`,
      at: `2026-08-10T15:0${attempt}:00.000Z`,
    }));
    totalFetches += source.calls.length;
    assert.equal(result.state, 'FAILED');
    assert.equal(result.error_code, 'CANA_LIVE_REALITY_HTTP_ERROR');
    assert.equal(result.terminal_result, 'HTTP_FAILURE');
    assert.equal(result.may_retry, true);
  }
  assert.equal(totalFetches, 3);
  assert.equal(store.contents.size, 0);
  const blockedSource = scriptedSource();
  const blocked = await acquireLiveMarketReality(store, acquisitionOptions(blockedSource, {
    attemptId: 'outage-4',
    at: '2026-08-10T15:04:00.000Z',
  }));
  assert.equal(blocked.state, 'FAILED');
  assert.equal(blocked.error_code, 'CANA_LIVE_REALITY_CIRCUIT_OPEN');
  assert.equal(blockedSource.calls.length, 0);

  const tenantBSource = scriptedSource();
  const tenantB = await acquireLiveMarketReality(store, acquisitionOptions(tenantBSource, {
    tenant: 'tenant-b.example',
    attemptId: 'tenant-b-1',
    at: '2026-08-10T15:04:00.000Z',
  }));
  assert.equal(tenantB.state, 'COMPLETED');
  assert.equal(tenantB.outcome, 'SOURCE_CHANGED');
  assert.equal(tenantBSource.calls.length, 5);
});

test('rate limiting immediately opens a bounded tenant circuit and records Retry-After', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  const store = new MemoryAcquisitionStore();
  const source = scriptedSource({ failureAt: 0, failureStatus: 429, retryAfter: '120' });
  const result = await acquireLiveMarketReality(store, acquisitionOptions(source));
  assert.equal(result.state, 'FAILED');
  assert.equal(result.terminal_result, 'RATE_LIMITED');
  assert.equal(result.circuit_state, 'OPEN_CIRCUIT');
  assert.equal(result.retry_after, '2026-08-10T15:02:02.000Z');
  assert.equal(result.may_retry, true);
  assert.equal(result.may_compile, false);
  assert.equal(result.may_mutate_truth, false);
  assert.equal(store.contents.size, 0);
});

test('cooldown probe success closes the circuit without manufacturing verification', async () => {
  const { acquireLiveMarketReality } = await import(ACQUISITION_MODULE);
  const store = new MemoryAcquisitionStore();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const source = scriptedSource({ failureAt: 0 });
    await acquireLiveMarketReality(store, acquisitionOptions(source, {
      attemptId: `probe-failure-${attempt}`,
      at: `2026-08-10T15:0${attempt}:00.000Z`,
    }));
  }
  const recoveredSource = scriptedSource();
  const recovered = await acquireLiveMarketReality(store, acquisitionOptions(recoveredSource, {
    attemptId: 'probe-success',
    at: '2026-08-10T15:20:00.000Z',
  }));
  assert.equal(recovered.state, 'COMPLETED');
  assert.equal(recovered.circuit_state, 'HEALTHY');
  assert.equal(recovered.verification_events_created, 0);
  assert.equal(recovered.public_truth_mutations, 0);
  assert.equal(digest(JSON.stringify([...store.contents.keys()])), digest(JSON.stringify([recovered.content_sha256])));
});
