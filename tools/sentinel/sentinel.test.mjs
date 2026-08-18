// SENTINEL BRIDGE courts — the god's-eye organ must be deterministic,
// honest about skips, and unable to self-authorize a response.
import assert from 'node:assert/strict';
import test from 'node:test';

import { compileSentinelProposals, deltaToChangeEvent } from './bridge.mjs';

const CTX = { observedAt: '2026-08-18T11:00:00Z', reportRef: 'docs/competitive/shadow/2026-08-18.json' };

const drift = (over = {}) => ({
  key: 'leafly:/dispensaries/washington-dc',
  change: 'title-changed',
  before: 'old title',
  after: 'new title',
  triage: 'TRIAGE_REQUIRED',
  ...over,
});

test('a shadow delta becomes a valid, deterministic ChangeEvent', () => {
  const one = deltaToChangeEvent(drift(), CTX);
  const two = deltaToChangeEvent(drift(), CTX);
  assert.equal(one.valid, true);
  assert.equal(one.event_id, two.event_id, 'identical drift -> identical event id');
  assert.equal(one.source, 'leafly');
  assert.equal(one.surface, '/dispensaries/washington-dc');
  const other = deltaToChangeEvent(drift({ after: 'different title' }), CTX);
  assert.notEqual(one.event_id, other.event_id, 'different evidence -> different id');
});

test('proposals carry falsification, rollback, and TRIAGE_REQUIRED — never a self-authorized response', () => {
  const { proposals, skipped } = compileSentinelProposals([drift()], CTX);
  assert.equal(skipped.length, 0);
  assert.equal(proposals.length, 1);
  const p = proposals[0];
  assert.equal(p.triage, 'TRIAGE_REQUIRED');
  assert.equal(p.candidate.valid, true);
  assert.equal(p.candidate.stage, 'PROPOSED', 'candidates enter at PROPOSED; promotion needs the court');
  assert.ok(p.candidate.falsification_test.length > 0);
  assert.ok(p.candidate.rollback.length > 0);
  assert.equal(p.candidate.plane, 'COMPETITIVE_SENTINEL');
});

test('malformed deltas are skipped WITH reasons, never silently', () => {
  const { proposals, skipped } = compileSentinelProposals(
    [drift(), { key: null, change: '' }, 'not-an-object'],
    CTX,
  );
  assert.equal(proposals.length, 3 - 2, 'only the valid delta compiles');
  assert.equal(skipped.length, 2);
  for (const s of skipped) assert.ok(Array.isArray(s.errors) && s.errors.length > 0);
});

test('empty and absent reports compile to zero proposals without inventing drift', () => {
  assert.deepEqual(compileSentinelProposals([], CTX).proposals, []);
  assert.deepEqual(compileSentinelProposals(undefined, CTX).proposals, []);
});
