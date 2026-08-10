import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { ABCA_LIVE_CONTRACT, ABCA_LIVE_CONTRACT_DIGEST } from '../src/lib/reality/live-abca-adapter.mjs';

let court;
let debt;
let revocation;
let adapter;
let router;

before(async () => {
  court = await import('../src/lib/reality/market-claim-court.mjs');
  debt = await import('../src/lib/reality/freshness-debt.mjs');
  revocation = await import('../src/lib/reality/evidence-revocation.mjs');
  adapter = await import('../src/lib/reality/market-claim-adapter.mjs');
  router = await import('../src/lib/reality/source-portfolio-router.mjs');
});

const ACQUIRED_AT = '2026-08-10T15:00:00.000Z';
const AS_OF = new Date('2026-08-11T15:00:00.000Z');

function evidence(overrides = {}) {
  const snapshot = {
    id: 'snapshot-1',
    sourceKey: ABCA_LIVE_CONTRACT.sourceKey,
    sourceUrl: ABCA_LIVE_CONTRACT.layerUrl,
    payloadSha256: 'a'.repeat(64),
    payloadBytes: 100,
    recordCount: 1,
    schemaVersion: 'cana-dc-abca-arcgis-snapshot-v1',
    completeness: 'COMPLETE',
  };
  const artifact = {
    id: 'content-1',
    snapshotId: snapshot.id,
    sourceKey: snapshot.sourceKey,
    sourceUrl: snapshot.sourceUrl,
    requestContractDigest: ABCA_LIVE_CONTRACT_DIGEST,
    contentSha256: snapshot.payloadSha256,
    payloadBytes: snapshot.payloadBytes,
    recordCount: snapshot.recordCount,
    schemaVersion: snapshot.schemaVersion,
  };
  const event = {
    id: 'acquisition-1',
    sourceKey: snapshot.sourceKey,
    tenant: 'orderweeddc.com',
    state: 'COMPLETED',
    outcome: 'SOURCE_UNCHANGED',
    fetchedAt: new Date(ACQUIRED_AT),
    completedAt: new Date('2026-08-10T15:00:05.000Z'),
    completeness: 'COMPLETE',
    sourceRevision: '1781114729000',
    preSourceRevision: '1781114729000',
    postSourceRevision: '1781114729000',
    observedRecordCount: 1,
    preObservedRecordCount: 1,
    postObservedRecordCount: 1,
    requestDigest: ABCA_LIVE_CONTRACT_DIGEST,
    adapterContractDigest: ABCA_LIVE_CONTRACT_DIGEST,
    contentArtifactId: artifact.id,
    snapshotId: snapshot.id,
    errorCode: null,
  };
  return {
    event: { ...event, ...overrides.event },
    artifact: { ...artifact, ...overrides.artifact },
    snapshot: { ...snapshot, ...overrides.snapshot },
  };
}

test('unchanged acquisition is valid only for revalidation and binds exact source, content, revision, and count', () => {
  const admitted = court.adjudicateAcquisitionEvidence({
    ...evidence(),
    tenant: 'orderweeddc.com',
    purpose: 'REVALIDATE',
    asOf: AS_OF,
  });
  assert.equal(admitted.decision, 'ALLOW');
  assert.equal(admitted.acquisition_id, 'acquisition-1');
  assert.equal(admitted.content_sha256, 'a'.repeat(64));
  assert.equal(admitted.zero_change, true);

  assert.equal(court.adjudicateAcquisitionEvidence({
    ...evidence(),
    tenant: 'orderweeddc.com',
    purpose: 'COMPILE',
    asOf: AS_OF,
  }).reason, 'ACQUISITION_OUTCOME_NOT_COMPILABLE');
  assert.equal(court.adjudicateAcquisitionEvidence({
    ...evidence({ event: { outcome: 'SOURCE_CHANGED' } }),
    tenant: 'orderweeddc.com',
    purpose: 'COMPILE',
    asOf: AS_OF,
  }).decision, 'ALLOW');
});

test('failed, cross-tenant, drifted, partial, future, and digest-mismatched acquisition evidence is denied', () => {
  const cases = [
    [evidence({ event: { state: 'FAILED', errorCode: 'CANA_LIVE_REALITY_HTTP_ERROR' } }), 'ACQUISITION_NOT_SUCCESSFUL'],
    [evidence({ event: { tenant: 'other.example' } }), 'ACQUISITION_TENANT_MISMATCH'],
    [evidence({ event: { postSourceRevision: '1781114730000' } }), 'ACQUISITION_REVISION_DRIFT'],
    [evidence({ event: { postObservedRecordCount: 2 } }), 'ACQUISITION_COUNT_DRIFT'],
    [evidence({ event: { completeness: 'PARTIAL' } }), 'ACQUISITION_NOT_COMPLETE'],
    [evidence({ event: { requestDigest: 'b'.repeat(64) } }), 'ACQUISITION_REQUEST_CONTRACT_MISMATCH'],
    [evidence({ artifact: { contentSha256: 'b'.repeat(64) } }), 'CONTENT_IDENTITY_MISMATCH'],
  ];
  for (const [input, reason] of cases) {
    assert.equal(court.adjudicateAcquisitionEvidence({
      ...input,
      tenant: 'orderweeddc.com',
      purpose: 'REVALIDATE',
      asOf: AS_OF,
    }).reason, reason);
  }
  assert.equal(court.adjudicateAcquisitionEvidence({
    ...evidence(),
    tenant: 'orderweeddc.com',
    purpose: 'REVALIDATE',
    asOf: new Date('2026-08-10T14:59:59.999Z'),
  }).reason, 'ACQUISITION_FROM_FUTURE');
});

test('freshness re-attestation is acquired-time bounded, license bounded, and predicate authoritative', () => {
  const policy = {
    source_id: 'dcgis:abca:licensed-medical-cannabis-retailers:layer-31',
    max_age_ms: 30 * 24 * 60 * 60 * 1000,
    authoritative_predicates: ['license_status'],
  };
  assert.deepEqual(court.adjudicateZeroChangeReattestation({
    acquisition: court.adjudicateAcquisitionEvidence({
      ...evidence(), tenant: 'orderweeddc.com', purpose: 'REVALIDATE', asOf: AS_OF,
    }),
    predicate: 'license_status',
    sourcePolicy: policy,
    licenseExpiration: '2026-08-30T00:00:00.000Z',
    asOf: AS_OF,
  }), {
    decision: 'ALLOW',
    verification: 'VERIFIED',
    decision_eligible: true,
    freshness_expires_at: '2026-08-30T00:00:00.000Z',
    reason: 'ZERO_CHANGE_REATTESTATION_PASSED',
  });
  assert.equal(court.adjudicateZeroChangeReattestation({
    acquisition: court.adjudicateAcquisitionEvidence({
      ...evidence(), tenant: 'orderweeddc.com', purpose: 'REVALIDATE', asOf: AS_OF,
    }),
    predicate: 'hours',
    sourcePolicy: policy,
    asOf: AS_OF,
  }).reason, 'PREDICATE_OUTSIDE_SOURCE_AUTHORITY');
});

test('freshness debt is visible and creates bounded OBSERVE_ONLY revalidation work without asserting truth', () => {
  const summary = debt.computeFreshnessDebt({
    tenant: 'orderweeddc.com',
    asOf: AS_OF,
    claims: [
      { id: 'claim-stale', predicate: 'license_status', freshness_expires_at: '2026-08-10T00:00:00.000Z', decision_eligible: false, demand_count: 8, dependent_decisions: 3, source_available: true },
      { id: 'claim-due', predicate: 'regulated_address', freshness_expires_at: '2026-08-14T00:00:00.000Z', decision_eligible: true, demand_count: 1, dependent_decisions: 1, source_available: true },
      { id: 'claim-low', predicate: 'operating_status', freshness_expires_at: '2026-09-10T00:00:00.000Z', decision_eligible: true, demand_count: 0, dependent_decisions: 0, source_available: true },
    ],
  });
  assert.equal(summary.stale_claims, 1);
  assert.equal(summary.approaching_stale_claims, 1);
  assert.equal(summary.items[0].claim_id, 'claim-stale');
  assert.ok(summary.items[0].priority_score > summary.items[1].priority_score);

  const work = debt.createRevalidationWorkSpec(summary.items[0], { now: AS_OF });
  assert.equal(work.trigger.triggerType, 'REVALIDATION');
  assert.equal(work.trigger.authorityCeiling, 'OBSERVE_ONLY');
  assert.equal(work.trigger.evidenceRequirements.loop_mode, 'REFLECTION_ONLY');
  assert.equal(work.trigger.evidenceRequirements.consumer, 'reality_claim_revalidation');
  assert.ok(work.trigger.budgetCentsMax <= 100);
  assert.equal(work.truth_mutations, 0);
});

test('revocation blast radius is lineage-specific and cannot fabricate replacement truth', () => {
  const graph = {
    claims: [
      { id: 'claim-a', parser_version: 'parser-v1', observation_ids: ['obs-a'] },
      { id: 'claim-b', parser_version: 'parser-v2', observation_ids: ['obs-b'] },
    ],
    verification_events: [
      { id: 'verify-a', claim_id: 'claim-a', decision_eligible: true },
      { id: 'verify-b', claim_id: 'claim-b', decision_eligible: true },
    ],
    projections: [{ id: 'projection-a', claim_id: 'claim-a' }, { id: 'projection-b', claim_id: 'claim-b' }],
    gaps: [{ id: 'gap-a', claim_ids: ['claim-a'] }, { id: 'gap-b', claim_ids: ['claim-b'] }],
  };
  const blast = revocation.deriveEvidenceBlastRadius({
    targetKind: 'PARSER_VERSION',
    targetId: 'parser-v1',
    graph,
  });
  assert.deepEqual(blast.claim_ids, ['claim-a']);
  assert.deepEqual(blast.verification_event_ids, ['verify-a']);
  assert.deepEqual(blast.projection_ids, ['projection-a']);
  assert.deepEqual(blast.gap_ids, ['gap-a']);
  const recalled = revocation.applyRevocationCourt({
    decisions: graph.verification_events,
    blastRadius: blast,
    revocationEventId: 'revoke-1',
  });
  assert.equal(recalled.find((item) => item.id === 'verify-a').decision_eligible, false);
  assert.equal(recalled.find((item) => item.id === 'verify-b').decision_eligible, true);
  assert.equal(recalled.some((item) => item.replacement_truth), false);
});

test('current truth requires a current acquisition-bound court event and excludes revoked lineage', () => {
  const claims = [
    { id: 'claim-a', claimType: 'license_status', claimValue: 'ACTIVE', observedAt: new Date(ACQUIRED_AT), freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
    { id: 'claim-b', claimType: 'regulated_address', claimValue: '100 Test St', observedAt: new Date(ACQUIRED_AT), freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
    { id: 'laundered', claimType: 'hours', claimValue: '24/7', verification: 'VERIFIED', decisionEligible: true, observedAt: new Date(ACQUIRED_AT), freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
  ];
  const events = [
    { id: 'event-a', claimId: 'claim-a', acquisitionEventId: 'acq-a', decision: 'ALLOW', evaluatorVersion: 'court-v1', asOf: AS_OF, freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
    { id: 'event-b', claimId: 'claim-b', acquisitionEventId: 'acq-b', decision: 'ALLOW', evaluatorVersion: 'court-v1', asOf: AS_OF, freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
  ];
  const current = adapter.selectCurrentClaimDecisions({
    claims,
    verificationEvents: events,
    revocations: [{ decision: 'EVIDENCE_REVOKED', acquisitionEventId: 'acq-a', effectiveAt: AS_OF }],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  });
  assert.deepEqual(current.map((item) => item.claim_id), ['claim-b']);
});

test('source routing cannot create predicate authority or let reliability override prohibition', () => {
  const prohibited = {
    source_key: 'copied-market-list',
    source_id: 'copied-market-list',
    source_class: 'UNVERIFIED_AGGREGATOR',
    independence_group: 'copied-data',
    authoritative_predicates: ['license_status', 'hours'],
    live_admitted: false,
    fixed_origin: true,
    estimated_cost_cents: 0,
    reliability_score: 1,
  };
  const official = { ...router.LIVE_SOURCE_REGISTRY[0], estimated_cost_cents: 0, reliability_score: 0.1 };
  assert.equal(router.routeRealitySource({
    predicate: 'license_status', candidates: [prohibited, official], maximumCostCents: 0,
  }).selected_source, official.source_key);
  assert.equal(router.routeRealitySource({
    predicate: 'hours', candidates: [prohibited, official], maximumCostCents: 0,
  }).state, 'UNKNOWN');
});
