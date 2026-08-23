#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { canonicalJson, digestCanonical } from './reconstruction-contracts.mjs';

const RECEIPT_SCHEMA = 'zenith-reconstruction-receipt/v1';
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const JSON_ARTIFACTS = Object.freeze({
  'docs/zenith/NEED_ITEM_INPUTS.json': 'zenith-need-inputs/v1',
  'docs/zenith/NEED_ITEM_LEDGER.json': 'zenith-need-ledger/v1',
  'docs/zenith/CURRENT_STATE_PR_CAPTURE.json': 'zenith-pr-captured-input/v2',
  'docs/zenith/PR_CONSUMPTION_LEDGER.json': 'zenith-pr-consumption-ledger/v1',
  'docs/zenith/DONOR_SCAN_INPUTS.json': 'zenith-donor-scan-inputs/v1',
  'docs/zenith/SOURCE_HISTORY_PROJECTION.json': 'zenith-source-history-projection/v1',
  'docs/zenith/DESCENDANT_DISPOSITION.json': 'zenith-descendant-disposition/v1',
  'docs/zenith/DONOR_INSPECTION_MANIFEST.json': 'zenith-donor-inspection/v2',
});
const CODE_ARTIFACTS = Object.freeze([
  'tools/zenith/reconstruction-contracts.mjs',
  'tools/zenith/reconstruction-contracts.test.mjs',
  'tools/zenith/reconstruct-needs.mjs',
  'tools/zenith/reconstruct-needs.test.mjs',
  'tools/zenith/reconstruct-pr-consumption.mjs',
  'tools/zenith/reconstruct-pr-consumption.test.mjs',
  'tools/zenith/reconstruct-source-history.mjs',
  'tools/zenith/reconstruct-source-history.test.mjs',
]);
const REQUIRED_ARTIFACT_PATHS = Object.freeze([
  ...Object.keys(JSON_ARTIFACTS),
  ...CODE_ARTIFACTS,
].sort());
const ZERO_EFFECTS = Object.freeze({
  credential_reads: 0,
  deployments: 0,
  dns_writes: 0,
  production_mutations: 0,
  public_mutations: 0,
  spend_cents: 0,
});

export class ReconstructionReceiptError extends Error {
  constructor(detail) {
    super(`RECONSTRUCTION_RECEIPT_INVALID: ${detail}`);
    this.name = 'ReconstructionReceiptError';
    this.code = 'RECONSTRUCTION_RECEIPT_INVALID';
  }
}

function fail(detail) {
  throw new ReconstructionReceiptError(detail);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    fail(`git ${args[0]} failed`);
  }
  return { status: result.status, stdout: result.stdout.trim() };
}

function exactCommit(repoRoot, value, label) {
  if (!HEX40.test(value ?? '')) fail(`${label} must be an exact lowercase commit SHA`);
  const resolved = git(repoRoot, ['rev-parse', '--verify', `${value}^{commit}`]).stdout;
  if (resolved !== value) fail(`${label} does not resolve exactly`);
  return value;
}

function readBoundArtifact(repoRoot, logicalPath, schemaVersion = null) {
  const root = realpathSync(repoRoot);
  let current = root;
  for (const component of logicalPath.split('/')) {
    current = path.join(current, component);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) fail(`artifact symlink refused: ${logicalPath}`);
  }
  const resolved = realpathSync(current);
  if (!resolved.startsWith(`${root}${path.sep}`)) fail(`artifact escapes repository: ${logicalPath}`);
  const bytes = readFileSync(resolved);
  let parsed = null;
  if (schemaVersion) {
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      fail(`artifact JSON is invalid: ${logicalPath}`);
    }
    if (parsed?.schema_version !== schemaVersion) {
      fail(`${logicalPath} schema is not ${schemaVersion}`);
    }
  }
  return Object.freeze({
    logical_path: logicalPath,
    byte_sha256: sha256(bytes),
    byte_size: bytes.length,
    canonical_sha256: parsed ? digestCanonical(parsed) : null,
    schema_version: schemaVersion,
    parsed,
  });
}

function requireNone(value, label) {
  if (value !== 'NONE') fail(`${label} must declare authority_effect NONE`);
}

function requireZeroEffects(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} effects are invalid`);
  for (const effect of Object.values(value)) {
    if (effect !== 0 && effect !== false) fail(`${label} contains a non-zero effect`);
  }
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function requireArtifactSet(rows) {
  if (!Array.isArray(rows)) fail('reconstruction artifact list is invalid');
  const paths = rows.map((row) => row?.logical_path).sort();
  if (canonicalJson(paths) !== canonicalJson(REQUIRED_ARTIFACT_PATHS)) {
    fail('reconstruction artifact set is incomplete or contains undeclared paths');
  }
  for (const row of rows) {
    if (!HEX64.test(row?.byte_sha256 ?? '') || !Number.isSafeInteger(row?.byte_size) || row.byte_size < 1) {
      fail(`reconstruction artifact identity is invalid: ${row?.logical_path ?? 'UNKNOWN'}`);
    }
    const expectedSchema = JSON_ARTIFACTS[row.logical_path];
    if (expectedSchema && (row.schema_version !== expectedSchema || !HEX64.test(row?.canonical_sha256 ?? ''))) {
      fail(`reconstruction JSON artifact identity is invalid: ${row.logical_path}`);
    }
  }
}

function requireEvidenceRelations(artifacts) {
  const needInputs = artifacts.get('docs/zenith/NEED_ITEM_INPUTS.json');
  const needLedger = artifacts.get('docs/zenith/NEED_ITEM_LEDGER.json');
  const capture = artifacts.get('docs/zenith/CURRENT_STATE_PR_CAPTURE.json');
  const prLedger = artifacts.get('docs/zenith/PR_CONSUMPTION_LEDGER.json');
  const donorInputs = artifacts.get('docs/zenith/DONOR_SCAN_INPUTS.json');
  const history = artifacts.get('docs/zenith/SOURCE_HISTORY_PROJECTION.json');
  const dispositions = artifacts.get('docs/zenith/DESCENDANT_DISPOSITION.json');
  const inspection = artifacts.get('docs/zenith/DONOR_INSPECTION_MANIFEST.json');

  requireNone(needLedger.parsed.authority_effect, 'NeedItem ledger');
  requireZeroEffects(needLedger.parsed.external_effects, 'NeedItem ledger');
  if (needLedger.parsed.input_manifest_digest !== needInputs.canonical_sha256) {
    fail('NeedItem input manifest digest does not match exact canonical bytes');
  }
  if (!Array.isArray(needLedger.parsed.need_items) || needLedger.parsed.need_items.length === 0) {
    fail('NeedItem ledger is empty');
  }
  if (needLedger.parsed.need_items.some((item) => item.authority_effect !== 'NONE' || item.decision_eligible !== false)) {
    fail('NeedItem authority or decision boundary changed');
  }

  requireNone(capture.parsed.authority_effect, 'PR capture');
  requireZeroEffects({ capture_external_effects: capture.parsed.external_effects.length }, 'PR capture');
  requireNone(prLedger.parsed.policy?.authority_effect, 'PR ledger');
  requireZeroEffects({ ledger_external_effects: prLedger.parsed.policy?.external_effects?.length }, 'PR ledger');
  if (prLedger.parsed.capture?.normalized_capture_sha256 !== capture.byte_sha256) {
    fail('PR ledger does not bind the exact normalized capture bytes');
  }
  if (!Array.isArray(prLedger.parsed.pr_consumptions) || prLedger.parsed.pr_consumptions.length === 0) {
    fail('PR consumption ledger is empty');
  }
  if (prLedger.parsed.pr_consumptions.some((row) => row.authority_effect !== 'NONE' || row.disposition === 'DISCARDED')) {
    fail('PR ledger contains authority or discard inference');
  }

  for (const artifact of [history, dispositions, inspection]) {
    requireNone(artifact.parsed.authority_effect, artifact.logical_path);
    requireZeroEffects(artifact.parsed.external_effects, artifact.logical_path);
  }
  if (
    history.parsed.main_sha !== donorInputs.parsed.main_sha
    || dispositions.parsed.main_sha !== donorInputs.parsed.main_sha
    || inspection.parsed.main_sha !== donorInputs.parsed.main_sha
  ) fail('source-history main SHA identity drifted');
  if (inspection.parsed.input_digest !== donorInputs.canonical_sha256) {
    fail('donor inspection does not bind the exact canonical scan inputs');
  }
  if (inspection.parsed.scan_complete !== true || dispositions.parsed.scan_complete !== true) {
    fail('donor absence cannot be receipted from an incomplete scan');
  }
  if (
    inspection.parsed.scan_counts?.bundle_object_inspections_complete
      !== inspection.parsed.scan_counts?.bundles_inspected
    || inspection.parsed.scan_counts?.bundle_object_inspections_incomplete !== 0
  ) fail('bundle object inspection is incomplete');
  if ((dispositions.parsed.donors ?? []).some((donor) => donor.disposition === 'ABSENT' && inspection.parsed.scan_complete !== true)) {
    fail('ABSENT donor claim lacks a complete scan');
  }

  return {
    needInputs: needInputs.parsed,
    needLedger: needLedger.parsed,
    capture: capture.parsed,
    prLedger: prLedger.parsed,
    donorInputs: donorInputs.parsed,
    history: history.parsed,
    dispositions: dispositions.parsed,
    inspection: inspection.parsed,
  };
}

export function buildReconstructionReceipt({
  repository,
  artifacts,
  protectedC1Sha,
  protectedC1Tree,
  reconstructionHead,
  reconstructionTree,
}) {
  const parsed = requireEvidenceRelations(artifacts);
  if (repository.main_sha !== parsed.donorInputs.main_sha || repository.main_sha !== parsed.prLedger.capture.main_sha) {
    fail('remote main identity differs across reconstruction artifacts');
  }
  const needItems = parsed.needLedger.need_items;
  const prRows = parsed.prLedger.pr_consumptions;
  const artifactRows = [...artifacts.values()].map((artifact) => ({
    logical_path: artifact.logical_path,
    byte_sha256: artifact.byte_sha256,
    byte_size: artifact.byte_size,
    ...(artifact.schema_version ? {
      canonical_sha256: artifact.canonical_sha256,
      schema_version: artifact.schema_version,
    } : {}),
  })).sort((left, right) => left.logical_path.localeCompare(right.logical_path));
  requireArtifactSet(artifactRows);

  const body = {
    schema_version: RECEIPT_SCHEMA,
    status: 'PARTIALLY_IMPLEMENTED',
    observed_at: parsed.inspection.observed_at,
    repository: {
      name_with_owner: parsed.capture.repository?.name_with_owner ?? 'UNKNOWN',
      remote_main_sha: repository.main_sha,
      protected_c1_sha: protectedC1Sha,
      protected_c1_tree: protectedC1Tree,
      reconstruction_head_sha: reconstructionHead,
      reconstruction_head_tree: reconstructionTree,
      ancestry: {
        remote_main_is_ancestor_of_reconstruction: true,
        protected_c1_is_ancestor_of_reconstruction: true,
      },
    },
    artifacts: artifactRows,
    needs: {
      count: needItems.length,
      epistemic_states: countBy(needItems, 'epistemic_state'),
      owner_counts: countBy(needItems, 'owner'),
      open_gates: needItems.map((item) => ({
        id: item.id,
        need_kind: item.need_kind,
        epistemic_state: item.epistemic_state,
        owner: item.owner,
        next_gate: item.next_gate,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    },
    pr_consumption: {
      capture_sha256: parsed.prLedger.capture.normalized_capture_sha256,
      row_count: prRows.length,
      dispositions: countBy(prRows, 'disposition'),
      discard_inference: false,
    },
    source_history: {
      main_sha: parsed.history.main_sha,
      scan_complete: parsed.inspection.scan_complete,
      containers_seen: parsed.inspection.scan_counts.containers_seen,
      archives_seen: parsed.inspection.scan_counts.archive_containers,
      bundles_inspected: parsed.inspection.scan_counts.bundles_inspected,
      bundle_object_inspections_complete: parsed.inspection.scan_counts.bundle_object_inspections_complete,
      quarantined_members: parsed.inspection.scan_counts.quarantined_members,
      rejected_members: parsed.inspection.scan_counts.rejected_members,
      limitations: parsed.inspection.limitations,
      known_commits: parsed.dispositions.known_commits,
      donors: parsed.dispositions.donors,
    },
    completion_boundary: {
      declared_reconstruction_inputs_complete: true,
      global_project_completion_claimed: false,
      production_ready_claimed: false,
      promotion_authority_granted: false,
      unresolved_states_preserved: true,
    },
    authority_effect: 'NONE',
    production_effects: 0,
    external_effects: ZERO_EFFECTS,
  };
  return Object.freeze({ ...body, receipt_sha256: sha256(canonicalJson(body)) });
}

export function verifyReconstructionReceipt(input) {
  if (!input || input.schema_version !== RECEIPT_SCHEMA || !HEX64.test(input.receipt_sha256 ?? '')) {
    fail('receipt shape is invalid');
  }
  const { receipt_sha256: digest, ...body } = input;
  if (sha256(canonicalJson(body)) !== digest) fail('receipt digest mismatch');
  requireArtifactSet(input.artifacts);
  requireNone(input.authority_effect, 'reconstruction receipt');
  if (canonicalJson(input.external_effects) !== canonicalJson(ZERO_EFFECTS)) {
    fail('reconstruction receipt zero-effect vocabulary is incomplete or changed');
  }
  if (input.production_effects !== 0) fail('production effects must equal zero');
  return true;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--repo', '--expected-head', '--expected-tree', '--protected-c1', '--protected-c1-tree', '--main', '--output'].includes(key) || !value) {
      fail('usage: emit-reconstruction-receipt.mjs --repo <repo> --expected-head <sha> --expected-tree <sha> --protected-c1 <sha> --protected-c1-tree <sha> --main <sha> --output <json>');
    }
    parsed[key.slice(2)] = value;
  }
  for (const key of ['repo', 'expected-head', 'expected-tree', 'protected-c1', 'protected-c1-tree', 'main', 'output']) {
    if (!parsed[key]) fail(`${key} is required`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = realpathSync(path.resolve(args.repo));
  const head = exactCommit(repoRoot, args['expected-head'], 'expected head');
  const tree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']).stdout;
  if (git(repoRoot, ['rev-parse', 'HEAD']).stdout !== head || tree !== args['expected-tree']) {
    fail('repository head or tree differs from the out-of-band expected identity');
  }
  const protectedC1 = exactCommit(repoRoot, args['protected-c1'], 'protected C1');
  const mainSha = exactCommit(repoRoot, args.main, 'main');
  if (git(repoRoot, ['show', '-s', '--format=%T', protectedC1]).stdout !== args['protected-c1-tree']) {
    fail('protected C1 tree differs from the expected identity');
  }
  if (
    git(repoRoot, ['merge-base', '--is-ancestor', mainSha, head], { allowFailure: true }).status !== 0
    || git(repoRoot, ['merge-base', '--is-ancestor', protectedC1, head], { allowFailure: true }).status !== 0
  ) fail('reconstruction head does not descend from main and protected C1');

  const artifacts = new Map();
  for (const [logicalPath, schema] of Object.entries(JSON_ARTIFACTS)) {
    artifacts.set(logicalPath, readBoundArtifact(repoRoot, logicalPath, schema));
  }
  for (const logicalPath of CODE_ARTIFACTS) {
    artifacts.set(logicalPath, readBoundArtifact(repoRoot, logicalPath));
  }
  const receipt = buildReconstructionReceipt({
    repository: { main_sha: mainSha },
    artifacts,
    protectedC1Sha: protectedC1,
    protectedC1Tree: args['protected-c1-tree'],
    reconstructionHead: head,
    reconstructionTree: tree,
  });
  verifyReconstructionReceipt(receipt);
  const output = path.resolve(args.output);
  const outputParent = realpathSync(path.dirname(output));
  if (!outputParent.startsWith(`${repoRoot}${path.sep}`)) fail('output must stay inside the repository');
  writeFileSync(output, `${JSON.stringify(JSON.parse(canonicalJson(receipt)), null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(`receipt_sha256=${receipt.receipt_sha256}\noutput=${output}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code ?? error.name ?? 'ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
