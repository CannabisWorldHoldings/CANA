import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ContractError,
  canonicalJson,
  canonicalizeNeedItem,
  canonicalizePrConsumption,
  canonicalizeReconstructionContracts,
  canonicalizeSourceHistoryEdge,
  canonicalizeSourceHistoryNode,
  canonicalizeZenithReconstructionReceipt,
  digestCanonical,
  writeExclusiveOutputs,
} from './reconstruction-contracts.mjs';

const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const TREE = '3'.repeat(40);
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

function outputRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-output-custody-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const common = (id, overrides = {}) => ({
  schema_version: 'zenith-reconstruction/v1',
  id,
  source_kind: 'GIT_COMMIT',
  source_identity: SHA1,
  source_digest: DIGEST_A,
  source_path: 'docs/zenith/input.json',
  observed_at: '2026-08-23T00:00:00.000Z',
  epistemic_state: 'UNKNOWN',
  owner: 'UNKNOWN',
  evidence_refs: [
    { ref: 'docs/evidence/input.json', digest: DIGEST_B },
    { ref: 'docs/evidence/source.json', digest: DIGEST_C },
  ],
  authority_effect: 'NONE',
  ...overrides,
});

const validInput = () => ({
  need_items: [
    common('need_cloudflare_target', {
      need_state: 'BLOCKED_EXTERNAL',
      need_kind: 'CLOUDFLARE_TARGET_PROOF',
      next_gate: 'OWNER_CREDENTIALS',
      gate_kind: 'CREDENTIAL',
      decision_eligible: false,
    }),
    common('need_next_stable', {
      need_state: 'OPEN',
      need_kind: 'NEXT_STABLE_SECURITY_PATCH',
      next_gate: 'STABLE_RELEASE_RECOURT',
      gate_kind: 'SECURITY_RELEASE',
      decision_eligible: false,
    }),
  ],
  pr_consumptions: [common('prc_59', {
    pr_number: 59,
    pr_head_sha: SHA1,
    pr_base_sha: SHA2,
    pr_head_tree: TREE,
    changed_path: 'tools/vanguard/governor.mjs',
    head_blob_sha: SHA1,
    content_digest: DIGEST_A,
    disposition: 'CONSUMED_EXACT',
    consuming_commit: SHA2,
    consuming_path: 'tools/vanguard/governor.mjs',
  })],
  source_history_nodes: [common('shn_main', {
    node_kind: 'GIT_COMMIT',
    content_digest: DIGEST_A,
    descendant_disposition: 'CANDIDATE_EXACT',
  })],
  source_history_edges: [common('she_main_to_pr', {
    from_id: 'shn_main',
    to_id: 'prc_59',
    edge_kind: 'CONSUMES',
  })],
  receipt: common('zrr_current', {
    candidate_commit: SHA1,
    candidate_tree: TREE,
    input_digest: DIGEST_A,
    artifact_digests: [{ path: 'docs/zenith/NEED_ITEM_LEDGER.json', digest: DIGEST_B }],
  }),
});

test('canonical reconstruction contracts are byte-stable for reordered inputs', () => {
  const first = validInput();
  const second = validInput();
  second.need_items.reverse();
  second.need_items[0].evidence_refs.reverse();
  second.receipt.artifact_digests.reverse();

  const firstCanonical = canonicalizeReconstructionContracts(first);
  const secondCanonical = canonicalizeReconstructionContracts(second);

  assert.equal(canonicalJson(firstCanonical), canonicalJson(secondCanonical));
  assert.equal(digestCanonical(firstCanonical), digestCanonical(secondCanonical));
  console.log(`fixture_sha256=${digestCanonical(firstCanonical)}`);
  assert.deepEqual(firstCanonical.need_items.map((item) => item.id), ['need_cloudflare_target', 'need_next_stable']);
  assert.equal(firstCanonical.receipt.authority_effect, 'NONE');
});

test('individual reconstruction contracts require their typed fields', () => {
  assert.equal(canonicalizeNeedItem(validInput().need_items[0]).need_state, 'BLOCKED_EXTERNAL');
  assert.equal(canonicalizeNeedItem(validInput().need_items[0]).decision_eligible, false);
  assert.equal(canonicalizePrConsumption(validInput().pr_consumptions[0]).disposition, 'CONSUMED_EXACT');
  assert.equal(canonicalizePrConsumption(validInput().pr_consumptions[0]).pr_head_tree, TREE);
  assert.equal(canonicalizeSourceHistoryNode(validInput().source_history_nodes[0]).node_kind, 'GIT_COMMIT');
  assert.equal(canonicalizeSourceHistoryNode(validInput().source_history_nodes[0]).descendant_disposition, 'CANDIDATE_EXACT');
  assert.equal(canonicalizeSourceHistoryEdge(validInput().source_history_edges[0]).edge_kind, 'CONSUMES');
  assert.equal(canonicalizeZenithReconstructionReceipt(validInput().receipt).candidate_tree, TREE);
});

test('downstream vocabulary requires exact object coupling and preserves unresolved truth', () => {
  const unresolved = validInput().pr_consumptions[0];
  unresolved.disposition = 'UNRESOLVED_OBJECT';
  unresolved.head_blob_sha = 'UNRESOLVED';
  unresolved.content_digest = 'UNRESOLVED';
  delete unresolved.consuming_commit;
  delete unresolved.consuming_path;
  assert.equal(canonicalizePrConsumption(unresolved).head_blob_sha, 'UNRESOLVED');

  const filenameOnly = validInput().pr_consumptions[0];
  delete filenameOnly.consuming_path;
  assert.throws(() => canonicalizePrConsumption(filenameOnly), (error) => error instanceof ContractError && error.code === 'CONSUMPTION_PAIR_REQUIRED');

  assert.throws(() => canonicalizePrConsumption({ ...validInput().pr_consumptions[0], disposition: 'CONSUMED' }), (error) => error instanceof ContractError && error.code === 'ENUM_INVALID');
  assert.throws(() => canonicalizeSourceHistoryNode({ ...validInput().source_history_nodes[0], descendant_disposition: 'INFERRED' }), (error) => error instanceof ContractError && error.code === 'ENUM_INVALID');
  assert.throws(() => canonicalizeNeedItem({ ...validInput().need_items[0], decision_eligible: true }), (error) => error instanceof ContractError && error.code === 'NEED_DECISION_ELIGIBILITY_INVALID');
});

test('reconstruction contracts refuse duplicate ids, path escape, missing digests, invented verified, and authority laundering', () => {
  const duplicate = validInput();
  duplicate.need_items[1].id = duplicate.need_items[0].id;
  assert.throws(() => canonicalizeReconstructionContracts(duplicate), (error) => error instanceof ContractError && error.code === 'DUPLICATE_ID');

  assert.throws(() => canonicalizeNeedItem(common('need_escape', {
    need_state: 'OPEN', need_kind: 'X', next_gate: 'Y', source_path: '../outside.json',
  })), (error) => error instanceof ContractError && error.code === 'PATH_NOT_REPOSITORY_RELATIVE');

  assert.throws(() => canonicalizeNeedItem(common('need_missing_digest', {
    need_state: 'OPEN', need_kind: 'X', next_gate: 'Y', evidence_refs: [{ ref: 'docs/evidence/input.json' }],
  })), (error) => error instanceof ContractError && error.code === 'EVIDENCE_DIGEST_REQUIRED');

  assert.throws(() => canonicalizeNeedItem(common('need_invented_verified', {
    need_state: 'OPEN', need_kind: 'X', next_gate: 'Y', epistemic_state: 'VERIFIED',
  })), (error) => error instanceof ContractError && error.code === 'VERIFIED_WITHOUT_EVIDENCE');

  assert.throws(() => canonicalizeNeedItem(common('need_authority_laundering', {
    need_state: 'OPEN', need_kind: 'X', next_gate: 'Y', authority_effect: 'APPROVES_DEPLOYMENT', evidence_refs: [],
  })), (error) => error instanceof ContractError && error.code === 'AUTHORITY_EFFECT_FORBIDDEN');
});

test('exclusive output custody validates every payload before it creates a first artifact', (t) => {
  const root = outputRoot(t);
  assert.throws(() => writeExclusiveOutputs({
    root,
    outputs: [
      { outputPath: 'first.json', bytes: 'first\n' },
      { outputPath: 'invalid.json', bytes: { invalid: true } },
    ],
  }), (error) => error instanceof ContractError && error.code === 'OUTPUT_BYTES_INVALID');
  assert.equal(fs.existsSync(path.join(root, 'first.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'invalid.json')), false);
});

test('exclusive output custody removes earlier placeholders when a later exclusive open races', (t) => {
  const root = outputRoot(t);
  const first = path.join(root, 'first.json');
  const later = path.join(root, 'later.json');
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHook = process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK;
  process.env.NODE_ENV = 'test';
  process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK = 'RACE_LATER_OPEN';
  try {
    assert.throws(() => writeExclusiveOutputs({
      root,
      outputs: [{ outputPath: 'first.json', bytes: 'first\n' }, { outputPath: 'later.json', bytes: 'later\n' }],
    }), (error) => error instanceof ContractError && error.code === 'OUTPUT_ALREADY_EXISTS');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousHook === undefined) delete process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK;
    else process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK = previousHook;
  }
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(later), true);
  assert.equal(fs.statSync(later).size, 0);
});

test('exclusive output custody cleans opened files when a parent swaps to an outside symlink during write', (t) => {
  const root = outputRoot(t);
  const parent = path.join(root, 'parent');
  const parked = path.join(root, 'parked');
  fs.mkdirSync(parent);
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHook = process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK;
  process.env.NODE_ENV = 'test';
  process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK = 'SWAP_PARENT_DURING_WRITE';
  try {
    assert.throws(() => writeExclusiveOutputs({
      root,
      outputs: [{ outputPath: 'parent/first.json', bytes: 'first\n' }, { outputPath: 'parent/second.json', bytes: 'second\n' }],
    }), (error) => error instanceof ContractError && error.code === 'OUTPUT_CUSTODY_CHANGED');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousHook === undefined) delete process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK;
    else process.env.CANA_ZENITH_OUTPUT_CUSTODY_TEST_HOOK = previousHook;
  }
  assert.equal(fs.existsSync(path.join(parent, 'first.json')), false);
  assert.equal(fs.existsSync(path.join(parent, 'second.json')), false);
  assert.equal(fs.existsSync(path.join(parked, 'first.json')), false);
  assert.equal(fs.existsSync(path.join(parked, 'second.json')), false);
});
