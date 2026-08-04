#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCreativeCampaignContext, ingestCreativeCompetitorEvidence } from '../../apps/web/src/lib/sitemind.mjs';
import {
  CANONICAL_BASE_COMMIT,
  CAMPAIGN_STATES,
  OWNER_CAMPAIGN_SEEDS,
  OWNER_REJECTION_MEMORY,
  PERFORMANCE_EVENT_TYPES,
  SPONSORSHIP_TIERS,
  VISUAL_COURT_JUDGES,
  auditPr21Survival,
  createPerformanceEvent,
  evaluateTuningReadiness,
  runControlledVerticalSlice,
  transitionCampaign,
} from '../../packages/ad-creative/src/dynamic-foundation.mjs';
import { validateCreativeEvidenceImportManifest } from '../../packages/ad-creative/src/evidence-import.mjs';
import { createProviderRegistry } from '../../packages/ad-creative/src/provider-contract.mjs';
import { createDeterministicFixtureProvider } from '../../packages/ad-creative/src/providers/deterministic-fixture.mjs';
import { makeGrant, sealPacket } from '../../skills-src/hermes-governed-packet.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = new Date('2026-08-04T04:00:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function writeJson(outputRoot, name, value) {
  const outputPath = join(outputRoot, name);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json(value), 'utf8');
}

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function sourceChangedPaths() {
  return git('status', '--porcelain=v1', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((candidate) => !candidate.startsWith('evidence/dynamic-creative/'))
    .sort();
}

function competitorEvidence() {
  return [
    ingestCreativeCompetitorEvidence({
      id: 'scheduled-watch-synthetic-fixture',
      source: 'https://example.test/scheduled-watch-fixture',
      capturedAt: NOW.toISOString(),
      beforeScreenshot: { sha256: sha256('scheduled-before-screenshot'), ref: `sha256:${sha256('scheduled-before-screenshot')}` },
      afterScreenshot: { sha256: sha256('scheduled-after-screenshot'), ref: `sha256:${sha256('scheduled-after-screenshot')}` },
      beforeContentSha256: sha256('scheduled-before-content'),
      afterContentSha256: sha256('scheduled-after-content'),
      observation: 'A synthetic watch fixture added a visibly disclosed comparison rail.',
      inference: 'A disclosed comparison mechanism may reduce choice overload; performance is unknown.',
      confidence: 'DIRECTLY_OBSERVED',
      rights: 'SYNTHETIC_REFERENCE_ONLY',
      collectionMethod: 'SCHEDULED_WATCH',
      eventId: 'evt_scheduled_watch_synthetic_fixture', entityId: 'entity_synthetic_competitor',
      competitorId: 'competitor_synthetic_fixture', surfaceId: 'homepage_comparison_rail',
      scheduledWatchSignalId: 'growth_watch_synthetic_001', crawlId: 'crawl_targeted_synthetic_001',
      baselineId: 'baseline_synthetic_001', uncertainty: 'PERFORMANCE_UNKNOWN',
      importanceScore: 0.4, changeType: 'DISCLOSURE_MECHANISM_ADDED', routingDecision: 'MECHANISM_REVIEW_ONLY',
      policyContext: 'SYNTHETIC_TEST_FIXTURE_NO_LIVE_MARKET_CLAIM',
    }),
    ingestCreativeCompetitorEvidence({
      id: 'deep-crawler-synthetic-fixture',
      source: 'https://example.test/deep-crawler-fixture',
      capturedAt: NOW.toISOString(),
      beforeScreenshot: { sha256: sha256('crawler-before-screenshot'), ref: `sha256:${sha256('crawler-before-screenshot')}` },
      afterScreenshot: { sha256: sha256('crawler-after-screenshot'), ref: `sha256:${sha256('crawler-after-screenshot')}` },
      beforeContentSha256: sha256('crawler-before-content'),
      afterContentSha256: sha256('crawler-after-content'),
      observation: 'A synthetic deep-crawl fixture exposed source freshness beside its action control.',
      inference: 'Source proximity is a trust mechanism hypothesis, not conversion evidence.',
      confidence: 'STRONGLY_INFERRED',
      rights: 'SYNTHETIC_REFERENCE_ONLY',
      collectionMethod: 'DEEP_CRAWLER',
      eventId: 'evt_deep_crawler_synthetic_fixture', entityId: 'entity_synthetic_competitor',
      competitorId: 'competitor_synthetic_fixture', surfaceId: 'source_freshness_handoff',
      crawlId: 'crawl_deep_synthetic_002', baselineId: 'baseline_synthetic_002',
      uncertainty: 'STRONGLY_INFERRED_MECHANISM_PERFORMANCE_UNKNOWN', importanceScore: 0.5,
      changeType: 'SOURCE_PROXIMITY_MECHANISM_OBSERVED', routingDecision: 'MECHANISM_REVIEW_ONLY',
      policyContext: 'SYNTHETIC_TEST_FIXTURE_NO_LIVE_MARKET_CLAIM',
    }),
  ];
}

async function enumerateEvidence(root, relativeRoot = '') {
  const names = (await readdir(join(root, relativeRoot))).sort();
  const entries = [];
  for (const name of names) {
    const relativePath = relativeRoot ? `${relativeRoot}/${name}` : name;
    const stats = await lstat(join(root, relativePath));
    let type = 'OTHER';
    if (stats.isSymbolicLink()) type = 'SYMLINK';
    else if (stats.isDirectory()) type = 'DIRECTORY';
    else if (stats.isFile() && stats.nlink > 1) type = 'HARDLINK';
    else if (stats.isFile()) type = 'FILE';
    entries.push({ path: relativePath, type, size: stats.isFile() ? stats.size : 0 });
    if (type === 'DIRECTORY') entries.push(...await enumerateEvidence(root, relativePath));
  }
  return entries;
}

async function ingestRejectedPr21Evidence({ packetRoot, outputRoot }) {
  const entries = await enumerateEvidence(packetRoot);
  const manifest = validateCreativeEvidenceImportManifest({ entries });
  const expected = Object.freeze({
    'desktop-banner.png': 'e4ae17edd0cb2c4b6f2d68e3a719132c2bf59c238417ed8283d5688d1d795332',
    'mobile-banner.png': '1b124691d8da52f05d3aada2ad009bb78d84439eeed9818fc7b68c2331c13f3d',
  });
  const checksums = await readFile(join(packetRoot, 'SHA256SUMS.txt'), 'utf8');
  const retainedRoot = join(outputRoot, 'rejected-pr21');
  await mkdir(retainedRoot, { recursive: true });
  const assets = [];
  for (const [assetName, expectedSha256] of Object.entries(expected)) {
    const bytes = await readFile(join(packetRoot, assetName));
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`${assetName} is not a PNG`);
    }
    const observedSha256 = sha256(bytes);
    if (observedSha256 !== expectedSha256) throw new Error(`${assetName} SHA-256 mismatch`);
    if (!checksums.split('\n').some((line) => line === `${expectedSha256}  ${assetName}`)) {
      throw new Error(`${assetName} is not bound by the source checksum manifest`);
    }
    const retainedPath = join(retainedRoot, assetName);
    if (resolve(packetRoot) !== resolve(retainedRoot)) await writeFile(retainedPath, bytes);
    assets.push({
      name: assetName,
      retained_path: relative(REPO_ROOT, retainedPath),
      sha256: observedSha256,
      bytes: bytes.length,
      rights_state: 'OWNER_PACKET_REJECTED_EVIDENCE_ONLY',
      decision: 'REJECTED_REQUEST_CHANGES',
    });
  }
  if (resolve(packetRoot) !== resolve(retainedRoot)) {
    await writeFile(join(retainedRoot, 'SHA256SUMS.txt'), Object.entries(expected).map(([name, hash]) => `${hash}  ${name}`).join('\n') + '\n', 'utf8');
  }
  return {
    schema_version: 'cana.pr21-rejected-billboard-ingestion/1.0.0',
    source_packet_name: basename(packetRoot),
    source_packet_manifest_sha256: 'fe83b9e6c37112d986e97880e22a5b28aab14f1c7520e70bdabb3df9ccf26381',
    import_manifest: manifest,
    assets,
    owner_decision: OWNER_REJECTION_MEMORY,
    protected_expression_reuse_authorized: false,
    mechanism_extraction_only: true,
    imported_files_executed: false,
    prompt_injection_state: 'QUARANTINED_NO_INSTRUCTION_AUTHORITY',
  };
}

function contextInput(evidence) {
  return {
    advertiser: { id: 'synthetic-anacostia-apothecary', name: 'Anacostia Apothecary - Synthetic Fixture', synthetic: true },
    entitlement: { tier: 'NEIGHBORHOOD', status: 'SYNTHETIC_FIXTURE_AUTHORIZED' },
    authorizedAssets: [{ id: 'fixture-logo', sha256: sha256('synthetic-fixture-logo'), rights: 'SYNTHETIC_FIXTURE_ONLY' }],
    objective: 'Invite adults 21+ to compare a clearly synthetic fixture offer.',
    offer: { text: 'Build a verified shortlist', permittedClaims: ['synthetic fixture only'] },
    audience: { age: '21+', location: 'Washington, D.C.' },
    placement: { id: 'HOMEPAGE_SPONSORED_BILLBOARD', desktop: [1440, 360], mobile: [390, 440] },
    brandRules: ['Sponsored disclosure is always visible', 'No pay-to-rank', 'No gradients or generated text'],
    ownerMemory: {
      approved: ['owd-source-before-hype', 'owd-block-by-block'],
      rejected: ['pr21-house-billboard-5c7fe27', 'owd-tonights-shortlist'],
      reasons: OWNER_REJECTION_MEMORY.tags,
      preferencePair: OWNER_REJECTION_MEMORY.preference_pair,
    },
    firstPartyResults: [],
    competitorEvidence: evidence,
    constraints: {
      legal: ['21+ only', 'no health claims'],
      platformPolicy: ['no generated text in image'],
      trust: ['synthetic advertiser must remain labeled', 'competitor performance remains unknown'],
    },
    performanceBudget: { maxAssetBytes: 180000, maxTotalBytes: 360000 },
    prohibitedElements: ['minors', 'medical claims', 'undisclosed sponsorship', 'organic rank influence'],
    asOf: NOW.toISOString(),
  };
}

async function main() {
  const requestedOutput = argument('output');
  if (!requestedOutput) throw new Error('Usage: run-vertical-slice.mjs --output <owner-review-directory>');
  const outputRoot = isAbsolute(requestedOutput) ? requestedOutput : resolve(REPO_ROOT, requestedOutput);
  await mkdir(outputRoot, { recursive: true });

  const requestedPacket = argument('pr21-packet');
  const packetRoot = requestedPacket
    ? (isAbsolute(requestedPacket) ? requestedPacket : resolve(REPO_ROOT, requestedPacket))
    : join(outputRoot, 'rejected-pr21');
  const rejectedPr21Evidence = await ingestRejectedPr21Evidence({ packetRoot, outputRoot });

  const changedPaths = sourceChangedPaths();
  const mergeBase = git('merge-base', 'HEAD', CANONICAL_BASE_COMMIT);
  const ancestry = auditPr21Survival({ canonicalBase: CANONICAL_BASE_COMMIT, mergeBase, changedPaths });
  const evidence = competitorEvidence();
  const compiled = compileCreativeCampaignContext(contextInput(evidence));
  if (!compiled.valid) throw new Error(compiled.errors.join('; '));
  const grant = makeGrant({
    capability: 'GENERATE_CREATIVE_DRAFT', budgetUnits: 8,
    expiresAt: '2026-08-05T04:00:00.000Z', issuedBy: 'CANA', now: NOW,
  });
  const governed = sealPacket({
    contextPacket: compiled.packet,
    grant,
    intent: {
      description: 'Generate deterministic shadow-only owner-review creative fixtures',
      capability: 'GENERATE_CREATIVE_DRAFT',
      successTest: 'three materially different responsive variants pass the bounded visual court',
      rollback: 'return Source Before Hype approved house fallback',
      subjects: ['subject:creative'],
    },
    now: NOW,
  });
  if (!governed.valid) throw new Error(governed.errors.join('; '));
  const provider = createDeterministicFixtureProvider();
  const registry = createProviderRegistry([provider]);
  const slice = await runControlledVerticalSlice({
    contextPacket: compiled.packet,
    hermesPacket: governed.packet,
    registry,
    now: NOW,
  });

  const lifecycle = {
    schema_version: 'cana.dynamic-campaign-lifecycle-example/1.0.0',
    states: CAMPAIGN_STATES,
    observed_transitions: [
      transitionCampaign({ current: 'DRAFT', target: 'GENERATED' }),
      transitionCampaign({ current: 'GENERATED', target: 'VISUAL_REVIEW_FAILED' }),
      transitionCampaign({ current: 'VISUAL_REVIEW_FAILED', target: 'GENERATED' }),
      transitionCampaign({ current: 'GENERATED', target: 'OWNER_REVIEW_REQUIRED' }),
    ],
    current_state: 'OWNER_REVIEW_REQUIRED',
    active_transition_executed: false,
  };
  const exampleEvent = createPerformanceEvent({
    eventId: 'evt_synthetic_owner_review_impression', type: 'IMPRESSION',
    campaignId: slice.variants[0].id, placementId: 'HOMEPAGE_SPONSORED_BILLBOARD',
    audience: 'DC_21_PLUS_SYNTHETIC_FIXTURE', provider: provider.name, model: provider.model,
    promptStrategy: slice.variants[0].strategy, mechanism: 'synthetic-owner-review',
    occurredAt: NOW.toISOString(), source: 'ORDERWEEDDC_FIRST_PARTY', attribution: 'OBSERVED_NOT_CAUSAL',
  });
  const tuningReadiness = evaluateTuningReadiness({
    rightsClearedApprovedCount: 2, preferencePairCount: 1, stableReasonLabels: false,
    firstPartyPerformanceCount: 0, duplicateCheck: 'NOT_RUN', contaminationCheck: 'NOT_RUN',
    splits: null, antiRegressionBenchmark: null, rollbackPlan: null,
    beatsRetrievalPromptingRouting: false,
  });
  const providerRegistryReceipt = {
    schema_version: 'cana.image-provider-registry/1.0.0',
    execution_authority: registry.executionAuthority,
    providers: registry.providers.map((entry) => ({
      name: entry.name, model: entry.model, capabilities: entry.capabilities, routing: entry.routing,
    })),
    external_provider_calls: 0,
    actual_spend_usd: 0,
  };

  const reviewAssets = [];
  for (const variant of slice.variants) {
    const campaignRoot = join(outputRoot, 'campaigns', variant.system_id);
    await mkdir(campaignRoot, { recursive: true });
    const assetPaths = {};
    for (const viewport of ['desktop', 'mobile']) {
      const bytes = Buffer.from(variant[viewport].image.imageBase64, 'base64');
      const outputAsset = join(campaignRoot, `${viewport}.svg`);
      const publicAsset = join(REPO_ROOT, 'apps/web/public/creative/review', `${variant.system_id}-${viewport}.svg`);
      await mkdir(dirname(publicAsset), { recursive: true });
      await writeFile(outputAsset, bytes);
      await writeFile(publicAsset, bytes);
      assetPaths[viewport] = `/creative/review/${variant.system_id}-${viewport}.svg`;
      reviewAssets.push({ campaign_id: variant.system_id, viewport, path: relative(REPO_ROOT, publicAsset), sha256: sha256(bytes), bytes: bytes.length });
    }
    await writeFile(join(campaignRoot, 'creative-record.json'), json({
      id: variant.id,
      system_id: variant.system_id,
      strategy: variant.strategy,
      creative_genome: variant.creative_genome,
      headline: variant.headline,
      cta: variant.cta,
      disclosure: variant.disclosure,
      state: 'OWNER_REVIEW_REQUIRED',
      assets: assetPaths,
      desktop_generation_receipt: variant.desktop.image.receipt,
      mobile_generation_receipt: variant.mobile.image.receipt,
      court: variant.court,
      postable: false,
    }));
  }

  const manifest = {
    schema_version: 'cana.dynamic-creative-owner-review-manifest/1.0.0',
    generated_at: NOW.toISOString(),
    current_state: 'OWNER_REVIEW_REQUIRED',
    synthetic_advertiser: true,
    campaigns: slice.variants.map((variant) => ({
      id: variant.system_id,
      creative_id: variant.id,
      strategy: variant.strategy,
      headline: variant.headline,
      cta: variant.cta,
      disclosure: variant.disclosure,
      desktop_asset: `/creative/review/${variant.system_id}-desktop.svg`,
      mobile_asset: `/creative/review/${variant.system_id}-mobile.svg`,
      court_status: variant.court.status,
      owner_decision: 'PENDING',
    })),
    rollback: slice.rotation,
    owner_seed_decisions: OWNER_CAMPAIGN_SEEDS,
    production_publication_authority: 'NONE',
  };
  const experimentPlan = {
    schema_version: 'cana.dynamic-creative-first-party-experiment-plan/1.0.0',
    status: 'DEFINED_NOT_RUN',
    control: 'owd-source-before-hype',
    treatments: slice.variants.map((variant) => variant.system_id),
    primary_metric: 'QUALIFIED_CLICK_RATE',
    counter_metrics: ['USER_COMPLAINT_RATE', 'PERFORMANCE_REGRESSION', 'POLICY_FAILURE'],
    attribution_requirement: 'ORDERWEEDDC_FIRST_PARTY_DIRECT_OBSERVATION',
    owner_approval_required: true,
    publication_authority: 'NONE',
    spend_authority: 'NONE',
  };
  const learningReceipt = {
    schema_version: 'cana.dynamic-creative-learning-receipt/1.0.0',
    cycle_status: 'STOPPED_FOR_OWNER_DECISION',
    observed: 'PR21 billboard owner rejection and two synthetic competitor-mechanism fixtures',
    attempted: 'Three materially different deterministic responsive campaign systems',
    why: 'Apply the owner rejection tags to original, rights-cleared campaign hypotheses',
    evidence: rejectedPr21Evidence.assets.map((asset) => ({ name: asset.name, sha256: asset.sha256 })),
    rights_state: 'SYNTHETIC_FIXTURES_AND_REJECTED_OWNER_PACKET_EVIDENCE_ONLY',
    owner_decision: 'PENDING_FOR_THREE_NEW_SYSTEMS',
    experiment: 'DEFINED_NOT_RUN',
    measured_outcome: null,
    causal_confidence: 'NONE_NO_EXPERIMENT_RUN',
    winning_mechanism: null,
    failure_mechanism: OWNER_REJECTION_MEMORY.tags,
    memory_applied: {
      owner_rejection_retrieved: true,
      context_digest: slice.context_digest,
      rejected_candidate: OWNER_REJECTION_MEMORY.candidate.commit,
    },
    routing_mutation: 'NONE_PROVIDER_ROUTER_REMAINS_POLICY_BOUND',
    next_mutation: 'Record the owner decision and reason before any next generation.',
    unresolved_questions: ['Which of the three systems should be approved, revised, or rejected?'],
  };

  await Promise.all([
    writeJson(outputRoot, 'ancestry-transfer-receipt.json', ancestry),
    writeJson(outputRoot, 'competitor-evidence.json', evidence),
    writeJson(outputRoot, 'sitemind-context-receipt.json', compiled.packet),
    writeJson(outputRoot, 'hermes-governed-packet.json', governed.packet),
    writeJson(outputRoot, 'owner-seed-genomes.json', OWNER_CAMPAIGN_SEEDS),
    writeJson(outputRoot, 'owner-preference-memory.json', OWNER_REJECTION_MEMORY),
    writeJson(outputRoot, 'pr21-rejected-evidence-ingestion.json', rejectedPr21Evidence),
    writeJson(outputRoot, 'rejected-creative-genome.json', { candidate: OWNER_REJECTION_MEMORY.candidate, failure_mechanisms: OWNER_REJECTION_MEMORY.tags, preference_pair: OWNER_REJECTION_MEMORY.preference_pair }),
    writeJson(outputRoot, 'provider-registry.json', providerRegistryReceipt),
    writeJson(outputRoot, 'provider-routing-receipt.json', slice.provider_routing_receipt),
    writeJson(outputRoot, 'entitlement-model.json', { tiers: SPONSORSHIP_TIERS, example: slice.entitlement }),
    writeJson(outputRoot, 'campaign-lifecycle.json', lifecycle),
    writeJson(outputRoot, 'visual-court.json', { judges: VISUAL_COURT_JUDGES, campaigns: slice.variants.map((variant) => ({ id: variant.id, court: variant.court })) }),
    writeJson(outputRoot, 'rejection-regeneration-receipt.json', slice.rejection_and_regeneration_receipt),
    writeJson(outputRoot, 'performance-event-schemas.json', { event_types: PERFORMANCE_EVENT_TYPES, example_event: exampleEvent }),
    writeJson(outputRoot, 'rotation-rollback-receipt.json', slice.rotation),
    writeJson(outputRoot, 'future-tuning-readiness.json', tuningReadiness),
    writeJson(outputRoot, 'first-party-experiment-plan.json', experimentPlan),
    writeJson(outputRoot, 'learning-receipt.json', learningReceipt),
    writeJson(outputRoot, 'review-asset-manifest.json', reviewAssets),
    writeJson(outputRoot, 'owner-review-manifest.json', manifest),
    writeJson(outputRoot, 'vertical-slice-receipt.json', slice),
  ]);

  process.stdout.write(json({
    status: 'DYNAMIC_CREATIVE_VERTICAL_SLICE_READY',
    output: relative(REPO_ROOT, outputRoot),
    campaigns: manifest.campaigns.map((campaign) => campaign.id),
    external_provider_calls: slice.external_provider_calls,
    actual_spend_usd: slice.actual_spend_usd,
    owner_review_state: slice.owner_review_state,
    fallback: slice.rotation.campaign.id,
  }));
}

await main();
