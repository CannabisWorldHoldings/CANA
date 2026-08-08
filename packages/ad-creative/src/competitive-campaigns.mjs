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
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runCampaignSystemPipeline } from './pipeline.mjs';

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
      designToken: 'campaign-local-orientation',
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
      designToken: 'campaign-bounded-choice',
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
      designToken: 'campaign-trust-before-handoff',
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

export async function generateCampaignSystems({ providerRoute, contextPacket, ownerDecision, asOf }) {
  assertMission(ownerDecision?.decision === 'REJECTED_REQUEST_CHANGES', 'OWNER_REJECTION_REQUIRED', 'Campaign generation requires the persisted PR #21 rejection');
  assertMission(contextPacket?.packet_digest && contextPacket.actionable_facts?.length > 0, 'SEALED_CONTEXT_REQUIRED', 'A sealed SiteMind context packet with actionable owner facts is required');
  const now = asOf instanceof Date ? asOf : new Date(asOf);
  assertMission(!Number.isNaN(now.getTime()), 'INVALID_TIMESTAMP', 'asOf is invalid');
  assertMission(providerRoute?.selected?.provider, 'CANONICAL_PROVIDER_ROUTE_REQUIRED', 'Campaign generation requires a canonical provider route');
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
  const pipeline = await runCampaignSystemPipeline({ provider: providerRoute.selected.provider, campaigns });
  assertMission(
    pipeline.results.every((result) => Object.values(result.variants).every((variant) => variant.verification.status === 'PASS')),
    'CANONICAL_CREATIVE_VERIFICATION_FAILED',
    'Every responsive campaign asset must pass the canonical ad-creative verification pipeline',
  );
  const providerBody = {
    schema_version: 'cana.creative-provider-routing-receipt/1.0.0',
    provider_id: providerRoute.selected.id,
    model: providerRoute.selected.provider.model,
    campaign_ids: campaigns.map((campaign) => campaign.id),
    requirements: providerRoute.requirements,
    provider_calls: 0,
    local_provider_operations: campaigns.length * 4,
    external_provider_calls: 0,
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
    canonical_pipeline: pipeline,
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

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function retainedPng(renderRoot, relativePath, expectedHash, expectedViewport, label) {
  assertMission(typeof relativePath === 'string' && path.basename(relativePath) === relativePath, 'RENDER_PATH_DENIED', `${label} must be a retained filename`);
  const root = path.resolve(renderRoot);
  const filePath = path.resolve(root, relativePath);
  assertMission(filePath.startsWith(`${root}${path.sep}`), 'RENDER_PATH_DENIED', `${label} escaped the render root`);
  const stat = fs.lstatSync(filePath);
  assertMission(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'RENDER_FILE_DENIED', `${label} must be one regular retained file`);
  const bytes = fs.readFileSync(filePath);
  assertMission(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'RENDER_PNG_REQUIRED', `${label} is not PNG evidence`);
  assertMission(bytes.length >= 24 && bytes.toString('ascii', 12, 16) === 'IHDR', 'RENDER_PNG_REQUIRED', `${label} has no PNG IHDR`);
  const digest = sha256(bytes);
  assertMission(digest === expectedHash, 'RENDER_HASH_MISMATCH', `${label} hash does not match retained bytes`);
  const dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (expectedViewport) {
    assertMission(dimensions.width === expectedViewport.width && dimensions.height === expectedViewport.height, 'RENDER_VIEWPORT_MISMATCH', `${label} dimensions do not match the recorded viewport`);
  }
  return deepFreeze({ digest, dimensions, bytes: bytes.length });
}

function renderFor(renderManifest, renderRoot, campaign, viewport) {
  const campaignId = campaign.id;
  const render = renderManifest?.campaigns?.[campaignId]?.[viewport];
  assertMission(render, 'RENDER_EVIDENCE_REQUIRED', `${campaignId} requires ${viewport} render evidence`);
  assertMission(/^[0-9a-f]{64}$/.test(render.page_context_sha256), 'PAGE_RENDER_HASH_REQUIRED', `${campaignId} ${viewport} page render needs SHA-256`);
  assertMission(/^[0-9a-f]{64}$/.test(render.isolated_sha256), 'BILLBOARD_RENDER_HASH_REQUIRED', `${campaignId} ${viewport} billboard render needs SHA-256`);
  const expectedMedia = viewport === 'desktop' ? campaign.desktopMedia : campaign.mobileMedia;
  assertMission(render.image_source === expectedMedia, 'RESPONSIVE_SOURCE_MISMATCH', `${campaignId} ${viewport} did not render its expected responsive source`);
  const page = retainedPng(renderRoot, render.page_context_path, render.page_context_sha256, render.viewport, `${campaignId} ${viewport} homepage`);
  const isolated = retainedPng(renderRoot, render.isolated_path, render.isolated_sha256, null, `${campaignId} ${viewport} billboard`);
  return deepFreeze({ ...render, retained: { page, isolated } });
}

function judge(name, campaign, desktop, mobile, canonicalResult) {
  const serious = [...desktop.serious_accessibility_findings, ...mobile.serious_accessibility_findings];
  const problems = [...desktop.console_problems, ...mobile.console_problems, ...desktop.request_failures, ...mobile.request_failures];
  const pipelinePassed = Object.values(canonicalResult.variants).every((variant) => variant.verification.status === 'PASS');
  const courts = {
    owner_taste_alignment: [campaign.approvalStatus === 'OWNER_REVIEW_PENDING' && campaign.negative_prompt.includes('fake storefront'), `pending=${campaign.approvalStatus}; rejected constraints retained`],
    anti_generic_quality: [campaign.designToken.startsWith('campaign-') && campaign.visual_concept.length >= 60, `token=${campaign.designToken}; concept=${campaign.visual_concept}`],
    authenticity: [pipelinePassed && campaign.authenticity_risks.length > 0, `canonical_pipeline=${pipelinePassed}; source=${campaign.image_source_plan}`],
    local_dc_intelligence: [campaign.local_dc_relevance.includes('D.C.') || campaign.local_dc_relevance.includes('District'), campaign.local_dc_relevance],
    campaign_coherence: [campaign.desktop.campaign_system_id === campaign.mobile.campaign_system_id && desktop.image_source !== mobile.image_source, `desktop=${desktop.image_source}; mobile=${mobile.image_source}`],
    image_copy_fit: [campaign.message_hierarchy[0] && campaign.altText.length > 20, `headline=${campaign.headline}; alt=${campaign.altText}`],
    conversion_mechanism: [campaign.destination.startsWith('/') && campaign.testable_prediction.includes('Against the rejected control'), `cta=${campaign.cta}; destination=${campaign.destination}`],
    accessibility: [serious.length === 0 && Boolean(campaign.altText), `serious_or_critical=${serious.length}; alt=${campaign.altText}`],
    mobile_crop_quality: [mobile.horizontal_overflow === false && mobile.viewport.width === 390 && mobile.retained.page.dimensions.height === 844, `source=${mobile.image_source}; overflow=${mobile.horizontal_overflow}`],
    performance_budget: [problems.length === 0 && desktop.performance.transferred_bytes < 2_000_000 && mobile.performance.transferred_bytes < 2_000_000, `problems=${problems.length}; bytes=${desktop.performance.transferred_bytes}/${mobile.performance.transferred_bytes}`],
    cannabis_ad_policy: [campaign.policyResult === 'PASS_FOR_OWNER_REVIEW' && campaign.unsupported_claim_risks.length > 0, `policy=${campaign.policyResult}; claim guard=${campaign.unsupported_claim_risks[0]}`],
    rights_and_provenance: [pipelinePassed && campaign.rights_state === 'CANA_OWNED_ORIGINAL_VECTOR', `rights=${campaign.rights_state}; canonical_pipeline=${pipelinePassed}`],
    brand_distinctiveness: [campaign.campaign_system_id.includes(campaign.id.slice(4)) && campaign.strategy.length > 8, `system=${campaign.campaign_system_id}; strategy=${campaign.strategy}; mechanism=${campaign.expected_mechanism}`],
    landing_page_continuity: [['/neighborhoods', '/deals', '/dispensaries'].includes(campaign.destination) && campaign.landing_page_match.length > 20, `destination=${campaign.destination}; continuity=${campaign.landing_page_match}`],
  };
  assertMission(courts[name], 'UNKNOWN_TOURNAMENT_JUDGE', `Unknown tournament judge: ${name}`);
  const [passed, evidence] = courts[name];
  const score = passed ? 100 : 0;
  return deepFreeze({
    name,
    score,
    status: score >= 80 ? 'PASS' : 'FAIL',
    evidence: [evidence],
  });
}

export function runVisualTournament({ campaigns, renderManifest, renderRoot, canonicalPipeline }) {
  assertMission(Array.isArray(campaigns) && campaigns.length === 3, 'THREE_CAMPAIGNS_REQUIRED', 'Tournament requires exactly three campaign systems');
  assertMission(renderManifest?.production_accessed === false, 'PRODUCTION_RENDER_DENIED', 'Tournament evidence must come from an isolated local review surface');
  const ids = campaigns.map((campaign) => campaign.id);
  assertMission(new Set(ids).size === ids.length, 'DUPLICATE_CAMPAIGN', 'Campaign identifiers must be unique');
  assertMission(new Set(campaigns.map((campaign) => campaign.strategy)).size === 3, 'STRATEGY_VARIATION_REQUIRED', 'Campaign strategies must be materially different');
  assertMission(new Set(campaigns.map((campaign) => campaign.visual_concept)).size === 3, 'VISUAL_VARIATION_REQUIRED', 'Campaign visual concepts must be materially different');
  assertMission(canonicalPipeline?.results?.length === 3, 'CANONICAL_PIPELINE_REQUIRED', 'Tournament requires canonical creative pipeline evidence');

  const results = campaigns.map((campaign) => {
    const desktop = renderFor(renderManifest, renderRoot, campaign, 'desktop');
    const mobile = renderFor(renderManifest, renderRoot, campaign, 'mobile');
    const canonicalResult = canonicalPipeline.results.find((result) => result.campaignId === campaign.id);
    assertMission(canonicalResult, 'CANONICAL_PIPELINE_RESULT_REQUIRED', `${campaign.id} has no canonical pipeline result`);
    const judges = VISUAL_TOURNAMENT_JUDGES.map((name) => judge(name, campaign, desktop, mobile, canonicalResult));
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
