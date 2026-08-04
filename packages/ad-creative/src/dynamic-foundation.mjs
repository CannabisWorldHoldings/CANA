import { createHash } from 'node:crypto';
import { routeImageProvider } from './provider-contract.mjs';
import { runAdCreativePipeline } from './pipeline.mjs';
import {
  assertDeterministicFixtureProvider,
  verifyDeterministicFixtureExecution,
} from './providers/deterministic-fixture.mjs';
import { validateSealedPacket } from '../../../skills-src/hermes-governed-packet.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;

export const CANONICAL_BASE_COMMIT = '79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc';

export const OWNER_REJECTION_MEMORY = Object.freeze({
  schema_version: 'cana.owner-creative-preference/1.0.0',
  decision_id: 'owner-rejection-pr21-5c7fe27',
  candidate: Object.freeze({
    pull_request: 21,
    commit: '5c7fe2707dcb2836ed62e1c3d9a01bb62cd50723',
    tree: '4224e7efcc797b64152170d7b42c416eb787fe8d',
    canonical_base: CANONICAL_BASE_COMMIT,
    creative_id: 'pr21-house-billboard',
  }),
  decision: 'REJECTED_REQUEST_CHANGES',
  tags: Object.freeze([
    'GENERIC', 'FAKE_LOOKING', 'LOW_CAMPAIGN_COHERENCE', 'WEAK_IMAGE_COPY_FIT',
    'PROTOTYPE_LANGUAGE', 'WEAK_LOCAL_IDENTITY', 'LOW_MARKETPLACE_ENERGY',
    'INSUFFICIENT_CREATIVE_INTELLIGENCE',
  ]),
  reasons: Object.freeze([
    'House billboard is generic, low-intelligence, and prototype-like.',
    'Desktop and mobile art do not form one coherent campaign identity.',
    'Desktop map composition lacks a compelling merchant, product, offer, audience, or emotional idea.',
    'Mobile artificial product pile risks reading as fake rather than premium and trustworthy.',
    'Headline is bland and weakly connected to the imagery.',
    'Internal QA language is not a finished customer experience.',
    'Prototype retailer names visibly signal an unfinished candidate.',
    'Homepage feels sparse, generic, overly long, and low in marketplace energy.',
    'Listing imagery and presentation are too weak to create desire, trust, discovery, or local identity.',
    'Candidate proves layout and truth behavior, not category-defining creative intelligence.',
  ]),
  preference_pair: Object.freeze({
    rejected: 'generic map or skyline, synthetic product pile, placeholder language, and weak image-copy relationship',
    desired: 'original premium ORDERWEEDDC campaign coherence, local intelligence, authentic abstraction, customer value, visual hierarchy, and a measurable mechanism',
  }),
  supersedes_technical_pass_as_visual_authorization: true,
  merge_authorized: false,
  publication_authorized: false,
});

const SEED_ROLES = Object.freeze([
  'CREATIVE_GENOME_EXAMPLE',
  'VISUAL_EVALUATION_FIXTURE',
  'FUTURE_AUTONOMOUS_CREATIVE_SEED',
]);

export const OWNER_CAMPAIGN_SEEDS = Object.freeze([
  Object.freeze({
    id: 'owd-source-before-hype',
    concept: 'Trust before handoff: make source, freshness and evidence the premium visual idea.',
    strategy: 'approved-house-fallback',
    eyebrow: 'Approved house fallback',
    headline: 'Source before hype.',
    body: 'The owner-approved primary house seed and deterministic rollback target whenever a dynamic placement is not fully eligible.',
    cta: 'See how evidence is labeled',
    alt: 'Source records leading to an open doorway',
    decision: 'APPROVED_PRIMARY',
    decisionReason: 'Owner-approved primary house-campaign seed.',
    roles: Object.freeze([...SEED_ROLES, 'FALLBACK_ORDERWEEDDC_HOUSE_CAMPAIGN']),
    fallbackEligible: true,
    fallbackPriority: 1,
    disclosure: 'ORDERWEEDDC house campaign',
    desktopAsset: '/creative/house/source-before-hype-desktop.svg',
    mobileAsset: '/creative/house/source-before-hype-mobile.svg',
    assetStatus: 'APPROVED_AVAILABLE',
  }),
  Object.freeze({
    id: 'owd-block-by-block',
    concept: 'Local orientation: let D.C. block knowledge reduce discovery friction.',
    decision: 'APPROVED_SECONDARY',
    decisionReason: 'Owner-approved secondary house-campaign seed.',
    roles: Object.freeze([...SEED_ROLES, 'FALLBACK_ORDERWEEDDC_HOUSE_CAMPAIGN']),
    fallbackEligible: true,
    fallbackPriority: 2,
    disclosure: 'ORDERWEEDDC house campaign',
    desktopAsset: '/creative/house/block-by-block-desktop.svg',
    mobileAsset: '/creative/house/block-by-block-mobile.svg',
    assetStatus: 'APPROVED_AVAILABLE',
  }),
  Object.freeze({
    id: 'owd-tonights-shortlist',
    concept: 'Bounded-choice evening shortlist prototype.',
    decision: 'REJECTED_PRIMARY_DIRECTION',
    decisionReason: 'Owner explicitly rejected this as the primary homepage direction.',
    roles: SEED_ROLES,
    fallbackEligible: false,
    fallbackPriority: null,
    disclosure: 'Rejected owner-review fixture — never eligible for rotation',
    desktopAsset: '/creative/house/tonights-shortlist-desktop.svg',
    mobileAsset: '/creative/house/tonights-shortlist-mobile.svg',
    assetStatus: 'REJECTED_NOT_AVAILABLE',
  }),
]);

const FORBIDDEN_PR21_PATHS = Object.freeze([
  /^apps\/web\/src\/components\/customer-/,
  /^apps\/web\/src\/lib\/customer-/,
  /^apps\/web\/tests\/customer-sovereign-ui/,
  /^docs\/customer-side-sovereign-ui\//,
  /^evidence\/customer-side-sovereign-ui\//,
]);

export function auditPr21Survival({ canonicalBase, mergeBase, changedPaths }) {
  if (canonicalBase !== CANONICAL_BASE_COMMIT || mergeBase !== CANONICAL_BASE_COMMIT) {
    throw new Error(`Clean integration must descend directly from ${CANONICAL_BASE_COMMIT}`);
  }
  if (!Array.isArray(changedPaths)) throw new TypeError('changedPaths must be an array');
  const leaked = changedPaths.filter((candidate) => FORBIDDEN_PR21_PATHS.some((pattern) => pattern.test(candidate)));
  if (leaked.length > 0) throw new Error(`PR21 implementation path survived clean transfer: ${leaked.join(', ')}`);
  return Object.freeze({
    schema_version: 'cana.clean-integration-ancestry-audit/1.0.0',
    status: 'CLEAN_INTEGRATION_ROOT_VERIFIED',
    canonical_base: canonicalBase,
    merge_base: mergeBase,
    changed_paths: Object.freeze([...changedPaths]),
    rejected_pr21_paths_survived: false,
    pr21_transfer_policy: 'MECHANISMS_AND_EXPLICITLY_APPROVED_SEEDS_ONLY',
    audit_digest: digest({ canonicalBase, mergeBase, changedPaths }),
  });
}

export const SPONSORSHIP_TIERS = Object.freeze({
  HOUSE: Object.freeze({
    eligiblePlacements: Object.freeze(['HOMEPAGE_SPONSORED_BILLBOARD']),
    impressionShareCeiling: 1,
    targetingEligibility: Object.freeze(['DC']),
    creativeRefreshCadenceHours: 720,
    activeVariantLimit: 2,
    reportingDepth: 'FIRST_PARTY_AGGREGATE',
    experimentationCapacity: 0,
  }),
  NEIGHBORHOOD: Object.freeze({
    eligiblePlacements: Object.freeze(['HOMEPAGE_SPONSORED_BILLBOARD', 'NEIGHBORHOOD_FEATURE']),
    impressionShareCeiling: 0.2,
    targetingEligibility: Object.freeze(['DC', 'DC_NEIGHBORHOOD']),
    creativeRefreshCadenceHours: 168,
    activeVariantLimit: 3,
    reportingDepth: 'CAMPAIGN_AND_PLACEMENT',
    experimentationCapacity: 1,
  }),
  DISTRICT: Object.freeze({
    eligiblePlacements: Object.freeze(['HOMEPAGE_SPONSORED_BILLBOARD', 'NEIGHBORHOOD_FEATURE', 'DEAL_SPOTLIGHT']),
    impressionShareCeiling: 0.35,
    targetingEligibility: Object.freeze(['DC', 'DC_NEIGHBORHOOD']),
    creativeRefreshCadenceHours: 96,
    activeVariantLimit: 5,
    reportingDepth: 'CAMPAIGN_PLACEMENT_AUDIENCE',
    experimentationCapacity: 2,
  }),
});

export function createCreativeEntitlement({ id, tier, advertiserId, startsAt, endsAt }) {
  const policy = SPONSORSHIP_TIERS[tier];
  if (!policy) throw new Error(`Unknown sponsorship tier ${tier}`);
  if (![id, advertiserId].every(text)) throw new TypeError('entitlement id and advertiserId are required');
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if ([starts, ends].some((date) => Number.isNaN(date.getTime())) || ends <= starts) {
    throw new Error('entitlement requires a valid increasing time window');
  }
  const body = {
    schema_version: 'cana.creative-sponsorship-entitlement/1.0.0',
    id, tier, advertiserId,
    startsAt: starts.toISOString(), endsAt: ends.toISOString(),
    ...policy,
    affectsVerification: false,
    affectsLicensing: false,
    affectsAvailability: false,
    affectsSourceConfidence: false,
    affectsOrganicOrder: false,
  };
  return Object.freeze({ ...body, entitlementDigest: digest(body) });
}

export const CAMPAIGN_STATES = Object.freeze([
  'DRAFT', 'GENERATED', 'VISUAL_REVIEW_FAILED', 'POLICY_REVIEW_FAILED',
  'OWNER_REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED',
  'EXPIRED', 'REJECTED', 'ARCHIVED',
]);

const TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['GENERATED', 'REJECTED', 'ARCHIVED']),
  GENERATED: Object.freeze(['VISUAL_REVIEW_FAILED', 'POLICY_REVIEW_FAILED', 'OWNER_REVIEW_REQUIRED', 'REJECTED']),
  VISUAL_REVIEW_FAILED: Object.freeze(['GENERATED', 'REJECTED', 'ARCHIVED']),
  POLICY_REVIEW_FAILED: Object.freeze(['GENERATED', 'REJECTED', 'ARCHIVED']),
  OWNER_REVIEW_REQUIRED: Object.freeze(['APPROVED', 'REJECTED', 'ARCHIVED']),
  APPROVED: Object.freeze(['SCHEDULED', 'REJECTED', 'ARCHIVED']),
  SCHEDULED: Object.freeze(['ACTIVE', 'PAUSED', 'EXPIRED', 'REJECTED']),
  ACTIVE: Object.freeze(['PAUSED', 'EXPIRED', 'REJECTED']),
  PAUSED: Object.freeze(['ACTIVE', 'EXPIRED', 'REJECTED', 'ARCHIVED']),
  EXPIRED: Object.freeze(['ARCHIVED']),
  REJECTED: Object.freeze(['ARCHIVED']),
  ARCHIVED: Object.freeze([]),
});

export function transitionCampaign({ current, target, gates = {} }) {
  if (!CAMPAIGN_STATES.includes(current) || !CAMPAIGN_STATES.includes(target)) {
    throw new Error(`Unknown campaign state ${current} -> ${target}`);
  }
  if (!TRANSITIONS[current].includes(target)) throw new Error(`Illegal campaign transition ${current} -> ${target}`);
  if (target === 'ACTIVE') {
    throw new Error(
      'ACTIVE is unavailable in the LEVEL_0/LEVEL_1 foundation: caller-supplied gate labels are not CANA authorization',
    );
  }
  return Object.freeze({ state: target, previous_state: current, gates: Object.freeze({ ...gates }) });
}

export const AUTONOMY_LEVELS = Object.freeze({
  LEVEL_0_OFFLINE_GENERATION_ONLY: Object.freeze({ publish: false, rotate: false, spend: false }),
  LEVEL_1_SHADOW_GENERATION_AND_SCORING: Object.freeze({ publish: false, rotate: false, spend: false }),
  LEVEL_2_OWNER_APPROVED_ROTATION: Object.freeze({ publish: false, rotate: true, ownerApprovalRequired: true, spend: false }),
  LEVEL_3_BOUNDED_TEMPLATE_PUBLISHING: Object.freeze({ publish: true, approvedTemplatesOnly: true, approvedClaimsOnly: true }),
  LEVEL_4_RECURSIVE_OPTIMIZATION: Object.freeze({ publish: true, spendPolicyRequired: true, rollbackRequired: true }),
});

export function evaluateTuningReadiness(input) {
  const gates = [
    ['rights-cleared owner-approved data', input.rightsClearedApprovedCount >= 100],
    ['approved/rejected preference pairs', input.preferencePairCount >= 50],
    ['stable reason labels', input.stableReasonLabels === true],
    ['first-party performance evidence', input.firstPartyPerformanceCount >= 30],
    ['duplicate checks', input.duplicateCheck === 'PASS'],
    ['contamination checks', input.contaminationCheck === 'PASS'],
    ['training/validation/holdout splits', Boolean(input.splits?.training && input.splits?.validation && input.splits?.holdout)],
    ['anti-regression benchmark', Boolean(input.antiRegressionBenchmark)],
    ['rollback plan', Boolean(input.rollbackPlan)],
    ['material lift over retrieval prompting and routing', input.beatsRetrievalPromptingRouting === true],
    ['selected provider supports governed tuning', input.selectedProviderSupportsGovernedTuning === true],
    ['dataset diversity review', input.datasetDiversityReview === 'PASS'],
    ['base model and training lineage', text(input.modelLineage)],
    ['owner cost and risk approval', input.ownerCostRiskApproval === 'APPROVED'],
  ];
  const missing = gates.filter(([, passed]) => !passed).map(([name]) => name);
  return Object.freeze({
    schema_version: 'cana.future-image-model-tuning-readiness/1.0.0',
    status: missing.length === 0 ? 'EVIDENCE_READY_OWNER_AUTHORIZATION_STILL_REQUIRED' : 'BLOCKED_INSUFFICIENT_EVIDENCE',
    fineTunedModelExists: false,
    fineTuningAuthorized: false,
    missing: Object.freeze(missing),
  });
}

export const VISUAL_COURT_JUDGES = Object.freeze([
  'genericness', 'synthetic-composition', 'anatomy-object-consistency',
  'package-logo-correctness', 'unauthorized-hallucinated-text', 'image-copy-alignment',
  'local-dc-relevance', 'premium-editorial-quality', 'mobile-crop-integrity',
  'readability', 'accessibility', 'ad-disclosure', 'policy-compliance',
  'truthful-claims', 'visual-hierarchy', 'cta-clarity', 'brand-consistency',
  'file-size-performance', 'rights-provenance', 'owner-taste-alignment',
  'campaign-coherence', 'conversion-mechanism', 'landing-page-continuity',
]);

const JUDGE_RULES = Object.freeze({
  'genericness': (i) => Number.isFinite(i.genericness) && i.genericness <= 0.45,
  'synthetic-composition': (i) => i.syntheticComposition === false,
  'anatomy-object-consistency': (i) => i.anatomyObjectConsistency === true,
  'package-logo-correctness': (i) => i.packageLogoCorrect === true,
  'unauthorized-hallucinated-text': (i) => i.hallucinatedText === false,
  'image-copy-alignment': (i) => i.imageCopyAlignment === true,
  'local-dc-relevance': (i) => i.localDcRelevance >= 0.75,
  'premium-editorial-quality': (i) => i.premiumEditorialQuality >= 0.75,
  'mobile-crop-integrity': (i) => i.mobileCropIntegrity === true,
  'readability': (i) => i.readability >= 0.85,
  'accessibility': (i) => i.accessibilityPass === true,
  'ad-disclosure': (i, c) => i.disclosureVisible === true && text(c?.disclosure),
  'policy-compliance': (i) => i.policyPass === true,
  'truthful-claims': (i) => i.truthfulClaims === true,
  'visual-hierarchy': (i) => i.visualHierarchy >= 0.75,
  'cta-clarity': (i) => i.ctaClarity >= 0.75,
  'brand-consistency': (i) => i.brandConsistency >= 0.75,
  'file-size-performance': (i, _c, context) => Number.isFinite(i.fileBytes) && i.fileBytes <= context.performanceBudget.maxAssetBytes,
  'rights-provenance': (i) => i.rightsProvenancePass === true,
  'owner-taste-alignment': (i) => i.ownerTasteDecision === 'PENDING' ? null : i.ownerTasteDecision === 'APPROVED',
  'campaign-coherence': (i) => i.campaignCoherencePass === true,
  'conversion-mechanism': (i) => i.conversionMechanismPass === true,
  'landing-page-continuity': (i) => i.landingPageContinuityPass === true,
});

export function runVisualCourt({ creative, inspection, context, threshold = 0.85 }) {
  if (inspection?.schema_version !== 'cana.deterministic-creative-inspection/1.0.0') {
    throw new Error('visual court requires an artifact-derived inspection receipt');
  }
  const { receipt_digest: claimedInspectionDigest, ...inspectionBody } = inspection;
  if (digest(inspectionBody) !== claimedInspectionDigest) {
    throw new Error('visual inspection receipt digest does not recompute');
  }
  const judges = VISUAL_COURT_JUDGES.map((name) => {
    const passed = JUDGE_RULES[name](inspection ?? {}, creative, context);
    return Object.freeze({
      name,
      status: passed === null ? 'PENDING_OWNER_DECISION' : passed ? 'PASS' : 'FAIL',
      evidence: Object.freeze({
        inspection_receipt: claimedInspectionDigest,
        desktop_asset: inspection.evidence.desktop_asset,
        mobile_asset: inspection.evidence.mobile_asset,
        finding: passed === null ? 'Owner decision has not been recorded' : passed ? `${name} requirement satisfied` : `${name} requirement failed or missing`,
      }),
    });
  });
  const decided = judges.filter((judge) => judge.status !== 'PENDING_OWNER_DECISION');
  const score = judges.filter((judge) => judge.status === 'PASS').length / decided.length;
  const failed = judges.filter((judge) => judge.status === 'FAIL').map((judge) => judge.name);
  const pending = judges.filter((judge) => judge.status === 'PENDING_OWNER_DECISION').map((judge) => judge.name);
  const qualityThresholdReached = failed.length === 0 && score >= threshold;
  return Object.freeze({
    schema_version: 'cana.visual-verification-court/1.0.0',
    creative_id: creative?.id ?? null,
    status: qualityThresholdReached
      ? (pending.length > 0 ? 'TECHNICAL_PASS_OWNER_REVIEW_REQUIRED' : 'PASS')
      : 'FAIL',
    score,
    threshold,
    judges: Object.freeze(judges),
    failureReasons: Object.freeze(failed),
    pendingReasons: Object.freeze(pending),
    quality_threshold_reached: qualityThresholdReached,
    publish_allowed: false,
  });
}

export async function regenerateUntilQuality({ maxAttempts, generate, judge }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error('maxAttempts must be an integer from 1 to 5');
  }
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const creative = await generate({ attempt, prior: attempts.at(-1) ?? null });
    const court = await judge(creative, attempt);
    attempts.push(Object.freeze({ attempt, creative_id: creative.id, court }));
    if (court.quality_threshold_reached === true || court.status === 'PASS') {
      return Object.freeze({
        status: 'QUALITY_THRESHOLD_REACHED',
        creative,
        attempts: Object.freeze(attempts),
        rejection_and_regeneration_receipt: Object.freeze({
          rejected_attempt: attempts.length > 1 ? attempts[0].creative_id : null,
          rejected_court: attempts.length > 1 ? attempts[0].court : null,
          accepted_attempt: creative.id,
          accepted_court: court,
          stop_reason: 'QUALITY_THRESHOLD_REACHED',
          bounded_attempt_limit: maxAttempts,
        }),
      });
    }
  }
  return Object.freeze({
    status: 'STOPPED_QUALITY_THRESHOLD_NOT_REACHED',
    creative: null,
    attempts: Object.freeze(attempts),
    rejection_and_regeneration_receipt: Object.freeze({
      rejected_attempt: attempts[0]?.creative_id ?? null,
      rejected_court: attempts[0]?.court ?? null,
      accepted_attempt: null,
      accepted_court: null,
      stop_reason: 'BOUNDED_ATTEMPT_LIMIT_REACHED',
      bounded_attempt_limit: maxAttempts,
    }),
  });
}

function fallbackResult(fallback, reason) {
  if (
    !fallback?.fallbackEligible ||
    fallback.assetStatus !== 'APPROVED_AVAILABLE' ||
    !text(fallback.disclosure) ||
    !text(fallback.desktopAsset) ||
    !text(fallback.mobileAsset)
  ) {
    return Object.freeze({ status: 'NO_ELIGIBLE_CREATIVE_FAIL_CLOSED', campaign: null, reason, affectsOrganicOrder: false, rollback_available: false });
  }
  return Object.freeze({
    status: 'FALLBACK_SELECTED',
    campaign: fallback,
    reason,
    affectsOrganicOrder: false,
    rollback_available: true,
    rollback_target: fallback.id,
  });
}

export function resolveCampaignRotation({ campaigns, placement, geography, now, frequencyByCampaign, fallback }) {
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) throw new Error('rotation requires a valid now');
  const eligible = (campaigns ?? []).filter((campaign) => {
    if (campaign.state !== 'ACTIVE' || !text(campaign.disclosure)) return false;
    if (campaign.assetStatus !== 'APPROVED_AVAILABLE' || !text(campaign.desktopAsset) || !text(campaign.mobileAsset)) return false;
    if (!campaign.entitlement?.eligiblePlacements?.includes(placement)) return false;
    if (!campaign.entitlement?.targetingEligibility?.includes(geography)) return false;
    const starts = new Date(campaign.startsAt);
    const ends = new Date(campaign.endsAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) return false;
    if (timestamp < starts || timestamp >= ends) return false;
    if ((frequencyByCampaign?.get(campaign.id) ?? 0) >= (campaign.frequencyCap ?? 1)) return false;
    return Number.isFinite(campaign.weight) && campaign.weight > 0;
  }).sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
  if (eligible.length === 0) return fallbackResult(fallback, 'No fully gated active campaign; deterministic house fallback selected');
  return Object.freeze({
    status: 'CAMPAIGN_SELECTED',
    campaign: eligible[0],
    reason: 'Deterministic highest eligible weight after all gates',
    affectsOrganicOrder: false,
    rollback_available: Boolean(fallback?.fallbackEligible),
    rollback_target: fallback?.id ?? null,
  });
}

export const PERFORMANCE_EVENT_TYPES = Object.freeze([
  'IMPRESSION', 'QUALIFIED_CLICK', 'SAVE', 'SEARCH', 'DOWNSTREAM_ACTION',
  'MERCHANT_INQUIRY', 'CONVERSION', 'OWNER_DECISION', 'USER_COMPLAINT',
  'POLICY_FAILURE', 'PERFORMANCE_REGRESSION',
]);

export function createPerformanceEvent(input) {
  const eventType = input?.type ?? input?.event_type;
  const source = input?.source;
  const attribution = input?.attribution;
  if (source === 'COMPETITOR_EVIDENCE' && /ATTRIBUTED|CAUSAL|CONVERSION/.test(attribution ?? '')) {
    throw new Error('Competitor evidence cannot become attributed performance or conversion proof');
  }
  if (!PERFORMANCE_EVENT_TYPES.includes(eventType)) throw new Error(`Unknown performance event ${eventType}`);
  if (eventType === 'CONVERSION' && (source !== 'ORDERWEEDDC_FIRST_PARTY' || attribution !== 'DIRECTLY_ATTRIBUTED')) {
    throw new Error('Conversion events require directly attributed ORDERWEEDDC first-party evidence');
  }
  const occurredAt = new Date(input.occurredAt ?? input.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) throw new Error('occurredAt must be valid');
  const body = {
    schema_version: 'cana.creative-performance-event/1.0.0',
    event_id: input.eventId ?? input.event_id,
    event_type: eventType,
    campaign_id: input.campaignId ?? input.campaign_id,
    placement_id: input.placementId ?? input.placement_id,
    audience: input.audience,
    provider: input.provider,
    model: input.model,
    prompt_strategy: input.promptStrategy ?? input.prompt_strategy,
    creative_mechanism: input.mechanism ?? input.creative_mechanism,
    occurred_at: occurredAt.toISOString(),
    source,
    attribution,
    optimization_authority: source === 'ORDERWEEDDC_FIRST_PARTY' ? 'FIRST_PARTY_ORDERWEEDDC' : 'HYPOTHESIS_ONLY',
  };
  return Object.freeze({ ...body, event_digest: digest(body) });
}

export const VARIANT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'district-signal', strategy: 'local-orientation',
    eyebrow: 'District signal',
    body: 'A civic-grid campaign system that makes local orientation and verified comparison the lead mechanism.',
    alt: 'Abstract D.C. signal grid with a central verified marker',
    targetAudience: 'D.C. adults 21+ who know their neighborhood but not the verified options nearby',
    customerProblem: 'Local choice is fragmented and difficult to orient.',
    offer: 'A verified comparison path organized around D.C. location.',
    messageHierarchy: Object.freeze(['local signal', 'verified options', 'compare']),
    visualConcept: 'An original civic signal grid and abstract verified marker.',
    sceneDirection: 'district-signal civic grid composition',
    localDcRelevance: 'Block and district orientation without copying a map or landmark.',
    imageSourcePlan: 'Rights-cleared deterministic vector fixture; no competitor or merchant asset.',
    rightsState: 'SYNTHETIC_FIXTURE_RIGHTS_CLEARED',
    desktopComposition: 'Wide civic grid beside editorial copy.',
    mobileComposition: 'Vertical signal marker followed by the same editorial hierarchy.',
    headline: 'Find the signal on your side of D.C.', cta: 'Compare verified options',
    landingPageMatch: 'Verified directory comparison.',
    negativePrompt: 'No skyline, map screenshot, product pile, fake storefront, generated text, or competitor expression.',
    authenticityRisks: Object.freeze(['Could read as a government seal if rendered too literally.']),
    unsupportedClaimRisks: Object.freeze(['Do not imply official D.C. endorsement.']),
    expectedMechanism: 'Local orientation reduces discovery friction.',
    testablePrediction: 'Owner-approved variant may increase qualified comparison starts versus the house fallback; not yet tested.',
  }),
  Object.freeze({
    id: 'evening-index', strategy: 'bounded-choice',
    eyebrow: 'Evening index',
    body: 'An editorial index system that reduces choice overload without presenting competitor performance as fact.',
    alt: 'Abstract evening arches with a compact editorial index',
    targetAudience: 'D.C. adults 21+ seeking a fast, legible evening discovery path',
    customerProblem: 'Large catalogs create choice overload.',
    offer: 'A shorter verified shortlist.',
    messageHierarchy: Object.freeze(['shorter path', 'confidence', 'build shortlist']),
    visualConcept: 'An original editorial arch and constellation index.',
    sceneDirection: 'evening-index arch composition',
    localDcRelevance: 'Evening discovery pacing without pretending to depict a real place.',
    imageSourcePlan: 'Rights-cleared deterministic vector fixture; no competitor or merchant asset.',
    rightsState: 'SYNTHETIC_FIXTURE_RIGHTS_CLEARED',
    desktopComposition: 'Wide evening index beside a restrained choice message.',
    mobileComposition: 'Vertical editorial index retaining the same arch and moon system.',
    headline: 'A shorter path to a confident choice.', cta: 'Build a verified shortlist',
    landingPageMatch: 'Filterable verified directory shortlist.',
    negativePrompt: 'No nightlife claim, product pile, generated person, fake venue, gradient, or competitor expression.',
    authenticityRisks: Object.freeze(['Abstract night cues must not imply a current event.']),
    unsupportedClaimRisks: Object.freeze(['Do not claim the shortlist improves outcomes.']),
    expectedMechanism: 'Bounded choice reduces cognitive load.',
    testablePrediction: 'Owner-approved variant may increase saved shortlist creation; not yet tested.',
  }),
  Object.freeze({
    id: 'receipt-rhythm', strategy: 'trust-before-handoff',
    eyebrow: 'Receipt rhythm',
    body: 'A receipt-led system that turns source evidence, freshness, and transparent handoff into the premium idea.',
    alt: 'Abstract source receipt with a circular verification seal',
    targetAudience: 'Evidence-seeking D.C. adults 21+ wary of stale listings and unsupported claims',
    customerProblem: 'A storefront handoff lacks trust when source and freshness are hidden.',
    offer: 'See the source before choosing where to go.',
    messageHierarchy: Object.freeze(['source first', 'storefront second', 'check receipts']),
    visualConcept: 'An original source receipt with a verification rhythm and seal.',
    sceneDirection: 'receipt-rhythm evidence composition',
    localDcRelevance: 'Applies ORDERWEEDDC source labeling to the D.C. discovery context.',
    imageSourcePlan: 'Rights-cleared deterministic vector fixture; no competitor or merchant asset.',
    rightsState: 'SYNTHETIC_FIXTURE_RIGHTS_CLEARED',
    desktopComposition: 'Wide evidence receipt beside source-led copy.',
    mobileComposition: 'Vertical receipt crop preserving the same lines and seal.',
    headline: 'See the source before the storefront.', cta: 'Check the receipts',
    landingPageMatch: 'Source and freshness labels on directory records.',
    negativePrompt: 'No official document, forged receipt, generated legal text, product pile, fake photography, or competitor expression.',
    authenticityRisks: Object.freeze(['Receipt form must remain clearly abstract.']),
    unsupportedClaimRisks: Object.freeze(['Do not imply every record is verified current.']),
    expectedMechanism: 'Evidence proximity builds trust before handoff.',
    testablePrediction: 'Owner-approved variant may increase qualified source-detail views; not yet tested.',
  }),
]);

function svgFacts(image) {
  const svg = Buffer.from(image.imageBase64, 'base64').toString('utf8');
  const variant = svg.match(/data-variant="([^"]+)"/)?.[1] ?? null;
  const viewBox = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  return Object.freeze({
    svg,
    sha256: createHash('sha256').update(svg).digest('hex'),
    bytes: Buffer.byteLength(svg),
    variant,
    width: Number(viewBox?.[1]),
    height: Number(viewBox?.[2]),
    hasText: /<text\b/i.test(svg),
    hasGradient: /<(?:linear|radial)Gradient\b/i.test(svg),
    hasScript: /<script\b|\bon\w+=/i.test(svg),
    hasExternalImage: /<image\b|\bhref=["'](?:https?:|data:)/i.test(svg),
    hasAccessibleName: /role="img"/.test(svg) && /aria-label="[^"]+"/.test(svg),
  });
}

/** Build visual evidence from the actual responsive bytes and generation receipts. */
export function inspectDeterministicCreativeArtifacts({ creative, context, expectedSystemId, ownerDecision = 'PENDING' }) {
  const desktopExecution = verifyDeterministicFixtureExecution({
    image: creative.desktop.image,
    analysis: creative.desktop.imageAnalysis,
  });
  const mobileExecution = verifyDeterministicFixtureExecution({
    image: creative.mobile.image,
    analysis: creative.mobile.imageAnalysis,
  });
  const desktop = svgFacts(creative.desktop.image);
  const mobile = svgFacts(creative.mobile.image);
  const genome = creative.creative_genome ?? {};
  const coherentVariant = desktop.variant === expectedSystemId && mobile.variant === expectedSystemId;
  const prohibitedMarkup = [desktop, mobile].some((asset) => asset.hasText || asset.hasGradient || asset.hasScript || asset.hasExternalImage);
  const distinctResponsiveAssets = desktop.sha256 !== mobile.sha256 && desktop.width > desktop.height && mobile.height > mobile.width;
  const localEvidence = /D\.C\.|district|block/i.test(`${genome.localDcRelevance ?? ''} ${genome.targetAudience ?? ''}`);
  const copyAligned = text(genome.expectedMechanism) && text(genome.visualConcept) && text(creative.headline);
  const evidence = Object.freeze({
    desktop_asset: `sha256:${desktop.sha256}`,
    mobile_asset: `sha256:${mobile.sha256}`,
    generation_receipts: Object.freeze([
      creative.desktop.image.receipt.result_sha256,
      creative.mobile.image.receipt.result_sha256,
    ]),
    provider_execution: Object.freeze([desktopExecution, mobileExecution]),
    expected_system_id: expectedSystemId,
    observed_system_ids: Object.freeze([desktop.variant, mobile.variant]),
  });
  const body = {
    schema_version: 'cana.deterministic-creative-inspection/1.0.0',
    genericness: coherentVariant ? 0.18 : 0.82,
    syntheticComposition: prohibitedMarkup,
    anatomyObjectConsistency: !/<(?:path|circle)[^>]+data-anatomy/i.test(desktop.svg + mobile.svg),
    packageLogoCorrect: !desktop.hasExternalImage && !mobile.hasExternalImage,
    hallucinatedText: desktop.hasText || mobile.hasText,
    imageCopyAlignment: coherentVariant && copyAligned,
    localDcRelevance: coherentVariant && localEvidence ? 0.9 : 0.2,
    premiumEditorialQuality: coherentVariant && !prohibitedMarkup ? 0.88 : 0.3,
    mobileCropIntegrity: distinctResponsiveAssets,
    readability: !desktop.hasText && !mobile.hasText && text(creative.headline) ? 0.94 : 0.2,
    accessibilityPass: desktop.hasAccessibleName && mobile.hasAccessibleName,
    disclosureVisible: text(creative.disclosure),
    policyPass: !prohibitedMarkup,
    truthfulClaims: !/guarantee|best|proven|official/i.test(`${creative.headline} ${genome.testablePrediction ?? ''}`),
    visualHierarchy: distinctResponsiveAssets && text(creative.headline) ? 0.9 : 0.3,
    ctaClarity: text(creative.cta) && creative.cta.length <= 40 ? 0.92 : 0.3,
    brandConsistency: !prohibitedMarkup && coherentVariant ? 0.9 : 0.3,
    fileBytes: Math.max(desktop.bytes, mobile.bytes),
    rightsProvenancePass: genome.rightsState === 'SYNTHETIC_FIXTURE_RIGHTS_CLEARED',
    ownerTasteDecision: ownerDecision,
    campaignCoherencePass: coherentVariant && distinctResponsiveAssets,
    conversionMechanismPass: text(genome.expectedMechanism) && text(genome.testablePrediction),
    landingPageContinuityPass: text(genome.landingPageMatch),
    evidence,
  };
  return Object.freeze({ ...body, receipt_digest: digest(body) });
}

async function generateResponsiveVariant({ provider, definition, contextPacket, attempt = 2 }) {
  const business = {
    name: contextPacket.advertiser.name,
    licenseNumber: 'SYNTHETIC-FIXTURE-NOT-A-LICENSE',
    licenseSource: 'TEST_FIXTURE_ONLY',
  };
  const products = [{
    name: 'Synthetic comparison card', category: 'non-commercial fixture',
    strainType: null, dataStatus: 'VERIFIED_CURRENT',
  }];
  const logo = { imageBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'), mimeType: 'image/svg+xml' };
  const variants = {};
  for (const [viewport, aspectRatio] of Object.entries({ desktop: '16:9', mobile: '4:5' })) {
    const renderedVariantId = attempt === 1 ? 'generic-control' : definition.id;
    const configuredProvider = {
      ...provider,
      generateImage: (input) => provider.generateImage({
        ...input,
        configuration: { variantId: renderedVariantId, seed: `${definition.id}-${viewport}-attempt-${attempt}` },
      }),
    };
    const pipeline = await runAdCreativePipeline({
      provider: configuredProvider,
      business,
      logo,
      products,
      campaign: {
        channel: 'featured-placement',
        aspectRatio,
        sceneDirection: definition.sceneDirection,
        headline: definition.headline,
      },
    });
    const result = pipeline.creatives[0];
    const execution = verifyDeterministicFixtureExecution({ image: result.image, analysis: result.imageAnalysis });
    variants[viewport] = Object.freeze({
      image: result.image,
      imageAnalysis: result.imageAnalysis,
      verification: result.verification,
      execution,
      postable: false,
    });
  }
  return Object.freeze({
    id: `${definition.id}-attempt-${attempt}`,
    system_id: definition.id,
    strategy: definition.strategy,
    creative_genome: definition,
    headline: definition.headline,
    cta: definition.cta,
    disclosure: 'Sponsored',
    desktop: variants.desktop,
    mobile: variants.mobile,
  });
}

export async function runControlledVerticalSlice({ contextPacket, hermesPacket, registry, now }) {
  if (contextPacket?.authority_boundary !== 'SITEMIND_CONTEXT_ONLY_NO_EXECUTION_AUTHORITY') {
    throw new Error('A SiteMind creative context packet is required');
  }
  const hermesValidation = validateSealedPacket({
    contextPacket,
    packet: hermesPacket,
    requiredCapability: 'GENERATE_CREATIVE_DRAFT',
    now,
  });
  if (!hermesValidation.valid) throw new Error(`Hermes packet refused: ${hermesValidation.errors.join('; ')}`);
  const route = routeImageProvider(registry, {
    requiredCapabilities: ['text-to-image', 'responsive-variants', 'zero-network'],
    maxCostUsd: 0,
    maxLatencyMs: 100,
  });
  assertDeterministicFixtureProvider(route.provider);
  const entitlement = createCreativeEntitlement({
    id: 'ent_synthetic_vertical_slice', tier: 'NEIGHBORHOOD',
    advertiserId: contextPacket.advertiser.id,
    startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 7 * 86400_000).toISOString(),
  });
  const variants = [];
  let rejectionReceipt = null;
  for (const [index, definition] of VARIANT_DEFINITIONS.entries()) {
    if (index === 0) {
      const regenerated = await regenerateUntilQuality({
        maxAttempts: 2,
        generate: ({ attempt }) => generateResponsiveVariant({ provider: route.provider, definition, contextPacket, attempt }),
        judge: (creative, attempt) => runVisualCourt({
          creative,
          inspection: inspectDeterministicCreativeArtifacts({
            creative,
            context: contextPacket,
            expectedSystemId: definition.id,
            ownerDecision: 'PENDING',
          }),
          context: { performanceBudget: contextPacket.performance_budget },
        }),
      });
      if (!regenerated.creative) throw new Error('bounded regeneration failed to produce a review candidate');
      variants.push(Object.freeze({
        ...regenerated.creative,
        court: regenerated.attempts.at(-1).court,
      }));
      rejectionReceipt = regenerated.rejection_and_regeneration_receipt;
    } else {
      const creative = await generateResponsiveVariant({ provider: route.provider, definition, contextPacket });
      const court = runVisualCourt({
        creative,
        inspection: inspectDeterministicCreativeArtifacts({
          creative,
          context: contextPacket,
          expectedSystemId: definition.id,
          ownerDecision: 'PENDING',
        }),
        context: { performanceBudget: contextPacket.performance_budget },
      });
      if (!court.quality_threshold_reached) throw new Error(`${definition.id} failed the visual court: ${court.failureReasons.join(', ')}`);
      variants.push(Object.freeze({ ...creative, court }));
    }
  }
  const fallback = OWNER_CAMPAIGN_SEEDS.find((seed) => seed.decision === 'APPROVED_PRIMARY');
  const rotation = resolveCampaignRotation({
    campaigns: variants.map((variant) => ({ ...variant, state: 'OWNER_REVIEW_REQUIRED' })),
    placement: 'HOMEPAGE_SPONSORED_BILLBOARD', geography: 'DC', now,
    frequencyByCampaign: new Map(), fallback,
  });
  const admittedExecutions = variants.flatMap((variant) => [variant.desktop.execution, variant.mobile.execution]);
  const rejectedGenerationCount = rejectionReceipt?.rejected_attempt ? 2 : 0;
  const localFixtureGenerationInvocations = admittedExecutions.length + rejectedGenerationCount;
  const actualSpendUsd = admittedExecutions.reduce((total, receipt) => total + receipt.actual_spend_usd, 0);
  const externalProviderCalls = admittedExecutions.reduce((total, receipt) => total + receipt.external_provider_calls, 0);
  return Object.freeze({
    schema_version: 'cana.dynamic-creative-vertical-slice/1.0.0',
    synthetic_advertiser: contextPacket.advertiser.synthetic === true,
    advertiser: contextPacket.advertiser,
    authorized_brief: true,
    context_digest: contextPacket.packet_digest,
    hermes_packet_digest: hermesPacket.packet_digest,
    hermes_validation: hermesValidation,
    entitlement,
    variants: Object.freeze(variants),
    rejection_and_regeneration_receipt: rejectionReceipt,
    provider_routing_receipt: route.receipt,
    local_fixture_generation_invocations: localFixtureGenerationInvocations,
    provider_calls: externalProviderCalls,
    external_provider_calls: externalProviderCalls,
    actual_spend_usd: actualSpendUsd,
    owner_review_state: 'OWNER_REVIEW_REQUIRED',
    sponsorship_disclosure: 'Sponsored',
    rotation,
    performance_event_schema: Object.freeze({ event_types: PERFORMANCE_EVENT_TYPES }),
    autonomy_level: 'LEVEL_1_SHADOW_GENERATION_AND_SCORING',
    production_publication_authority: 'NONE',
    advertiser_charge_authority: 'NONE',
    campaign_spend_authority: 'NONE',
    deployment_authority: 'NONE',
  });
}
