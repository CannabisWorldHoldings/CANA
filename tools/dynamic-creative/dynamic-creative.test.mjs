import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as ProviderContract from '../../packages/ad-creative/src/provider-contract.mjs';
import * as Hermes from '../../skills-src/hermes-governed-packet.mjs';
import * as SiteMind from '../../apps/web/src/lib/sitemind.mjs';
import { validateCreativeEvidenceImportManifest } from '../../packages/ad-creative/src/evidence-import.mjs';

const { createProvider, createProviderRegistry, routeImageProvider } = ProviderContract;
const { CAPABILITIES, makeGrant, sealPacket } = Hermes;
const { compileCreativeCampaignContext, ingestCreativeCompetitorEvidence } = SiteMind;

async function loadFoundation() {
  try {
    return await import('../../packages/ad-creative/src/dynamic-foundation.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

const sha = (letter) => letter.repeat(64);
const NOW = new Date('2026-08-04T04:00:00.000Z');

function fixtureProvider({
  name = 'deterministic-fixture',
  model = 'svg-fixture-v1',
  quality = 0.8,
  cost = 0,
  latency = 10,
  policyEligible = true,
  historicalPerformance = 0.7,
} = {}) {
  return createProvider({
    name,
    model,
    capabilities: ['text-to-image', 'responsive-variants', 'zero-network'],
    routing: {
      quality,
      costUsd: cost,
      latencyMs: latency,
      policyEligible,
      historicalPerformance,
      externalCalls: 0,
    },
    async generateImage() {
      return {
        imageBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
        mimeType: 'image/svg+xml',
        receipt: { provider: name, model, externalCalls: 0, actualCostUsd: 0 },
      };
    },
    async analyzeImage() {
      return {
        containsMinorsAppeal: false,
        containsHealthClaims: false,
        containsRenderedText: false,
        matchesBrand: true,
        summary: 'deterministic fixture',
        receipt: { provider: name, model, externalCalls: 0, actualCostUsd: 0 },
      };
    },
  });
}

function validContextInput(overrides = {}) {
  return {
    advertiser: {
      id: 'synthetic-anacostia-apothecary',
      name: 'Anacostia Apothecary — Synthetic Fixture',
      synthetic: true,
    },
    entitlement: { tier: 'NEIGHBORHOOD', status: 'FIXTURE_AUTHORIZED' },
    authorizedAssets: [{ id: 'fixture-logo', sha256: sha('a'), rights: 'SYNTHETIC_FIXTURE' }],
    objective: 'Invite adults 21+ to compare a clearly synthetic fixture offer.',
    offer: { text: 'Build a verified shortlist', permittedClaims: ['synthetic fixture only'] },
    audience: { age: '21+', location: 'Washington, D.C.' },
    placement: { id: 'HOMEPAGE_SPONSORED_BILLBOARD', desktop: [1440, 360], mobile: [390, 440] },
    brandRules: ['Sponsored disclosure is always visible', 'No pay-to-rank'],
    ownerMemory: {
      approved: ['owd-source-before-hype', 'owd-block-by-block'],
      rejected: ['owd-tonights-shortlist'],
      reasons: ['GENERIC', 'FAKE_LOOKING'],
    },
    firstPartyResults: [],
    competitorEvidence: [],
    constraints: {
      legal: ['21+ only', 'no health claims'],
      platformPolicy: ['no generated text in image'],
      trust: ['synthetic advertiser must remain labeled'],
    },
    performanceBudget: { maxAssetBytes: 180000, maxTotalBytes: 360000 },
    prohibitedElements: ['minors', 'medical claims', 'undisclosed sponsorship', 'organic rank influence'],
    asOf: NOW.toISOString(),
    ...overrides,
  };
}

test('clean ancestry proves the requested canonical root', async () => {
  const { auditPr21Survival } = await loadFoundation();
  assert.equal(typeof auditPr21Survival, 'function', 'clean integration ancestry audit is missing');
  const audit = auditPr21Survival({
    canonicalBase: '79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc',
    mergeBase: '79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc',
    changedPaths: [
      'packages/ad-creative/src/dynamic-foundation.mjs',
      'apps/web/src/components/dynamic-sponsored-placement.tsx',
    ],
  });
  assert.equal(audit.status, 'CLEAN_INTEGRATION_ROOT_VERIFIED');
  assert.equal(audit.rejected_pr21_paths_survived, false);
});

test('rejects PR21 survival outside the approved transfer allowlist', async () => {
  const { auditPr21Survival } = await loadFoundation();
  assert.throws(
    () => auditPr21Survival({
      canonicalBase: '79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc',
      mergeBase: '79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc',
      changedPaths: ['apps/web/src/components/customer-home-hero.tsx'],
    }),
    /PR21 implementation path survived/i,
  );
});

test('preserves owner decisions as seeds rather than permanent billboard architecture', async () => {
  const { OWNER_CAMPAIGN_SEEDS, OWNER_REJECTION_MEMORY } = await loadFoundation();
  assert.ok(OWNER_CAMPAIGN_SEEDS, 'owner seed fixture is missing');
  assert.equal(OWNER_CAMPAIGN_SEEDS.find((seed) => seed.id === 'owd-source-before-hype')?.decision, 'APPROVED_PRIMARY');
  assert.equal(OWNER_CAMPAIGN_SEEDS.find((seed) => seed.id === 'owd-block-by-block')?.decision, 'APPROVED_SECONDARY');
  assert.equal(OWNER_CAMPAIGN_SEEDS.find((seed) => seed.id === 'owd-tonights-shortlist')?.decision, 'REJECTED_PRIMARY_DIRECTION');
  assert.ok(OWNER_CAMPAIGN_SEEDS.every((seed) => seed.roles.includes('VISUAL_EVALUATION_FIXTURE')));
  assert.equal(OWNER_CAMPAIGN_SEEDS.find((seed) => seed.id === 'owd-tonights-shortlist')?.fallbackEligible, false);
  assert.equal(OWNER_REJECTION_MEMORY.candidate.commit, '5c7fe2707dcb2836ed62e1c3d9a01bb62cd50723');
  assert.deepEqual(OWNER_REJECTION_MEMORY.tags, [
    'GENERIC', 'FAKE_LOOKING', 'LOW_CAMPAIGN_COHERENCE', 'WEAK_IMAGE_COPY_FIT',
    'PROTOTYPE_LANGUAGE', 'WEAK_LOCAL_IDENTITY', 'LOW_MARKETPLACE_ENERGY',
    'INSUFFICIENT_CREATIVE_INTELLIGENCE',
  ]);
  assert.equal(OWNER_REJECTION_MEMORY.merge_authorized, false);
});

test('rejects unsafe offline evidence members before any byte is promoted', () => {
  const admitted = validateCreativeEvidenceImportManifest({
    entries: [
      { path: 'desktop-banner.png', type: 'FILE', size: 341598 },
      { path: 'nested', type: 'DIRECTORY', size: 0 },
      { path: 'nested/receipt.json', type: 'FILE', size: 1200 },
    ],
  });
  assert.equal(admitted.status, 'ADMITTED_UNTRUSTED_EVIDENCE_MANIFEST');
  assert.equal(admitted.imported_instruction_authority, 'NONE');
  assert.equal(admitted.imported_files_executed, false);
  for (const bad of [
    { path: '../escape.png', type: 'FILE', size: 1 },
    { path: '__MACOSX/payload', type: 'FILE', size: 1 },
    { path: '._desktop-banner.png', type: 'FILE', size: 1 },
    { path: 'link', type: 'SYMLINK', size: 0 },
    { path: 'huge.png', type: 'FILE', size: 5_000_001 },
  ]) {
    assert.throws(() => validateCreativeEvidenceImportManifest({ entries: [bad] }), /refused/i);
  }
});

test('compiles governed context through SiteMind with every required campaign field', () => {
  assert.equal(typeof compileCreativeCampaignContext, 'function', 'SiteMind creative context compiler is missing');
  const compiled = compileCreativeCampaignContext(validContextInput());
  assert.equal(compiled.valid, true);
  assert.equal(compiled.packet.authority_boundary, 'SITEMIND_CONTEXT_ONLY_NO_EXECUTION_AUTHORITY');
  assert.equal(compiled.packet.owner_memory.rejected[0], 'owd-tonights-shortlist');
  assert.match(compiled.packet.packet_digest, /^[0-9a-f]{64}$/);
  const required = [
    'advertiser', 'entitlement', 'authorized_assets', 'objective', 'offer', 'audience',
    'placement', 'brand_rules', 'owner_memory', 'first_party_results', 'competitor_evidence',
    'constraints', 'performance_budget', 'prohibited_elements',
  ];
  assert.deepEqual(required.filter((field) => compiled.packet[field] == null), []);
});

test('routes providers by quality cost latency policy and historical performance', () => {
  assert.equal(typeof createProviderRegistry, 'function', 'provider registry is missing');
  assert.equal(typeof routeImageProvider, 'function', 'provider router is missing');
  const registry = createProviderRegistry([
    fixtureProvider({ name: 'eligible-balanced', quality: 0.9, cost: 0.02, latency: 800, historicalPerformance: 0.85 }),
    fixtureProvider({ name: 'ineligible-best', quality: 1, cost: 0, latency: 1, policyEligible: false, historicalPerformance: 1 }),
    fixtureProvider({ name: 'eligible-cheap', quality: 0.7, cost: 0, latency: 20, historicalPerformance: 0.7 }),
  ]);
  const route = routeImageProvider(registry, {
    requiredCapabilities: ['text-to-image', 'responsive-variants'],
    maxCostUsd: 0.05,
    maxLatencyMs: 1000,
    weights: { quality: 0.45, cost: 0.15, latency: 0.1, historicalPerformance: 0.3 },
  });
  assert.equal(route.provider.name, 'eligible-balanced');
  assert.equal(route.receipt.candidates.find((candidate) => candidate.name === 'ineligible-best').eligible, false);
  assert.deepEqual(route.receipt.routing_dimensions, ['quality', 'cost', 'latency', 'policy_eligibility', 'historical_performance']);
});

test('enforces entitlements without coupling sponsorship to truth fields', async () => {
  const { createCreativeEntitlement, SPONSORSHIP_TIERS } = await loadFoundation();
  assert.equal(typeof createCreativeEntitlement, 'function', 'creative entitlement model is missing');
  const entitlement = createCreativeEntitlement({
    id: 'ent_fixture_neighborhood', tier: 'NEIGHBORHOOD', advertiserId: 'synthetic-advertiser',
    startsAt: NOW.toISOString(), endsAt: '2026-08-11T04:00:00.000Z',
  });
  assert.ok(SPONSORSHIP_TIERS.NEIGHBORHOOD.eligiblePlacements.includes('HOMEPAGE_SPONSORED_BILLBOARD'));
  assert.ok(entitlement.impressionShareCeiling > 0 && entitlement.impressionShareCeiling <= 1);
  assert.ok(entitlement.creativeRefreshCadenceHours > 0);
  assert.ok(entitlement.activeVariantLimit > 0);
  assert.equal(entitlement.affectsVerification, false);
  assert.equal(entitlement.affectsLicensing, false);
  assert.equal(entitlement.affectsAvailability, false);
  assert.equal(entitlement.affectsSourceConfidence, false);
});

test('enforces lifecycle and refuses ACTIVE until every gate passes', async () => {
  const { CAMPAIGN_STATES, transitionCampaign } = await loadFoundation();
  const requiredStates = [
    'DRAFT', 'GENERATED', 'VISUAL_REVIEW_FAILED', 'POLICY_REVIEW_FAILED',
    'OWNER_REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED',
    'EXPIRED', 'REJECTED', 'ARCHIVED',
  ];
  assert.deepEqual(requiredStates.filter((state) => !CAMPAIGN_STATES.includes(state)), []);
  assert.throws(
    () => transitionCampaign({
      current: 'SCHEDULED', target: 'ACTIVE',
      gates: { visual: 'PASS', policy: 'PASS', owner: 'PENDING', entitlement: 'PASS', schedule: 'PASS' },
    }),
    /owner gate/i,
  );
  assert.equal(transitionCampaign({
    current: 'SCHEDULED', target: 'ACTIVE',
    gates: { visual: 'PASS', policy: 'PASS', owner: 'APPROVED', entitlement: 'PASS', schedule: 'PASS' },
  }).state, 'ACTIVE');
});

test('supports future tuning interfaces without claiming a tuned model exists', async () => {
  const { evaluateTuningReadiness } = await loadFoundation();
  const blocked = evaluateTuningReadiness({
    rightsClearedApprovedCount: 2, preferencePairCount: 1, stableReasonLabels: false,
    firstPartyPerformanceCount: 0, duplicateCheck: 'NOT_RUN', contaminationCheck: 'NOT_RUN',
    splits: null, antiRegressionBenchmark: null, rollbackPlan: null, beatsRetrievalPromptingRouting: false,
  });
  assert.equal(blocked.fineTunedModelExists, false);
  assert.equal(blocked.status, 'BLOCKED_INSUFFICIENT_EVIDENCE');
  assert.ok(blocked.missing.length >= 7);
});

test('ingests evidence with explicit confidence and no unsupported performance claim', () => {
  assert.equal(typeof ingestCreativeCompetitorEvidence, 'function', 'SiteMind competitor evidence intake is missing');
  const observed = ingestCreativeCompetitorEvidence({
    id: 'crawl-fixture-1', source: 'https://example.test/competitor', capturedAt: NOW.toISOString(),
    beforeScreenshot: { sha256: sha('b'), ref: 'sha256:' + sha('b') },
    afterScreenshot: { sha256: sha('c'), ref: 'sha256:' + sha('c') },
    beforeContentSha256: sha('d'), afterContentSha256: sha('e'),
    observation: 'The public page added a disclosed comparison rail.',
    inference: 'This may reduce choice overload.',
    confidence: 'DIRECTLY_OBSERVED', rights: 'REFERENCE_ONLY',
  });
  assert.equal(observed.performance_claim, 'UNKNOWN_NOT_OBSERVED');
  assert.equal(observed.mechanism.protected_expression_copied, false);
  assert.match(observed.evidence_digest, /^[0-9a-f]{64}$/);
  assert.throws(() => ingestCreativeCompetitorEvidence({ ...observed, confidence: 'PROVEN_CONVERSION' }), /confidence/i);
});

test('runs visual court with every required judge and bounded regeneration', async () => {
  const { VISUAL_COURT_JUDGES, runVisualCourt, regenerateUntilQuality } = await loadFoundation();
  const requiredJudges = [
    'genericness', 'synthetic-composition', 'anatomy-object-consistency', 'package-logo-correctness',
    'unauthorized-hallucinated-text', 'image-copy-alignment', 'local-dc-relevance',
    'premium-editorial-quality', 'mobile-crop-integrity', 'readability', 'accessibility',
    'ad-disclosure', 'policy-compliance', 'truthful-claims', 'visual-hierarchy', 'cta-clarity',
    'brand-consistency', 'file-size-performance',
  ];
  assert.deepEqual(requiredJudges.filter((judge) => !VISUAL_COURT_JUDGES.includes(judge)), []);
  assert.ok(VISUAL_COURT_JUDGES.includes('rights-provenance'));
  assert.ok(VISUAL_COURT_JUDGES.includes('owner-taste-alignment'));
  assert.ok(VISUAL_COURT_JUDGES.includes('campaign-coherence'));
  const failed = runVisualCourt({
    creative: { id: 'generic', headline: 'Shop now', disclosure: 'Sponsored' },
    inspection: { genericness: 0.9, syntheticComposition: true, fileBytes: 999999 },
    context: validContextInput(), threshold: 0.85,
  });
  assert.equal(failed.status, 'FAIL');
  let attempts = 0;
  const regenerated = await regenerateUntilQuality({
    maxAttempts: 2,
    generate: async () => ({ id: `attempt-${++attempts}`, headline: 'Compare with receipts', disclosure: 'Sponsored' }),
    judge: (creative) => ({ status: creative.id === 'attempt-2' ? 'PASS' : 'FAIL', score: creative.id === 'attempt-2' ? 0.9 : 0.4, failureReasons: ['genericness'] }),
  });
  assert.equal(regenerated.status, 'QUALITY_THRESHOLD_REACHED');
  assert.equal(regenerated.attempts.length, 2);
  assert.equal(regenerated.rejection_and_regeneration_receipt.rejected_attempt, 'attempt-1');
});

test('fails closed rotation and rolls back to approved disclosed house creative', async () => {
  const { resolveCampaignRotation, OWNER_CAMPAIGN_SEEDS } = await loadFoundation();
  const fallback = OWNER_CAMPAIGN_SEEDS.find((seed) => seed.id === 'owd-source-before-hype');
  const result = resolveCampaignRotation({
    campaigns: [{ id: 'synthetic-campaign', state: 'ACTIVE', disclosure: '', weight: 1 }],
    placement: 'HOMEPAGE_SPONSORED_BILLBOARD', geography: 'DC', now: NOW,
    frequencyByCampaign: new Map(), fallback,
  });
  assert.equal(result.status, 'FALLBACK_SELECTED');
  assert.equal(result.campaign.id, 'owd-source-before-hype');
  assert.equal(result.campaign.disclosure, 'ORDERWEEDDC house campaign');
  assert.equal(result.affectsOrganicOrder, false);
  assert.equal(result.rollback_available, true);
});

test('records first party events and rejects competitor evidence as attributed performance', async () => {
  const { PERFORMANCE_EVENT_TYPES, createPerformanceEvent } = await loadFoundation();
  const required = ['IMPRESSION', 'QUALIFIED_CLICK', 'SAVE', 'SEARCH', 'DOWNSTREAM_ACTION', 'MERCHANT_INQUIRY', 'CONVERSION', 'OWNER_DECISION', 'USER_COMPLAINT', 'POLICY_FAILURE', 'PERFORMANCE_REGRESSION'];
  assert.deepEqual(required.filter((type) => !PERFORMANCE_EVENT_TYPES.includes(type)), []);
  const event = createPerformanceEvent({
    eventId: 'evt_fixture_1', type: 'QUALIFIED_CLICK', campaignId: 'campaign-1',
    placementId: 'HOMEPAGE_SPONSORED_BILLBOARD', audience: 'DC_21_PLUS', provider: 'deterministic-fixture',
    model: 'svg-fixture-v1', promptStrategy: 'receipt-first', mechanism: 'source-before-hype',
    occurredAt: NOW.toISOString(), source: 'ORDERWEEDDC_FIRST_PARTY', attribution: 'OBSERVED_NOT_CAUSAL',
  });
  assert.equal(event.optimization_authority, 'FIRST_PARTY_ORDERWEEDDC');
  assert.throws(
    () => createPerformanceEvent({ ...event, eventId: 'evt_bad', source: 'COMPETITOR_EVIDENCE', attribution: 'ATTRIBUTED_CONVERSION' }),
    /competitor evidence/i,
  );
  assert.throws(
    () => createPerformanceEvent({
      eventId: 'evt_unattributed_conversion', type: 'CONVERSION', campaignId: 'campaign-1',
      placementId: 'HOMEPAGE_SPONSORED_BILLBOARD', occurredAt: NOW.toISOString(),
      source: 'ORDERWEEDDC_FIRST_PARTY', attribution: 'OBSERVED_NOT_CAUSAL',
    }),
    /directly attributed/i,
  );
});

test('controlled vertical slice remains LEVEL 1 and zero spend', async () => {
  const { runControlledVerticalSlice } = await loadFoundation();
  assert.equal(typeof runControlledVerticalSlice, 'function', 'controlled vertical slice is missing');
  const registry = createProviderRegistry([fixtureProvider()]);
  const context = compileCreativeCampaignContext(validContextInput());
  const grant = makeGrant({
    capability: 'GENERATE_CREATIVE_DRAFT', budgetUnits: 6,
    expiresAt: '2026-08-05T04:00:00.000Z', issuedBy: 'CANA', now: NOW,
  });
  assert.ok(CAPABILITIES.includes('GENERATE_CREATIVE_DRAFT'));
  const packet = sealPacket({
    contextPacket: context.packet, grant,
    intent: {
      description: 'Generate deterministic owner-review creative fixtures',
      capability: 'GENERATE_CREATIVE_DRAFT', successTest: 'three variants pass bounded visual review',
      rollback: 'return Source Before Hype approved house fallback', subjects: ['subject:creative'],
    }, now: NOW,
  });
  assert.equal(packet.valid, true);
  const result = await runControlledVerticalSlice({ contextPacket: context.packet, hermesPacket: packet.packet, registry, now: NOW });
  assert.equal(result.synthetic_advertiser, true);
  assert.equal(result.authorized_brief, true);
  assert.equal(result.variants.length, 3);
  assert.ok(result.variants.every((variant) => variant.desktop && variant.mobile));
  assert.equal(result.provider_calls, 0);
  assert.equal(result.external_provider_calls, 0);
  assert.equal(result.actual_spend_usd, 0);
  assert.equal(result.autonomy_level, 'LEVEL_1_SHADOW_GENERATION_AND_SCORING');
  assert.equal(result.owner_review_state, 'OWNER_REVIEW_REQUIRED');
  assert.equal(result.rotation.status, 'FALLBACK_SELECTED');
  assert.equal(result.rotation.campaign.id, 'owd-source-before-hype');
  assert.equal(result.production_publication_authority, 'NONE');
});
