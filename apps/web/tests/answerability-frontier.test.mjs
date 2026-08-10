import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerabilityFrontier } from '../src/lib/ask/answerability-frontier.mjs';

const NOW = new Date('2026-08-10T12:00:00.000Z');

function intent({
  location = 'dupont circle',
  rawQuery = 'dispensary in dupont',
  compiledAt = '2026-08-10T11:00:00.000Z',
  matchedToken = 'dupont',
  category = null,
} = {}) {
  const known = (value, token) => ({ status: 'KNOWN', value, matched_token: token });
  const unknown = { status: 'UNKNOWN', value: null, matched_token: null };
  return {
    ir_version: 1,
    compiler: 'deterministic-lexicon-v1',
    raw_query: rawQuery,
    compiled_at: compiledAt,
    dimensions: {
      location: location === null ? unknown : known(location, matchedToken),
      category: category === null ? unknown : known(category, category),
      price_max_usd: unknown,
      fulfillment: unknown,
      open_now: unknown,
    },
    unknown_dimensions: category === null
      ? ['category', 'price_max_usd', 'fulfillment', 'open_now']
      : ['price_max_usd', 'fulfillment', 'open_now'],
  };
}

function current(subjectRef, predicate, suffix = predicate) {
  return {
    subject_ref: subjectRef,
    predicate,
    verification: 'VERIFIED',
    decision_eligible: true,
    observed_at: '2026-08-09T00:00:00.000Z',
    freshness_expires_at: '2026-09-09T00:00:00.000Z',
    acquisition_event_id: `acq-${suffix}`,
    verification_event_id: `court-${suffix}`,
  };
}

const CORE = ['license_number', 'license_status', 'operating_status', 'regulated_address'];

test('canonical frontier ignores raw query, compile time, matched token, and evidence ordering', () => {
  const claims = CORE.map((predicate) => current('retailer-1', predicate));
  const left = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.com',
    intent: intent(),
    claimDecisions: claims,
    asOf: NOW,
  });
  const right = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.com',
    intent: intent({
      rawQuery: 'RAW PRIVATE WORDS THAT MUST NOT PERSIST',
      compiledAt: '2030-01-01T00:00:00.000Z',
      matchedToken: 'dupont circle',
    }),
    claimDecisions: [...claims].reverse(),
    asOf: new Date('2026-08-10T12:01:00.000Z'),
  });
  assert.equal(left.frontier_key, right.frontier_key);
  assert.equal(left.evidence_digest, right.evidence_digest);
  assert.equal(JSON.stringify(right).includes('RAW PRIVATE WORDS'), false);
  assert.deepEqual(right.intent_scope, { location: 'dupont circle' });
});

test('equivalent intent has a tenant-scoped canonical frontier key', () => {
  const base = buildAnswerabilityFrontier({ tenant: 'orderweeddc.com', intent: intent(), asOf: NOW });
  const otherTenant = buildAnswerabilityFrontier({ tenant: 'example.com', intent: intent(), asOf: NOW });
  const otherScope = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.com', intent: intent({ location: 'navy yard' }), asOf: NOW,
  });
  assert.match(base.frontier_key, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(base.frontier_key, otherTenant.frontier_key);
  assert.notEqual(base.frontier_key, otherScope.frontier_key);
});

test('one complete current subject makes the frontier answerable', () => {
  const frontier = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.com',
    intent: intent(),
    claimDecisions: CORE.map((predicate) => current('retailer-1', predicate)),
    asOf: NOW,
  });
  assert.equal(frontier.answerable, true);
  assert.equal(frontier.answerable_subject_ref, 'retailer-1');
  assert.deepEqual(frontier.covered_predicates, CORE);
  assert.deepEqual(frontier.blocking_predicates, []);
});

test('cross-subject partial coverage cannot fake a complete subject', () => {
  const frontier = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.com',
    intent: intent(),
    claimDecisions: [
      current('retailer-a', 'license_number', 'a-license'),
      current('retailer-a', 'license_status', 'a-status'),
      current('retailer-b', 'operating_status', 'b-status'),
      current('retailer-b', 'regulated_address', 'b-address'),
    ],
    asOf: NOW,
  });
  assert.equal(frontier.answerable, false);
  assert.equal(frontier.answerable_subject_ref, null);
  assert.deepEqual(frontier.covered_predicates, ['license_number', 'license_status']);
  assert.deepEqual(frontier.blocking_predicates, ['operating_status', 'regulated_address']);
});

test('stale, contradicted, and unknown claims remain exact blockers', () => {
  const frontier = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.com',
    intent: intent(),
    claimDecisions: [
      current('retailer-1', 'license_number'),
      { ...current('retailer-1', 'license_status'), freshness_expires_at: NOW.toISOString() },
      { ...current('retailer-1', 'operating_status'), verification: 'CONTRADICTED', decision_eligible: false },
      { ...current('retailer-1', 'regulated_address'), verification: 'UNKNOWN', decision_eligible: false },
    ],
    asOf: NOW,
  });
  assert.equal(frontier.answerable, false);
  assert.deepEqual(frontier.covered_predicates, ['license_number']);
  assert.deepEqual(frontier.stale_predicates, ['license_status']);
  assert.deepEqual(frontier.contradicted_predicates, ['operating_status']);
  assert.deepEqual(frontier.unknown_predicates, ['regulated_address']);
  assert.deepEqual(frontier.blocking_predicates, ['license_status', 'operating_status', 'regulated_address']);
});

test('known unsupported scope stays UNKNOWN and exposes its required predicates without inventing truth', () => {
  const frontier = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.com',
    intent: intent({ category: 'flower' }),
    claimDecisions: CORE.map((predicate) => current('retailer-1', predicate)),
    asOf: NOW,
  });
  assert.equal(frontier.answerable, false);
  assert.deepEqual(frontier.unsupported_known_dimensions, ['category']);
  assert.deepEqual(frontier.required_predicates, ['availability', ...CORE.slice(0, 2), 'menu', ...CORE.slice(2)]);
  assert.deepEqual(frontier.blocking_predicates, ['availability', 'menu']);
});
