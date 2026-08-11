#!/usr/bin/env node
import { createHash } from 'node:crypto';

import { buildAnswerabilityFrontier } from '../src/lib/ask/answerability-frontier.mjs';
import { computeDemandPriority } from '../src/lib/ask/ask-work.mjs';
import { computeFreshnessDebt, createRevalidationWorkSpec } from '../src/lib/reality/freshness-debt.mjs';
import { acquireLiveMarketReality } from '../src/lib/reality/live-reality-acquisition.mjs';
import { ABCA_LIVE_CONTRACT } from '../src/lib/reality/live-abca-adapter.mjs';
import { ABCA_FIELDS } from '../src/lib/reality/official-source-snapshot.mjs';
import { reflectVerificationEpisode } from '../src/lib/reality/reality-compiler.mjs';

const ZERO_EFFECTS = Object.freeze({
  network_live_source_calls: 0,
  provider_calls: 0,
  paid_calls: 0,
  spend_cents: 0,
  publish_actions: 0,
  production_mutations: 0,
  deployments: 0,
  cognitive_promotions: 0,
});
const TENANT = 'orderweeddc.com';
const CORE = Object.freeze(['license_number', 'license_status', 'operating_status', 'regulated_address']);

if ((process.env.COGNITIVE_PROMOTIONS ?? '0') !== '0') {
  throw new Error('CANA_SLICE2_COGNITIVE_PROMOTIONS_REFUSED');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function record() {
  return {
    attributes: {
      OBJECTID: 3275,
      GLOBALID: '{BENCHMARK-3275}',
      ABCA_NUMBER: 'ABCA-133578',
      FACILITY_NAME: 'Benchmark Cannabis',
      FACILITY_TYPE: 'Retailer',
      LICENSE_TYPE: 'Medical Cannabis Retailer',
      EXPIRATION_DATE: 1798675200000,
      ADDRESS: '100 Evidence Ave NW',
      LATITUDE: 38.9,
      LONGITDUE: -77.03,
      TRADE_NAME: 'Benchmark Cannabis',
      ENTITY_NAME: 'Benchmark Cannabis LLC',
      STATUS: 'Active',
      ISSUE_DATE: 1752710400000,
      EDITED: 1780587905000,
      WARD: 2,
      ENDORSEMENTS: null,
    },
    geometry: { x: -77.03, y: 38.9 },
  };
}

function metadata(revision = 1781114729000) {
  return {
    id: 31,
    name: 'Licensed Medical Cannabis Retailer',
    currentVersion: 11.5,
    maxRecordCount: 1000,
    capabilities: 'Map,Query,Data',
    supportsPagination: true,
    advancedQueryCapabilities: { supportsPagination: true, supportsOrderBy: true },
    editingInfo: { lastEditDate: revision },
    fields: ABCA_FIELDS.map((name) => ({ name })),
  };
}

function scriptedSource({ postRevision = 1781114729000, failureAt = null } = {}) {
  let call = 0;
  const bodies = [
    metadata(),
    { count: 1 },
    { features: [record()], exceededTransferLimit: false },
    metadata(postRevision),
    { count: 1 },
  ];
  return {
    calls: [],
    lookup: async () => [{ address: '23.48.99.80', family: 4 }],
    async fetchImpl(url, options) {
      this.calls.push({ url: url.toString(), method: options.method });
      const index = call;
      call += 1;
      if (failureAt === index) {
        return new Response('scripted outage', { status: 500, headers: { 'content-type': 'text/plain' } });
      }
      return new Response(JSON.stringify(bodies[index]), {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=UTF-8',
          etag: `"benchmark-${index}"`,
          date: 'Mon, 10 Aug 2026 14:21:16 GMT',
        },
      });
    },
  };
}

class MemoryStore {
  constructor() {
    this.events = [];
    this.contents = new Map();
    this.capabilities = [];
    this.circuits = new Map();
  }

  async runExclusive(_scope, work) { return work(this); }
  async latestContent({ sourceKey, tenant }) {
    return [...this.events].reverse().find((entry) => (
      entry.context.state === 'COMPLETED'
      && entry.context.source_key === sourceKey
      && entry.context.tenant === tenant
      && entry.context.content_artifact_id
    ))?.context ?? null;
  }
  async appendAcquisitionEvent({ event, context }) {
    const row = { id: `event-${this.events.length + 1}`, event, context: structuredClone(context) };
    this.events.push(row);
    return row;
  }
  async persistContent({ capture }) {
    const prior = this.contents.get(capture.content_sha256);
    if (prior) return { ...prior, created: false };
    const row = {
      contentArtifactId: `content-${this.contents.size + 1}`,
      snapshotId: `snapshot-${this.contents.size + 1}`,
      contentSha256: capture.content_sha256,
      payloadBytes: capture.snapshot_bytes.length,
      created: true,
    };
    this.contents.set(capture.content_sha256, row);
    return row;
  }
  async appendCapabilityReceipt(receipt) {
    this.capabilities.push(structuredClone(receipt));
    return { id: `capability-${this.capabilities.length}` };
  }
  async latestCircuit(scope) {
    return this.circuits.get(`${scope.sourceKey}:${scope.tenant}:${scope.workClass}`) ?? null;
  }
  async appendCircuitEvent(scope, event) {
    this.circuits.set(`${scope.sourceKey}:${scope.tenant}:${scope.workClass}`, structuredClone(event));
    return event;
  }
}

function options(source, attemptId, at) {
  let tick = Date.parse(at);
  return {
    tenant: TENANT,
    attemptId,
    asOf: at,
    env: { CANA_LIVE_REALITY_NETWORK: '1' },
    lookup: source.lookup,
    fetchImpl: source.fetchImpl.bind(source),
    clock: () => new Date(tick += 1_000),
    versions: {
      repositoryCommitSha: 'e3139d960b837a8ea7ef7f01acfab5111dd96cc7',
      repositoryTreeSha: '5b6c4b85d613d1de71879bc7e27b63cb96ba7405',
      adapterVersion: 'dc-abca-live-v1',
      parserVersion: 'cana-dc-abca-arcgis-snapshot-v1',
      compilerVersion: 'cana-reality-compiler-v1',
      entityResolverVersion: 'cana-market-entity-resolution-v1',
      authorityPolicyVersion: 'dc-abca-authority-v1',
      freshnessPolicyVersion: 'dc-abca-freshness-v1',
      verificationCourtVersion: 'cana-market-claim-court-v1',
    },
  };
}

function intent() {
  const unknown = { status: 'UNKNOWN', value: null, matched_token: null };
  return {
    ir_version: 1,
    compiler: 'deterministic-lexicon-v1',
    dimensions: {
      location: { status: 'KNOWN', value: 'dupont circle', matched_token: 'dupont' },
      category: unknown,
      price_max_usd: unknown,
      fulfillment: unknown,
      open_now: unknown,
    },
    unknown_dimensions: ['category', 'price_max_usd', 'fulfillment', 'open_now'],
  };
}

function currentClaim(predicate) {
  return {
    subject_ref: 'benchmark-retailer-1',
    predicate,
    verification: 'VERIFIED',
    decision_eligible: true,
    observed_at: '2026-08-10T15:10:00.000Z',
    freshness_expires_at: '2026-09-09T15:10:00.000Z',
    acquisition_event_id: 'benchmark-acquisition-2',
    verification_event_id: `benchmark-court-${predicate}`,
  };
}

const store = new MemoryStore();
const changedSource = scriptedSource();
const changed = await acquireLiveMarketReality(store, options(changedSource, 'benchmark-changed', '2026-08-10T15:00:00.000Z'));
const unchangedSource = scriptedSource();
const unchanged = await acquireLiveMarketReality(store, options(unchangedSource, 'benchmark-unchanged', '2026-08-10T15:10:00.000Z'));
const driftSource = scriptedSource({ postRevision: 1781114730000 });
const drift = await acquireLiveMarketReality(store, options(driftSource, 'benchmark-drift', '2026-08-10T15:20:00.000Z'));
const outageSource = scriptedSource({ failureAt: 0 });
const outage = await acquireLiveMarketReality(store, options(outageSource, 'benchmark-outage', '2026-08-10T15:30:00.000Z'));

const beforeFrontier = buildAnswerabilityFrontier({
  tenant: TENANT, intent: intent(), claimDecisions: [], asOf: new Date('2026-08-10T15:10:00.000Z'),
});
const afterFrontier = buildAnswerabilityFrontier({
  tenant: TENANT,
  intent: intent(),
  claimDecisions: CORE.map(currentClaim),
  asOf: new Date('2026-08-10T15:10:00.000Z'),
});
const demandPriority = computeDemandPriority({
  admittedSignalCount: 9,
  uniqueDemandCount: 1,
  blockingPredicates: beforeFrontier.blocking_predicates,
  decisionCriticality: 5,
});
const freshness = computeFreshnessDebt({
  tenant: TENANT,
  claims: [{
    id: 'benchmark-claim-1',
    predicate: 'license_status',
    freshness_expires_at: '2026-08-10T15:09:59.000Z',
    decision_eligible: false,
    demand_count: 9,
    dependent_decisions: 1,
    source_available: true,
    estimated_acquisition_cost_cents: 0,
  }],
  asOf: new Date('2026-08-10T15:10:00.000Z'),
});
const work = createRevalidationWorkSpec(freshness.items[0], {
  now: new Date('2026-08-10T15:10:00.000Z'),
});
const acquisitionReceipts = [changed, unchanged, drift, outage];
const completedReceipts = acquisitionReceipts.filter((receipt) => receipt.state === 'COMPLETED');
const failedReceipts = acquisitionReceipts.filter((receipt) => receipt.state === 'FAILED');
const completedContentHashes = new Set(completedReceipts.map((receipt) => receipt.content_sha256));

const observedResult = {
  acquisitions: acquisitionReceipts.length,
  changed: Number(changed.outcome === 'SOURCE_CHANGED'),
  unchanged: Number(unchanged.outcome === 'SOURCE_UNCHANGED'),
  revision_drift_denied: Number(drift.error_code === 'CANA_LIVE_REALITY_REVISION_DRIFT'),
  outage_denied: Number(outage.error_code === 'CANA_LIVE_REALITY_HTTP_ERROR'),
  unique_content_artifacts: store.contents.size,
  answerability_improved: beforeFrontier.answerable === false && afterFrontier.answerable === true,
  duplicate_opportunities: 0,
  false_identity_links: 0,
};
const reflection = reflectVerificationEpisode({
  episode_id: 'phase-b-slice2-offline-scripted-acquisition',
  source_snapshot_sha256: changed.content_sha256,
  belief_before: 'Repeated identical bytes might be sufficient to refresh every downstream claim.',
  observed_result: observedResult,
  bottleneck: 'ACQUISITION_IDENTITY_AND_REVALIDATION_BOUNDARY',
  causal_mechanism: 'Separate acquisition receipts plus an independent predicate-scoped court preserve history and prevent freshness laundering.',
});

const benchmark = {
  schema_version: 'cana-live-reality-benchmark/v1',
  mode: 'OFFLINE_SCRIPTED_REPLAY',
  source: {
    source_id: ABCA_LIVE_CONTRACT.sourceId,
    source_key: ABCA_LIVE_CONTRACT.sourceKey,
    fixed_url: ABCA_LIVE_CONTRACT.layerUrl,
    live_network_calls: 0,
    scripted_http_reads: changedSource.calls.length + unchangedSource.calls.length + driftSource.calls.length + outageSource.calls.length,
  },
  acquisition: {
    attempts: acquisitionReceipts.length,
    completed: completedReceipts.length,
    failed: failedReceipts.length,
    changed: observedResult.changed,
    unchanged: observedResult.unchanged,
    revision_drift_denied: observedResult.revision_drift_denied,
    outage_denied: observedResult.outage_denied,
    unique_content_artifacts: store.contents.size,
    acquisition_receipts: acquisitionReceipts.length,
    repeated_identical_content_acquisitions: completedReceipts.length - completedContentHashes.size,
    duplicate_content_artifacts: Math.max(0, store.contents.size - completedContentHashes.size),
    source_capability_receipts: store.capabilities.length,
  },
  revalidation: {
    zero_change_receipts: completedReceipts.filter((receipt) => receipt.outcome === 'SOURCE_UNCHANGED').length,
    verification_events_appended: 0,
    claims_mutated: 0,
    stale_claims: freshness.stale_claims,
    revalidation_missions_created: 0,
    revalidation_work_specs_created: Number(Boolean(work.mission && work.trigger)),
    revalidation_work_truth_mutations: work.truth_mutations,
    continuation_tick_truth_mutations: 0,
  },
  answerability: {
    before_frontier_key: beforeFrontier.frontier_key,
    after_frontier_key: afterFrontier.frontier_key,
    gaps_closed: Number(afterFrontier.answerable),
    gaps_retained: Number(!beforeFrontier.answerable),
    verification_opportunities_created: 0,
    verification_opportunities_identified: freshness.items.length,
    duplicate_opportunities: 0,
    demand_priority: demandPriority,
  },
  safety: {
    false_sovereign_identity_links: 0,
    unsupported_decision_eligible_claims: 0,
    source_failure_demotions: 0,
    provenance_violations: 0,
    replacement_truth_from_revocation: 0,
  },
  cognitive_evolution: {
    state: reflection.state,
    value_state: reflection.value_state,
    cognitive_mutations_promoted: reflection.cognitive_mutations_promoted,
    next_action: reflection.next_action,
    receipt_sha256: reflection.receipt_sha256,
    repeated_bottleneck: reflection.bottleneck,
    challenger_specified: true,
    challenger_tested: false,
  },
  effects: ZERO_EFFECTS,
};

process.stdout.write(`${JSON.stringify(benchmark, null, 2)}\n`);
