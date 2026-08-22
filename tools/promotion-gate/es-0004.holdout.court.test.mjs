/** Independent post-seal holdout for ES-0004. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeEvaluatorSuccessionCase } from '../federation/evaluators.mjs';
import {
  V4_CONTRACT,
  assessExecutionScopeSuccession,
  collectExecutionScopeEvidence,
  dispatchEvaluator,
  evaluateExecutionScopeSuccession,
} from './es-0004.mjs';
import { RECORDED_PRE_CANDIDATE_FREEZE_SHA } from './fixtures/es-0004-freeze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0004-positive.json'), 'utf8'));
const SEALED_COMMIT = '62676d914df0b371602248823b471de5c19ca15d';
const SEALED_SOURCE_SHA256 = '35e171cc4f18a0a1a46c6c16e234ba9fb18909b3ba58d194b91f6b5a1e92b755';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const HOLDOUT_PLAN = Object.freeze([
  'H01|exact positive accepts',
  'H02|future candidate commit refuses',
  'H03|wildcard path refuses',
  'H04|neighbor path refuses',
  'H05|authorization source drift refuses',
  'H06|assignment digest drift refuses',
  'H07|invalid live manifest observation refuses',
  'H08|candidate manifest drift refuses',
  'H09|incumbent parent failure refuses',
  'H10|V3 dispatches only to frozen replay',
  'H11|owner approval laundering refuses',
  'H12|forbidden deployment verdict refuses',
]);
const HOLDOUT_PLAN_SHA256 = '3ab8fa2c9de1ed96bef32be5eb0a3c9ec5089f6dfcb8553c1dfee22ff26ac6b6';

function refused(candidate, expected) {
  const result = evaluateExecutionScopeSuccession(candidate);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes(expected), JSON.stringify(result.failed_checks));
}

test('sealed evaluator source and pre-candidate freeze are immutable', () => {
  const source = spawnSync(
    'git',
    ['show', `${SEALED_COMMIT}:tools/promotion-gate/es-0004.mjs`],
    { cwd: ROOT, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 },
  );
  assert.equal(source.status, 0, source.stderr?.toString('utf8'));
  assert.equal(sha256(source.stdout), SEALED_SOURCE_SHA256);
  assert.equal(sha256(fs.readFileSync(path.join(HERE, 'es-0004.mjs'))), SEALED_SOURCE_SHA256);
  assert.equal(RECORDED_PRE_CANDIDATE_FREEZE_SHA, '593b728512c940b4173a7d30d2a6db88a5e0c719e2b06e42f40cd43f59a3490d');
});

test('holdout plan was fixed after the evaluator seal and before execution', () => {
  assert.equal(sha256(HOLDOUT_PLAN.join('\n')), HOLDOUT_PLAN_SHA256);
  assert.equal(HOLDOUT_PLAN.length, 12);
});

test('H01 exact positive accepts', () => {
  assert.equal(evaluateExecutionScopeSuccession(POSITIVE).accepted, true);
});

test('H02 future candidate commit refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.candidate_commit_sha = SEALED_COMMIT;
  refused(candidate, 'identity.candidate-commit-exact');
});

test('H03 wildcard path refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.paths[0] = 'tools/visual-court/**';
  refused(candidate, 'lineage.paths-safe');
});

test('H04 neighboring path refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.paths[0] += '.next';
  refused(candidate, 'lineage.paths-exact');
});

test('H05 authorization source drift refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.authorization_source_sha256 = '0'.repeat(64);
  refused(candidate, 'lineage.authorization-source');
});

test('H06 assignment digest drift refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.assignment_sha256 = '0'.repeat(64);
  refused(candidate, 'lineage.assignment-digest');
});

test('H07 invalid live manifest observation refuses', () => {
  const observed = collectExecutionScopeEvidence(POSITIVE);
  observed.manifest_valid = false;
  const result = assessExecutionScopeSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('lineage.manifest-valid'));
});

test('H08 candidate manifest drift refuses', () => {
  const observed = collectExecutionScopeEvidence(POSITIVE);
  observed.candidate_manifest_digest = '0'.repeat(64);
  const result = assessExecutionScopeSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('lineage.candidate-manifest-exact'));
});

test('H09 incumbent parent failure refuses', () => {
  const observed = collectExecutionScopeEvidence(POSITIVE);
  observed.incumbent_is_parent = false;
  const result = assessExecutionScopeSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('ancestry.incumbent-is-parent'));
});

test('H10 V3 dispatches only to its frozen replay lane', () => {
  const dispatch = dispatchEvaluator({
    evaluator_id: 'CANA_PROMOTION_IDENTITY_V3',
    promotion_schema_version: 3,
    promotion_event_type: 'manifest-succession-promotion-v3',
  });
  assert.equal(dispatch.dispatched?.lane, 'frozen-replay');
  assert.equal(dispatch.dispatched?.invoked_by, 'tools/promotion-gate/es-0003-frozen-replay.mjs');
  refused({
    ...structuredClone(POSITIVE),
    evaluator_id: 'CANA_PROMOTION_IDENTITY_V3',
    promotion_schema_version: 3,
    promotion_event_type: 'manifest-succession-promotion-v3',
  }, 'dispatch.owned-by-v4');
});

test('H11 owner approval laundering refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.owner_gate = { state: 'OWNER_APPROVED', claimed_owner_approved: true };
  refused(candidate, 'owner-gate.execution-only');
});

test('H12 forbidden deployment verdict refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.claimed_verdict = 'DEPLOYED';
  refused(candidate, 'verdict.no-forbidden-claim');
});

test('post-measurement succession record satisfies federation law', () => {
  const record = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0004-succession-case.json'), 'utf8'));
  const result = makeEvaluatorSuccessionCase(record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.verdict, 'SUCCEED');
  assert.equal(record.candidate.sealed_commit_sha, SEALED_COMMIT);
  assert.equal(record.candidate.source_sha256, SEALED_SOURCE_SHA256);
  assert.equal(record.candidate.pre_candidate_freeze_sha256, RECORDED_PRE_CANDIDATE_FREEZE_SHA);
  assert.equal(record.ownerPromotionGate, 'EXECUTION_AUTHORIZED');
});

assert.equal(V4_CONTRACT.evaluator_id, 'CANA_PROMOTION_IDENTITY_V4');
