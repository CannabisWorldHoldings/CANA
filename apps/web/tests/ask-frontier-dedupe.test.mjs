import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerabilityFrontier } from '../src/lib/ask/answerability-frontier.mjs';
import {
  computeDemandPriority,
  frontierOpportunityKey,
  frontierWorkRequirements,
} from '../src/lib/ask/ask-work.mjs';
import { adjudicateFrontierRecheck } from '../src/lib/ask/market-gap-recheck.mjs';

const NOW = new Date('2026-08-10T12:00:00.000Z');
const UNKNOWN = { status: 'UNKNOWN', value: null, matched_token: null };

function intent(location = 'dupont circle') {
  return {
    ir_version: 1,
    compiler: 'deterministic-lexicon-v1',
    raw_query: `private raw query for ${location}`,
    compiled_at: NOW.toISOString(),
    dimensions: {
      location: { status: 'KNOWN', value: location, matched_token: location },
      category: UNKNOWN,
      price_max_usd: UNKNOWN,
      fulfillment: UNKNOWN,
      open_now: UNKNOWN,
    },
    unknown_dimensions: ['category', 'price_max_usd', 'fulfillment', 'open_now'],
  };
}

function current(subjectRef, predicate) {
  return {
    subject_ref: subjectRef,
    predicate,
    verification: 'VERIFIED',
    decision_eligible: true,
    observed_at: '2026-08-09T00:00:00.000Z',
    freshness_expires_at: '2026-09-09T00:00:00.000Z',
    acquisition_event_id: `acq-${subjectRef}`,
    verification_event_id: `court-${subjectRef}-${predicate}`,
  };
}

const CORE = ['license_number', 'license_status', 'operating_status', 'regulated_address'];

function frontier({ tenant = 'orderweeddc.com', claims = [] } = {}) {
  return buildAnswerabilityFrontier({ tenant, intent: intent(), claimDecisions: claims, asOf: NOW });
}

test('equivalent gap frontiers share one tenant-scoped opportunity identity', () => {
  const gap = frontier();
  const key = frontierOpportunityKey({ tenant: 'orderweeddc.com', kind: 'MARKET_GAP', frontier: gap });
  assert.match(key, /^sha256:[a-f0-9]{64}$/);
  assert.equal(key, frontierOpportunityKey({ tenant: 'orderweeddc.com', kind: 'MARKET_GAP', frontier: gap }));
  assert.notEqual(key, frontierOpportunityKey({ tenant: 'example.com', kind: 'MARKET_GAP', frontier: frontier({ tenant: 'example.com' }) }));
});

test('frontier work binds exact evidence, blocker set, and REFLECTION_ONLY loop mode', () => {
  const gap = frontier();
  const requirement = frontierWorkRequirements({ opportunityId: 'opportunity-1', frontier: gap });
  assert.deepEqual(requirement, {
    consumer: 'ask_market_gap_recheck',
    recheck: 'answerability_frontier',
    opportunityId: 'opportunity-1',
    frontierKey: gap.frontier_key,
    frontierEvidenceDigest: gap.evidence_digest,
    tenant: 'orderweeddc.com',
    intentScope: { location: 'dupont circle' },
    requiredPredicates: CORE,
    loopMode: 'REFLECTION_ONLY',
  });
});

test('demand priority is transparent, bounded, and cannot assert economic value', () => {
  const one = computeDemandPriority({ admittedSignalCount: 1, uniqueDemandCount: 1, blockingPredicates: CORE });
  const repeated = computeDemandPriority({ admittedSignalCount: 9, uniqueDemandCount: 1, blockingPredicates: CORE });
  assert.deepEqual(one.components, {
    admitted_signal_count: 1,
    unique_demand_count: 1,
    blocking_predicate_count: 4,
    freshness_urgency: 0,
    contradiction_severity: 0,
    decision_criticality: 0,
  });
  assert.ok(repeated.score > one.score);
  assert.equal(repeated.hypothesized_value, null);
  assert.ok(repeated.score <= 10_000);
});

test('10,000 equivalent demand signals collapse to one bounded work identity and capped priority', () => {
  const gap = frontier();
  const keys = new Set(Array.from({ length: 10_000 }, () => frontierOpportunityKey({
    tenant: 'orderweeddc.com',
    kind: 'MARKET_GAP',
    frontier: gap,
  })));
  assert.equal(keys.size, 1);
  const priority = computeDemandPriority({
    admittedSignalCount: 10_000,
    uniqueDemandCount: 10_000,
    blockingPredicates: CORE,
  });
  assert.equal(priority.components.admitted_signal_count, 100);
  assert.equal(priority.components.unique_demand_count, 100);
  assert.equal(priority.hypothesized_value, null);
  assert.ok(priority.score <= 10_000);
});

test('count alone, partial coverage, and a wrong frontier cannot close work', () => {
  const gap = frontier();
  const requirement = frontierWorkRequirements({ opportunityId: 'opportunity-1', frontier: gap });
  const partial = frontier({ claims: CORE.slice(0, 3).map((predicate) => current('retailer-1', predicate)) });
  assert.deepEqual(adjudicateFrontierRecheck({
    storedFrontier: gap,
    requirement,
    currentFrontier: partial,
    verifiedCandidateCount: 99,
  }), { decision: 'PERSISTENT', reason: 'FRONTIER_NOT_ANSWERABLE' });
  assert.deepEqual(adjudicateFrontierRecheck({
    storedFrontier: gap,
    requirement: { ...requirement, frontierKey: 'sha256:'.padEnd(71, '0') },
    currentFrontier: partial,
    verifiedCandidateCount: 99,
  }), { decision: 'REFUSED', reason: 'FRONTIER_BINDING_MISMATCH' });
});

test('the same exact frontier closes only from one complete current subject', () => {
  const gap = frontier();
  const requirement = frontierWorkRequirements({ opportunityId: 'opportunity-1', frontier: gap });
  const complete = frontier({ claims: CORE.map((predicate) => current('retailer-1', predicate)) });
  assert.deepEqual(adjudicateFrontierRecheck({
    storedFrontier: gap,
    requirement,
    currentFrontier: complete,
    verifiedCandidateCount: 1,
  }), { decision: 'CLOSE', reason: 'EXACT_FRONTIER_ANSWERABLE' });
});
