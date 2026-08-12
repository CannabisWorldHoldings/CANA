/**
 * TRI-MARKET POSTGRES COURT — the ACTUAL Prisma transaction store on the
 * ACTUAL PostgreSQL datastore. Closes the gap between the reference-store
 * proof (tri-market-durable-store.test.mjs) and production persistence.
 *
 * Requires the repository verifier's disposable PostgreSQL cluster (loopback
 * DATABASE_URL + CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER) — exactly like
 * postgres-semantics.test.mjs. Refuses to run anywhere else. No SQLite, no
 * MariaDB, no mocked Prisma.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

import { createPrismaAcquisitionStore } from '../src/lib/reality/live-reality-acquisition.mjs';
import { acquireMarketReality } from '../src/lib/reality/acquire-market-reality.mjs';
import { VA_CCA_LANE, MD_MCA_LANE } from '../src/lib/reality/market-acquisition-lanes.mjs';
import { formVaMarketClaims, VA_CLAIMS_SCHEMA_VERSION, VA_ENTITY_NORMALIZATION_VERSION } from '../src/lib/markets/va/va-claims.mjs';
import { formMdMarketClaims, MD_CLAIMS_SCHEMA_VERSION, MD_ENTITY_NORMALIZATION_VERSION } from '../src/lib/markets/md/md-claims.mjs';
import { parseCcaRegistryPage } from '../src/lib/markets/va/va-cca-registry-parser.mjs';
import { parseMcaRegistryPage } from '../src/lib/markets/md/md-mca-registry-parser.mjs';
import { MARKET_CLAIM_COURT_VERSION } from '../src/lib/reality/market-claim-court.mjs';
import { selectCurrentClaimDecisions } from '../src/lib/reality/market-claim-adapter.mjs';

const databaseUrl = process.env.DATABASE_URL ?? '';
const disposableSystemIdentifier = process.env.CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER ?? '';
let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  parsedDatabaseUrl = null;
}
if (
  !parsedDatabaseUrl ||
  !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
  !['127.0.0.1', 'localhost', '::1'].includes(parsedDatabaseUrl.hostname) ||
  !/^\d{10,}$/.test(disposableSystemIdentifier)
) {
  throw new Error(
    'tri-market-postgres-court.test.mjs requires a loopback PostgreSQL URL and a ' +
      'CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER issued by the repository verifier.',
  );
}

const prisma = new PrismaClient();
const [databaseIdentity] = await prisma.$queryRawUnsafe(
  'SELECT current_database() AS database, system_identifier::text AS system_identifier FROM pg_control_system()',
);
if (
  databaseIdentity?.system_identifier !== disposableSystemIdentifier ||
  databaseIdentity?.database !== parsedDatabaseUrl.pathname.slice(1)
) {
  await prisma.$disconnect();
  throw new Error('tri-market PostgreSQL court refuses a database without the matching disposable cluster identity');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const VA_FIXTURE = readFileSync(path.join(here, 'fixtures', 'va-cca', 'dispensaries.html'), 'utf8');
const MD_FIXTURE = readFileSync(path.join(here, 'fixtures', 'md-mca', 'dispensaries.html'), 'utf8');
const RUN_TENANT = `pgcourt-${Date.now()}.example`;
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
const store = createPrismaAcquisitionStore(prisma);
const stableFetch = (body) => async () => ({ status: 200, text: async () => body });

async function acquire(sourceKey, versions, body, attempt, useStore = store) {
  return acquireMarketReality(useStore, {
    sourceKey, tenant: RUN_TENANT, attemptId: attempt, asOf: new Date().toISOString(),
    env: ENV, fetchImpl: stableFetch(body), versions,
  });
}

test.after(async () => {
  const sourceKeys = [VA_CCA_LANE.sourceKey, MD_MCA_LANE.sourceKey];
  await prisma.marketSourceCapabilityReceipt.deleteMany({ where: { sourceKey: { in: sourceKeys } } });
  await prisma.marketSourceAcquisitionEvent.deleteMany({ where: { tenant: RUN_TENANT } });
  await prisma.marketSourceCircuitEvent.deleteMany({ where: { tenant: RUN_TENANT } });
  await prisma.marketSourceContentArtifact.deleteMany({ where: { sourceKey: { in: sourceKeys } } });
  await prisma.marketSourceSnapshot.deleteMany({ where: { sourceKey: { in: sourceKeys } } });
  await prisma.$disconnect();
});

test('DATABASE REALITY: PostgreSQL extensions and disposable identity', async () => {
  const extensions = await prisma.$queryRawUnsafe('SELECT extname FROM pg_extension');
  const names = extensions.map((row) => row.extname);
  assert.ok(names.includes('postgis'), `PostGIS must be installed (P1 target) — found: ${names.join(',')}`);
  // h3/h3_postgis are required on the production target (ADR-0002); record
  // their presence here without failing clusters that omit them.
  console.log(`[pg-court] extensions: ${names.join(',')}`);
});

test('REAL TRI-MARKET PERSISTENCE: VA + MD through the actual Prisma store; raw artifacts durable; VERIFIED state rebuilt from rows', async () => {
  const va = await acquire(VA_CCA_LANE.sourceKey, VA_VERSIONS, VA_FIXTURE, 'pg-va-1');
  const md = await acquire(MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_FIXTURE, 'pg-md-1');
  assert.equal(va.state, 'COMPLETED'); assert.equal(md.state, 'COMPLETED');
  assert.equal(va.outcome, 'SOURCE_CHANGED'); assert.equal(md.outcome, 'SOURCE_CHANGED');
  assert.equal(va.record_count, 23); assert.equal(md.record_count, 90);
  assert.equal(va.verification, 'UNKNOWN', 'ACQUISITION ≠ VERIFICATION in the real store');

  // Raw-artifact law against REAL rows.
  const vaSnapshot = await prisma.marketSourceSnapshot.findUnique({
    where: { sourceKey_payloadSha256: { sourceKey: VA_CCA_LANE.sourceKey, payloadSha256: va.content_sha256 } },
  });
  assert.ok(vaSnapshot, 'VA raw snapshot persisted');
  assert.equal(sha256(vaSnapshot.payloadJson), va.content_sha256, 'stored raw HTML hashes to the receipt digest');

  // Rebuild VERIFIED world state FROM the database rows only.
  async function verifiedFromDb(receipt, versions, market) {
    const eventRow = await prisma.marketSourceAcquisitionEvent.findUnique({ where: { id: receipt.acquisition_event_id } });
    const artifact = await prisma.marketSourceContentArtifact.findUnique({ where: { id: receipt.content_artifact_id } });
    const snapshot = await prisma.marketSourceSnapshot.findUnique({ where: { id: receipt.snapshot_id } });
    assert.equal(eventRow.tenant, RUN_TENANT);
    assert.equal(eventRow.state, 'COMPLETED');
    const records = market === 'va'
      ? parseCcaRegistryPage(snapshot.payloadJson, { url: 'x' }).records
      : parseMcaRegistryPage(snapshot.payloadJson, { url: 'x' }).records;
    const formed = (market === 'va' ? formVaMarketClaims : formMdMarketClaims)({
      statements: records, sourceId: receipt.source_key, observedAt: receipt.acquired_at,
    });
    const claims = formed.slice(0, 2).map((claim) => ({
      id: claim.claim_id, tenant: RUN_TENANT, claimType: claim.predicate, claimValue: claim.value,
      snapshotId: snapshot.id, observedAt: new Date(receipt.acquired_at),
      freshnessExpiresAt: new Date(Date.now() + 20 * 86_400_000),
    }));
    const acquisitionEvent = {
      id: eventRow.id, sourceKey: eventRow.sourceKey, tenant: eventRow.tenant,
      state: eventRow.state, outcome: eventRow.outcome,
      fetchedAt: eventRow.fetchedAt, completedAt: eventRow.completedAt,
      completeness: eventRow.completeness, sourceRevision: eventRow.sourceRevision,
      preSourceRevision: eventRow.preSourceRevision, postSourceRevision: eventRow.postSourceRevision,
      revisionState: eventRow.revisionState,
      observedRecordCount: eventRow.observedRecordCount,
      preObservedRecordCount: eventRow.preObservedRecordCount,
      postObservedRecordCount: eventRow.postObservedRecordCount,
      requestDigest: eventRow.requestDigest, adapterContractDigest: eventRow.adapterContractDigest,
      repositoryCommitSha: eventRow.repositoryCommitSha, repositoryTreeSha: eventRow.repositoryTreeSha,
      contentArtifactId: eventRow.contentArtifactId, snapshotId: eventRow.snapshotId, errorCode: eventRow.errorCode,
      adapterVersion: eventRow.adapterVersion, parserVersion: eventRow.parserVersion,
      compilerVersion: eventRow.compilerVersion, entityResolverVersion: eventRow.entityResolverVersion,
      authorityPolicyVersion: eventRow.authorityPolicyVersion, freshnessPolicyVersion: eventRow.freshnessPolicyVersion,
      verificationCourtVersion: eventRow.verificationCourtVersion,
    };
    const verificationEvents = claims.map((claim, index) => ({
      id: `${receipt.source_key}-pgverify-${index}`, claimId: claim.id, acquisitionEventId: eventRow.id,
      decision: 'ALLOW', evaluatorVersion: MARKET_CLAIM_COURT_VERSION,
      asOf: new Date(), freshnessExpiresAt: new Date(Date.now() + 20 * 86_400_000),
    }));
    return selectCurrentClaimDecisions({
      claims, verificationEvents, acquisitionEvents: [acquisitionEvent],
      contentArtifacts: [artifact], sourceSnapshots: [snapshot],
      revocations: [], asOf: new Date(Date.now() + 60_000),
    });
  }
  const vaVerified = await verifiedFromDb(va, VA_VERSIONS, 'va');
  const mdVerified = await verifiedFromDb(md, MD_VERSIONS, 'md');
  assert.equal(vaVerified.length, 2); assert.equal(mdVerified.length, 2);
  for (const d of vaVerified) { assert.equal(d.verification, 'VERIFIED'); assert.equal(d.source_id, VA_CCA_LANE.sourceKey); }
  for (const d of mdVerified) { assert.equal(d.verification, 'VERIFIED'); assert.equal(d.source_id, MD_MCA_LANE.sourceKey); }
});

test('DB IDEMPOTENCY: exact re-run reuses the immutable artifact; sequential duplicates stay deterministic', async () => {
  const rerun = await acquire(VA_CCA_LANE.sourceKey, VA_VERSIONS, VA_FIXTURE, 'pg-va-2');
  assert.equal(rerun.outcome, 'SOURCE_UNCHANGED');
  assert.equal(rerun.content_artifacts_created, 0);
  const artifacts = await prisma.marketSourceContentArtifact.findMany({ where: { sourceKey: VA_CCA_LANE.sourceKey } });
  assert.equal(artifacts.length, 1, 'one immutable VA artifact after repeated acquisition');
  assert.equal(rerun.revision_bound, false, 'no fake revision from a content hash');
});

test('CONCURRENT DUPLICATES: advisory lock serializes; exactly one artifact; outcomes deterministic as a set', async () => {
  const [a, b] = await Promise.all([
    acquire(MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_FIXTURE, 'pg-md-c1'),
    acquire(MD_MCA_LANE.sourceKey, MD_VERSIONS, MD_FIXTURE, 'pg-md-c2'),
  ]);
  assert.deepEqual([a.state, b.state], ['COMPLETED', 'COMPLETED']);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ['SOURCE_CHANGED', 'SOURCE_UNCHANGED'],
    'the advisory lock serialized the duplicates: one CHANGED, one UNCHANGED');
  const artifacts = await prisma.marketSourceContentArtifact.findMany({ where: { sourceKey: MD_MCA_LANE.sourceKey } });
  assert.equal(artifacts.length, 1, 'concurrency produced exactly one immutable MD artifact');
});

test('NO PARTIAL TRUTH under real transaction ROLLBACK: post-COMPLETED persistence failure erases the attempt entirely', async () => {
  const attempt = 'pg-rollback-1';
  const sabotagedStore = Object.freeze({
    async runExclusive(scope, work) {
      return store.runExclusive(scope, async (tx) => work(Object.freeze({
        ...tx,
        async appendCapabilityReceipt() { throw new Error('CANA_TEST_INJECTED_DB_FAILURE'); },
      })));
    },
  });
  // Use distinct content so a successful run WOULD have created rows.
  const mutated = `${VA_FIXTURE}<!-- rollback-court -->`;
  await assert.rejects(
    acquire(VA_CCA_LANE.sourceKey, VA_VERSIONS, mutated, attempt, sabotagedStore),
    /COMPLETION_PERSISTENCE_FAILED/,
  );
  // The transaction must have rolled back EVERYTHING: no events, no artifact,
  // no snapshot for the mutated content — zero partial truth.
  const events = await prisma.marketSourceAcquisitionEvent.findMany({ where: { tenant: RUN_TENANT, attemptId: attempt } });
  assert.equal(events.length, 0, 'rollback erased all acquisition events of the failed attempt');
  const mutatedSha = sha256(mutated);
  const orphan = await prisma.marketSourceContentArtifact.findMany({
    where: { sourceKey: VA_CCA_LANE.sourceKey, contentSha256: mutatedSha },
  });
  assert.equal(orphan.length, 0, 'no orphaned content artifact from the rolled-back attempt');
});

test('AUDITABLE FAILURE (no rollback path): source failure commits a FAILED terminal with zero content', async () => {
  const attempt = 'pg-fail-1';
  const failed = await acquireMarketReality(store, {
    sourceKey: MD_MCA_LANE.sourceKey, tenant: RUN_TENANT, attemptId: attempt,
    asOf: new Date().toISOString(), env: ENV,
    fetchImpl: async () => ({ status: 503, text: async () => 'down' }), versions: MD_VERSIONS,
  });
  assert.equal(failed.state, 'FAILED');
  const rows = await prisma.marketSourceAcquisitionEvent.findMany({
    where: { tenant: RUN_TENANT, attemptId: attempt }, orderBy: { sequence: 'asc' },
  });
  assert.ok(rows.length >= 2, 'failure receipt rows committed for audit');
  assert.equal(rows.at(-1).state, 'FAILED');
  assert.equal(rows.at(-1).contentArtifactId, null, 'no content bound to a failed attempt');
});

test('REAL-DB MULTI-MARKET ISOLATION: borrowed artifacts and crossed tuples fail closed', async () => {
  const vaEvent = await prisma.marketSourceAcquisitionEvent.findFirst({
    where: { tenant: RUN_TENANT, sourceKey: VA_CCA_LANE.sourceKey, state: 'COMPLETED' },
  });
  const mdArtifact = await prisma.marketSourceContentArtifact.findFirst({ where: { sourceKey: MD_MCA_LANE.sourceKey } });
  const mdSnapshot = await prisma.marketSourceSnapshot.findFirst({ where: { sourceKey: MD_MCA_LANE.sourceKey } });
  assert.ok(vaEvent && mdArtifact && mdSnapshot);
  const claim = {
    id: 'iso-claim-1', tenant: RUN_TENANT, claimType: 'facility_name', claimValue: 'X',
    snapshotId: mdSnapshot.id, observedAt: vaEvent.fetchedAt,
    freshnessExpiresAt: new Date(Date.now() + 86_400_000),
  };
  // VA acquisition row pointed at MD persisted content → refused.
  const crossed = selectCurrentClaimDecisions({
    claims: [claim],
    verificationEvents: [{ id: 'iso-v1', claimId: claim.id, acquisitionEventId: vaEvent.id, decision: 'ALLOW',
      evaluatorVersion: MARKET_CLAIM_COURT_VERSION, asOf: new Date(), freshnessExpiresAt: claim.freshnessExpiresAt }],
    acquisitionEvents: [{ ...vaEvent, contentArtifactId: mdArtifact.id, snapshotId: mdSnapshot.id }],
    contentArtifacts: [mdArtifact], sourceSnapshots: [mdSnapshot],
    revocations: [], asOf: new Date(Date.now() + 60_000),
  });
  assert.deepEqual(crossed, [], 'VA event bound to MD content must produce zero current truth');
});
