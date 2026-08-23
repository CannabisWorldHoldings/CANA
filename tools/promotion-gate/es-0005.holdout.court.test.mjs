/** Independent post-seal holdout for ES-0005. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeEvaluatorSuccessionCase } from '../federation/evaluators.mjs';
import {
  V5_CONTRACT,
  assessZenithSuccession,
  collectZenithSuccessionEvidence,
  dispatchEvaluator,
  evaluateZenithSuccession,
} from './es-0005.mjs';
import { RECORDED_PRE_CANDIDATE_FREEZE_SHA } from './fixtures/es-0005-freeze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0005-positive.json'), 'utf8'));
const SEALED_COMMIT = 'e8f3ffa5385da882a9d517c0801ac7dc0142258e';
const SEALED_SOURCE_SHA256 = '2cd67c0bb5283f25dadc578fa8c808e4b928ad842955096a6c195ea06d1e7eee';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const HOLDOUT_PLAN = Object.freeze([
  'H01|exact positive accepts',
  'H02|future candidate commit refuses',
  'H03|wildcard path refuses',
  'H04|neighbor path refuses',
  'H05|authorization source drift refuses',
  'H06|approval digest drift refuses',
  'H07|invalid live manifest observation refuses',
  'H08|candidate manifest drift refuses',
  'H09|incumbent parent failure refuses',
  'H10|protected-base ancestry failure refuses',
  'H11|V4 dispatches only to frozen replay',
  'H12|self-promotion authority laundering refuses',
  'H13|deployment authority laundering refuses',
  'H14|owner approval laundering refuses',
  'H15|forbidden deployment verdict refuses',
  'H16|observed assignment path drift refuses',
  'H17|unexpected V4 bridge verdict refuses',
]);
const HOLDOUT_PLAN_SHA256 = '89f26f6eccfa26d5d8c0418073ef805f757e4d3c9de2285528d520866d2e1f49';

function refused(candidate, expected) {
  const result = evaluateZenithSuccession(candidate);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes(expected), JSON.stringify(result.failed_checks));
}

test('sealed evaluator source and pre-candidate freeze are immutable', () => {
  const source = spawnSync(
    'git',
    ['show', `${SEALED_COMMIT}:tools/promotion-gate/es-0005.mjs`],
    { cwd: ROOT, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 },
  );
  assert.equal(source.status, 0, source.stderr?.toString('utf8'));
  assert.equal(sha256(source.stdout), SEALED_SOURCE_SHA256);
  assert.equal(sha256(fs.readFileSync(path.join(HERE, 'es-0005.mjs'))), SEALED_SOURCE_SHA256);
  assert.equal(RECORDED_PRE_CANDIDATE_FREEZE_SHA, 'dabfc97d07c91504d272823442e533878394e3026b20285b1a93fd9a411e4794');
});

test('holdout plan was fixed after the evaluator seal and before execution', () => {
  assert.equal(sha256(HOLDOUT_PLAN.join('\n')), HOLDOUT_PLAN_SHA256);
  assert.equal(HOLDOUT_PLAN.length, 17);
});

test('H01 exact positive accepts', () => {
  assert.equal(evaluateZenithSuccession(POSITIVE).accepted, true);
});

test('H02 future candidate commit refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.candidate_commit_sha = SEALED_COMMIT;
  refused(candidate, 'identity.candidate-commit-exact');
});

test('H03 wildcard path refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.paths[0] = 'apps/web/**';
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

test('H06 approval digest drift refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.approval_sha256 = '0'.repeat(64);
  refused(candidate, 'lineage.approval-digest');
});

test('H07 invalid live manifest observation refuses', () => {
  const observed = collectZenithSuccessionEvidence(POSITIVE);
  observed.manifest_valid = false;
  const result = assessZenithSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('lineage.manifest-valid'));
});

test('H08 candidate manifest drift refuses', () => {
  const observed = collectZenithSuccessionEvidence(POSITIVE);
  observed.candidate_manifest_digest = '0'.repeat(64);
  const result = assessZenithSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('lineage.candidate-manifest-exact'));
});

test('H09 incumbent parent failure refuses', () => {
  const observed = collectZenithSuccessionEvidence(POSITIVE);
  observed.incumbent_is_parent = false;
  const result = assessZenithSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('ancestry.incumbent-is-parent'));
});

test('H10 protected-base ancestry failure refuses', () => {
  const observed = collectZenithSuccessionEvidence(POSITIVE);
  observed.protected_base_is_ancestor = false;
  const result = assessZenithSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('ancestry.protected-base-is-ancestor'));
});

test('H11 V4 dispatches only to its frozen replay lane', () => {
  const dispatch = dispatchEvaluator({
    evaluator_id: 'CANA_PROMOTION_IDENTITY_V4',
    promotion_schema_version: 4,
    promotion_event_type: 'execution-scope-succession-v4',
  });
  assert.equal(dispatch.dispatched?.lane, 'frozen-replay');
  assert.equal(dispatch.dispatched?.invoked_by, 'tools/promotion-gate/es-0004-frozen-replay.mjs');
  refused({
    ...structuredClone(POSITIVE),
    evaluator_id: 'CANA_PROMOTION_IDENTITY_V4',
    promotion_schema_version: 4,
    promotion_event_type: 'execution-scope-succession-v4',
  }, 'dispatch.owned-by-v5');
});

test('H12 self-promotion authority laundering refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.authority_boundaries.self_promotion = true;
  refused(candidate, 'authority.all-false');
});

test('H13 deployment authority laundering refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.manifest_succession.authority_boundaries.deployment = true;
  refused(candidate, 'authority.all-false');
});

test('H14 owner approval laundering refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.owner_gate = { state: 'OWNER_APPROVED', claimed_owner_approved: true };
  refused(candidate, 'owner-gate.execution-only');
});

test('H15 forbidden deployment verdict refuses', () => {
  const candidate = structuredClone(POSITIVE);
  candidate.claimed_verdict = 'DEPLOYED';
  refused(candidate, 'verdict.no-forbidden-claim');
});

test('H16 observed assignment path drift refuses', () => {
  const observed = collectZenithSuccessionEvidence(POSITIVE);
  observed.assignment_paths_valid = false;
  const result = assessZenithSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('lineage.paths-exact'));
});

test('H17 unexpected V4 bridge verdict refuses', () => {
  const observed = collectZenithSuccessionEvidence(POSITIVE);
  observed.v4_failed_checks = ['lineage.new-manifest'];
  const result = assessZenithSuccession(POSITIVE, observed);
  assert.equal(result.accepted, false);
  assert.ok(result.failed_checks.includes('bridge.v4-refuses-only-current-succession'));
});

test('post-measurement succession record satisfies federation law', () => {
  const record = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0005-succession-case.json'), 'utf8'));
  const result = makeEvaluatorSuccessionCase(record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.verdict, 'SUCCEED');
  assert.equal(record.candidate.sealed_commit_sha, SEALED_COMMIT);
  assert.equal(record.candidate.source_sha256, SEALED_SOURCE_SHA256);
  assert.equal(record.candidate.pre_candidate_freeze_sha256, RECORDED_PRE_CANDIDATE_FREEZE_SHA);
  assert.equal(record.ownerPromotionGate, 'EXECUTION_AUTHORIZED');
});

assert.equal(V5_CONTRACT.evaluator_id, 'CANA_PROMOTION_IDENTITY_V5');
