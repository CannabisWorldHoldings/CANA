import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ReconstructionReceiptError,
  buildReconstructionReceipt,
  verifyReconstructionReceipt,
} from './emit-reconstruction-receipt.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const DIGEST = 'd'.repeat(64);

function artifact(logicalPath, schemaVersion, parsed) {
  return {
    logical_path: logicalPath,
    byte_sha256: logicalPath === 'docs/zenith/CURRENT_STATE_PR_CAPTURE.json' ? DIGEST : createHash('sha256').update(logicalPath).digest('hex'),
    byte_size: 100,
    canonical_sha256: parsed ? createHash('sha256').update(JSON.stringify(parsed)).digest('hex') : null,
    schema_version: schemaVersion,
    parsed,
  };
}

function fixture() {
  const needInputs = { schema_version: 'zenith-need-inputs/v1' };
  const donorInputs = { schema_version: 'zenith-donor-scan-inputs/v1', main_sha: SHA_A };
  const inspection = {
    schema_version: 'zenith-donor-inspection/v2', authority_effect: 'NONE',
    external_effects: { network: false }, input_digest: null, main_sha: SHA_A,
    observed_at: '2026-08-23T16:00:00.000Z', scan_complete: true, limitations: [],
    scan_counts: {
      containers_seen: 2, archive_containers: 1, bundles_inspected: 1,
      bundle_object_inspections_complete: 1, bundle_object_inspections_incomplete: 0,
      quarantined_members: 1, rejected_members: 0,
    },
  };
  const artifacts = new Map([
    ['docs/zenith/NEED_ITEM_INPUTS.json', artifact('docs/zenith/NEED_ITEM_INPUTS.json', needInputs.schema_version, needInputs)],
    ['docs/zenith/NEED_ITEM_LEDGER.json', artifact('docs/zenith/NEED_ITEM_LEDGER.json', 'zenith-need-ledger/v1', {
      schema_version: 'zenith-need-ledger/v1', authority_effect: 'NONE', external_effects: { deployments: 0 },
      input_manifest_digest: null,
      need_items: [{ id: 'need-1', need_kind: 'PROOF', epistemic_state: 'UNKNOWN', owner: 'UNKNOWN', next_gate: 'OWNER_PROOF', authority_effect: 'NONE', decision_eligible: false }],
    })],
    ['docs/zenith/CURRENT_STATE_PR_CAPTURE.json', artifact('docs/zenith/CURRENT_STATE_PR_CAPTURE.json', 'zenith-pr-captured-input/v2', {
      schema_version: 'zenith-pr-captured-input/v2', authority_effect: 'NONE', external_effects: [], repository: { name_with_owner: 'CANA/test' },
    })],
    ['docs/zenith/PR_CONSUMPTION_LEDGER.json', artifact('docs/zenith/PR_CONSUMPTION_LEDGER.json', 'zenith-pr-consumption-ledger/v1', {
      schema_version: 'zenith-pr-consumption-ledger/v1', capture: { normalized_capture_sha256: DIGEST, main_sha: SHA_A },
      policy: { authority_effect: 'NONE', external_effects: [] },
      pr_consumptions: [{ disposition: 'PENDING_REVIEW', authority_effect: 'NONE' }],
    })],
    ['docs/zenith/DONOR_SCAN_INPUTS.json', artifact('docs/zenith/DONOR_SCAN_INPUTS.json', donorInputs.schema_version, donorInputs)],
    ['docs/zenith/SOURCE_HISTORY_PROJECTION.json', artifact('docs/zenith/SOURCE_HISTORY_PROJECTION.json', 'zenith-source-history-projection/v1', {
      schema_version: 'zenith-source-history-projection/v1', authority_effect: 'NONE', external_effects: { network: false }, main_sha: SHA_A,
    })],
    ['docs/zenith/DESCENDANT_DISPOSITION.json', artifact('docs/zenith/DESCENDANT_DISPOSITION.json', 'zenith-descendant-disposition/v1', {
      schema_version: 'zenith-descendant-disposition/v1', authority_effect: 'NONE', external_effects: { network: false }, main_sha: SHA_A,
      scan_complete: true, known_commits: [{ sha: SHA_A, relation_to_main: 'ANCESTOR', disposition: 'REUSE_EXISTING' }],
      donors: [{ sha: SHA_B, disposition: 'ABSENT', epistemic_state: 'UNKNOWN' }],
    })],
    ['docs/zenith/DONOR_INSPECTION_MANIFEST.json', artifact('docs/zenith/DONOR_INSPECTION_MANIFEST.json', inspection.schema_version, inspection)],
  ]);
  for (const logicalPath of [
    'tools/zenith/reconstruction-contracts.mjs',
    'tools/zenith/reconstruction-contracts.test.mjs',
    'tools/zenith/reconstruct-needs.mjs',
    'tools/zenith/reconstruct-needs.test.mjs',
    'tools/zenith/reconstruct-pr-consumption.mjs',
    'tools/zenith/reconstruct-pr-consumption.test.mjs',
    'tools/zenith/reconstruct-source-history.mjs',
    'tools/zenith/reconstruct-source-history.test.mjs',
  ]) artifacts.set(logicalPath, artifact(logicalPath, null, null));
  artifacts.get('docs/zenith/NEED_ITEM_LEDGER.json').parsed.input_manifest_digest = artifacts.get('docs/zenith/NEED_ITEM_INPUTS.json').canonical_sha256;
  inspection.input_digest = artifacts.get('docs/zenith/DONOR_SCAN_INPUTS.json').canonical_sha256;
  return artifacts;
}

test('deterministic receipt binds bounded reconstruction evidence and preserves open truth', () => {
  const inputs = {
    repository: { main_sha: SHA_A }, artifacts: fixture(),
    protectedC1Sha: SHA_B, protectedC1Tree: 'c'.repeat(40),
    reconstructionHead: 'e'.repeat(40), reconstructionTree: 'f'.repeat(40),
  };
  const first = buildReconstructionReceipt(inputs);
  const second = buildReconstructionReceipt(inputs);
  assert.deepEqual(first, second);
  assert.equal(verifyReconstructionReceipt(first), true);
  assert.equal(first.status, 'PARTIALLY_IMPLEMENTED');
  assert.equal(first.completion_boundary.global_project_completion_claimed, false);
  assert.equal(first.pr_consumption.discard_inference, false);
  assert.equal(first.source_history.donors[0].disposition, 'ABSENT');
  assert.deepEqual(first.external_effects, {
    credential_reads: 0, deployments: 0, dns_writes: 0,
    production_mutations: 0, public_mutations: 0, spend_cents: 0,
  });
});

test('tampered receipt, non-zero effects, discarded PR rows, and incomplete donor scans fail closed', () => {
  const inputs = {
    repository: { main_sha: SHA_A }, artifacts: fixture(),
    protectedC1Sha: SHA_B, protectedC1Tree: 'c'.repeat(40),
    reconstructionHead: 'e'.repeat(40), reconstructionTree: 'f'.repeat(40),
  };
  const receipt = buildReconstructionReceipt(inputs);
  assert.throws(
    () => verifyReconstructionReceipt({ ...receipt, status: 'COMPLETE' }),
    (error) => error instanceof ReconstructionReceiptError,
  );

  const effectful = fixture();
  effectful.get('docs/zenith/NEED_ITEM_LEDGER.json').parsed.external_effects.deployments = 1;
  assert.throws(() => buildReconstructionReceipt({ ...inputs, artifacts: effectful }), /non-zero effect/);

  const discarded = fixture();
  discarded.get('docs/zenith/PR_CONSUMPTION_LEDGER.json').parsed.pr_consumptions[0].disposition = 'DISCARDED';
  assert.throws(() => buildReconstructionReceipt({ ...inputs, artifacts: discarded }), /discard inference/);

  const incomplete = fixture();
  incomplete.get('docs/zenith/DONOR_INSPECTION_MANIFEST.json').parsed.scan_complete = false;
  assert.throws(() => buildReconstructionReceipt({ ...inputs, artifacts: incomplete }), /incomplete scan/);
});
