// VA VERIFIED WORLD STATE — the end-to-end court proving that a Virginia
// acquisition can produce VERIFIED, decision-eligible claim decisions through
// the SAME reality machine as D.C. (Transfer Test #1, slice 2c).
//
// Chain under test: fixture acquisition (captureVaCcaReality) → extracted
// statements → market claims (UNKNOWN default) → acquisition/artifact/snapshot
// evidence rows → execution-provenance version tuple (VA map, read from repo
// files at HEAD) → selectCurrentClaimDecisions → VERIFIED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  VA_CCA_LIVE_CONTRACT,
  VA_CCA_LIVE_CONTRACT_DIGEST,
  captureVaCcaReality,
} from '../src/lib/reality/live-va-cca-adapter.mjs';
import {
  VA_CLAIMS_SCHEMA_VERSION,
  VA_ENTITY_NORMALIZATION_VERSION,
  formVaMarketClaims,
} from '../src/lib/markets/va/va-claims.mjs';
import {
  MARKET_CLAIM_COURT_VERSION,
  adjudicateAcquisitionEvidence,
  adjudicateExecutionProvenance,
} from '../src/lib/reality/market-claim-court.mjs';
import { selectCurrentClaimDecisions } from '../src/lib/reality/market-claim-adapter.mjs';
import {
  answerCustomerDiscoveryFromReality,
  resolveCustomerDiscovery,
} from '../src/lib/ask/ask-service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(path.join(here, 'fixtures', 'va-cca', 'dispensaries.html'), 'utf8');
const ENV_OK = { CANA_LIVE_VA_CCA_ACQUISITION: 'OPERATOR_APPROVED' };
const TENANT = 'orderweeddc.com';
const ACQUIRED_AT = '2026-08-12T13:00:00.000Z';
const AS_OF = new Date('2026-08-12T18:00:00.000Z');
const REPOSITORY_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const REPOSITORY_TREE_SHA = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();

const VA_VERSIONS = Object.freeze({
  adapterVersion: 'va-cca-live-v1',
  parserVersion: VA_CCA_LIVE_CONTRACT.schemaVersion,
  compilerVersion: VA_CLAIMS_SCHEMA_VERSION,
  entityResolverVersion: VA_ENTITY_NORMALIZATION_VERSION,
  authorityPolicyVersion: 'va-cca-authority-v1',
  freshnessPolicyVersion: 'va-cca-freshness-v1',
  verificationCourtVersion: MARKET_CLAIM_COURT_VERSION,
});

async function vaEvidence() {
  const receipt = await captureVaCcaReality({
    fetchImpl: async () => ({ status: 200, text: async () => FIXTURE }),
    env: ENV_OK,
    clock: () => new Date(ACQUIRED_AT),
  });
  const formed = formVaMarketClaims({
    statements: receipt.records,
    sourceId: receipt.source_id,
    observedAt: ACQUIRED_AT,
  });
  const richmondAddress = formed.find((claim) => (
    claim.predicate === 'address' && claim.value.includes(', Richmond, VA ')
  ));
  assert.ok(richmondAddress, 'fixture must retain a Richmond subject for customer projection');
  const requiredPredicates = new Set(['cca_registry_listing_exists', 'name', 'address']);
  const claims = formed
    .filter((claim) => claim.entity_identity === richmondAddress.entity_identity && requiredPredicates.has(claim.predicate))
    .map((claim, index) => ({
    id: claim.claim_id,
    tenant: TENANT,
    claimType: claim.predicate,
    claimValue: claim.value,
    entityIdentity: claim.entity_identity,
    snapshotId: 'va-snapshot-1',
    observedAt: new Date(ACQUIRED_AT),
    freshnessExpiresAt: new Date('2026-09-11T13:00:00.000Z'),
    index,
    }));
  const snapshot = {
    id: 'va-snapshot-1',
    sourceKey: receipt.source_key,
    sourceUrl: receipt.source_url,
    payloadSha256: receipt.content_sha256,
    payloadBytes: receipt.payload_bytes,
    recordCount: receipt.record_count,
    schemaVersion: receipt.schema_version,
    completeness: 'COMPLETE',
  };
  const artifact = {
    id: 'va-content-1',
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
    id: 'va-acquisition-1',
    sourceKey: receipt.source_key,
    tenant: TENANT,
    state: 'COMPLETED',
    outcome: 'SOURCE_CHANGED',
    fetchedAt: new Date(ACQUIRED_AT),
    completedAt: new Date('2026-08-12T13:00:05.000Z'),
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
    ...VA_VERSIONS,
  };
  const verificationEvents = claims.map((claim, index) => ({
    id: `va-event-${index}`,
    claimId: claim.id,
    acquisitionEventId: event.id,
    decision: 'ALLOW',
    evaluatorVersion: MARKET_CLAIM_COURT_VERSION,
    asOf: new Date('2026-08-12T14:00:00.000Z'),
    freshnessExpiresAt: new Date('2026-09-11T13:00:00.000Z'),
  }));
  return { receipt, claims, snapshot, artifact, event, verificationEvents };
}

test('VA execution provenance: the VA version tuple is admitted from repo files at HEAD', async () => {
  const { event } = await vaEvidence();
  const verdict = adjudicateExecutionProvenance(event);
  assert.deepEqual(verdict, {
    decision: 'ALLOW',
    reason: 'EXECUTION_PROVENANCE_PASSED',
    repository_commit_sha: REPOSITORY_COMMIT_SHA,
    repository_tree_sha: REPOSITORY_TREE_SHA,
  });
});

test('VA acquisition with the DC version tuple is DENIED (tuples do not cross markets)', async () => {
  const { event } = await vaEvidence();
  const forged = {
    ...event,
    adapterVersion: 'dc-abca-live-v1',
    authorityPolicyVersion: 'dc-abca-authority-v1',
    freshnessPolicyVersion: 'dc-abca-freshness-v1',
  };
  assert.equal(adjudicateExecutionProvenance(forged).reason, 'VERSION_TUPLE_MISMATCH');
});

test('THE FIRST VERIFIED VIRGINIA WORLD STATE: fixture acquisition → VERIFIED claim decisions', async () => {
  const { claims, snapshot, artifact, event, verificationEvents } = await vaEvidence();
  const current = selectCurrentClaimDecisions({
    claims,
    verificationEvents,
    acquisitionEvents: [event],
    contentArtifacts: [artifact],
    sourceSnapshots: [snapshot],
    revocations: [],
    asOf: AS_OF,
  });
  assert.equal(current.length, 3, 'all three VA claims reach current truth');
  for (const decision of current) {
    assert.equal(decision.verification, 'VERIFIED');
    assert.equal(decision.decision_eligible, true);
    assert.equal(decision.source_id, VA_CCA_LIVE_CONTRACT.sourceKey);
    assert.equal(decision.court_version, MARKET_CLAIM_COURT_VERSION);
    assert.match(decision.subject_ref, /^va-cca:/);
  }

  const projection = answerCustomerDiscoveryFromReality({
    rawQuery: 'dispensary in richmond',
    marketId: 'US-VA',
    tenantDomain: TENANT,
    claimDecisions: current,
    now: AS_OF,
  });
  assert.equal(projection.results.length, 1, 'verified CCA Reality reaches ASK without a Retailer fixture');
  assert.equal(projection.results[0].merchant_id, current[0].subject_ref);
  assert.equal(projection.results[0].location.city.value, 'Richmond');
  assert.equal(projection.results[0].regulatory_state.state, 'UNKNOWN');
  assert.equal(projection.results[0].delivery_eligibility.state, 'UNKNOWN');
  assert.equal(projection.truth.gate, 'selectCurrentClaimDecisions + buildAnswerabilityFrontier');

  const storeReads = [];
  const persisted = {
    marketClaim: { findMany: async (query) => {
      storeReads.push(['claims', query.where]);
      return claims.map((claim) => ({
        ...claim,
        claimKey: `${claim.entityIdentity}:${claim.claimType}`,
        version: 1,
        resolutionId: claim.entityIdentity,
        evidence: [],
        verificationEvents: verificationEvents.filter((item) => item.claimId === claim.id),
      }));
    } },
    marketVerificationEvent: { findMany: async () => {
      throw new Error('current-state loader must use the latest nested verification event');
    } },
    marketSourceAcquisitionEvent: { findMany: async () => [event] },
    marketSourceContentArtifact: { findMany: async () => [artifact] },
    marketSourceSnapshot: { findMany: async () => [snapshot] },
    marketEvidenceRevocationEvent: { findMany: async () => [] },
  };
  const liveSurface = await resolveCustomerDiscovery(persisted, {
    rawQuery: 'dispensary in richmond',
    marketId: 'US-VA',
    tenantDomain: TENANT,
    now: AS_OF,
  });
  assert.equal(liveSurface.projection.results.length, 1,
    'the customer orchestration must load canonical persisted Reality, not a fabricated Retailer');
  assert.equal(liveSurface.projection.results[0].merchant_id, current[0].subject_ref);
  assert.deepEqual(storeReads, [['claims', {
    tenant: TENANT,
    snapshot: { is: { sourceKey: VA_CCA_LIVE_CONTRACT.sourceKey } },
    versions: { none: {} },
  }]]);
});

test('VA acquisition court: COMPILE purpose ALLOWs; forged digest and foreign source are rejected', async () => {
  const { snapshot, artifact, event } = await vaEvidence();
  const admitted = adjudicateAcquisitionEvidence({
    event, artifact, snapshot, tenant: TENANT, purpose: 'COMPILE', asOf: AS_OF,
  });
  assert.equal(admitted.decision, 'ALLOW');
  assert.equal(admitted.content_sha256, snapshot.payloadSha256);

  assert.equal(adjudicateAcquisitionEvidence({
    event: { ...event, requestDigest: 'b'.repeat(64) },
    artifact, snapshot, tenant: TENANT, purpose: 'COMPILE', asOf: AS_OF,
  }).reason, 'ACQUISITION_REQUEST_CONTRACT_MISMATCH');

  assert.equal(adjudicateAcquisitionEvidence({
    event: { ...event, sourceKey: 'attacker-source' },
    artifact, snapshot, tenant: TENANT, purpose: 'COMPILE', asOf: AS_OF,
  }).reason, 'ACQUISITION_SOURCE_MISMATCH');
});

test('VA revalidation stays refused without a bound revision (HTML sources have none yet)', async () => {
  const { snapshot, artifact, event } = await vaEvidence();
  assert.equal(adjudicateAcquisitionEvidence({
    event: { ...event, outcome: 'SOURCE_UNCHANGED' },
    artifact, snapshot, tenant: TENANT, purpose: 'REVALIDATE', asOf: AS_OF,
  }).reason, 'ACQUISITION_REVISION_UNBOUND');
});

test('VA contract digest binds the acquisition end-to-end', async () => {
  const { event } = await vaEvidence();
  assert.equal(event.requestDigest, VA_CCA_LIVE_CONTRACT_DIGEST);
  assert.equal(event.adapterContractDigest, VA_CCA_LIVE_CONTRACT_DIGEST);
});
