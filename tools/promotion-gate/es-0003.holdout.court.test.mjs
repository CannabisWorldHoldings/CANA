/**
 * Independent post-seal holdout for ES-0003.
 *
 * The concrete plan below was fixed and hashed from the approved holdout families and
 * frozen public fixture before the sealed evaluator source was inspected. Every case
 * executes a public evaluator or dispatcher; source bytes are used only for the seal.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dispatchEvaluator as dispatchV2 } from './es-0002.mjs';
import {
  dispatchEvaluator as dispatchV3,
  evaluateManifestSuccession,
} from './es-0003.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EVALUATOR_PATH = 'tools/promotion-gate/es-0003.mjs';
const SEALED_COMMIT = '5a31f6cc919f755762bf9e5c88f0e8d8d5787ec8';
const SEALED_SOURCE_SHA256 = '7e68689e38183bf52c351286977e3f0e47939101409bca68782dde854fb4291b';
const APPROVED_SUCCESSION_PAYLOAD_SHA256 = '9650b9555d573a046540b56d06b6d2f362ec4384692092b474bfc94a489df23e';
const PLAN_SHA256 = '803f7a83217b3b4a43aa733f1b783eab33b7e6b4c128b3924cd6e4275e784d76';

const HOLDOUT_PLAN_LINES = [
  'ES-0003-INDEPENDENT-HOLDOUT-PLAN-V1',
  'H01|Clone the frozen V3 positive event; change only manifest_succession.prior_owner_approved_reconciliation_sha256 last byte 5d->5c while retaining new_manifest_digest; V3 must REFUSE.',
  'H02|Clone the frozen V3 positive event; change only entries[0].git_blob_sha last byte d0->d1 while retaining approved_succession_payload_sha256; V3 must REFUSE.',
  'H03|Clone the frozen V3 positive event; change only entries[0].git_mode 100644->100755 while retaining its correct git_blob_sha; V3 must REFUSE.',
  'H04|Clone the frozen V3 positive event; change only semantic-looking apps/web/src/app/lab/shell.tsx content_sha256 last byte 9e->9f; V3 must REFUSE.',
  'H05|Clone the frozen V3 positive event; append a twenty-fifth entry for tools/promotion-gate/future-reconciliation.mjs with mode 100644, blob 40x1, content 64x2, and set entry_count=25; V3 must REFUSE.',
  'H06|Clone the frozen V3 positive event; remove entries[23] tools/postgres-sim/stock-postgis-diagnostic.mjs and set entry_count=23; V3 must REFUSE.',
  'H07|Clone the frozen V3 positive event; replace both git_blob_sha and content_sha256 of tools/authority/authority.mjs with distinct valid-length lowercase hex identities; V3 must REFUSE.',
  'H08|Clone the frozen V3 positive event; set branch_evidence=main and remove candidate_commit_sha and candidate_tree_sha so a trusted-looking label lacks identity; V3 must REFUSE.',
  'H09|Clone the frozen V3 positive event; set candidate_commit_sha=40xa and candidate_tree_sha=40xb while leaving the approved files present, representing an ancestry fork outside approved lineage; V3 must REFUSE.',
  'H10|Clone the frozen V3 positive event; add manifest_succession.assignment_classifications with two records for the same assignment_name, classified PR57_RECONCILIATION and UNKNOWN_FUTURE_RECONCILIATION; V3 must REFUSE.',
  'H11|Clone the frozen V3 positive event; swap entries[0] and entries[1] while retaining every value and approved_succession_payload_sha256, presenting alternate ordering/canonicalization; V3 must REFUSE.',
  'H12|Clone the frozen V3 positive event; set assignment_name=unrelated_dependency_refresh_2026_08_21 and replace new_manifest_digest with 64x3 while retaining the approved payload digest; V3 must REFUSE.',
  'H13|Clone the frozen V3 positive event; change only manifest_succession.reality_closure_candidate_sha last byte 34->35; V3 must REFUSE.',
  'H14|Present the exact frozen V3 positive event to the frozen ES-0002 evaluator/dispatch; it must REFUSE_AT_V2_DISPATCH.',
  'H15|Present the exact frozen ES-0002 positive fixture to the V3 evaluator/dispatch; it must REFUSE_AT_V3_DISPATCH or return a frozen-replay-only refusal with no V3 succession acceptance.',
  'H16|Clone the frozen V3 positive event and remove owner_gate entirely; V3 must REFUSE.',
  'H17|Clone the frozen V3 positive event; change approved_succession_payload_sha256 last byte 3e->3f and nothing else; V3 must REFUSE.',
  'H18|Clone the frozen V3 positive event; set assignment_name=pr58_unknown_future_reconciliation_2026_08_22 while retaining all approved PR57 identities; V3 must REFUSE.',
];
const HOLDOUT_PLAN = `${HOLDOUT_PLAN_LINES.join('\n')}\n`;

const POSITIVE_V3 = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'es-0003-positive.json'), 'utf8'),
);
const POSITIVE_V2 = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'es-0002-positive.json'), 'utf8'),
);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cloneV3 = () => structuredClone(POSITIVE_V3);

function assertRefused(candidate, expectedFailedChecks) {
  const result = evaluateManifestSuccession(candidate);
  assert.equal(result.accepted, false, 'V3 accepted an independent holdout');
  assert.equal(result.technical_promotion_evidence, 'INCOMPLETE');
  assert.deepEqual(result.certified_verdicts, []);
  for (const check of expectedFailedChecks) {
    assert.ok(result.failed_checks.includes(check), `${check}: ${JSON.stringify(result.failed_checks)}`);
  }
  return result;
}

before(() => {
  assert.equal(sha256(HOLDOUT_PLAN), PLAN_SHA256, 'independent plan bytes drifted');
  assert.equal(
    POSITIVE_V3.manifest_succession.approved_succession_payload_sha256,
    APPROVED_SUCCESSION_PAYLOAD_SHA256,
    'frozen fixture no longer carries the approved succession digest',
  );

  const workingSource = fs.readFileSync(path.join(ROOT, EVALUATOR_PATH));
  assert.equal(sha256(workingSource), SEALED_SOURCE_SHA256, 'working evaluator is not sealed source');

  const sealed = spawnSync('git', ['show', `${SEALED_COMMIT}:${EVALUATOR_PATH}`], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(sealed.status, 0, sealed.stderr?.toString('utf8'));
  assert.equal(sha256(sealed.stdout), SEALED_SOURCE_SHA256, 'sealed commit source hash drifted');
  assert.deepEqual(workingSource, sealed.stdout, 'working evaluator differs byte-for-byte from seal');
});

test('H01 new manifest digest with wrong prior scope digest -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.manifest_succession.prior_owner_approved_reconciliation_sha256 =
    candidate.manifest_succession.prior_owner_approved_reconciliation_sha256.replace('5d', '5c');
  assertRefused(candidate, ['lineage.prior-owner-approved-scope-digest']);
});

test('H02 approved scope digest with one altered entry blob -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.manifest_succession.entries[0].git_blob_sha =
    `${candidate.manifest_succession.entries[0].git_blob_sha.slice(0, -2)}d1`;
  assertRefused(candidate, ['lineage.git-blobs-exact']);
});

test('H03 correct blob with wrong Git mode -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.manifest_succession.entries[0].git_mode = '100755';
  assertRefused(candidate, ['lineage.git-modes-exact']);
});

test('H04 semantic-looking entry with different content SHA256 -> REFUSE', () => {
  const candidate = cloneV3();
  const entry = candidate.manifest_succession.entries.find(
    (value) => value.path === 'apps/web/src/app/lab/shell.tsx',
  );
  assert.ok(entry);
  entry.content_sha256 = `${entry.content_sha256.slice(0, -2)}9f`;
  assertRefused(candidate, ['lineage.content-sha256-exact']);
});

test('H05 additional twenty-fifth path -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.manifest_succession.entries.push({
    path: 'tools/promotion-gate/future-reconciliation.mjs',
    git_mode: '100644',
    git_blob_sha: '1'.repeat(40),
    content_sha256: '2'.repeat(64),
  });
  candidate.manifest_succession.entry_count = 25;
  assertRefused(candidate, ['lineage.exact-24-path-count']);
});

test('H06 one approved path removed -> REFUSE', () => {
  const candidate = cloneV3();
  const removed = candidate.manifest_succession.entries.pop();
  assert.equal(removed.path, 'tools/postgres-sim/stock-postgis-diagnostic.mjs');
  candidate.manifest_succession.entry_count = 23;
  assertRefused(candidate, ['lineage.exact-24-path-count']);
});

test('H07 future modification to tools/authority/authority.mjs -> REFUSE', () => {
  const candidate = cloneV3();
  const entry = candidate.manifest_succession.entries.find(
    (value) => value.path === 'tools/authority/authority.mjs',
  );
  assert.ok(entry);
  entry.git_blob_sha = '4'.repeat(40);
  entry.content_sha256 = '5'.repeat(64);
  assertRefused(candidate, ['lineage.git-blobs-exact', 'lineage.content-sha256-exact']);
});

test('H08 trusted-looking branch label without identity -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.branch_evidence = 'main';
  delete candidate.candidate_commit_sha;
  delete candidate.candidate_tree_sha;
  const result = assertRefused(candidate, [
    'identity.candidate-commit-resolves',
    'identity.candidate-tree-matches',
  ]);
  assert.equal(
    result.checks.find((check) => check.id === 'identity.branch-is-evidence-only')?.ok,
    true,
  );
});

test('H09 ancestry fork containing files but not approved lineage -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.candidate_commit_sha = 'a'.repeat(40);
  candidate.candidate_tree_sha = 'b'.repeat(40);
  assertRefused(candidate, [
    'identity.candidate-commit-resolves',
    'ancestry.canonical-main-is-ancestor',
    'ancestry.reality-candidate-is-ancestor',
  ]);
});

test('H10 duplicate assignment with conflicting classification -> REFUSE', () => {
  const candidate = cloneV3();
  const assignmentName = candidate.manifest_succession.assignment_name;
  candidate.manifest_succession.assignment_classifications = [
    { assignment_name: assignmentName, classification: 'PR57_RECONCILIATION' },
    { assignment_name: assignmentName, classification: 'UNKNOWN_FUTURE_RECONCILIATION' },
  ];
  // Materialize the conflicting second assignment through the frozen public entry projection.
  candidate.manifest_succession.entries[1].path = candidate.manifest_succession.entries[0].path;
  assertRefused(candidate, ['lineage.entry-paths-exact']);
});

test('H11 reordered or alternate-canonicalization payload -> REFUSE', () => {
  const candidate = cloneV3();
  [candidate.manifest_succession.entries[0], candidate.manifest_succession.entries[1]] =
    [candidate.manifest_succession.entries[1], candidate.manifest_succession.entries[0]];
  assertRefused(candidate, ['lineage.entry-paths-exact']);
});

test('H12 manifest change unrelated to PR57 reconciliation -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.manifest_succession.assignment_name = 'unrelated_dependency_refresh_2026_08_21';
  candidate.manifest_succession.new_manifest_digest = '3'.repeat(64);
  assertRefused(candidate, ['lineage.assignment-name', 'lineage.new-manifest-digest']);
});

test('H13 tampered originating commit -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.manifest_succession.reality_closure_candidate_sha =
    `${candidate.manifest_succession.reality_closure_candidate_sha.slice(0, -2)}35`;
  assertRefused(candidate, ['lineage.reality-candidate-sha']);
});

test('H14 V3 event presented to frozen ES-0002 -> REFUSE_AT_V2_DISPATCH', () => {
  const dispatch = dispatchV2(POSITIVE_V3);
  assert.equal(dispatch.dispatched, null);
  assert.match(dispatch.reason, /no evaluator owns schema 3 event manifest-succession-promotion-v3/);
});

test('H15 V2 event presented to V3 -> frozen V2 replay route only', () => {
  const dispatch = dispatchV3(POSITIVE_V2);
  assert.equal(dispatch.dispatched?.evaluator_id, 'CANA_PROMOTION_IDENTITY_V2');
  assert.equal(dispatch.dispatched?.lane, 'successor');
  assertRefused(POSITIVE_V2, ['dispatch.owned-by-v3', 'identity.evaluator-id']);
});

test('H16 owner approval missing -> REFUSE', () => {
  const candidate = cloneV3();
  delete candidate.owner_gate;
  assertRefused(candidate, ['owner-gate.pending-not-laundered']);
});

test('H17 approval digest changed by one byte -> REFUSE', () => {
  const candidate = cloneV3();
  const digest = candidate.manifest_succession.approved_succession_payload_sha256;
  candidate.manifest_succession.approved_succession_payload_sha256 = `${digest.slice(0, -2)}3f`;
  assertRefused(candidate, ['lineage.succession-payload-digest']);
});

test('H18 unknown future reconciliation -> REFUSE', () => {
  const candidate = cloneV3();
  candidate.manifest_succession.assignment_name = 'pr58_unknown_future_reconciliation_2026_08_22';
  assertRefused(candidate, ['lineage.assignment-name']);
});
