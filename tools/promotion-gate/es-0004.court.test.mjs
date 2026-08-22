/** ES-0004 public court, frozen before the V4 evaluator source exists. */
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
  V4_CONTRACT,
  collectExecutionScopeEvidence,
  dispatchEvaluator,
  evaluateExecutionScopeSuccession,
} from './es-0004.mjs';
import { replayFrozenEs0003 } from './es-0003-frozen-replay.mjs';
import { CORPUS, materialize } from './fixtures/es-0004-adversarial-corpus.mjs';
import {
  EVIDENCE_SCHEMA,
  EVENT_SCHEMA,
  EXECUTION_SCOPE_PAYLOAD_SHA256,
  PROMOTION_CRITERIA,
  RECORDED_PRE_CANDIDATE_FREEZE_SHA,
  computePreCandidateFreeze,
} from './fixtures/es-0004-freeze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0004-positive.json'), 'utf8'));

test('PRE-CANDIDATE FREEZE: public criteria, fixture, corpus, bridge and court are byte-bound', () => {
  const freeze = computePreCandidateFreeze();
  assert.equal(freeze.freeze_sha256, RECORDED_PRE_CANDIDATE_FREEZE_SHA);
  assert.equal(PROMOTION_CRITERIA.length, 15);
  assert.equal(CORPUS.length, 19);
  assert.equal(EXECUTION_SCOPE_PAYLOAD_SHA256, '452ab52765c74984d104c134d5e3b2a0ae8aa879d8e66452e72de3095d6da409');
});

test('V1/V2/V3/V4 dispatch is explicit, disjoint and branch names are never authority', () => {
  assert.equal(EVALUATOR_ID, EVENT_SCHEMA.evaluator_id);
  assert.equal(PROMOTION_SCHEMA_VERSION, EVENT_SCHEMA.promotion_schema_version);
  assert.equal(V4_CONTRACT.branch_name_used_as_authority, false);
  assert.equal(DISPATCH_TABLE.length, 4);
  assert.equal(new Set(DISPATCH_TABLE.map((entry) => `${entry.promotion_schema_version}:${entry.promotion_event_type}`)).size, 4);
  assert.equal(dispatchEvaluator(EVENT_SCHEMA).dispatched?.evaluator_id, EVALUATOR_ID);
  assert.equal(dispatchEvaluator({ promotion_schema_version: 3, promotion_event_type: 'manifest-succession-promotion-v3' }).dispatched?.lane, 'frozen-replay');
  assert.equal(dispatchEvaluator({ promotion_schema_version: 99, promotion_event_type: 'future' }).dispatched, null);
});

test('POSITIVE: only the exact PR59 custody manifest transition is technically eligible', () => {
  const result = evaluateExecutionScopeSuccession(POSITIVE);
  assert.equal(result.accepted, true, JSON.stringify(result.failed_checks));
  assert.equal(result.technical_promotion_evidence, 'VERIFIED');
  assert.equal(result.owner_promotion_gate, 'EXECUTION_AUTHORIZED');
  assert.deepEqual(result.checks.map((check) => check.id), EVIDENCE_SCHEMA);
  assert.deepEqual(result.certified_verdicts, CERTIFIABLE_VERDICTS);
});

test('BRANCH RELABEL INVARIANCE: labels never change the exact-byte verdict', () => {
  const baseline = evaluateExecutionScopeSuccession(POSITIVE);
  for (const branch of ['main', 'trusted-looking/future', 'renamed', '']) {
    const candidate = structuredClone(POSITIVE);
    candidate.branch_evidence = branch;
    assert.equal(evaluateExecutionScopeSuccession(candidate).accepted, baseline.accepted);
  }
});

test('FIXED ADVERSARIAL CORPUS: all 19 cases refuse at their declared boundary', () => {
  for (const testCase of CORPUS) {
    const { candidate, expectedCheck } = materialize(testCase, POSITIVE);
    const result = evaluateExecutionScopeSuccession(candidate);
    assert.equal(result.accepted, false, `${testCase[0]} was accepted`);
    assert.ok(result.failed_checks.includes(expectedCheck), `${testCase[0]}: ${JSON.stringify(result.failed_checks)}`);
  }
});

test('FAILURE INJECTION: observation drift refuses even when candidate claims remain exact', () => {
  const mutations = [
    ['ancestry.incumbent-is-parent', (o) => { o.incumbent_is_parent = false; }],
    ['ancestry.incumbent-is-ancestor', (o) => { o.incumbent_is_ancestor = false; }],
    ['lineage.manifest-valid', (o) => { o.manifest_valid = false; }],
    ['lineage.candidate-manifest-exact', (o) => { o.candidate_manifest_digest = '0'.repeat(64); }],
    ['bridge.v3-refuses-only-new-manifest', (o) => { o.v3_failed_checks = []; }],
  ];
  const observed = collectExecutionScopeEvidence(POSITIVE);
  for (const [expectedCheck, mutate] of mutations) {
    const scenario = structuredClone(observed);
    mutate(scenario);
    const result = evaluateExecutionScopeSuccession(POSITIVE, { observed: scenario });
    assert.equal(result.accepted, false, expectedCheck);
    assert.ok(result.failed_checks.includes(expectedCheck), JSON.stringify(result.failed_checks));
  }
});

test('SEALED ES-0003 replays 9/9 plus independent holdout 18/18 in its exact archive', () => {
  const replay = replayFrozenEs0003({ mirror: process.env.CANA_SOURCE_MIRROR ?? ROOT });
  assert.equal(replay.classification, 'VERIFIED', JSON.stringify(replay.evidence));
  assert.deepEqual(replay.public_court, { tests: 9, pass: 9, fail: 0, skipped: 0 });
  assert.deepEqual(replay.holdout_court, { tests: 18, pass: 18, fail: 0, skipped: 0 });
});

test('VERDICT HYGIENE: V4 cannot certify merge, canonical, deployment or owner approval', () => {
  for (const forbidden of FORBIDDEN_VERDICTS) assert.ok(!CERTIFIABLE_VERDICTS.includes(forbidden));
});
