#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import {
  COMPETITIVE_EVOLUTION_SCHEMAS,
  PR21_OWNER_REJECTION,
  PR21_PREFERENCE_PAIR,
  adaptScheduledTaskHandoff,
  buildCompetitorEvidenceReceipt,
  buildLearningReceipt,
  compileCompetitiveContext,
  createCompetitorEventLedger,
  extractCompetitorMechanism,
  ingestPr21OwnerPacket,
  retrieveOwnerTaste,
  routeCrawlCadence,
} from '../../apps/web/src/lib/sitemind-competitive-evolution.mjs';
import {
  createCompetitiveProviderRegistry,
  generateCampaignSystems,
  runVisualTournament,
} from '../../packages/ad-creative/src/competitive-campaigns.mjs';

const TERMINAL_MARKER = 'ORDERWEEDDC_SITEMIND_COMPETITOR_TO_CREATIVE_EVOLUTION_TOURNAMENT_READY_FOR_OWNER_REVIEW';
const asOf = new Date('2026-08-03T14:00:00.000Z');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtureSignal() {
  return {
    schema_version: 'cana.growth-watch-signal-packet/1.0.0',
    signal_id: 'fixture_growth_watch_marketplace_mechanism_20260803',
    entity_id: 'fixture_public_marketplace',
    competitor_id: 'fixture_public_marketplace',
    candidate_urls: ['https://example.com/public-marketplace-fixture'],
    claims: ['A bounded local shortlist can precede a menu handoff.'],
    source_dates: [asOf.toISOString()],
    novelty: 0.8,
    uncertainty: 0.25,
    observed_at: asOf.toISOString(),
    evidence_class: 'OFFLINE_ADAPTER_FIXTURE_NOT_CURRENT_COMPETITOR_CLAIM',
  };
}

function fixtureCrawl() {
  return {
    schema_version: 'cana.competitor-crawl-observation/1.0.0',
    crawl_id: 'fixture_crawl_marketplace_mechanism_20260803',
    baseline_id: 'fixture_baseline_marketplace_mechanism_20260727',
    entity_id: 'fixture_public_marketplace',
    competitor_id: 'fixture_public_marketplace',
    surface_id: 'offline-adapter-contract',
    url: 'https://example.com/public-marketplace-fixture',
    captured_at: asOf.toISOString(),
    before_content_sha256: sha256('fixture-before-content'),
    after_content_sha256: sha256('fixture-after-content'),
    before_screenshot_sha256: sha256('fixture-before-screenshot'),
    after_screenshot_sha256: sha256('fixture-after-screenshot'),
    dom_diff: { changed_sections: ['fixture decision sequence'] },
    visual_diff: { changed_regions: ['fixture local orientation'] },
    semantic_diff: { added: ['fixture bounded shortlist before handoff'] },
    asset_diff: { added: [], removed: [] },
    seo_diff: { changed: [] },
    funnel_diff: { changed: ['fixture discovery-to-handoff sequence'] },
    ad_creative_diff: { changed: ['fixture local-value framing'] },
    policy_context: { state: 'OFFLINE_FIXTURE_ONLY' },
    direct_observation: 'The offline adapter fixture presents local orientation before a bounded marketplace handoff.',
    inference: 'The sequence may reduce choice overload; no competitor adoption or outcome is claimed.',
    uncertainty: 0.25,
    confidence: 0.85,
    evidence_locations: [`sha256:${sha256('fixture-adapter-evidence')}`],
    rights_state: 'REFERENCE_ONLY',
    prompt_injection_state: 'SCANNED_NO_AUTHORITY',
    importance_score: 0.8,
    change_type: 'OFFLINE_ADAPTER_VALIDATION',
  };
}

function contactSheetHtml(campaigns, outputRoot) {
  const cards = campaigns.map((campaign) => {
    const renderRoot = path.join(outputRoot, 'renders');
    const desktop = fs.readFileSync(path.join(renderRoot, `${campaign.id}-desktop-billboard.png`)).toString('base64');
    const mobile = fs.readFileSync(path.join(renderRoot, `${campaign.id}-mobile-billboard.png`)).toString('base64');
    return `<article>
      <header><span>${campaign.strategy.replaceAll('_', ' ')}</span><h2>${campaign.headline}</h2><p>${campaign.supportingText}</p></header>
      <div class="renders"><figure><img src="data:image/png;base64,${desktop}" alt="${campaign.altText}, desktop render"><figcaption>Desktop homepage billboard</figcaption></figure><figure class="mobile"><img src="data:image/png;base64,${mobile}" alt="${campaign.altText}, mobile render"><figcaption>Mobile homepage billboard</figcaption></figure></div>
      <footer><strong>${campaign.cta}</strong><span>${campaign.destination}</span></footer>
    </article>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>ORDERWEEDDC campaign tournament</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eef0ec;color:#101511;font:15px/1.45 Arial,sans-serif}main{width:1520px;margin:0 auto;padding:44px}h1{font-size:42px;line-height:1.05;margin:8px 0 14px;max-width:1000px}.kicker{color:#12613c;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.decision{background:#fff;padding:24px 28px;border-radius:16px;margin:28px 0 34px;display:flex;gap:28px;align-items:center}.decision strong{margin-right:auto}.decision label{font-weight:700}.decision button{border:0;border-radius:8px;background:#12613c;color:#fff;padding:12px 18px;font-weight:800}article{background:#fff;border-radius:20px;padding:28px;margin:0 0 30px}article header span{font-size:12px;font-weight:800;letter-spacing:.14em;color:#12613c}h2{font-size:30px;margin:8px 0}article header p{max-width:880px;color:#59645d}.renders{display:grid;grid-template-columns:1fr 300px;gap:24px;align-items:start;margin-top:24px}figure{margin:0}img{display:block;width:100%;height:auto;border-radius:12px;background:#ddd}.mobile img{max-height:520px;object-fit:contain}figcaption{font-size:12px;color:#68716b;margin-top:8px}footer{display:flex;gap:18px;margin-top:20px;color:#12613c}footer span{color:#68716b}.note{color:#59645d;max-width:1000px}</style></head><body><main><p class="kicker">Owner review · decision pending</p><h1>Three original ORDERWEEDDC campaign systems</h1><p class="note">Each pair is captured inside the actual homepage at desktop and mobile sizes. No campaign is approved, published, deployed, performance-proven or authorized to spend.</p><form class="decision" id="decision"><strong>Record an offline review decision</strong>${campaigns.map((campaign) => `<label><input type="radio" name="decision" value="APPROVE_ONE:${campaign.id}"> ${campaign.strategy.replaceAll('_', ' ')}</label>`).join('')}<label><input type="radio" name="decision" value="REJECT_ALL_REQUEST_CHANGES"> Reject all</label><button type="submit">Download decision</button></form>${cards}</main><script>document.getElementById('decision').addEventListener('submit',event=>{event.preventDefault();const selected=new FormData(event.currentTarget).get('decision');if(!selected)return;const payload={schema_version:'cana.owner-campaign-decision/1.0.0',status:selected.startsWith('APPROVE_ONE:')?'APPROVE_ONE':'REJECT_ALL_REQUEST_CHANGES',selected_campaign_id:selected.split(':')[1]||null,recorded_at:new Date().toISOString(),production_authority:'NONE'};const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\\n'],{type:'application/json'}));link.download='owner-campaign-decision.json';link.click();URL.revokeObjectURL(link.href)});</script></body></html>`;
}

async function renderContactSheet(campaigns, outputRoot) {
  const html = contactSheetHtml(campaigns, outputRoot);
  const htmlPath = path.join(outputRoot, 'owner-review.html');
  fs.writeFileSync(htmlPath, html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(outputRoot, 'owner-review-contact-sheet.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}

const ownerPacket = argument('owner-packet');
const outputInput = argument('output');
if (!ownerPacket || !outputInput) {
  throw new Error('Usage: run-pr21-vertical-slice.mjs --owner-packet <directory> --output <directory>');
}
const outputRoot = path.resolve(outputInput);
const renderManifestPath = path.join(outputRoot, 'renders', 'render-manifest.json');
if (!fs.existsSync(renderManifestPath)) throw new Error(`Actual-homepage render manifest is required: ${renderManifestPath}`);
const renderManifest = JSON.parse(fs.readFileSync(renderManifestPath, 'utf8'));
if (renderManifest.status !== 'PASS' || renderManifest.production_accessed !== false) {
  throw new Error('Render manifest must be a passing local-only capture.');
}

const ingest = ingestPr21OwnerPacket({ packetDirectory: ownerPacket, outputDirectory: outputRoot });
const signal = fixtureSignal();
const crawl = fixtureCrawl();
const signalHandoff = adaptScheduledTaskHandoff({
  taskName: 'CANA Sovereign Growth Watch', runId: 'offline-growth-adapter-20260803', producedAt: signal.observed_at, payload: signal,
});
const crawlHandoff = adaptScheduledTaskHandoff({
  taskName: 'Competitor Crawl Intelligence', runId: 'offline-crawler-adapter-20260803', producedAt: crawl.captured_at, payload: crawl,
});
const ledger = createCompetitorEventLedger({ rootDirectory: outputRoot, tenantId: 'orderweeddc', workspaceId: 'homepage' });
const event = ledger.fuse({ growthWatchPacket: signalHandoff.payload, crawlObservation: crawlHandoff.payload });
const evidenceReceipt = buildCompetitorEvidenceReceipt(event);
const cadence = routeCrawlCadence({ changeRate: 0.7, importanceScore: 0.8, failureRate: 0.05, evidenceQuality: 0.9 });
const mechanism = extractCompetitorMechanism(crawl, {
  currentCapability: 'ORDERWEEDDC exposes source and record state before marketplace handoff.',
  adjacentPattern: 'Travel and editorial shortlists can reduce choice overload without copying their expression.',
});
const context = compileCompetitiveContext({ mechanism, ownerDecisionObservedAt: PR21_OWNER_REJECTION.observed_at });
const generation = generateCampaignSystems({
  registry: createCompetitiveProviderRegistry(),
  contextPacket: context.packet,
  ownerDecision: PR21_OWNER_REJECTION,
  asOf,
});
const tournament = runVisualTournament({ campaigns: generation.campaigns, renderManifest });
const learning = buildLearningReceipt({
  ownerDecision: { ...PR21_OWNER_REJECTION, status: PR21_OWNER_REJECTION.decision },
  tournamentStatus: tournament.status,
  candidateDecision: tournament.owner_decision,
  asOf,
});
const retrieval = retrieveOwnerTaste({ learningReceipts: [learning], generation: 2 });

writeJson(path.join(outputRoot, 'schemas.json'), COMPETITIVE_EVOLUTION_SCHEMAS);
writeJson(path.join(outputRoot, 'bridge', 'growth-watch-signal.json'), signal);
writeJson(path.join(outputRoot, 'bridge', 'crawler-observation.json'), crawl);
writeJson(path.join(outputRoot, 'bridge', 'growth-watch-handoff.json'), signalHandoff);
writeJson(path.join(outputRoot, 'bridge', 'crawler-handoff.json'), crawlHandoff);
writeJson(path.join(outputRoot, 'bridge', 'fused-event.json'), event);
writeJson(path.join(outputRoot, 'bridge', 'evidence-receipt.json'), evidenceReceipt);
writeJson(path.join(outputRoot, 'bridge', 'cadence-routing.json'), cadence);
writeJson(path.join(outputRoot, 'bridge', 'mechanism.json'), mechanism);
writeJson(path.join(outputRoot, 'bridge', 'sitemind-context.json'), context);
writeJson(path.join(outputRoot, 'rejected-creative-genome.json'), {
  schema_version: 'cana.rejected-creative-genome/1.0.0',
  candidate: PR21_OWNER_REJECTION.candidate,
  desktop_evidence: ingest.evidence.desktop,
  mobile_evidence: ingest.evidence.mobile,
  rejection_tags: PR21_OWNER_REJECTION.rejection_tags,
  failure_mechanisms: PR21_OWNER_REJECTION.reasons,
  reusable_expression: [],
  mechanism_only_learning: PR21_PREFERENCE_PAIR.desired,
});
writeJson(path.join(outputRoot, 'provider-routing-receipt.json'), generation.provider_receipt);
writeJson(path.join(outputRoot, 'hermes-packet.json'), generation.hermes_packet);
writeJson(path.join(outputRoot, 'hermes-receipt.json'), generation.hermes_receipt);
writeJson(path.join(outputRoot, 'tournament.json'), tournament);
writeJson(path.join(outputRoot, 'first-party-experiment-defined-not-run.json'), tournament.first_party_experiment);
writeJson(path.join(outputRoot, 'learning-receipt.json'), learning);
writeJson(path.join(outputRoot, 'next-generation-retrieval.json'), retrieval);
writeJson(path.join(outputRoot, 'owner-decision-control.json'), tournament.owner_decision);

for (const campaign of generation.campaigns) {
  const score = tournament.campaigns.find((entry) => entry.campaign_id === campaign.id);
  const campaignRoot = path.join(outputRoot, 'campaigns', campaign.id);
  writeJson(path.join(campaignRoot, 'creative-record.json'), campaign);
  writeJson(path.join(campaignRoot, 'tournament-scorecard.json'), score.judges);
  writeJson(path.join(campaignRoot, 'failure-list.json'), score.failure_list);
  writeJson(path.join(campaignRoot, 'critique-overlay.json'), score.critique_overlay);
  writeJson(path.join(campaignRoot, 'lineage-receipt.json'), score.lineage_receipt);
  const assets = [campaign.desktopMedia, campaign.mobileMedia].map((media) => {
    const assetPath = path.join(process.cwd(), 'apps/web/public', media);
    return {
      asset_id: media,
      asset_sha256: sha256(fs.readFileSync(assetPath)),
      source_kind: 'REPOSITORY_ORIGINAL_VECTOR',
      rights_state: campaign.rights_state,
      training_eligibility: 'CANA_OWNED_REVIEW_ASSET',
      competitor_expression_copied: false,
      verified_at: asOf.toISOString(),
    };
  });
  writeJson(path.join(campaignRoot, 'rights-provenance.json'), assets);
}

await renderContactSheet(generation.campaigns, outputRoot);
writeJson(path.join(outputRoot, 'limitations.json'), {
  schema_version: 'cana.competitive-evolution-limitations/1.0.0',
  limitations: tournament.limitations,
  adapter_fixture: 'The bridge proof uses an offline contract fixture and makes no current competitor adoption or performance claim.',
  owner_decision: 'PENDING',
  production_authority: 'NONE',
});
writeJson(path.join(outputRoot, 'vertical-slice-receipt.json'), {
  schema_version: 'cana.pr21-competitive-evolution-vertical-slice/1.0.0',
  status: 'PASSED',
  terminal_marker: TERMINAL_MARKER,
  source_rejected_commit: PR21_OWNER_REJECTION.candidate.commit,
  candidate_state_at_run: 'WORKTREE_RENDER_AND_TOURNAMENT_EVIDENCE_PRECEDES_FINAL_REVIEW_COMMIT',
  owner_rejection_persisted: ingest.status,
  competitor_event_ledger: ledger.verify(),
  tournament_status: tournament.status,
  campaign_ids: generation.campaigns.map((campaign) => campaign.id),
  render_screenshot_count: renderManifest.screenshot_count,
  owner_decision_status: tournament.owner_decision.status,
  first_party_experiment_status: tournament.first_party_experiment.execution_status,
  provider_calls: generation.provider_receipt.provider_calls,
  actual_spend_usd: generation.provider_receipt.actual_spend_usd,
  production_accessed: false,
  merged: false,
  deployed: false,
});

console.log(JSON.stringify({
  status: tournament.status,
  terminal_marker: TERMINAL_MARKER,
  owner_decision_status: tournament.owner_decision.status,
  campaigns: generation.campaigns.map((campaign) => campaign.id),
  output: outputRoot,
}, null, 2));
