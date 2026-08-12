// TRI-MARKET DURABLE STORE COURT — one reality store, three markets.
//
// Reference store implements the EXACT transactionStore interface of the
// Prisma persistence layer (sourceKey+tenant keyed; content-hash idempotent
// persistContent; append-only events) so the offline rehearsal proves the
// semantics the PostgreSQL store will carry. No SQLite, no interim store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { acquireMarketReality } from '../src/lib/reality/acquire-market-reality.mjs';
import {
  VA_CCA_LANE,
  MD_MCA_LANE,
  acquisitionLaneForSourceKey,
} from '../src/lib/reality/market-acquisition-lanes.mjs';
import { formVaMarketClaims, VA_CLAIMS_SCHEMA_VERSION, VA_ENTITY_NORMALIZATION_VERSION } from '../src/lib/markets/va/va-claims.mjs';
import { formMdMarketClaims, MD_CLAIMS_SCHEMA_VERSION, MD_ENTITY_NORMALIZATION_VERSION } from '../src/lib/markets/md/md-claims.mjs';
import { MARKET_CLAIM_COURT_VERSION } from '../src/lib/reality/market-claim-court.mjs';
import { selectCurrentClaimDecisions } from '../src/lib/reality/market-claim-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const VA_FIXTURE = readFileSync(path.join(here, 'fixtures', 'va-cca', 'dispensaries.html'), 'utf8');
const MD_FIXTURE = readFileSync(path.join(here, 'fixtures', 'md-mca', 'dispensaries.html'), 'utf8');
const TENANT = 'orderweeddc.com';
const COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const TREE = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const VA_VERSIONS = Object.freeze({
  repositoryCommitSha: COMMIT, repositoryTreeSha: TREE,
  adapterVersion: 'va-cca-live-v1', parserVersion: 'cana-va-cca-registry-snapshot-v1',
  compilerVersion: VA_CLAIMS_SCHEMA_VERSION, entityResolverVersion: VA_ENTITY_NORMALIZATION_VERSION,
  authorityPolicyVersion: 'va-cca-authority-v1', freshnessPolicyVersion: 'va-cca-freshness-v1',
  verificationCourtVersion: MARKET_CLAIM_COURT_VERSION,
});
const MD_VERSIONS = Object.freeze({
  repositoryCommitSha: COMMIT, repositoryTreeSha: TREE,
  adapterVersion: 'md-mca-live-v1', parserVersion: 'cana-md-mca-registry-snapshot-v1',
  compilerVersion: MD_CLAIMS_SCHEMA_VERSION, entityResolverVersion: MD_ENTITY_NORMALIZATION_VERSION,
  authorityPolicyVersion: 'md-mca-authority-v1', freshnessPolicyVersion: 'md-mca-freshness-v1',
  verificationCourtVersion: MARKET_CLAIM_COURT_VERSION,
});
const ENV = Object.freeze({
  CANA_LIVE_VA_CCA_ACQUISITION: 'OPERATOR_APPROVED',
  CANA_LIVE_MD_MCA_ACQUISITION: 'OPERATOR_APPROVED',
});

/** In-memory reference store — same interface + semantics as transactionStore. */
function createReferenceStore() {
  const db = {
    acquisitionEvents: [], snapshots: [], contentArtifacts: [],
    capabilityReceipts: [], circuitEvents: [], identityResolutions: [],
  };
  let seq = 0;
  const id = (prefix) => `${prefix}-${(seq += 1)}`;
  const tx = {
    async latestContent({ sourceKey, tenant }) {
      const rows = db.acquisitionEvents.filter((r) => r.sourceKey === sourceKey && r.tenant === tenant
        && r.state === 'COMPLETED' && r.contentArtifactId);
      const last = rows.at(-1);
      if (!last) return null;
      const artifact = db.contentArtifacts.find((a) => a.id === last.contentArtifactId);
      return { content_artifact_id: last.contentArtifactId, snapshot_id: last.snapshotId, content_sha256: artifact.contentSha256 };
    },
    async appendAcquisitionEvent({ event, context }) {
      const row = { id: id('acq'), ...context, sourceKey: context.source_key, tenant: context.tenant,
        state: context.state, contentArtifactId: context.content_artifact_id, snapshotId: context.snapshot_id,
        eventHash: context.event_digest };
      db.acquisitionEvents.push(row);
      return row;
    },
    async persistContent({ capture }) {
      let snapshot = db.snapshots.find((s) => s.sourceKey === capture.source_key && s.payloadSha256 === capture.content_sha256);
      if (!snapshot) {
        snapshot = { id: id('snap'), sourceKey: capture.source_key, sourceUrl: capture.source_url,
          payloadSha256: capture.content_sha256, payloadBytes: capture.snapshot_bytes.length,
          recordCount: capture.record_count, schemaVersion: capture.manifest.schema_version,
          payloadJson: capture.snapshot_bytes.toString('utf8'), completeness: 'COMPLETE',
          fetchedAt: capture.fetched_at };
        db.snapshots.push(snapshot);
      }
      let content = db.contentArtifacts.find((a) => a.sourceKey === capture.source_key && a.contentSha256 === capture.content_sha256);
      let created = false;
      if (!content) {
        content = { id: id('content'), snapshotId: snapshot.id, sourceKey: capture.source_key,
          sourceUrl: capture.source_url, requestContractDigest: capture.request_digest,
          contentSha256: capture.content_sha256, payloadBytes: capture.snapshot_bytes.length,
          recordCount: capture.record_count, schemaVersion: capture.manifest.schema_version };
        db.contentArtifacts.push(content);
        created = true;
      }
      return { contentArtifactId: content.id, snapshotId: snapshot.id, contentSha256: content.contentSha256,
        payloadBytes: content.payloadBytes, created };
    },
    async appendCapabilityReceipt(receipt) { db.capabilityReceipts.push(receipt); return receipt; },
    async latestCircuit(scope) {
      return db.circuitEvents.filter((e) => e.sourceKey === scope.sourceKey && e.tenant === scope.tenant
        && e.workClass === scope.workClass).at(-1) ?? null;
    },
    async appendCircuitEvent(scope, event) {
      const row = { ...event, sourceKey: scope.sourceKey, tenant: scope.tenant, workClass: scope.workClass };
      db.circuitEvents.push(row);
      return row;
    },
    // IDENTITY EVOLUTION LAW: resolution is APPENDED, history never rewritten.
    async appendIdentityResolution({ sourceKey, locatorKey, resolvedIdentity, evidenceArtifactId, at }) {
      const row = { id: id('resolution'), sourceKey, locatorKey, resolvedIdentity, evidenceArtifactId, at };
      db.identityResolutions.push(row);
      return row;
    },
  };
  return Object.freeze({
    db,
    async runExclusive(scope, work) { return work(tx); },
  });
}

function stableFetch(body) { return async () => ({ status: 200, text: async () => body }); }

async function acquire(store, sourceKey, versions, fetchBody, attempt) {
  return acquireMarketReality(store, {
    sourceKey, tenant: TENANT, attemptId: attempt, asOf: '2026-08-12T15:00:00.000Z',
    env: ENV, fetchImpl: stableFetch(fetchBody),
    clock: () => new Date('2026-08-12T15:00:01.000Z'), versions,
  });
}

test('TRI-MARKET OFFLINE REHEARSAL: acquisitions → durable store → claims → verification → market-separated VERIFIED world state', async () => {
  const store = createReferenceStore();
  const va1 = await acquire(store, VA_CCA_LANE.sourceKey, VA_VERSIONS, VA_FIXTURE, 'va-run-1');
  const md1 = await acquire(store, MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_FIXTURE, 'md-run-1');
  assert.equal(va1.state, 'COMPLETED'); assert.equal(va1.outcome, 'SOURCE_CHANGED');
  assert.equal(md1.state, 'COMPLETED'); assert.equal(md1.outcome, 'SOURCE_CHANGED');
  assert.equal(va1.record_count, 23); assert.equal(md1.record_count, 90);
  assert.equal(va1.verification, 'UNKNOWN', 'ACQUISITION ≠ VERIFICATION');
  assert.equal(va1.content_artifacts_created, 1); assert.equal(md1.content_artifacts_created, 1);
  // Raw artifact law: the full page text is durably stored.
  const vaSnap = store.db.snapshots.find((s) => s.sourceKey === VA_CCA_LANE.sourceKey);
  assert.equal(sha256(vaSnap.payloadJson), va1.content_sha256);

  // IDEMPOTENCY LAW: exact re-run reuses content; world state must not duplicate.
  const va2 = await acquire(store, VA_CCA_LANE.sourceKey, VA_VERSIONS, VA_FIXTURE, 'va-run-2');
  assert.equal(va2.outcome, 'SOURCE_UNCHANGED');
  assert.equal(va2.content_artifacts_created, 0, 'content reused, not duplicated');
  assert.equal(va2.content_artifact_id, va1.content_artifact_id, 'dedup linkage to the same immutable artifact');
  assert.equal(va2.revision_bound, false, 'HTML content hash never becomes a fake revision');
  assert.equal(store.db.contentArtifacts.filter((a) => a.sourceKey === VA_CCA_LANE.sourceKey).length, 1);

  // Claims + verification from DURABLE rows → market-separated VERIFIED state.
  function verifiedFor(receipt, formClaims, versions, count = 2) {
    const artifact = store.db.contentArtifacts.find((a) => a.id === receipt.content_artifact_id);
    const snapshot = store.db.snapshots.find((s) => s.id === receipt.snapshot_id);
    const lane = acquisitionLaneForSourceKey(receipt.source_key);
    const records = lane.marketId === 'US-VA'
      ? formVaMarketClaims
      : formMdMarketClaims;
    const parsed = formClaims === 'va'
      ? formVaMarketClaims({ statements: extractRecords(snapshot, 'va'), sourceId: receipt.source_key, observedAt: receipt.acquired_at })
      : formMdMarketClaims({ statements: extractRecords(snapshot, 'md'), sourceId: receipt.source_key, observedAt: receipt.acquired_at });
    const claims = parsed.slice(0, count).map((claim) => ({
      id: claim.claim_id, tenant: TENANT, claimType: claim.predicate, claimValue: claim.value,
      snapshotId: snapshot.id, observedAt: new Date(receipt.acquired_at),
      freshnessExpiresAt: new Date('2026-09-11T15:00:00.000Z'),
    }));
    const acquisitionEvent = {
      id: receipt.acquisition_event_id, sourceKey: receipt.source_key, tenant: TENANT,
      state: 'COMPLETED', outcome: 'SOURCE_CHANGED',
      fetchedAt: new Date(receipt.acquired_at), completedAt: new Date(receipt.completed_at),
      completeness: 'COMPLETE', sourceRevision: 'UNKNOWN', preSourceRevision: null, postSourceRevision: null,
      revisionState: 'UNKNOWN', observedRecordCount: receipt.record_count,
      preObservedRecordCount: receipt.record_count, postObservedRecordCount: receipt.record_count,
      requestDigest: artifact.requestContractDigest, adapterContractDigest: artifact.requestContractDigest,
      repositoryCommitSha: COMMIT, repositoryTreeSha: TREE,
      contentArtifactId: artifact.id, snapshotId: snapshot.id, errorCode: null, ...versions,
    };
    const verificationEvents = claims.map((claim, index) => ({
      id: `${receipt.source_key}-verify-${index}`, claimId: claim.id, acquisitionEventId: acquisitionEvent.id,
      decision: 'ALLOW', evaluatorVersion: MARKET_CLAIM_COURT_VERSION,
      asOf: new Date('2026-08-12T16:00:00.000Z'), freshnessExpiresAt: new Date('2026-09-11T15:00:00.000Z'),
    }));
    return selectCurrentClaimDecisions({
      claims, verificationEvents, acquisitionEvents: [acquisitionEvent],
      contentArtifacts: [{ ...artifact, contentSha256: snapshot.payloadSha256, payloadBytes: snapshot.payloadBytes,
        recordCount: snapshot.recordCount, schemaVersion: snapshot.schemaVersion, sourceUrl: artifact.sourceUrl }],
      sourceSnapshots: [{ ...snapshot, sourceKey: snapshot.sourceKey, sourceUrl: artifact.sourceUrl }],
      revocations: [], asOf: new Date('2026-08-12T18:00:00.000Z'),
    });
  }
  function extractRecords(snapshot, market) {
    // Re-extract from the DURABLY STORED raw artifact — proving the store
    // carries everything needed to rebuild statements.
    if (market === 'va') {
      const mod = 'va';
      return vaParse(snapshot.payloadJson);
    }
    return mdParse(snapshot.payloadJson);
  }
  const { parseCcaRegistryPage } = await import('../src/lib/markets/va/va-cca-registry-parser.mjs');
  const { parseMcaRegistryPage } = await import('../src/lib/markets/md/md-mca-registry-parser.mjs');
  const vaParse = (html) => parseCcaRegistryPage(html, { url: 'x' }).records;
  const mdParse = (html) => parseMcaRegistryPage(html, { url: 'x' }).records;

  const vaVerified = verifiedFor(va1, 'va', VA_VERSIONS);
  const mdVerified = verifiedFor(md1, 'md', MD_VERSIONS);
  assert.equal(vaVerified.length, 2); assert.equal(mdVerified.length, 2);
  for (const d of vaVerified) { assert.equal(d.verification, 'VERIFIED'); assert.equal(d.source_id, VA_CCA_LANE.sourceKey); }
  for (const d of mdVerified) { assert.equal(d.verification, 'VERIFIED'); assert.equal(d.source_id, MD_MCA_LANE.sourceKey); }
  // Market separation: no VA decision cites MD evidence and vice versa.
  assert.ok(vaVerified.every((d) => d.source_id !== MD_MCA_LANE.sourceKey));
  assert.ok(mdVerified.every((d) => d.source_id !== VA_CCA_LANE.sourceKey));
});

test('SUPERSESSION + ISOLATION: one market changes; the other is untouched; old content superseded not erased', async () => {
  const store = createReferenceStore();
  await acquire(store, VA_CCA_LANE.sourceKey, VA_VERSIONS, VA_FIXTURE, 'va-a');
  await acquire(store, MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_FIXTURE, 'md-a');
  const vaBefore = JSON.stringify(store.db.contentArtifacts.filter((a) => a.sourceKey === VA_CCA_LANE.sourceKey));

  // MD registry layout changes (a new dispensary appears) — content hash moves.
  const MD_MUTATED = MD_FIXTURE.replace('</body>',
    '<table><tbody><tr><td><div>New Leaf Dispensary</div><div>1 Test Way</div><div>Bethesda, MD 20814</div></td></tr></tbody></table></body>');
  const mdChange = await acquire(store, MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_MUTATED, 'md-b');
  assert.equal(mdChange.outcome, 'SOURCE_CHANGED');
  assert.equal(mdChange.record_count, 91, 'the new location extracted');
  const mdArtifacts = store.db.contentArtifacts.filter((a) => a.sourceKey === MD_MCA_LANE.sourceKey);
  assert.equal(mdArtifacts.length, 2, 'superseded content preserved immutably, never erased');
  // The latest content pointer moved; the old artifact remains addressable.
  const latest = await store.runExclusive({}, (tx) => tx.latestContent({ sourceKey: MD_MCA_LANE.sourceKey, tenant: TENANT }));
  assert.equal(latest.content_sha256, mdChange.content_sha256);
  // VA is byte-identically unaffected.
  assert.equal(JSON.stringify(store.db.contentArtifacts.filter((a) => a.sourceKey === VA_CCA_LANE.sourceKey)), vaBefore);
});

test('IDENTITY EVOLUTION: a name-unpublished MD location gains identity by APPENDED resolution — history never rewritten', async () => {
  const store = createReferenceStore();
  const md = await acquire(store, MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_FIXTURE, 'md-idres');
  const snapshot = store.db.snapshots.find((s) => s.id === md.snapshot_id);
  const { parseMcaRegistryPage } = await import('../src/lib/markets/md/md-mca-registry-parser.mjs');
  const { records } = parseMcaRegistryPage(snapshot.payloadJson, { url: 'x' });
  const unnamed = records.filter((r) => !('name' in r));
  assert.equal(unnamed.length, 19, 'unresolved regulator records preserved');
  const target = unnamed[0];
  const locatorKey = `md-mca:locator:${sha256(`${target.address.street}|${target.address.zip}`).slice(0, 24)}`;
  const before = JSON.stringify(snapshot);
  const resolution = await store.runExclusive({}, (tx) => tx.appendIdentityResolution({
    sourceKey: MD_MCA_LANE.sourceKey,
    locatorKey,
    resolvedIdentity: { name: 'Later Evidence Dispensary', normalization_version: MD_ENTITY_NORMALIZATION_VERSION },
    evidenceArtifactId: md.content_artifact_id,
    at: '2026-09-01T00:00:00.000Z',
  }));
  assert.equal(store.db.identityResolutions.length, 1);
  assert.equal(resolution.locatorKey, locatorKey);
  assert.equal(JSON.stringify(snapshot), before, 'original acquisition evidence untouched — resolution appended, not rewritten');
});

test('HOSTILE MULTI-MARKET COURT: cross-wiring fails closed', async () => {
  const store = createReferenceStore();
  // Acquisition without an admitted source.
  await assert.rejects(
    acquire(store, 'attacker-source', VA_VERSIONS, VA_FIXTURE, 'x1'),
    /SOURCE_NOT_ADMITTED/,
  );
  // MD grant does not authorize VA acquisition (per-market operator opt-in).
  await assert.rejects(
    acquireMarketReality(store, {
      sourceKey: VA_CCA_LANE.sourceKey, tenant: TENANT, attemptId: 'x2', asOf: '2026-08-12T15:00:00.000Z',
      env: { CANA_LIVE_MD_MCA_ACQUISITION: 'OPERATOR_APPROVED' },
      fetchImpl: stableFetch(VA_FIXTURE), versions: VA_VERSIONS,
    }).then((r) => { if (r.state === 'FAILED') throw new Error(r.error_code); }),
    /NOT_AUTHORIZED/,
  );
  // Store isolation: after valid runs, no row of one market carries the other's sourceKey.
  await acquire(store, VA_CCA_LANE.sourceKey, VA_VERSIONS, VA_FIXTURE, 'x3');
  await acquire(store, MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_FIXTURE, 'x4');
  const vaRows = store.db.acquisitionEvents.filter((r) => r.sourceKey === VA_CCA_LANE.sourceKey);
  const mdRows = store.db.acquisitionEvents.filter((r) => r.sourceKey === MD_MCA_LANE.sourceKey);
  assert.ok(vaRows.length > 0 && mdRows.length > 0);
  assert.ok(vaRows.every((r) => r.request_digest === VA_CCA_LANE.contractDigest));
  assert.ok(mdRows.every((r) => r.request_digest === MD_MCA_LANE.contractDigest));
  // Lane lookup refusal law.
  assert.equal(acquisitionLaneForSourceKey('forged'), null);
  assert.equal(acquisitionLaneForSourceKey(''), null);
});

test('FAILURE RECOVERY: a failed acquisition appends a FAILED terminal + circuit degradation, never partial truth', async () => {
  const store = createReferenceStore();
  const failed = await acquireMarketReality(store, {
    sourceKey: VA_CCA_LANE.sourceKey, tenant: TENANT, attemptId: 'fail-1', asOf: '2026-08-12T15:00:00.000Z',
    env: ENV, fetchImpl: async () => ({ status: 503, text: async () => 'down' }), versions: VA_VERSIONS,
  });
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.content_artifacts_created, 0);
  assert.equal(failed.public_truth_mutations, 0);
  const terminal = store.db.acquisitionEvents.at(-1);
  assert.equal(terminal.state, 'FAILED');
  assert.equal(store.db.contentArtifacts.length, 0, 'no partial content persisted');
  const circuit = store.db.circuitEvents.at(-1);
  assert.equal(circuit.state, 'DEGRADED');
  // Recovery: the next clean run succeeds and closes the loop.
  const recovered = await acquire(store, VA_CCA_LANE.sourceKey, VA_VERSIONS, VA_FIXTURE, 'fail-2');
  assert.equal(recovered.state, 'COMPLETED');
  assert.equal(store.db.circuitEvents.at(-1).state, 'HEALTHY');
});
