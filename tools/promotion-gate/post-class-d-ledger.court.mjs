import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER = path.join(ROOT, 'docs/technical-promotion/POST_CLASS_D_REMAINING_CAPABILITY_LEDGER.jsonl');
export const MANIFEST = path.join(ROOT, 'docs/technical-promotion/POST_CLASS_D_REQUIRED_CAPABILITY_MANIFEST.json');
export const SUPERSESSION = path.join(ROOT, 'docs/technical-promotion/CANONICAL_CAPABILITY_SUPERSESSION_LEDGER.md');
export const GITHUB_CUSTODY = path.join(ROOT, 'docs/technical-promotion/POST_CLASS_D_GITHUB_CUSTODY.json');
const ALLOWED_DISPOSITIONS = new Set(['CANONICAL', 'SUPERSEDED', 'REJECTED_WITH_REASON', 'DEFERRED_WITH_REASON', 'BOUNDED_UNKNOWN']);
const BASE_KEYS = ['schema', 'capability_id', 'high_value', 'domain', 'source', 'current_canonical', 'disposition', 'reason', 'evidence', 'next_gate', 'production_effects', 'assessed_at', 'assessed_against_sha', 'assessed_against_tree'].sort();
const INCLUSION_KEYS = ['artifact_inclusion', 'canonical_source', 'hosted_execution', 'product_import', 'production_authority'].sort();
const SOURCE_ONLY_INCLUSION = Object.freeze({
  canonical_source: 'VERIFIED_PRESENT',
  product_import: 'NOT_INCLUDED',
  artifact_inclusion: 'NOT_INCLUDED',
  hosted_execution: 'NOT_VERIFIED',
  production_authority: 'NONE',
});
const CREDENTIAL_PATTERNS = [
  /postgres(?:ql)?:\/\//i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/i,
  /\b(?:token|api[_-]?(?:token|key)|x-api-key|oauth[_-]?token|client[_-]?secret|password|secret|authorization)\s*[:=]\s*[^\s,;]{6,}/i,
  /\b(?:gh[pousr]_[a-z0-9]{20,}|sk-[a-z0-9_-]{20,})\b/i,
];

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const exactSet = (actual, expected, message) => assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort(), message);
const git = (args, options = {}) => execFileSync('git', args, { cwd: ROOT, encoding: options.encoding ?? 'utf8' });
const gitText = (args) => git(args).trimEnd();
const objectExists = (object) => spawnSync('git', ['cat-file', '-e', object], { cwd: ROOT }).status === 0;
const rel = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');

export function readLedger() {
  assert.equal(fs.existsSync(LEDGER), true, 'remaining capability ledger is missing');
  return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`ledger line ${index + 1} is not JSON: ${error.message}`); }
  });
}

export function readManifest() {
  assert.equal(fs.existsSync(MANIFEST), true, 'required capability manifest is missing');
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function trailers(commit) {
  const values = new Map();
  for (const line of gitText(['show', '-s', '--format=%B', commit]).split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]+):\s*(\S+)$/);
    if (match) {
      assert.equal(values.has(match[1]), false, `duplicate commit trailer ${match[1]}`);
      values.set(match[1], match[2]);
    }
  }
  return values;
}

export function validateCourtCustody(manifest) {
  const admission = manifest.court_admission;
  assert.deepEqual(Object.keys(admission).sort(), ['authorization_effect', 'authorization_source_sha256', 'paths']);
  assert.equal(admission.authorization_effect, 'exact-reviewed-court-bytes-only');
  assert.equal(admission.authorization_source_sha256, manifest.owner_authorization_source_sha256);
  const expectedPaths = [
    'tools/promotion-gate/post-class-d-ledger.court.mjs',
    'tools/promotion-gate/post-class-d-ledger.court.test.mjs',
  ];
  exactSet(Object.keys(admission.paths), expectedPaths, 'court custody path drift');
  const custodyCommit = gitText(['log', '-1', '--format=%H', '--', rel(MANIFEST)]);
  assert.match(custodyCommit, /^[0-9a-f]{40}$/, 'manifest custody commit missing');
  const recorded = trailers(custodyCommit);
  assert.equal(recorded.get('Ledger-Manifest-SHA256'), sha256(git(['show', `${custodyCommit}:${rel(MANIFEST)}`], { encoding: null })));
  assert.equal(recorded.get('Ledger-Authorization-SHA256'), manifest.owner_authorization_source_sha256);
  for (const [courtPath, trailer] of [
    [expectedPaths[0], 'Ledger-Verifier-SHA256'],
    [expectedPaths[1], 'Ledger-Court-SHA256'],
  ]) {
    const digest = admission.paths[courtPath];
    const pathCommit = gitText(['log', '-1', '--format=%H', '--', courtPath]);
    const pathTrailers = trailers(pathCommit);
    assert.match(digest, /^[0-9a-f]{64}$/, courtPath);
    assert.match(pathCommit, /^[0-9a-f]{40}$/, `${courtPath} custody commit missing`);
    assert.equal(sha256(fs.readFileSync(path.join(ROOT, courtPath))), digest, courtPath);
    assert.equal(sha256(git(['show', `${pathCommit}:${courtPath}`], { encoding: null })), digest, courtPath);
    assert.equal(pathTrailers.get(trailer), digest, trailer);
    assert.equal(pathTrailers.get('Ledger-Authorization-SHA256'), manifest.owner_authorization_source_sha256);
  }
}

function validateProof(proofId, proof) {
  assert.equal(text(proofId) && proof && typeof proof === 'object' && !Array.isArray(proof), true, proofId);
  if (proof.type === 'git_blob') {
    assert.match(proof.commit, /^[0-9a-f]{40}$/, proofId);
    assert.equal(text(proof.path), true, proofId);
    assert.equal(objectExists(`${proof.commit}:${proof.path}`), true, `${proofId} does not resolve`);
    assert.equal(gitText(['cat-file', '-t', `${proof.commit}:${proof.path}`]), 'blob', proofId);
    return;
  }
  if (proof.type === 'assessment_observation') {
    for (const key of ['commit', 'tree', 'parent']) assert.match(proof[key], /^[0-9a-f]{40}$/, `${proofId}.${key}`);
    for (const key of ['patch_sha256', 'path_list_sha256']) assert.match(proof[key], /^[0-9a-f]{64}$/, `${proofId}.${key}`);
    assert.equal(Number.isInteger(proof.changed_path_count) && proof.changed_path_count > 0, true, proofId);
    const available = objectExists(`${proof.commit}^{commit}`);
    assert.equal(available || proof.object_optional === true, true, `${proofId} object unavailable without boundary`);
    if (available) {
      assert.equal(gitText(['show', '-s', '--format=%T', proof.commit]), proof.tree, `${proofId}.tree`);
      assert.equal(gitText(['show', '-s', '--format=%P', proof.commit]), proof.parent, `${proofId}.parent`);
      const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', proof.commit], { encoding: null });
      const patch = git(['show', '--format=', '--binary', proof.commit], { encoding: null });
      assert.equal(paths.toString('utf8').trim().split('\n').filter(Boolean).length, proof.changed_path_count, proofId);
      assert.equal(sha256(paths), proof.path_list_sha256, `${proofId}.path_list_sha256`);
      assert.equal(sha256(patch), proof.patch_sha256, `${proofId}.patch_sha256`);
    }
    return;
  }
  if (proof.type === 'external_boundary') {
    assert.deepEqual(Object.keys(proof).sort(), ['authority', 'boundary', 'may_access_credentials', 'may_execute', 'may_mutate_production', 'may_query_provider', 'type']);
    assert.equal(text(proof.boundary), true, proofId);
    assert.deepEqual(
      { authority: proof.authority, may_execute: proof.may_execute, may_query_provider: proof.may_query_provider, may_access_credentials: proof.may_access_credentials, may_mutate_production: proof.may_mutate_production },
      { authority: 'NONE', may_execute: false, may_query_provider: false, may_access_credentials: false, may_mutate_production: false },
      proofId,
    );
    return;
  }
  assert.fail(`${proofId} has unsupported proof type ${proof.type}`);
}

export function validateManifest(manifest) {
  assert.equal(manifest.schema, 'orderweeddc.post-class-d-required-capabilities.v1');
  assert.match(manifest.assessed_against_sha, /^[0-9a-f]{40}$/);
  assert.equal(gitText(['show', '-s', '--format=%T', manifest.assessed_against_sha]), manifest.assessed_against_tree, 'assessment tree mismatch');
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', manifest.assessed_against_sha, 'HEAD'], { cwd: ROOT }).status, 0, 'candidate does not descend from assessment');
  assert.match(manifest.owner_authorization_source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(new Set(manifest.assessment_diff_paths).size, manifest.assessment_diff_paths.length, 'duplicate diff paths');
  assert.deepEqual(Object.keys(manifest.github_custody).sort(), ['receipt_path', 'state', 'verification_requirement']);
  assert.equal(manifest.github_custody.state, 'PENDING_GITHUB_VERIFIED_COMMIT');
  assert.equal(manifest.github_custody.receipt_path, rel(GITHUB_CUSTODY));
  assert.equal(manifest.github_custody.verification_requirement.includes('verified=true'), true);
  assert.deepEqual(Object.keys(manifest.verification_receipt_policy).sort(), ['durability_secret_scan_required_when_receipts_present', 'evidence_root', 'exact_source_required']);
  assert.deepEqual(manifest.verification_receipt_policy, { evidence_root: '.omo/evidence', exact_source_required: true, durability_secret_scan_required_when_receipts_present: true });
  validateCourtCustody(manifest);
  for (const [proofId, proof] of Object.entries(manifest.proofs)) validateProof(proofId, proof);

  const ids = manifest.required_capabilities.map((entry) => entry.capability_id);
  assert.equal(new Set(ids).size, ids.length, 'manifest capability ids must be unique');
  for (const entry of manifest.required_capabilities) {
    const keys = entry.expected_inclusion ? ['capability_id', 'expected_disposition', 'expected_inclusion', 'proof_ids'] : ['capability_id', 'expected_disposition', 'proof_ids'];
    assert.deepEqual(Object.keys(entry).sort(), keys, entry.capability_id);
    assert.equal(text(entry.capability_id) && ALLOWED_DISPOSITIONS.has(entry.expected_disposition), true, entry.capability_id);
    assert.equal(Array.isArray(entry.proof_ids) && entry.proof_ids.length > 0, true, entry.capability_id);
    if (entry.expected_inclusion) assert.deepEqual(entry.expected_inclusion, SOURCE_ONLY_INCLUSION, entry.capability_id);
    for (const proofId of entry.proof_ids) {
      const proof = manifest.proofs[proofId];
      assert.equal(Boolean(proof), true, `${entry.capability_id}:${proofId}`);
      if (proof.type === 'external_boundary') assert.equal(entry.expected_disposition, 'BOUNDED_UNKNOWN', `${entry.capability_id}:${proofId}`);
      if (proof.type === 'assessment_observation' && proof.object_optional === true) assert.equal(['DEFERRED_WITH_REASON', 'REJECTED_WITH_REASON'].includes(entry.expected_disposition), true, `${entry.capability_id}:${proofId}`);
    }
  }

  const requiredIds = new Set(ids);
  const inventoried = new Set();
  for (const source of manifest.inventory_sources) {
    assert.equal(Array.isArray(source.capability_ids) && source.capability_ids.length > 0, true, source.inventory_id);
    if (source.type === 'owner_authorization_digest') assert.equal(source.source_sha256, manifest.owner_authorization_source_sha256, source.inventory_id);
    else if (source.type === 'git_blob_inventory') assert.equal(manifest.proofs[source.proof_id]?.type, 'git_blob', source.inventory_id);
    else assert.fail(`unsupported inventory source ${source.type}`);
    for (const id of source.capability_ids) { assert.equal(requiredIds.has(id), true, `${source.inventory_id}:${id}`); inventoried.add(id); }
  }
  exactSet(inventoried, requiredIds, 'full capability inventory reconciliation drift');

  const reconciled = new Set();
  for (const marker of manifest.independent_inventory_markers) {
    const proof = manifest.proofs[marker.proof_id];
    assert.equal(proof?.type, 'git_blob', marker.proof_id);
    assert.equal(gitText(['show', `${proof.commit}:${proof.path}`]).includes(marker.marker), true, `${marker.capability_id}:${marker.marker}`);
    reconciled.add(marker.capability_id);
  }
  exactSet(reconciled, ids.filter((id) => id.startsWith('orderweeddcrsi_')), 'independent ORDERWEEDDCRSI inventory reconciliation drift');

  const inclusionIds = new Set();
  for (const item of manifest.independent_inclusion_evidence) {
    assert.deepEqual(Object.keys(item).sort(), ['capability_id', 'proof_id']);
    const required = manifest.required_capabilities.find((entry) => entry.capability_id === item.capability_id);
    assert.deepEqual(required?.expected_inclusion, SOURCE_ONLY_INCLUSION, item.capability_id);
    const proof = manifest.proofs[item.proof_id];
    assert.equal(proof?.type, 'git_blob', item.proof_id);
    const source = gitText(['show', `${proof.commit}:${proof.path}`]);
    for (const marker of ['current product runtime inclusion: false', 'hosted OS execution: unproven', 'production provider routing: unproven', 'Any future production claim requires an intentional, separately authorized builder']) {
      assert.equal(source.includes(marker), true, `${item.capability_id}:${marker}`);
    }
    inclusionIds.add(item.capability_id);
  }
  exactSet(inclusionIds, ids.filter((id) => id.startsWith('orderweeddcrsi_')), 'independent inclusion evidence drift');

  const runtimeProof = manifest.proofs['git.runtime_inclusion_manifest'];
  const runtimeManifest = JSON.parse(gitText(['show', `${runtimeProof.commit}:${runtimeProof.path}`]));
  assert.equal(runtimeManifest.product_artifact_observation.convergence_runtime_included, false);
  const runtimeSeams = runtimeManifest.components.find((entry) => entry.id === 'intelligence-os-runtime-seams');
  assert.equal(runtimeSeams.included_in_orderweeddc_artifact, false);
}

export function validateLedger(entries, manifest) {
  const required = new Map(manifest.required_capabilities.map((entry) => [entry.capability_id, entry]));
  assert.equal(entries.length, required.size, 'ledger row count differs from required manifest');
  exactSet(entries.map((entry) => entry.capability_id), required.keys(), 'ledger capability set drift');
  for (const entry of entries) {
    const expected = required.get(entry.capability_id);
    const keys = expected.expected_inclusion ? [...BASE_KEYS, 'inclusion'].sort() : BASE_KEYS;
    assert.deepEqual(Object.keys(entry).sort(), keys, entry.capability_id);
    assert.equal(entry.schema, 'orderweeddc.post-class-d-capability.v1');
    assert.equal(entry.high_value, true, entry.capability_id);
    for (const field of ['capability_id', 'domain', 'source', 'current_canonical', 'reason', 'next_gate']) assert.equal(text(entry[field]), true, `${entry.capability_id}.${field}`);
    assert.equal(entry.reason.length >= 24 && entry.disposition === expected.expected_disposition, true, entry.capability_id);
    assert.deepEqual(entry.evidence, expected.proof_ids, entry.capability_id);
    if (expected.expected_inclusion) { assert.deepEqual(Object.keys(entry.inclusion).sort(), INCLUSION_KEYS, entry.capability_id); assert.deepEqual(entry.inclusion, expected.expected_inclusion, entry.capability_id); }
    assert.equal(entry.production_effects, 0, entry.capability_id);
    assert.match(entry.assessed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, entry.capability_id);
    assert.equal(entry.assessed_against_sha, manifest.assessed_against_sha, entry.capability_id);
    assert.equal(entry.assessed_against_tree, manifest.assessed_against_tree, entry.capability_id);
  }
}

export function parseMarkdownDispositions(markdown) {
  const rows = new Map();
  for (const match of markdown.matchAll(/^\| `([^`]+)` \| ([A-Z_]+) \|/gm)) { assert.equal(rows.has(match[1]), false, `duplicate Markdown row ${match[1]}`); rows.set(match[1], match[2]); }
  return rows;
}

export function assertCredentialFree(value, label) {
  for (const pattern of CREDENTIAL_PATTERNS) assert.doesNotMatch(value, pattern, `${label} contains credential-shaped material`);
}

export function changedPathsSinceAssessment(manifest) {
  const paths = new Set();
  const ignoredEvidence = (candidate) => candidate.startsWith('.omo/evidence/') || candidate.startsWith('.cana-local/');
  for (const args of [['diff', '--name-only', `${manifest.assessed_against_sha}...HEAD`], ['diff', '--name-only'], ['diff', '--cached', '--name-only'], ['ls-files', '--others', '--exclude-standard']]) {
    for (const line of gitText(args).split('\n').filter(Boolean)) if (!ignoredEvidence(line)) paths.add(line);
  }
  return paths;
}

export function assertExactAssessmentDrift(manifest) {
  const expected = manifest.assessment_diff_paths.filter((candidate) => candidate !== rel(GITHUB_CUSTODY) || fs.existsSync(GITHUB_CUSTODY));
  exactSet(changedPathsSinceAssessment(manifest), expected, 'assessment has unrelated or missing source drift');
}

export function validateGithubCustody(manifest) {
  if (!fs.existsSync(GITHUB_CUSTODY)) return { state: manifest.github_custody.state, externallyVerified: false };
  const receipt = JSON.parse(fs.readFileSync(GITHUB_CUSTODY, 'utf8'));
  assert.deepEqual(Object.keys(receipt).sort(), ['authorization_source_sha256', 'court_sha256', 'kind', 'manifest_sha256', 'parent_commit', 'parent_tree', 'production_effects', 'schema', 'signature_verification_requirement', 'verifier_sha256']);
  const head = gitText(['rev-parse', 'HEAD']);
  const parents = gitText(['show', '-s', '--format=%P', head]).split(' ').filter(Boolean);
  assert.equal(parents.length, 2, 'GitHub custody head must be a two-parent authenticated merge');
  const [parent, receiptCommit] = parents;
  assert.equal(receipt.schema, 'orderweeddc.post-class-d-github-custody.v1');
  assert.equal(receipt.kind, 'GITHUB_VERIFIED_RECEIPT_COMMIT');
  assert.equal(receipt.parent_commit, parent);
  assert.equal(receipt.parent_tree, gitText(['show', '-s', '--format=%T', parent]));
  assert.equal(receipt.manifest_sha256, sha256(git(['show', `${parent}:${rel(MANIFEST)}`], { encoding: null })));
  assert.equal(receipt.verifier_sha256, sha256(git(['show', `${parent}:tools/promotion-gate/post-class-d-ledger.court.mjs`], { encoding: null })));
  assert.equal(receipt.court_sha256, sha256(git(['show', `${parent}:tools/promotion-gate/post-class-d-ledger.court.test.mjs`], { encoding: null })));
  assert.equal(receipt.authorization_source_sha256, manifest.owner_authorization_source_sha256);
  assert.equal(receipt.signature_verification_requirement, manifest.github_custody.verification_requirement);
  assert.equal(receipt.production_effects, 0);
  assert.equal(gitText(['rev-parse', `${receiptCommit}^`]), parent, 'receipt-side parent drift');
  assert.equal(gitText(['show', '-s', '--format=%T', receiptCommit]), gitText(['show', '-s', '--format=%T', head]), 'signed merge tree differs from receipt tree');
  assert.deepEqual(gitText(['diff-tree', '--no-commit-id', '--name-only', '-r', receiptCommit]).split('\n').filter(Boolean), [rel(GITHUB_CUSTODY)]);
  assert.deepEqual(gitText(['diff-tree', '-m', '--no-commit-id', '--name-only', '-r', head]).split('\n').filter(Boolean), [rel(GITHUB_CUSTODY)]);
  return { state: 'GITHUB_CUSTODY_RECEIPT_PRESENT', externallyVerified: false, commit: head };
}

export function validateExternalReceipts(manifest) {
  const evidenceRoot = path.join(ROOT, manifest.verification_receipt_policy.evidence_root);
  if (!fs.existsSync(evidenceRoot)) return { exactReceipts: 0, durabilitySecretScan: 'NOT_PRESENT' };
  const head = gitText(['rev-parse', 'HEAD']);
  const tree = gitText(['show', '-s', '--format=%T', head]);
  const receipts = [];
  for (const name of fs.readdirSync(evidenceRoot)) {
    if (!name.endsWith('.json')) continue;
    try {
      const body = JSON.parse(fs.readFileSync(path.join(evidenceRoot, name), 'utf8'));
      if (body?.source?.commit === head && body?.source?.tree === tree && body?.source?.status === '' && body?.overall === 'PASS') receipts.push(body);
    } catch { /* reviewer reports and unrelated evidence are not source receipts */ }
  }
  if (receipts.length === 0) return { exactReceipts: 0, durabilitySecretScan: 'NOT_PRESENT' };
  const durabilityBuild = receipts.find((body) => body.kind === 'durability-build');
  assert.equal(Boolean(durabilityBuild), true, 'exact-head durability-build receipt missing');
  assert.equal(durabilityBuild.secretScan, 'PASS', 'exact-head durability secret scan did not pass');
  return { exactReceipts: receipts.length, durabilitySecretScan: 'PASS' };
}
