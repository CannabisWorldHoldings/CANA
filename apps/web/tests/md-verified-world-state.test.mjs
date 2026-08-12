// MD VERIFIED WORLD STATE — Transfer Test #2's decisive court: Maryland
// reaches VERIFIED claim decisions through the SAME reality machine, with
// ZERO core validation changes (only additive registrations).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MD_MCA_LIVE_CONTRACT,
  MD_MCA_LIVE_CONTRACT_DIGEST,
  captureMdMcaReality,
} from '../src/lib/reality/live-md-mca-adapter.mjs';
import {
  MD_CLAIMS_SCHEMA_VERSION,
  MD_ENTITY_NORMALIZATION_VERSION,
  formMdMarketClaims,
} from '../src/lib/markets/md/md-claims.mjs';
import { parseMcaRegistryPage, MD_MCA_PARSER_RULE_VERSION } from '../src/lib/markets/md/md-mca-registry-parser.mjs';
import { MD_MARKET, validateMdMarket } from '../src/lib/markets/md/md-market-registry.mjs';
import {
  MARKET_CLAIM_COURT_VERSION,
  adjudicateAcquisitionEvidence,
  adjudicateExecutionProvenance,
} from '../src/lib/reality/market-claim-court.mjs';
import { selectCurrentClaimDecisions } from '../src/lib/reality/market-claim-adapter.mjs';
import { routeRealitySource, LIVE_SOURCE_REGISTRY } from '../src/lib/reality/source-portfolio-router.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(path.join(here, 'fixtures', 'md-mca', 'dispensaries.html'), 'utf8');
const ENV_OK = { CANA_LIVE_MD_MCA_ACQUISITION: 'OPERATOR_APPROVED' };
const TENANT = 'orderweeddc.com';
const ACQUIRED_AT = '2026-08-12T14:00:00.000Z';
const AS_OF = new Date('2026-08-12T18:00:00.000Z');
const REPOSITORY_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const REPOSITORY_TREE_SHA = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();

// Pins — refreshed together with the fixture, never edited alone.
const PINNED_RECORD_COUNT = 90;
const PINNED_NAMED_COUNT = 71;

const MD_VERSIONS = Object.freeze({
  adapterVersion: 'md-mca-live-v1',
  parserVersion: MD_MCA_LIVE_CONTRACT.schemaVersion,
  compilerVersion: MD_CLAIMS_SCHEMA_VERSION,
  entityResolverVersion: MD_ENTITY_NORMALIZATION_VERSION,
  authorityPolicyVersion: 'md-mca-authority-v1',
  freshnessPolicyVersion: 'md-mca-freshness-v1',
  verificationCourtVersion: MARKET_CLAIM_COURT_VERSION,
});

test('MD market registry laws hold (no invented delivery class, regulator-only sources)', () => {
  assert.equal(validateMdMarket(), true);
  assert.equal(MD_MARKET.deliveryModel.independentDeliveryOperatorClass, 'NONE');
});

test('MCA fixture: pinned extraction (loud-change law) — 90 records, 71 named, 0 rejects', () => {
  const { records, rejects } = parseMcaRegistryPage(FIXTURE, { url: MD_MCA_LIVE_CONTRACT.pageUrl });
  assert.equal(records.length, PINNED_RECORD_COUNT);
  assert.equal(records.filter((r) => r.name).length, PINNED_NAMED_COUNT);
  assert.equal(rejects.length, 0);
  for (const r of records) {
    assert.equal(r.statementType, 'MCA_REGISTRY_LISTING');
    assert.equal(r.address.state, 'MD');
    assert.match(r.address.zip, /^\d{5}$/);
    assert.equal(r.provenance.parserRule, MD_MCA_PARSER_RULE_VERSION);
  }
  // Name-unpublished locations carry NO name field — absent, never invented.
  const unnamed = records.filter((r) => !('name' in r));
  assert.equal(unnamed.length, PINNED_RECORD_COUNT - PINNED_NAMED_COUNT);
});

async function mdEvidence() {
  const receipt = await captureMdMcaReality({
    fetchImpl: async () => ({ status: 200, text: async () => FIXTURE }),
    env: ENV_OK,
    clock: () => new Date(ACQUIRED_AT),
  });
  const formed = formMdMarketClaims({
    statements: receipt.records,
    sourceId: receipt.source_id,
    observedAt: ACQUIRED_AT,
  });
  const claims = formed.slice(0, 3).map((claim) => ({
    id: claim.claim_id,
    tenant: TENANT,
    claimType: claim.predicate,
    claimValue: claim.value,
    snapshotId: 'md-snapshot-1',
    observedAt: new Date(ACQUIRED_AT),
    freshnessExpiresAt: new Date('2026-09-11T14:00:00.000Z'),
  }));
  const snapshot = {
    id: 'md-snapshot-1',
    sourceKey: receipt.source_key,
    sourceUrl: receipt.source_url,
    payloadSha256: receipt.content_sha256,
    payloadBytes: receipt.payload_bytes,
    recordCount: receipt.record_count,
    schemaVersion: receipt.schema_version,
    completeness: 'COMPLETE',
  };
  const artifact = {
    id: 'md-content-1',
    snapshotId: snapshot.id,
    sourceKey: snapshot.sourceKey,
    sourceUrl: snapshot.sourceUrl,
    requestContractDigest: receipt.request_digest,
    contentSha256: snapshot.payloadSha256,
    payloadBytes: snapshot.payloadBytes,
    recordCount: snapshot.recordCount,
    schemaVersion: snapshot.schemaVersion,
  };
  const event = {
    id: 'md-acquisition-1',
    sourceKey: receipt.source_key,
    tenant: TENANT,
    state: 'COMPLETED',
    outcome: 'SOURCE_CHANGED',
    fetchedAt: new Date(ACQUIRED_AT),
    completedAt: new Date('2026-08-12T14:00:05.000Z'),
    completeness: 'COMPLETE',
    sourceRevision: 'UNKNOWN',
    preSourceRevision: null,
    postSourceRevision: null,
    revisionState: 'UNKNOWN',
    observedRecordCount: receipt.record_count,
    preObservedRecordCount: receipt.record_count,
    postObservedRecordCount: receipt.record_count,
    requestDigest: receipt.request_digest,
    adapterContractDigest: receipt.adapter_contract_digest,
    repositoryCommitSha: REPOSITORY_COMMIT_SHA,
    repositoryTreeSha: REPOSITORY_TREE_SHA,
    contentArtifactId: artifact.id,
    snapshotId: snapshot.id,
    errorCode: null,
    ...MD_VERSIONS,
  };
  const verificationEvents = claims.map((claim, index) => ({
    id: `md-event-${index}`,
    claimId: claim.id,
    acquisitionEventId: event.id,
    decision: 'ALLOW',
    evaluatorVersion: MARKET_CLAIM_COURT_VERSION,
    asOf: new Date('2026-08-12T15:00:00.000Z'),
    freshnessExpiresAt: new Date('2026-09-11T14:00:00.000Z'),
  }));
  return { receipt, claims, snapshot, artifact, event, verificationEvents };
}

test('MD execution provenance: the MD tuple is admitted; DC and VA tuples are DENIED for MD events', async () => {
  const { event } = await mdEvidence();
  assert.equal(adjudicateExecutionProvenance(event).decision, 'ALLOW');
  assert.equal(adjudicateExecutionProvenance({
    ...event,
    adapterVersion: 'dc-abca-live-v1',
    authorityPolicyVersion: 'dc-abca-authority-v1',
    freshnessPolicyVersion: 'dc-abca-freshness-v1',
  }).reason, 'VERSION_TUPLE_MISMATCH');
  assert.equal(adjudicateExecutionProvenance({
    ...event,
    adapterVersion: 'va-cca-live-v1',
    authorityPolicyVersion: 'va-cca-authority-v1',
    freshnessPolicyVersion: 'va-cca-freshness-v1',
  }).reason, 'VERSION_TUPLE_MISMATCH');
});

test('THE FIRST VERIFIED MARYLAND WORLD STATE: fixture acquisition → VERIFIED claim decisions', async () => {
  const { claims, snapshot, artifact, event, verificationEvents } = await mdEvidence();
  const current = selectCurrentClaimDecisions({
    claims,
    verificationEvents,
    acquisitionEvents: [event],
    contentArtifacts: [artifact],
    sourceSnapshots: [snapshot],
    revocations: [],
    asOf: AS_OF,
  });
  assert.equal(current.length, 3);
  for (const decision of current) {
    assert.equal(decision.verification, 'VERIFIED');
    assert.equal(decision.decision_eligible, true);
    assert.equal(decision.source_id, MD_MCA_LIVE_CONTRACT.sourceKey);
  }
});

test('MD acquisition court: COMPILE ALLOWs; forgeries rejected with the same reasons as every market', async () => {
  const { snapshot, artifact, event } = await mdEvidence();
  assert.equal(adjudicateAcquisitionEvidence({
    event, artifact, snapshot, tenant: TENANT, purpose: 'COMPILE', asOf: AS_OF,
  }).decision, 'ALLOW');
  assert.equal(adjudicateAcquisitionEvidence({
    event: { ...event, requestDigest: 'b'.repeat(64) },
    artifact, snapshot, tenant: TENANT, purpose: 'COMPILE', asOf: AS_OF,
  }).reason, 'ACQUISITION_REQUEST_CONTRACT_MISMATCH');
  assert.equal(adjudicateAcquisitionEvidence({
    event: { ...event, sourceKey: 'attacker-source' },
    artifact, snapshot, tenant: TENANT, purpose: 'COMPILE', asOf: AS_OF,
  }).reason, 'ACQUISITION_SOURCE_MISMATCH');
});

test('router: three admitted sources; MD routes only within its authority; license stays UNKNOWN', () => {
  assert.equal(LIVE_SOURCE_REGISTRY.length, 3);
  const md = { ...LIVE_SOURCE_REGISTRY[2], estimated_cost_cents: 0, reliability_score: 1 };
  assert.equal(md.independence_group, 'md-mca-registry-pages');
  assert.equal(routeRealitySource({ predicate: 'facility_name', candidates: [md], maximumCostCents: 0 }).selected_source, md.source_key);
  assert.equal(routeRealitySource({ predicate: 'license_number', candidates: [md], maximumCostCents: 0 }).state, 'UNKNOWN');
});

test('MD contract digest binds end-to-end', async () => {
  const { event } = await mdEvidence();
  assert.equal(event.requestDigest, MD_MCA_LIVE_CONTRACT_DIGEST);
});
