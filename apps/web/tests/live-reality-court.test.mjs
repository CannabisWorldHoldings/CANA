import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

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
const COURT_VERSION = 'cana-market-claim-court-v1';
const REPOSITORY = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const REPOSITORY_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const REPOSITORY_TREE_SHA = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();

function writeVersionFixture(root, relative, contents) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

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
    revisionState: 'OBSERVED',
    observedRecordCount: 1,
    preObservedRecordCount: 1,
    postObservedRecordCount: 1,
    requestDigest: ABCA_LIVE_CONTRACT_DIGEST,
    adapterContractDigest: ABCA_LIVE_CONTRACT_DIGEST,
    adapterVersion: 'dc-abca-live-v1',
    parserVersion: 'cana-dc-abca-arcgis-snapshot-v1',
    compilerVersion: 'cana-reality-compiler-v1',
    entityResolverVersion: 'dc-abca-identity-v1',
    authorityPolicyVersion: 'dc-abca-authority-v1',
    freshnessPolicyVersion: 'dc-abca-freshness-v1',
    verificationCourtVersion: COURT_VERSION,
    repositoryCommitSha: REPOSITORY_COMMIT_SHA,
    repositoryTreeSha: REPOSITORY_TREE_SHA,
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

test('UNKNOWN revision may be compiled as observation evidence but cannot revalidate freshness', () => {
  const unknownRevision = evidence({
    event: {
      sourceRevision: 'UNKNOWN',
      preSourceRevision: null,
      postSourceRevision: null,
      revisionState: 'UNKNOWN',
      outcome: 'SOURCE_CHANGED',
    },
  });
  const compile = court.adjudicateAcquisitionEvidence({
    ...unknownRevision,
    tenant: 'orderweeddc.com',
    purpose: 'COMPILE',
    asOf: AS_OF,
  });
  assert.equal(compile.decision, 'ALLOW');
  assert.equal(compile.revision_bound, false);
  assert.equal(court.adjudicateAcquisitionEvidence({
    ...unknownRevision,
    tenant: 'orderweeddc.com',
    purpose: 'REVALIDATE',
    asOf: AS_OF,
  }).reason, 'ACQUISITION_REVISION_UNBOUND');

  const unknownUnchanged = court.adjudicateAcquisitionEvidence({
    ...evidence({ event: {
      sourceRevision: 'UNKNOWN',
      preSourceRevision: null,
      postSourceRevision: null,
      revisionState: 'UNKNOWN',
    } }),
    tenant: 'orderweeddc.com',
    purpose: 'REVALIDATE',
    asOf: AS_OF,
  });
  assert.equal(unknownUnchanged.reason, 'ACQUISITION_REVISION_UNBOUND');
  assert.equal(court.adjudicateZeroChangeReattestation({
    acquisition: unknownUnchanged,
    predicate: 'license_status',
    sourcePolicy: {
      max_age_ms: 30 * 24 * 60 * 60 * 1000,
      authoritative_predicates: ['license_status'],
    },
    asOf: AS_OF,
  }).decision_eligible, false);

  assert.equal(court.adjudicateAcquisitionEvidence({
    ...evidence({ event: {
      sourceRevision: 'UNKNOWN',
      preSourceRevision: 'UNKNOWN',
      postSourceRevision: 'UNKNOWN',
      revisionState: 'OBSERVED',
      outcome: 'SOURCE_CHANGED',
    } }),
    tenant: 'orderweeddc.com',
    purpose: 'REVALIDATE',
    asOf: AS_OF,
  }).reason, 'ACQUISITION_REVISION_UNBOUND');
});

test('failed, cross-tenant, drifted, partial, future, and digest-mismatched acquisition evidence is denied', () => {
  const cases = [
    [evidence({ event: { state: 'FAILED', errorCode: 'CANA_LIVE_REALITY_HTTP_ERROR' } }), 'ACQUISITION_NOT_SUCCESSFUL'],
    [evidence({ event: { tenant: 'other.example' } }), 'ACQUISITION_TENANT_MISMATCH'],
    [evidence({ event: { postSourceRevision: '1781114730000' } }), 'ACQUISITION_REVISION_DRIFT'],
    [evidence({ event: { postObservedRecordCount: 2 } }), 'ACQUISITION_COUNT_DRIFT'],
    [evidence({ event: { completeness: 'PARTIAL' } }), 'ACQUISITION_NOT_COMPLETE'],
    [evidence({ event: { requestDigest: 'b'.repeat(64) } }), 'ACQUISITION_REQUEST_CONTRACT_MISMATCH'],
    [evidence({ event: { compilerVersion: null } }), 'ACQUISITION_VERSION_PROVENANCE_INVALID'],
    [evidence({ event: { repositoryTreeSha: null } }), 'ACQUISITION_VERSION_PROVENANCE_INVALID'],
    [evidence({ event: { repositoryCommitSha: '0'.repeat(40) } }), 'ACQUISITION_REPOSITORY_COMMIT_UNKNOWN'],
    [evidence({ event: { repositoryTreeSha: 'f'.repeat(40) } }), 'ACQUISITION_REPOSITORY_TREE_MISMATCH'],
    [evidence({ event: { compilerVersion: 'cana-reality-compiler-v999' } }), 'ACQUISITION_VERSION_TUPLE_MISMATCH'],
    [evidence({ event: { verificationCourtVersion: 'forged-court-v9' } }), 'ACQUISITION_COURT_VERSION_MISMATCH'],
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

test('execution provenance admits an exact depth-one merge checkout without reading absent parents', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-shallow-merge-court-'));
  const source = path.join(root, 'source');
  const shallow = path.join(root, 'shallow');
  const bundle = path.join(root, 'source.bundle');
  const bundled = path.join(root, 'bundled');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync('git', ['init', '--quiet', source]);
  execFileSync('git', ['-C', source, 'config', 'user.name', 'CANA Court']);
  execFileSync('git', ['-C', source, 'config', 'user.email', 'court@example.invalid']);
  writeVersionFixture(source, 'apps/web/scripts/acquire-live-market-reality.mjs', [
    "adapterVersion: 'dc-abca-live-v1'",
    "authorityPolicyVersion: 'dc-abca-authority-v1'",
    "freshnessPolicyVersion: 'dc-abca-freshness-v1'",
  ].join('\n'));
  writeVersionFixture(source, 'apps/web/src/lib/reality/official-source-snapshot.mjs',
    "export const OFFICIAL_SOURCE_SCHEMA_VERSION = 'cana-dc-abca-arcgis-snapshot-v1';\n");
  writeVersionFixture(source, 'apps/web/src/lib/reality/reality-compiler.mjs',
    "export const REALITY_COMPILER_VERSION = 'cana-reality-compiler-v1';\n");
  writeVersionFixture(source, 'apps/web/src/lib/reality/entity-resolution.mjs',
    "export const ENTITY_NORMALIZATION_VERSION = 'dc-abca-identity-v1';\n");
  writeVersionFixture(source, 'apps/web/src/lib/reality/market-claim-court.mjs',
    "export const MARKET_CLAIM_COURT_VERSION = 'cana-market-claim-court-v1';\n");
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, 'commit', '--quiet', '-m', 'fixture parent']);
  const firstParent = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeVersionFixture(source, 'fixture-second-parent', 'bounded merge fixture\n');
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, 'commit', '--quiet', '-m', 'fixture second parent']);
  const secondParent = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const merge = execFileSync(
    'git',
    ['-C', source, 'commit-tree', tree, '-p', secondParent, '-p', firstParent],
    { encoding: 'utf8', input: 'synthetic pull request merge\n' },
  ).trim();
  execFileSync('git', ['-C', source, 'update-ref', 'refs/heads/synthetic', merge]);
  execFileSync('git', ['clone', '--quiet', '--depth=1', '--branch', 'synthetic', pathToFileURL(source).href, shallow]);
  execFileSync('git', ['-C', shallow, 'bundle', 'create', bundle, 'HEAD']);
  execFileSync('git', ['clone', '--quiet', bundle, bundled]);
  execFileSync('git', ['-C', bundled, 'checkout', '--quiet', merge]);

  const legacyProbe = spawnSync('git', ['show', '-s', '--format=%T', merge], {
    cwd: bundled,
    encoding: 'utf8',
  });
  assert.notEqual(legacyProbe.status, 0, 'fixture must reproduce the missing-parent git show failure');
  const moduleUrl = pathToFileURL(path.join(REPOSITORY, 'apps/web/src/lib/reality/market-claim-court.mjs')).href;
  const child = execFileSync('node', ['--input-type=module', '--eval', `
    import { adjudicateExecutionProvenance } from ${JSON.stringify(moduleUrl)};
    const result = adjudicateExecutionProvenance({
      repositoryCommitSha: ${JSON.stringify(merge)},
      repositoryTreeSha: ${JSON.stringify(tree)},
      adapterVersion: 'dc-abca-live-v1',
      parserVersion: 'cana-dc-abca-arcgis-snapshot-v1',
      compilerVersion: 'cana-reality-compiler-v1',
      entityResolverVersion: 'dc-abca-identity-v1',
      authorityPolicyVersion: 'dc-abca-authority-v1',
      freshnessPolicyVersion: 'dc-abca-freshness-v1',
      verificationCourtVersion: 'cana-market-claim-court-v1',
    });
    process.stdout.write(JSON.stringify(result));
  `], { cwd: bundled, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(child), {
    decision: 'ALLOW',
    reason: 'EXECUTION_PROVENANCE_PASSED',
    repository_commit_sha: merge,
    repository_tree_sha: tree,
  });
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
    { id: 'claim-a', tenant: 'orderweeddc.com', claimType: 'license_status', claimValue: 'ACTIVE', snapshotId: 'snapshot-a', observedAt: new Date(ACQUIRED_AT), freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
    { id: 'claim-b', tenant: 'orderweeddc.com', claimType: 'regulated_address', claimValue: '100 Test St', snapshotId: 'snapshot-b', observedAt: new Date(ACQUIRED_AT), freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
    { id: 'laundered', tenant: 'orderweeddc.com', claimType: 'hours', claimValue: '24/7', verification: 'VERIFIED', decisionEligible: true, observedAt: new Date(ACQUIRED_AT), freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
  ];
  const events = [
    { id: 'event-a', claimId: 'claim-a', acquisitionEventId: 'acq-a', decision: 'ALLOW', evaluatorVersion: COURT_VERSION, asOf: AS_OF, freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
    { id: 'event-b', claimId: 'claim-b', acquisitionEventId: 'acq-b', decision: 'ALLOW', evaluatorVersion: COURT_VERSION, asOf: AS_OF, freshnessExpiresAt: new Date('2026-09-09T15:00:00.000Z') },
  ];
  const acquisitions = [
    { id: 'acq-a', tenant: 'orderweeddc.com', state: 'COMPLETED', outcome: 'SOURCE_CHANGED', completeness: 'COMPLETE', sourceKey: ABCA_LIVE_CONTRACT.sourceKey, requestDigest: ABCA_LIVE_CONTRACT_DIGEST, adapterContractDigest: ABCA_LIVE_CONTRACT_DIGEST, snapshotId: 'snapshot-a', contentArtifactId: 'content-a', fetchedAt: new Date(ACQUIRED_AT), revisionState: 'UNKNOWN', adapterVersion: 'dc-abca-live-v1', parserVersion: 'cana-dc-abca-arcgis-snapshot-v1', compilerVersion: 'cana-reality-compiler-v1', entityResolverVersion: 'dc-abca-identity-v1', authorityPolicyVersion: 'dc-abca-authority-v1', freshnessPolicyVersion: 'dc-abca-freshness-v1', verificationCourtVersion: COURT_VERSION, repositoryCommitSha: REPOSITORY_COMMIT_SHA, repositoryTreeSha: REPOSITORY_TREE_SHA },
    { id: 'acq-b', tenant: 'orderweeddc.com', state: 'COMPLETED', outcome: 'SOURCE_CHANGED', completeness: 'COMPLETE', sourceKey: ABCA_LIVE_CONTRACT.sourceKey, requestDigest: ABCA_LIVE_CONTRACT_DIGEST, adapterContractDigest: ABCA_LIVE_CONTRACT_DIGEST, snapshotId: 'snapshot-b', contentArtifactId: 'content-b', fetchedAt: new Date(ACQUIRED_AT), revisionState: 'UNKNOWN', adapterVersion: 'dc-abca-live-v1', parserVersion: 'cana-dc-abca-arcgis-snapshot-v1', compilerVersion: 'cana-reality-compiler-v1', entityResolverVersion: 'dc-abca-identity-v1', authorityPolicyVersion: 'dc-abca-authority-v1', freshnessPolicyVersion: 'dc-abca-freshness-v1', verificationCourtVersion: COURT_VERSION, repositoryCommitSha: REPOSITORY_COMMIT_SHA, repositoryTreeSha: REPOSITORY_TREE_SHA },
  ];
  const contentArtifacts = [
    { id: 'content-a', snapshotId: 'snapshot-a', sourceKey: ABCA_LIVE_CONTRACT.sourceKey, sourceUrl: ABCA_LIVE_CONTRACT.layerUrl, requestContractDigest: ABCA_LIVE_CONTRACT_DIGEST, contentSha256: 'a'.repeat(64), payloadBytes: 100, recordCount: 1, schemaVersion: 'cana-dc-abca-arcgis-snapshot-v1' },
    { id: 'content-b', snapshotId: 'snapshot-b', sourceKey: ABCA_LIVE_CONTRACT.sourceKey, sourceUrl: ABCA_LIVE_CONTRACT.layerUrl, requestContractDigest: ABCA_LIVE_CONTRACT_DIGEST, contentSha256: 'b'.repeat(64), payloadBytes: 200, recordCount: 2, schemaVersion: 'cana-dc-abca-arcgis-snapshot-v1' },
  ];
  const sourceSnapshots = [
    { id: 'snapshot-a', sourceKey: ABCA_LIVE_CONTRACT.sourceKey, sourceUrl: ABCA_LIVE_CONTRACT.layerUrl, payloadSha256: 'a'.repeat(64), payloadBytes: 100, recordCount: 1, schemaVersion: 'cana-dc-abca-arcgis-snapshot-v1', completeness: 'COMPLETE' },
    { id: 'snapshot-b', sourceKey: ABCA_LIVE_CONTRACT.sourceKey, sourceUrl: ABCA_LIVE_CONTRACT.layerUrl, payloadSha256: 'b'.repeat(64), payloadBytes: 200, recordCount: 2, schemaVersion: 'cana-dc-abca-arcgis-snapshot-v1', completeness: 'COMPLETE' },
  ];
  const current = adapter.selectCurrentClaimDecisions({
    claims,
    verificationEvents: events,
    acquisitionEvents: acquisitions,
    contentArtifacts,
    sourceSnapshots,
    revocations: [{ decision: 'EVIDENCE_REVOKED', acquisitionEventId: 'acq-a', effectiveAt: AS_OF }],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  });
  assert.deepEqual(current.map((item) => item.claim_id), ['claim-b']);

  const artifactRevoked = adapter.selectCurrentClaimDecisions({
    claims,
    verificationEvents: events,
    acquisitionEvents: acquisitions,
    contentArtifacts,
    sourceSnapshots,
    revocations: [{
      decision: 'EVIDENCE_REVOKED',
      targetKind: 'CONTENT_ARTIFACT',
      targetId: 'content-b',
      effectiveAt: AS_OF,
    }],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  });
  assert.deepEqual(artifactRevoked.map((item) => item.claim_id), ['claim-a']);

  for (const effectiveAt of [undefined, 'not-a-date']) {
    const malformedRevocation = adapter.selectCurrentClaimDecisions({
      claims,
      verificationEvents: events,
      acquisitionEvents: acquisitions,
      contentArtifacts,
      sourceSnapshots,
      revocations: [{ decision: 'EVIDENCE_RESTORED', acquisitionEventId: 'acq-a', effectiveAt }],
      asOf: new Date('2026-08-12T00:00:00.000Z'),
    });
    assert.deepEqual(
      malformedRevocation.map((item) => item.claim_id),
      ['claim-b'],
      'a malformed revocation time must fail closed instead of preserving eligible evidence',
    );
  }

  const policyRevoked = adapter.selectCurrentClaimDecisions({
    claims,
    verificationEvents: events,
    acquisitionEvents: acquisitions,
    contentArtifacts,
    sourceSnapshots,
    revocations: [{ decision: 'EVIDENCE_REVOKED', targetKind: 'POLICY_VERSION', targetId: 'dc-abca-authority-v1', effectiveAt: AS_OF }],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  });
  assert.deepEqual(policyRevoked, []);

  const courtRevoked = adapter.selectCurrentClaimDecisions({
    claims,
    verificationEvents: events,
    acquisitionEvents: acquisitions,
    contentArtifacts,
    sourceSnapshots,
    revocations: [{ decision: 'EVIDENCE_REVOKED', targetKind: 'POLICY_VERSION', targetId: COURT_VERSION, effectiveAt: AS_OF }],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  });
  assert.deepEqual(courtRevoked, []);

  const hostileAcquisitions = [
    { tenant: 'other.example' },
    { state: 'FAILED', outcome: 'SOURCE_FAILED' },
    { errorCode: 'CANA_HOSTILE_COMPLETED_ERROR' },
    { sourceKey: 'attacker-source' },
    { snapshotId: 'other-snapshot' },
    { contentArtifactId: null },
    { completeness: 'PARTIAL' },
    { verificationCourtVersion: 'forged-court' },
    { adapterVersion: null },
    { compilerVersion: null },
    { entityResolverVersion: null },
    { authorityPolicyVersion: null },
    { outcome: 'SOURCE_UNCHANGED', revisionState: 'UNKNOWN' },
    { fetchedAt: new Date('2026-08-12T01:00:00.000Z') },
  ];
  for (const hostile of hostileAcquisitions) {
    const rejected = adapter.selectCurrentClaimDecisions({
      claims: [claims[0]],
      verificationEvents: [events[0]],
      acquisitionEvents: [{ ...acquisitions[0], ...hostile }],
      contentArtifacts,
      sourceSnapshots,
      revocations: [],
      asOf: new Date('2026-08-12T00:00:00.000Z'),
    });
    assert.deepEqual(rejected, []);
  }

  assert.deepEqual(adapter.selectCurrentClaimDecisions({
    claims: [claims[0]],
    verificationEvents: [events[0]],
    acquisitionEvents: [{ ...acquisitions[0], repositoryCommitSha: '0'.repeat(40) }],
    contentArtifacts,
    sourceSnapshots,
    revocations: [],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  }), [], 'a nonexistent repository commit cannot authorize current truth');
  assert.deepEqual(adapter.selectCurrentClaimDecisions({
    claims: [claims[0]],
    verificationEvents: [events[0]],
    acquisitionEvents: [acquisitions[0]],
    contentArtifacts: [],
    sourceSnapshots,
    revocations: [],
    asOf: new Date('2026-08-12T00:00:00.000Z'),
  }), [], 'current truth requires the immutable content artifact and snapshot binding');
  for (const [artifactOverride, snapshotOverride] of [
    [{ contentSha256: 'f'.repeat(64) }, {}],
    [{ payloadBytes: 101 }, {}],
    [{ recordCount: 2 }, {}],
    [{ schemaVersion: 'forged-schema-v9' }, {}],
    [{}, { completeness: 'PARTIAL' }],
  ]) {
    assert.deepEqual(adapter.selectCurrentClaimDecisions({
      claims: [claims[0]],
      verificationEvents: [events[0]],
      acquisitionEvents: [acquisitions[0]],
      contentArtifacts: [{ ...contentArtifacts[0], ...artifactOverride }],
      sourceSnapshots: [{ ...sourceSnapshots[0], ...snapshotOverride }],
      revocations: [],
      asOf: new Date('2026-08-12T00:00:00.000Z'),
    }), [], 'current truth requires exact immutable snapshot bytes and schema binding');
  }
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
  const forged = {
    ...prohibited,
    live_admitted: true,
    authoritative_predicates: ['license_status', 'hours'],
  };
  assert.equal(router.routeRealitySource({
    predicate: 'license_status', candidates: [prohibited, forged, official], maximumCostCents: 0,
  }).selected_source, official.source_key);
  assert.equal(router.routeRealitySource({
    predicate: 'hours', candidates: [prohibited, official], maximumCostCents: 0,
  }).state, 'UNKNOWN');
  assert.equal(router.routeRealitySource({
    predicate: 'license_status',
    candidates: [{ ...official, source_id: 'forged-official-identity' }],
    maximumCostCents: 0,
  }).state, 'UNKNOWN');
});
