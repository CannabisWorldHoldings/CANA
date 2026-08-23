import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSiteIntelligenceSnapshot } from '../src/lib/site-intelligence.mjs';
import { reviewMediaUpload } from '../src/lib/merchant-media-intake.mjs';
import { ExperienceFabric } from '../../../tools/experience-fabric/kernel.mjs';

import {
  CandidateCompileError,
  compileExperienceReviewCandidate,
  evidenceRefsSha256,
  experienceReviewIdempotencyKey,
  sourceProofSha256,
} from '../src/lib/experience-review-candidate.mjs';

const SHA256_B = 'b'.repeat(64);
const COMMIT = '1'.repeat(40);
const TREE = '2'.repeat(40);

function siteMetrics() {
  return {
    brands: 1, retailersTotal: 1, retailersCurrent: 1,
    retailersDemonstration: 0, retailersStale: 0, retailersAwaiting: 0,
    retailersDisputed: 0, retailersMissingWebsite: 0, retailersMissingSource: 0,
    pendingEvidence: 0, pendingClaims: 0, pendingDisputes: 0,
    articlesTotal: 0, articlesCurrent: 0, articlesDemonstration: 0,
    articlesStale: 0, canonicalBrandExists: true, canonicalSitemapRetailers: 1,
    canonicalSitemapArticles: 0, leadsLast30Days: 0, persistedSnapshots: 0,
    marketSourceSnapshots: 1, marketClaimsTotal: 1, marketClaimsEligible: 1,
    marketClaimsUnknown: 0, marketResolutionsReviewRequired: 0,
    marketGapsOpen: 0, marketGapsClosed: 0,
  };
}

function fabricState() {
  return {
    merchant: { id: 'merchant-abca-117379', identity: 'Merchant', brand: { green: '#22582f' } },
    inventory: {},
    fulfillment: { verified_availability: {} },
    contract: { accessibility: { min_contrast: 4.5, focus_visible: true } },
    economics: { conversion: 'UNKNOWN', revenue: 'UNKNOWN' },
    design: { components: { hero: { variant: 'editorial' } } },
  };
}

function actualFabricOutput() {
  const fabric = new ExperienceFabric(fabricState());
  const sourceOutput = fabric.mutatePrivate({
    goal: 'owner_review_candidate', scope: 'hero', risk: 'R1', agent: 'candidate-compiler-test',
    write_set: ['design.components.hero.*'],
    mutation: { 'design.components.hero.variant': 'cinematic' },
  });
  return { sourceOutput, sourceReceipt: structuredClone(fabric.receipts[0]) };
}

function baseEnvelope(overrides = {}) {
  const sourceOutput = buildSiteIntelligenceSnapshot(
    siteMetrics(),
    new Date('2026-08-23T16:00:00.000Z'),
  );
  const evidenceRefs = [
    { ref: 'docs/evidence/site-intelligence/snapshot.json', sha256: sourceOutput.fingerprint },
  ];
  return {
    sourceKind: 'SITEMIND',
    sourceArtifact: 'docs/evidence/site-intelligence/snapshot.json',
    sourceArtifactSha256: sourceOutput.fingerprint,
    sourceRevision: 'site-intelligence-v2',
    sourceTreeSha: TREE,
    repositoryCommitSha: COMMIT,
    tenant: 'orderweeddc',
    siteId: 'site-dc',
    payloadSha256: sourceOutput.fingerprint,
    evidenceRefs,
    evidenceSha256: evidenceRefsSha256(evidenceRefs),
    rightsState: 'NOT_APPLICABLE',
    accessibilityState: 'NOT_TESTED',
    policyState: 'PASS',
    uncertaintyState: 'BOUNDED',
    externalEffects: 0,
    sourceOutput,
    ...overrides,
  };
}

function merchantEnvelope(overrides = {}) {
  const rightsAttestation = {
    holder: 'Private Person Must Not Persist',
    granted_at: '2026-08-23T15:00:00.000Z',
    scope: 'marketplace display',
  };
  const imageTextCourt = {
    verdict: 'CLEAN', evidence: 'digest-addressed upstream court',
    decided_at: '2026-08-23T15:30:00.000Z',
  };
  const sourceOutput = reviewMediaUpload({
    asset_id: 'asset-1', merchant_id: 'merchant-abca-117379',
    asset_class: 'PRODUCT_IMAGE', sha256: SHA256_B, width: 1200, height: 1200,
    rights_attestation: rightsAttestation, image_text_court: imageTextCourt,
  }, { now: '2026-08-23T16:00:00.000Z' });
  const sourceEvidence = { rightsAttestation, imageTextCourt };
  const evidenceRefs = [
    { ref: 'docs/evidence/media/court.json', sha256: SHA256_B },
    { ref: 'docs/evidence/media/rights-court.json', sha256: sourceProofSha256(sourceEvidence) },
  ];
  return baseEnvelope({
    sourceKind: 'MERCHANT_MEDIA',
    sourceArtifact: 'docs/evidence/media/court.json',
    sourceArtifactSha256: SHA256_B,
    sourceRevision: 'merchant-media-v1',
    merchantId: 'merchant-abca-117379',
    siteId: undefined,
    rightsState: 'VERIFIED',
    accessibilityState: 'PASS',
    payloadSha256: SHA256_B,
    evidenceRefs,
    evidenceSha256: evidenceRefsSha256(evidenceRefs),
    sourceOutput,
    sourceEvidence,
    ...overrides,
  });
}

function fabricEnvelope(overrides = {}) {
  const { sourceOutput, sourceReceipt } = actualFabricOutput();
  const evidenceRefs = [
    { ref: 'docs/evidence/experience-fabric/private-court.json', sha256: sourceReceipt.hash },
  ];
  return baseEnvelope({
    sourceKind: 'EXPERIENCE_FABRIC',
    sourceArtifact: 'docs/evidence/experience-fabric/private-court.json',
    sourceArtifactSha256: sourceReceipt.hash,
    sourceRevision: 'experience-fabric-v1',
    rightsState: 'NOT_APPLICABLE',
    accessibilityState: 'PASS',
    payloadSha256: sourceOutput.receipt_hash,
    evidenceRefs,
    evidenceSha256: evidenceRefsSha256(evidenceRefs),
    sourceOutput,
    sourceReceipt,
    ...overrides,
  });
}

function memoryModel() {
  const rows = new Map();
  const calls = [];
  return {
    calls,
    async findUnique({ where }) {
      calls.push({ operation: 'findUnique', where });
      return rows.get(where.idempotencyKey) ?? null;
    },
    async create({ data }) {
      calls.push({ operation: 'create', data });
      const row = {
        id: `candidate-${rows.size + 1}`,
        ...data,
        createdAt: new Date('2026-08-23T16:00:00.000Z'),
        updatedAt: new Date('2026-08-23T16:00:00.000Z'),
      };
      rows.set(data.idempotencyKey, row);
      return row;
    },
  };
}

function dependencies(model, known = true) {
  return {
    experienceReviewCandidate: model,
    isKnownTenant: async (tenant) => known && tenant === 'orderweeddc',
  };
}

test('one fixture from each source family compiles to pending Owner review only', async () => {
  for (const envelope of [baseEnvelope(), merchantEnvelope(), fabricEnvelope()]) {
    const model = memoryModel();
    const result = await compileExperienceReviewCandidate(dependencies(model), envelope);
    assert.equal(result.outcome, 'QUEUED_FOR_OWNER_REVIEW');
    assert.equal(result.decisionEligible, true);
    assert.equal(result.candidate.lifecycle, 'PENDING_REVIEW');
    assert.equal(model.calls.filter(({ operation }) => operation === 'create').length, 1);
  }
});

test('deterministic replay returns the existing candidate without another write', async () => {
  const model = memoryModel();
  const envelope = baseEnvelope();
  const expected = experienceReviewIdempotencyKey(envelope);
  const first = await compileExperienceReviewCandidate(dependencies(model), envelope);
  const replay = await compileExperienceReviewCandidate(dependencies(model), structuredClone(envelope));
  assert.equal(first.candidate.idempotencyKey, expected);
  assert.equal(replay.outcome, 'IDEMPOTENT_REPLAY');
  assert.equal(replay.candidate.id, first.candidate.id);
  assert.equal(model.calls.filter(({ operation }) => operation === 'create').length, 1);
});

test('same payload remains an idempotent replay after Owner review and is not decision eligible again', async () => {
  const model = memoryModel();
  const envelope = baseEnvelope();
  const first = await compileExperienceReviewCandidate(dependencies(model), envelope);
  first.candidate.lifecycle = 'APPROVED_FOR_DRAFT_ONLY';
  const replay = await compileExperienceReviewCandidate(dependencies(model), envelope);
  assert.equal(replay.outcome, 'IDEMPOTENT_REPLAY');
  assert.equal(replay.decisionEligible, false);
  assert.equal(replay.candidate.id, first.candidate.id);
  assert.equal(model.calls.filter(({ operation }) => operation === 'create').length, 1);
});

test('same stable identity with changed payload fails closed as an idempotency conflict', async () => {
  const model = memoryModel();
  const envelope = baseEnvelope();
  await compileExperienceReviewCandidate(dependencies(model), envelope);
  await assert.rejects(
    compileExperienceReviewCandidate(dependencies(model), {
      ...envelope,
      payloadSha256: '9'.repeat(64),
      sourceOutput: { ...envelope.sourceOutput, fingerprint: '9'.repeat(64) },
    }),
    (error) => error instanceof CandidateCompileError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(model.calls.filter(({ operation }) => operation === 'create').length, 1);
});

test('structural envelope validation is closed over source kind and exact custody digests', async () => {
  const invalid = [
    [baseEnvelope({ sourceKind: 'CAMPAIGN' }), 'SOURCE_KIND_INVALID'],
    [baseEnvelope({ sourceArtifact: '../private.txt' }), 'SOURCE_ARTIFACT_INVALID'],
    [baseEnvelope({ sourceArtifactSha256: 'short' }), 'SHA256_INVALID'],
    [baseEnvelope({ sourceRevision: ' ' }), 'SOURCE_REVISION_INVALID'],
    [baseEnvelope({ sourceRevision: `revision-${'x'.repeat(201)}` }), 'SOURCE_REVISION_INVALID'],
    [baseEnvelope({ sourceTreeSha: '3'.repeat(39) }), 'COMMIT_SHA_INVALID'],
    [baseEnvelope({ repositoryCommitSha: 'g'.repeat(40) }), 'COMMIT_SHA_INVALID'],
    [baseEnvelope({ tenant: '' }), 'TENANT_REQUIRED'],
    [baseEnvelope({ evidenceRefs: [] }), 'EVIDENCE_REFS_INVALID'],
    [baseEnvelope({ externalEffects: false }), 'EXTERNAL_EFFECTS_FORBIDDEN'],
    [baseEnvelope({ sourceOutput: [] }), 'SOURCE_OUTPUT_INVALID'],
  ];
  for (const [envelope, code] of invalid) {
    await assert.rejects(
      compileExperienceReviewCandidate(dependencies(memoryModel()), envelope),
      (error) => error instanceof CandidateCompileError && error.code === code,
      code,
    );
  }
  await assert.rejects(
    compileExperienceReviewCandidate(dependencies(memoryModel()), baseEnvelope({
      sourceOutput: { oversized: 'x'.repeat(256 * 1024) },
    })),
    (error) => error instanceof CandidateCompileError && error.code === 'SOURCE_OUTPUT_TOO_LARGE',
  );
});

test('unknown tenant is refused before persistence', async () => {
  const model = memoryModel();
  const result = await compileExperienceReviewCandidate(dependencies(model, false), baseEnvelope());
  assert.deepEqual(result, {
    outcome: 'REFUSED',
    decisionEligible: false,
    reasonCodes: ['UNKNOWN_TENANT'],
  });
  assert.equal(model.calls.length, 0);
});

test('missing rights and non-approved media court return for evidence without persistence', async () => {
  const pending = merchantEnvelope();
  pending.sourceOutput = reviewMediaUpload({
    asset_id: 'asset-pending', merchant_id: pending.merchantId,
    asset_class: 'PRODUCT_IMAGE', sha256: pending.payloadSha256,
    width: 1200, height: 1200,
    rights_attestation: pending.sourceEvidence.rightsAttestation,
  }, { now: '2026-08-23T16:00:00.000Z' });
  const rejected = merchantEnvelope();
  rejected.sourceOutput = reviewMediaUpload({
    asset_id: 'asset-rejected', merchant_id: rejected.merchantId,
    asset_class: 'PRODUCT_IMAGE', sha256: rejected.payloadSha256,
    width: 1200, height: 1200,
    image_text_court: rejected.sourceEvidence.imageTextCourt,
  }, { now: '2026-08-23T16:00:00.000Z' });
  for (const [envelope, reasonCode] of [
    [merchantEnvelope({ rightsState: 'MISSING' }), 'RIGHTS_EVIDENCE_REQUIRED'],
    [pending, 'MEDIA_COURT_NOT_APPROVED'],
    [rejected, 'MEDIA_COURT_NOT_APPROVED'],
  ]) {
    const model = memoryModel();
    const result = await compileExperienceReviewCandidate(dependencies(model), envelope);
    assert.equal(result.outcome, 'RETURNED_FOR_EVIDENCE');
    assert.equal(result.decisionEligible, false);
    assert.ok(result.reasonCodes.includes(reasonCode));
    assert.equal(model.calls.some(({ operation }) => operation === 'create'), false);
  }
});

test('oracle failure, protected mutation, claimed economics, and promotion all fail closed', async () => {
  const oracleFailure = fabricEnvelope();
  oracleFailure.sourceOutput.court.verdict = 'FAIL';
  const policyFailure = fabricEnvelope();
  policyFailure.sourceOutput.court.results.find(({ oracle }) => oracle === 'POLICY').status = 'FAIL';
  const protectedMutation = fabricEnvelope();
  protectedMutation.sourceReceipt.changed_paths = ['merchant.identity'];
  const claimedEconomics = fabricEnvelope();
  claimedEconomics.sourceOutput.court.results.find(({ oracle }) => oracle === 'ECONOMIC-TRUTH').detail = 'claimed revenue up';
  const priorPromotion = fabricEnvelope();
  priorPromotion.sourceReceipt.promoted = true;
  const unsafeEnvelopes = [
    [oracleFailure, 'FABRIC_ORACLE_FAILURE'],
    [policyFailure, 'FABRIC_ORACLE_FAILURE'],
    [protectedMutation, 'PROTECTED_PATH_MUTATION'],
    [claimedEconomics, 'ECONOMIC_OUTCOME_UNVERIFIED'],
    [priorPromotion, 'FABRIC_PROMOTION_FORBIDDEN'],
  ];
  for (const [envelope, reasonCode] of unsafeEnvelopes) {
    const model = memoryModel();
    const result = await compileExperienceReviewCandidate(dependencies(model), envelope);
    assert.equal(result.outcome, 'RETURNED_FOR_EVIDENCE');
    assert.equal(result.decisionEligible, false);
    assert.ok(result.reasonCodes.includes(reasonCode));
    assert.equal(model.calls.some(({ operation }) => operation === 'create'), false);
  }
});

test('actual Site Intelligence output is refused when its Action plane is no longer guarded', async () => {
  const envelope = baseEnvelope();
  envelope.sourceOutput = structuredClone(envelope.sourceOutput);
  envelope.sourceOutput.planes.find(({ name }) => name === 'Action').status = 'READY';
  const model = memoryModel();
  const result = await compileExperienceReviewCandidate(dependencies(model), envelope);
  assert.equal(result.outcome, 'RETURNED_FOR_EVIDENCE');
  assert.deepEqual(result.reasonCodes, ['SITEMIND_SNAPSHOT_UNVERIFIED']);
  assert.equal(model.calls.some(({ operation }) => operation === 'create'), false);
});

test('raw source payload, OCR, PII, and secret material never reach Prisma', async () => {
  const model = memoryModel();
  await compileExperienceReviewCandidate(dependencies(model), merchantEnvelope({
    sourceOutput: {
      ...merchantEnvelope().sourceOutput,
      rawPayload: 'customer@example.com',
      secret: 'sk-never-persist',
    },
  }));
  const written = model.calls.find(({ operation }) => operation === 'create').data;
  const serialized = JSON.stringify(written);
  assert.doesNotMatch(serialized, /Private Person|OCR|customer@example\.com|sk-never-persist|rawPayload|sourceOutput/);
  assert.deepEqual(Object.keys(written).sort(), [
    'accessibilityState', 'evidenceRefs', 'idempotencyKey', 'lifecycle',
    'merchantId', 'payloadSha256', 'policyState', 'repositoryCommitSha',
    'rightsState', 'siteId', 'sourceArtifact', 'sourceArtifactSha256',
    'sourceKind', 'sourceRevision', 'sourceTreeSha', 'tenant',
    'uncertaintyState', 'version',
  ].sort());
  assert.equal(model.calls.some(({ operation }) => /approve|promote|receipt/i.test(operation)), false);
});
