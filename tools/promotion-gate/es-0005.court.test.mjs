/** ES-0005 public court, frozen before the V5 evaluator source exists. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CERTIFIABLE_VERDICTS,
  DISPATCH_TABLE,
  EVALUATOR_ID,
  FORBIDDEN_VERDICTS,
  PROMOTION_SCHEMA_VERSION,
  V5_CONTRACT,
  collectZenithSuccessionEvidence,
  dispatchEvaluator,
  evaluateZenithSuccession,
} from './es-0005.mjs';
import { replayFrozenEs0004 } from './es-0004-frozen-replay.mjs';
import { CORPUS, materialize } from './fixtures/es-0005-adversarial-corpus.mjs';
import {
  EVIDENCE_SCHEMA,
  EVENT_SCHEMA,
  PROMOTION_CRITERIA,
  RECORDED_PRE_CANDIDATE_FREEZE_SHA,
  computePreCandidateFreeze,
} from './fixtures/es-0005-freeze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0005-positive.json'), 'utf8'));

test('PRE-CANDIDATE FREEZE: public criteria, fixture, corpus, bridge and court are byte-bound', () => {
  const freeze = computePreCandidateFreeze();
  assert.equal(freeze.freeze_sha256, RECORDED_PRE_CANDIDATE_FREEZE_SHA);
  assert.equal(PROMOTION_CRITERIA.length, 18);
  assert.equal(CORPUS.length, 23);
});

test('V1/V2/V3/V4/V5 dispatch is explicit, disjoint and branch names are never authority', () => {
  assert.equal(EVALUATOR_ID, EVENT_SCHEMA.evaluator_id);
  assert.equal(PROMOTION_SCHEMA_VERSION, EVENT_SCHEMA.promotion_schema_version);
  assert.equal(V5_CONTRACT.branch_name_used_as_authority, false);
  assert.equal(DISPATCH_TABLE.length, 5);
  assert.equal(new Set(DISPATCH_TABLE.map((entry) => `${entry.promotion_schema_version}:${entry.promotion_event_type}`)).size, 5);
  assert.equal(dispatchEvaluator(EVENT_SCHEMA).dispatched?.evaluator_id, EVALUATOR_ID);
  assert.equal(dispatchEvaluator({ promotion_schema_version: 4, promotion_event_type: 'execution-scope-succession-v4' }).dispatched?.lane, 'frozen-replay');
  assert.equal(dispatchEvaluator({ promotion_schema_version: 99, promotion_event_type: 'future' }).dispatched, null);
});

test('POSITIVE: only the exact ZENITH ownership manifest transition is technically eligible', () => {
  const result = evaluateZenithSuccession(POSITIVE);
  assert.equal(result.accepted, true, JSON.stringify(result.failed_checks));
  assert.equal(result.technical_promotion_evidence, 'VERIFIED');
  assert.equal(result.owner_promotion_gate, 'EXECUTION_AUTHORIZED');
  assert.deepEqual(result.checks.map((check) => check.id), EVIDENCE_SCHEMA);
  assert.deepEqual(result.certified_verdicts, CERTIFIABLE_VERDICTS);
});

test('BRANCH RELABEL INVARIANCE: labels never change the exact-byte verdict', () => {
  const baseline = evaluateZenithSuccession(POSITIVE);
  for (const branch of ['main', 'trusted-looking/future', 'renamed', '']) {
    const candidate = structuredClone(POSITIVE);
    candidate.branch_evidence = branch;
    assert.equal(evaluateZenithSuccession(candidate).accepted, baseline.accepted);
  }
});

test('FIXED ADVERSARIAL CORPUS: all 23 cases refuse at their declared boundary', () => {
  for (const testCase of CORPUS) {
    const { candidate, expectedCheck } = materialize(testCase, POSITIVE);
    const result = evaluateZenithSuccession(candidate);
    assert.equal(result.accepted, false, `${testCase[0]} was accepted`);
    assert.ok(result.failed_checks.includes(expectedCheck), `${testCase[0]}: ${JSON.stringify(result.failed_checks)}`);
  }
});

test('FAILURE INJECTION: observation drift refuses even when candidate claims remain exact', () => {
  const mutations = [
    ['ancestry.incumbent-is-parent', (o) => { o.incumbent_is_parent = false; }],
    ['ancestry.incumbent-is-ancestor', (o) => { o.incumbent_is_ancestor = false; }],
    ['ancestry.protected-base-is-ancestor', (o) => { o.protected_base_is_ancestor = false; }],
    ['lineage.manifest-valid', (o) => { o.manifest_valid = false; }],
    ['lineage.candidate-manifest-exact', (o) => { o.candidate_manifest_digest = '0'.repeat(64); }],
    ['authority.all-false', (o) => { o.authority_boundaries_valid = false; }],
    ['bridge.v4-refuses-only-current-succession', (o) => { o.v4_failed_checks = []; }],
  ];
  const observed = collectZenithSuccessionEvidence(POSITIVE);
  for (const [expectedCheck, mutate] of mutations) {
    const scenario = structuredClone(observed);
    mutate(scenario);
    const result = evaluateZenithSuccession(POSITIVE, { observed: scenario });
    assert.equal(result.accepted, false, expectedCheck);
    assert.ok(result.failed_checks.includes(expectedCheck), JSON.stringify(result.failed_checks));
  }
});

test('SEALED ES-0004 replays 8/8 plus independent holdout 15/15 in its exact archive', () => {
  const replay = replayFrozenEs0004({ mirror: process.env.CANA_SOURCE_MIRROR ?? ROOT });
  assert.equal(replay.classification, 'VERIFIED', JSON.stringify(replay.evidence));
  assert.deepEqual(replay.public_court, { tests: 8, pass: 8, fail: 0, skipped: 0 });
  assert.deepEqual(replay.holdout_court, { tests: 15, pass: 15, fail: 0, skipped: 0 });
});

test('VERDICT HYGIENE: V5 cannot certify merge, canonical, deployment or owner approval', () => {
  for (const forbidden of FORBIDDEN_VERDICTS) assert.ok(!CERTIFIABLE_VERDICTS.includes(forbidden));
});
