#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEntityResolutionBenchmark } from '../src/lib/reality/entity-resolution.mjs';
import { adjudicateMarketClaim } from '../src/lib/reality/market-claim-court.mjs';
import { loadOfficialSourceSnapshot } from '../src/lib/reality/official-source-snapshot.mjs';
import {
  DC_ABCA_SOURCE,
  compileRealitySnapshot,
  createEvidenceSnapshot,
  reflectVerificationEpisode,
  runOrganismLoopScenario,
} from '../src/lib/reality/reality-compiler.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotDirectory = path.join(WEB, 'fixtures', 'reality', 'dc-abca-layer-31', '2026-06-05');
const loaded = loadOfficialSourceSnapshot(snapshotDirectory);
if (loaded.raw_query_pages.length !== 1) throw new Error('CANA_REALITY_SLICE1_REQUIRES_ONE_SOURCE_PAGE');
const observedAt = loaded.source_modified_at ?? `${loaded.source_catalog_modified_date}T00:00:00.000Z`;
const asOf = new Date(process.argv[2] ?? '2026-06-06T00:00:00.000Z');
if (!Number.isFinite(asOf.getTime())) throw new Error('CANA_REALITY_BENCHMARK_CLOCK_INVALID');
const snapshot = createEvidenceSnapshot({
  sourceId: loaded.source_id,
  payloadBytes: loaded.raw_query_pages[0],
  fetchedAt: observedAt,
  completeness: 'COMPLETE',
});
const retailers = loaded.records.map((record, index) => ({
  id: `benchmark-retailer-${String(index + 1).padStart(3, '0')}`,
  geoEntityId: `benchmark-geo-${String(index + 1).padStart(3, '0')}`,
  licenseNumber: record.ABCA_NUMBER,
}));
const compiled = compileRealitySnapshot({ snapshot, retailers });
const decisions = compiled.claims.map((claim) => adjudicateMarketClaim({
  claim,
  snapshot,
  sourcePolicy: DC_ABCA_SOURCE,
  asOf,
}));
const admitted = decisions.filter((decision) => decision.decision_eligible);
const unsupportedEligible = admitted.filter((decision) => !DC_ABCA_SOURCE.authoritative_predicates.includes(decision.predicate));
const tampered = adjudicateMarketClaim({
  claim: compiled.claims[0],
  snapshot: { ...snapshot, sha256: '0'.repeat(64) },
  sourcePolicy: DC_ABCA_SOURCE,
  asOf,
});
const stale = adjudicateMarketClaim({
  claim: compiled.claims[0],
  snapshot,
  sourcePolicy: DC_ABCA_SOURCE,
  asOf: new Date('2026-08-10T00:00:00.000Z'),
});
const entityBenchmark = runEntityResolutionBenchmark({ records: loaded.records, retailers });
const before = [];
const after = admitted.map((claim) => ({
  subject_ref: claim.subject_id,
  predicate: claim.predicate,
  decision_eligible: true,
}));
const organism = runOrganismLoopScenario({
  tenant: 'orderweeddc.com',
  intent: { required_predicates: ['license_number', 'license_status', 'regulated_address', 'operating_status'] },
  demandSignals: 1,
  verifiedClaimsBefore: before,
  verifiedClaimsAfter: after,
});
const reflection = reflectVerificationEpisode({
  episode_id: 'phase-b-official-source-replay',
  source_snapshot_sha256: snapshot.sha256,
  belief_before: 'The official listing might be sufficient for every retailer field.',
  observed_result: {
    official_records: loaded.record_count,
    authoritative_predicates: DC_ABCA_SOURCE.authoritative_predicates.length,
    unsupported_predicates_admitted: unsupportedEligible.length,
  },
  bottleneck: 'Official license evidence does not prove customer-facing hours, phone, price, inventory, delivery, or quality.',
  causal_mechanism: 'Predicate-scoped authority plus independent court recomputation prevents source authority from spreading to unsupported fields.',
});

console.log(JSON.stringify({
  schema_version: 'cana-reality-benchmark-v1',
  mode: 'OFFLINE_COMMITTED_FIXTURE_REPLAY',
  as_of: asOf.toISOString(),
  source: {
    id: loaded.source_id,
    catalog_modified_date: loaded.source_catalog_modified_date,
    captured_at: loaded.fetched_at,
    fixture_snapshot_sha256: loaded.snapshot_sha256,
    raw_query_sha256: snapshot.sha256,
    records: loaded.record_count,
  },
  compiler: {
    observations: compiled.observations.length,
    invalid_observations: compiled.invalid_observations.length,
    resolutions: compiled.resolutions.length,
    claims_unknown_before_court: compiled.claims.length,
  },
  court: {
    admitted_claims: admitted.length,
    denied_claims: decisions.length - admitted.length,
    unsupported_claims_admitted: unsupportedEligible.length,
    tampered_snapshot_decision: tampered.decision,
    stale_current_decision: stale.decision,
  },
  entity_resolution: {
    exact_matches: entityBenchmark.exact_matches,
    review_required_records: entityBenchmark.review_required_records,
    unmatched_records: entityBenchmark.unmatched_records,
    malformed_records: entityBenchmark.malformed_records,
    false_automatic_links: entityBenchmark.false_automatic_links,
  },
  organism: {
    gap_closed_in_deterministic_replay: organism.gap_closed,
    site_intelligence_coverage_delta: organism.site_intelligence_coverage_delta,
  },
  cognitive_evolution: {
    state: reflection.state,
    value_state: reflection.value_state,
    cognitive_mutations_promoted: reflection.cognitive_mutations_promoted,
    receipt_sha256: reflection.receipt_sha256,
  },
  effects: organism.effects,
}, null, 2));
