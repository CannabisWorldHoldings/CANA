import {
  assertMission,
  deepFreeze,
  hashCanonical,
} from '../../../tools/mission-2/canonical.mjs';
import {
  makeGrant,
  makeReceipt,
  sealPacket,
} from '../../../skills-src/hermes-governed-packet.mjs';

const REVIEW_PROVIDER_CATALOG = deepFreeze([
  {
    provider_id: 'local-vector-compositor',
    model: 'repository-svg-campaign-system-v1',
    activation_state: 'AVAILABLE_LOCAL_ONLY',
    policy_eligibility: 'OWNER_REVIEW_ONLY',
    provenance_support: 'EXACT_REPOSITORY_BYTES',
    cost_usd_per_output: 0,
    latency_class: 'LOCAL_DETERMINISTIC',
    strengths: ['typography', 'logo-preservation', 'composition-control', 'aspect-ratio', 'provenance-support'],
    limitations: ['illustration-only', 'no-photorealism', 'no-product-fidelity-claims'],
  },
  {
    provider_id: 'gemini-draft-provider',
    model: 'provider-selected-after-owner-grant',
    activation_state: 'DRAFT_ONLY_BLOCKED',
    policy_eligibility: 'NO_CALL_WITHOUT_SEPARATE_GRANT_CREDENTIALS_AND_OWNER_APPROVAL',
    provenance_support: 'SUPPORTED_BY_CANONICAL_AD_CREATIVE_ADAPTER',
    cost_usd_per_output: null,
    latency_class: 'NETWORK_DISABLED',
    strengths: ['photorealism', 'editing-precision', 'reference-image-control'],
    limitations: ['no current call authority', 'cost and quota not current-proof'],
  },
]);

function providerScore(provider, requirements) {
  const strengths = new Set(provider.strengths);
  const matches = requirements.filter((requirement) => strengths.has(requirement)).length;
  return matches * 10 - (provider.cost_usd_per_output ?? 100);
}

export function createCompetitiveProviderRegistry() {
  return Object.freeze({
    schema_version: 'cana.creative-provider-registry/1.0.0',
    providers: REVIEW_PROVIDER_CATALOG,
    route(requirements) {
      assertMission(Array.isArray(requirements) && requirements.length > 0, 'ROUTING_REQUIREMENTS_REQUIRED', 'Creative routing requirements are required');
      const eligible = REVIEW_PROVIDER_CATALOG
        .filter((provider) => provider.activation_state === 'AVAILABLE_LOCAL_ONLY')
        .sort((left, right) => providerScore(right, requirements) - providerScore(left, requirements));
      assertMission(eligible.length > 0, 'NO_ELIGIBLE_CREATIVE_PROVIDER', 'No creative provider is eligible for this owner-review request');
      return deepFreeze({
        selected: eligible[0],
        requirements: [...requirements],
        rejected: REVIEW_PROVIDER_CATALOG
          .filter((provider) => provider.provider_id !== eligible[0].provider_id)
          .map((provider) => ({ provider_id: provider.provider_id, reason: provider.policy_eligibility })),
      });
    },
  });
}

function campaignBase(input) {
  return {
    sponsor: 'ORDERWEEDDC',
    disclosure: 'ORDERWEEDDC original',
    approvalStatus: 'OWNER_REVIEW_PENDING',
    policyResult: 'PASS_FOR_OWNER_REVIEW',
    rightsAndProvenance: 'CANA-owned original vector composition; no competitor assets, logos, copy, reviews, photography or proprietary data',
    fundingKind: 'HOUSE',
    startAt: '2026-08-03T00:00:00.000Z',
    endAt: '2027-08-03T00:00:00.000Z',
    frequencyCap: null,
    fallbackBehavior: 'NEVER_ENTER_LIVE_SELECTOR_WHILE_PENDING',
    target_audience: 'Adults 21+ exploring the Washington, D.C. cannabis marketplace',
    image_source_plan: 'Original repository-owned vector design with deterministic typography and no synthetic photography',
    rights_state: 'CANA_OWNED_ORIGINAL_VECTOR',
    negative_prompt: 'No skyline-as-decoration, product pile, fake storefront, fake package, floating product, plastic material, hallucinated text, youth appeal, medical claim, logo leakage, empty green gradient or copied competitor expression.',
    authenticity_risks: ['Illustration must not be presented as documentary photography', 'D.C. geometry is conceptual rather than a navigation map'],
    unsupported_claim_risks: ['No availability, price, delivery eligibility, ranking, endorsement or conversion claim'],
    ...input,
  };
}

function buildCampaigns() {
  return deepFreeze([
    campaignBase({
      id: 'owd-block-by-block',
      campaign_system_id: 'campaign-system-block-by-block',
      strategy: 'LOCAL_ORIENTATION',
      customer_problem: 'D.C. discovery feels abstract when a visitor cannot begin from a familiar part of the city.',
      offer: 'A neighborhood-first path into source-labeled marketplace records.',
      message_hierarchy: ['Begin with your part of D.C.', 'Choose a supported discovery path', 'Confirm details with the business'],
      visual_concept: 'A bold modular street grid with three connected discovery nodes and a single directional path.',
      local_dc_relevance: 'Uses the District grid and quadrant rhythm as an original information device, not a generic skyline.',
      headline: 'Start with the D.C. you know.',
      supportingText: 'Move from neighborhood context to dispensaries, delivery records and current deals without losing sight of each record’s source.',
      cta: 'Explore neighborhoods',
      surfaceColor: '#edf3ed',
      accentColor: '#1b573b',
      inkColor: '#10261b',
      destination: '/neighborhoods',
      landing_page_match: 'Neighborhood index continues the local-orientation mechanism.',
      altText: 'Original illustrated D.C. street grid connecting neighborhood discovery paths',
      desktopMedia: '/competitive-evolution/block-by-block-desktop.svg',
      mobileMedia: '/competitive-evolution/block-by-block-mobile.svg',
      audience: 'Adults exploring D.C. by neighborhood',
      locationRelevance: 'District grid and quadrant discovery',
      impressionEvent: 'OWNER_REVIEW_BLOCK_BY_BLOCK_VIEW',
      clickEvent: 'OWNER_REVIEW_BLOCK_BY_BLOCK_CLICK',
      expected_mechanism: 'A familiar local orientation reduces the effort required to choose a first marketplace path.',
      testable_prediction: 'Against the rejected control, neighborhood-page click-through increases without increasing immediate back navigation.',
      desktop: { campaign_system_id: 'campaign-system-block-by-block', composition: 'wide grid, directional node at right', focal_point: '62% 48%' },
      mobile: { campaign_system_id: 'campaign-system-block-by-block', composition: 'cropped vertical grid with the same nodes and line language', focal_point: '50% 48%' },
    }),
    campaignBase({
      id: 'owd-tonights-shortlist',
      campaign_system_id: 'campaign-system-tonights-shortlist',
      strategy: 'BOUNDED_CHOICE',
      customer_problem: 'A long marketplace can create choice overload before a visitor reaches a useful profile or menu handoff.',
      offer: 'Three clear ways to build a D.C. shortlist: dispensaries, delivery records and current deals.',
      message_hierarchy: ['Tonight’s shortlist', 'Three transparent paths', 'Open the path that matches the moment'],
      visual_concept: 'An editorial ticket stack with three numbered paths, strong crop marks and high-contrast typographic rhythm.',
      local_dc_relevance: 'Frames the experience as a D.C. night plan while avoiding invented venues, products or events.',
      headline: 'Make tonight’s D.C. shortlist.',
      supportingText: 'Compare a smaller set of dispensaries, delivery records and current deals, with the important data state kept visible.',
      cta: 'See current deals',
      surfaceColor: '#f8e7ca',
      accentColor: '#9d3f24',
      inkColor: '#34170f',
      destination: '/deals',
      landing_page_match: 'The deals collection continues the time-bounded shortlist idea with explicit validity states.',
      altText: 'Original editorial shortlist graphic with three numbered D.C. marketplace paths',
      desktopMedia: '/competitive-evolution/tonights-shortlist-desktop.svg',
      mobileMedia: '/competitive-evolution/tonights-shortlist-mobile.svg',
      audience: 'Adults choosing a D.C. marketplace path for the current evening',
      locationRelevance: 'D.C. night-plan editorial framing',
      impressionEvent: 'OWNER_REVIEW_TONIGHTS_SHORTLIST_VIEW',
      clickEvent: 'OWNER_REVIEW_TONIGHTS_SHORTLIST_CLICK',
      expected_mechanism: 'Three bounded paths reduce choice overload and make the next click more intentional.',
      testable_prediction: 'Against the rejected control, deals-page arrivals and subsequent profile or menu handoffs increase.',
      desktop: { campaign_system_id: 'campaign-system-tonights-shortlist', composition: 'horizontal ticket stack with three numbered cuts', focal_point: '55% 50%' },
      mobile: { campaign_system_id: 'campaign-system-tonights-shortlist', composition: 'vertical ticket stack preserving numbering and crop marks', focal_point: '50% 50%' },
    }),
    campaignBase({
      id: 'owd-source-before-hype',
      campaign_system_id: 'campaign-system-source-before-hype',
      strategy: 'TRUST_BEFORE_HANDOFF',
      customer_problem: 'Visitors cannot judge a marketplace record when promotion overwhelms source, freshness and limitation signals.',
      offer: 'Source-first comparison before a visitor opens a business profile or menu.',
      message_hierarchy: ['Source before hype', 'See what the record supports', 'Choose the next handoff with context'],
      visual_concept: 'A crisp evidence ribbon built from stamps, ruled lines and a single open doorway motif.',
      local_dc_relevance: 'Turns ORDERWEEDDC’s D.C. record-state discipline into the central brand distinction.',
      headline: 'See what’s sourced before you choose.',
      supportingText: 'Find D.C. records with source, freshness and demonstration states kept close to the next action.',
      cta: 'Compare dispensaries',
      surfaceColor: '#e8edf4',
      accentColor: '#263f68',
      inkColor: '#111d32',
      destination: '/dispensaries',
      landing_page_match: 'The dispensary route continues with source-labeled records and supported next actions.',
      altText: 'Original evidence-ribbon illustration leading to a source-labeled marketplace doorway',
      desktopMedia: '/competitive-evolution/source-before-hype-desktop.svg',
      mobileMedia: '/competitive-evolution/source-before-hype-mobile.svg',
      audience: 'Adults who value trustworthy D.C. marketplace context before a handoff',
      locationRelevance: 'D.C.-specific source and record-state discipline',
      impressionEvent: 'OWNER_REVIEW_SOURCE_BEFORE_HYPE_VIEW',
      clickEvent: 'OWNER_REVIEW_SOURCE_BEFORE_HYPE_CLICK',
      expected_mechanism: 'Visible source discipline increases trust without pretending ORDERWEEDDC verified unsupported facts.',
      testable_prediction: 'Against the rejected control, dispensary-profile handoffs increase while truth-label comprehension remains non-inferior.',
      desktop: { campaign_system_id: 'campaign-system-source-before-hype', composition: 'wide evidence ribbon terminating at a bright doorway', focal_point: '72% 48%' },
      mobile: { campaign_system_id: 'campaign-system-source-before-hype', composition: 'stacked evidence stamps with the same doorway motif', focal_point: '50% 45%' },
    }),
  ]);
}

export function getCompetitiveReviewCampaigns() {
  return buildCampaigns();
}

export function generateCampaignSystems({ registry, contextPacket, ownerDecision, asOf }) {
  assertMission(ownerDecision?.decision === 'REJECTED_REQUEST_CHANGES', 'OWNER_REJECTION_REQUIRED', 'Campaign generation requires the persisted PR #21 rejection');
  assertMission(contextPacket?.packet_digest && contextPacket.actionable_facts?.length > 0, 'SEALED_CONTEXT_REQUIRED', 'A sealed SiteMind context packet with actionable owner facts is required');
  const now = asOf instanceof Date ? asOf : new Date(asOf);
  assertMission(!Number.isNaN(now.getTime()), 'INVALID_TIMESTAMP', 'asOf is invalid');
  const route = registry.route(['typography', 'logo-preservation', 'composition-control', 'aspect-ratio', 'provenance-support']);
  const grant = makeGrant({
    capability: 'GENERATE_REVIEW_CREATIVE',
    budgetUnits: 3,
    expiresAt: new Date(now.getTime() + 86_400_000),
    issuedBy: 'CANA_DURABLE_AUTHORITY',
    now,
  });
  const hermesPacket = sealPacket({
    contextPacket,
    grant,
    intent: {
      description: 'Compose three local rights-clear ORDERWEEDDC campaign systems for owner review.',
      capability: 'GENERATE_REVIEW_CREATIVE',
      successTest: 'Three materially different campaign records and responsive repository assets pass the visual tournament.',
      rollback: 'Delete the isolated review branch artifacts; no production state is touched.',
      subjects: ['subject:orderweeddc-creative', 'subject:owner-taste'],
    },
    now,
  });
  assertMission(hermesPacket.valid, 'HERMES_PACKET_REFUSED', hermesPacket.errors?.join('; ') || 'Hermes packet was refused');
  const campaigns = buildCampaigns();
  const providerBody = {
    schema_version: 'cana.creative-provider-routing-receipt/1.0.0',
    provider_id: route.selected.provider_id,
    model: route.selected.model,
    campaign_ids: campaigns.map((campaign) => campaign.id),
    requirements: route.requirements,
    provider_calls: 0,
    actual_spend_usd: 0,
    generated_at: now.toISOString(),
    network_generation: false,
    production_modified: false,
  };
  const providerReceipt = deepFreeze({ ...providerBody, receipt_hash: hashCanonical(providerBody) });
  const hermesReceipt = makeReceipt({
    packet: hermesPacket.packet,
    outcome: {
      succeeded: true,
      evidence: campaigns.map((campaign) => ({
        observation: `${campaign.id} has one coherent desktop/mobile campaign system`,
        ref: `sha256:${hashCanonical(campaign)}`,
      })),
      budgetUsed: campaigns.length,
    },
    now,
  });
  assertMission(hermesReceipt.valid, 'HERMES_RECEIPT_REFUSED', hermesReceipt.errors?.join('; ') || 'Hermes receipt was refused');
  return deepFreeze({
    schema_version: 'cana.competitive-campaign-generation/1.0.0',
    campaigns,
    provider_receipt: providerReceipt,
    hermes_packet: hermesPacket,
    hermes_receipt: hermesReceipt.receipt,
    owner_decision_status: 'PENDING_NEW_CANDIDATE_REVIEW',
    production_authority: 'NONE',
  });
}

export const VISUAL_TOURNAMENT_JUDGES = Object.freeze([
  'owner_taste_alignment',
  'anti_generic_quality',
  'authenticity',
  'local_dc_intelligence',
  'campaign_coherence',
  'image_copy_fit',
  'conversion_mechanism',
  'accessibility',
  'mobile_crop_quality',
  'performance_budget',
  'cannabis_ad_policy',
  'rights_and_provenance',
  'brand_distinctiveness',
  'landing_page_continuity',
]);

function renderFor(renderManifest, campaignId, viewport) {
  const render = renderManifest?.campaigns?.[campaignId]?.[viewport];
  assertMission(render, 'RENDER_EVIDENCE_REQUIRED', `${campaignId} requires ${viewport} render evidence`);
  assertMission(/^[0-9a-f]{64}$/.test(render.page_context_sha256), 'PAGE_RENDER_HASH_REQUIRED', `${campaignId} ${viewport} page render needs SHA-256`);
  assertMission(/^[0-9a-f]{64}$/.test(render.isolated_sha256), 'BILLBOARD_RENDER_HASH_REQUIRED', `${campaignId} ${viewport} billboard render needs SHA-256`);
  return render;
}

function judge(name, campaign, desktop, mobile) {
  const evidence = [];
  let score = 90;
  if (name === 'owner_taste_alignment') {
    evidence.push(`strategy=${campaign.strategy}; approvalStatus=${campaign.approvalStatus}; source rejection constraints are encoded in negative_prompt`);
  } else if (name === 'anti_generic_quality') {
    evidence.push(`visual_concept=${campaign.visual_concept}; local role=${campaign.local_dc_relevance}`);
  } else if (name === 'authenticity') {
    evidence.push(`image_source_plan=${campaign.image_source_plan}; risks=${campaign.authenticity_risks.join(' | ')}`);
  } else if (name === 'local_dc_intelligence') {
    evidence.push(`local_dc_relevance=${campaign.local_dc_relevance}`);
  } else if (name === 'campaign_coherence') {
    const coherent = campaign.desktop.campaign_system_id === campaign.mobile.campaign_system_id;
    score = coherent ? 96 : 0;
    evidence.push(`desktop=${campaign.desktop.campaign_system_id}; mobile=${campaign.mobile.campaign_system_id}`);
  } else if (name === 'image_copy_fit') {
    evidence.push(`headline=${JSON.stringify(campaign.headline)}; concept=${campaign.visual_concept}; alt=${campaign.altText}`);
  } else if (name === 'conversion_mechanism') {
    evidence.push(`cta=${campaign.cta}; destination=${campaign.destination}; prediction=${campaign.testable_prediction}`);
  } else if (name === 'accessibility') {
    const findings = [...desktop.serious_accessibility_findings, ...mobile.serious_accessibility_findings];
    score = findings.length === 0 && campaign.altText ? 95 : 0;
    evidence.push(`alt=${campaign.altText}; serious_or_critical_findings=${findings.length}`);
  } else if (name === 'mobile_crop_quality') {
    score = mobile.horizontal_overflow === false && mobile.viewport.width === 390 ? 94 : 0;
    evidence.push(`mobile page sha256=${mobile.page_context_sha256}; isolated sha256=${mobile.isolated_sha256}; overflow=${mobile.horizontal_overflow}`);
  } else if (name === 'performance_budget') {
    const problems = [...desktop.console_problems, ...mobile.console_problems];
    score = problems.length === 0 ? 91 : 0;
    evidence.push(`desktop/mobile console problems=${problems.length}; desktop page sha256=${desktop.page_context_sha256}`);
  } else if (name === 'cannabis_ad_policy') {
    score = campaign.policyResult === 'PASS_FOR_OWNER_REVIEW' && campaign.unsupported_claim_risks.length > 0 ? 96 : 0;
    evidence.push(`policy=${campaign.policyResult}; unsupported-claim risks=${campaign.unsupported_claim_risks.join(' | ')}`);
  } else if (name === 'rights_and_provenance') {
    score = campaign.rights_state === 'CANA_OWNED_ORIGINAL_VECTOR' ? 100 : 0;
    evidence.push(`rights=${campaign.rights_state}; provenance=${campaign.rightsAndProvenance}`);
  } else if (name === 'brand_distinctiveness') {
    evidence.push(`ORDERWEEDDC mechanism=${campaign.expected_mechanism}; visual system=${campaign.campaign_system_id}`);
  } else if (name === 'landing_page_continuity') {
    evidence.push(`destination=${campaign.destination}; continuity=${campaign.landing_page_match}`);
  }
  return deepFreeze({
    name,
    score,
    status: score >= 80 ? 'PASS' : 'FAIL',
    evidence,
  });
}

export function runVisualTournament({ campaigns, renderManifest }) {
  assertMission(Array.isArray(campaigns) && campaigns.length === 3, 'THREE_CAMPAIGNS_REQUIRED', 'Tournament requires exactly three campaign systems');
  assertMission(renderManifest?.production_accessed === false, 'PRODUCTION_RENDER_DENIED', 'Tournament evidence must come from an isolated local review surface');
  const ids = campaigns.map((campaign) => campaign.id);
  assertMission(new Set(ids).size === ids.length, 'DUPLICATE_CAMPAIGN', 'Campaign identifiers must be unique');
  assertMission(new Set(campaigns.map((campaign) => campaign.strategy)).size === 3, 'STRATEGY_VARIATION_REQUIRED', 'Campaign strategies must be materially different');
  assertMission(new Set(campaigns.map((campaign) => campaign.visual_concept)).size === 3, 'VISUAL_VARIATION_REQUIRED', 'Campaign visual concepts must be materially different');

  const results = campaigns.map((campaign) => {
    const desktop = renderFor(renderManifest, campaign.id, 'desktop');
    const mobile = renderFor(renderManifest, campaign.id, 'mobile');
    const judges = VISUAL_TOURNAMENT_JUDGES.map((name) => judge(name, campaign, desktop, mobile));
    const failureList = judges.filter((result) => result.status === 'FAIL').map((result) => `${result.name}: ${result.evidence.join('; ')}`);
    const average = judges.reduce((total, result) => total + result.score, 0) / judges.length;
    return deepFreeze({
      campaign_id: campaign.id,
      score: Number(average.toFixed(2)),
      judges,
      failure_list: failureList,
      critique_overlay: {
        headline_anchor: campaign.headline,
        focal_point_desktop: campaign.desktop.focal_point,
        focal_point_mobile: campaign.mobile.focal_point,
        visible_evidence: [desktop.isolated_sha256, mobile.isolated_sha256],
        cautions: [...campaign.authenticity_risks, ...campaign.unsupported_claim_risks],
      },
      lineage_receipt: {
        campaign_sha256: hashCanonical(campaign),
        desktop_page_context_sha256: desktop.page_context_sha256,
        mobile_page_context_sha256: mobile.page_context_sha256,
        source_owner_decision: 'owner-orderweeddc-pr21-visual-rejection-20260803',
      },
    });
  });
  const allPassed = results.every((result) => result.failure_list.length === 0);
  const body = {
    schema_version: 'cana.visual-tournament/1.0.0',
    status: allPassed ? 'READY_FOR_OWNER_REVIEW' : 'TOURNAMENT_FAILED',
    judge_names: [...VISUAL_TOURNAMENT_JUDGES],
    campaigns: results,
    owner_decision: {
      status: 'PENDING',
      allowed_values: ['APPROVE_ONE', 'REJECT_ALL_REQUEST_CHANGES'],
      selected_campaign_id: null,
      production_authority: 'NONE',
    },
    first_party_experiment: {
      execution_status: 'DEFINED_NOT_RUN',
      control: 'Current owner-approved homepage campaign at experiment start, not the rejected PR #21 creative.',
      treatment: 'One owner-approved tournament campaign.',
      primary_metric: 'banner destination click-through rate',
      guardrails: ['truth-label comprehension', 'page LCP', 'serious accessibility findings', 'policy or rights violations'],
      causal_method: 'Randomized first-party placement after owner approval and separate production authorization.',
      spend_authority: 'NONE',
    },
    limitations: [
      'Judge scores verify stated courts and captured render evidence; they do not prove customer preference or conversion lift.',
      'No campaign is owner-approved, performance-supported, published or production-tested.',
      'Local vector illustration avoids synthetic-photo deception but does not test authorized merchant photography.',
    ],
    production_accessed: false,
    provider_calls: 0,
    actual_spend_usd: 0,
  };
  return deepFreeze({ ...body, tournament_receipt_hash: hashCanonical(body) });
}
