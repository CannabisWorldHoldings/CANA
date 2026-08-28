import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER = path.join(ROOT, 'docs/technical-promotion/POST_CLASS_D_REMAINING_CAPABILITY_LEDGER.jsonl');
export const MANIFEST = path.join(ROOT, 'docs/technical-promotion/POST_CLASS_D_REQUIRED_CAPABILITY_MANIFEST.json');
export const SUPERSESSION = path.join(ROOT, 'docs/technical-promotion/CANONICAL_CAPABILITY_SUPERSESSION_LEDGER.md');
export const GITHUB_CUSTODY = path.join(ROOT, 'docs/technical-promotion/POST_CLASS_D_GITHUB_CUSTODY.json');
export const GITHUB_WEB_FLOW_KEY = path.join(ROOT, 'tools/promotion-gate/github-web-flow-signing-key.asc');
const GITHUB_WEB_FLOW_FINGERPRINT = '968479A1AFF927E37D1A566BB5690EEEBB952194';
const DURABILITY_BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const ASSESSMENT_COMMIT = 'e0466894121a4c92f0512cfa47e649815c7a3948';
const GIT_BLOB_PROOF_PATHS = Object.freeze({
  'git.owner_console': 'apps/web/src/app/admin/console/page.tsx',
  'git.authority': 'tools/authority/authority.mjs',
  'git.vanguard_console': 'tools/vanguard/console.mjs',
  'git.experience_fabric': 'tools/experience-fabric/layout-kernel.mjs',
  'git.asset_registry': 'apps/web/src/lib/asset-registry.mjs',
  'git.homepage_hero': 'apps/web/src/components/marketplace-home-hero.tsx',
  'git.os_recovery_inventory': 'docs/convergence/mission-1/INTELLIGENCE_OS_RECOVERY_STATUS.md',
  'git.component_disposition': 'docs/convergence/mission-1/COMPONENT_DISPOSITION.md',
  'git.source_ledger': 'docs/convergence/mission-1/SOURCE_LEDGER.md',
  'git.local_verification': 'docs/convergence/mission-1/LOCAL_VERIFICATION_RECEIPTS.json',
  'git.runtime_inclusion_manifest': 'docs/convergence/mission-1/RUNTIME_INCLUSION_MANIFEST.json',
  'git.alive_loop_adapter': 'tools/alive-loop/adapter.mjs',
  'git.authority_receipts': 'tools/authority/receipts.mjs',
  'git.evidence_envelope': 'packages/governor-kernel/standalone/runtime/evidence.py',
  'git.provider_boundary': 'packages/governor-kernel/standalone/runtime/model_router.py',
  'git.change_pipeline': 'skills-src/cana-signal-to-fix.mjs',
  'git.restart_court': 'tools/mission-2/mission-2.test.mjs',
  'git.winner_memory': 'tools/alive-loop/winner-memory.mjs',
  'git.sitemind_core': 'packages/governor-kernel/sitemind-core/ATTACK_COURT_RECEIPT.json',
  'git.hermes_boundary': 'tools/authority/hermes-boundary.test.mjs',
  'git.merchant_core': 'apps/web/src/lib/growth-os.mjs',
  'git.merchant_ai': 'packages/ai/package.json',
  'git.customer_delivery': 'apps/web/src/app/[domain]/delivery/page.tsx',
  'git.growth_core': 'tools/growth-foundry/m001/claim-graph.mjs',
  'git.cloudflare_foundation': 'apps/web/open-next.config.ts',
  'git.postgis_adr': 'docs/adr/0001-postgresql-postgis-canonical-datastore.md',
});
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
const sha256File = (file) => sha256(fs.readFileSync(file));
const gitLargeText = (args) => {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
};

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
    'tools/promotion-gate/github-web-flow-signing-key.asc',
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
    [expectedPaths[2], 'Ledger-Github-Key-SHA256'],
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

export function validateProofAllowlist(manifest) {
  const actualGitProofs = Object.entries(manifest.proofs)
    .filter(([, proof]) => proof.type === 'git_blob')
    .map(([proofId]) => proofId);
  exactSet(actualGitProofs, Object.keys(GIT_BLOB_PROOF_PATHS), 'git blob proof identity drift');
  for (const [proofId, expectedPath] of Object.entries(GIT_BLOB_PROOF_PATHS)) {
    const proof = manifest.proofs[proofId];
    assert.equal(proof.commit, ASSESSMENT_COMMIT, `${proofId}.commit semantic drift`);
    assert.equal(proof.path, expectedPath, `${proofId}.path semantic drift`);
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
  validateProofAllowlist(manifest);
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
  assert.deepEqual(Object.keys(receipt).sort(), ['authorization_source_sha256', 'court_sha256', 'github_web_flow_key_sha256', 'kind', 'manifest_sha256', 'parent_commit', 'parent_tree', 'production_effects', 'schema', 'signature_verification_requirement', 'verifier_sha256']);
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
  assert.equal(receipt.github_web_flow_key_sha256, sha256(git(['show', `${parent}:tools/promotion-gate/github-web-flow-signing-key.asc`], { encoding: null })));
  assert.equal(receipt.authorization_source_sha256, manifest.owner_authorization_source_sha256);
  assert.equal(receipt.signature_verification_requirement, manifest.github_custody.verification_requirement);
  assert.equal(receipt.production_effects, 0);
  assert.equal(gitText(['rev-parse', `${receiptCommit}^`]), parent, 'receipt-side parent drift');
  assert.equal(gitText(['show', '-s', '--format=%T', receiptCommit]), gitText(['show', '-s', '--format=%T', head]), 'signed merge tree differs from receipt tree');
  assert.deepEqual(gitText(['diff-tree', '--no-commit-id', '--name-only', '-r', receiptCommit]).split('\n').filter(Boolean), [rel(GITHUB_CUSTODY)]);
  assert.deepEqual(gitText(['diff-tree', '-m', '--no-commit-id', '--name-only', '-r', head]).split('\n').filter(Boolean), [rel(GITHUB_CUSTODY)]);
  const signature = validateGithubCommitSignature(head);
  assert.equal(signature, 'SIGNATURE_VERIFIED', 'exact-head GitHub signature must be independently verified');
  return { state: 'GITHUB_CUSTODY_RECEIPT_PRESENT', externallyVerified: true, signature, commit: head };
}

function gpgExecutable() {
  for (const candidate of ['/opt/homebrew/bin/gpg', '/usr/local/bin/gpg', '/usr/bin/gpg']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function validateGithubCommitSignature(commit = gitText(['rev-parse', 'HEAD'])) {
  assert.equal(fs.existsSync(GITHUB_WEB_FLOW_KEY), true, 'pinned GitHub web-flow signing key is missing');
  const gpg = gpgExecutable();
  if (!gpg) return 'EXTERNAL_SIGNATURE_REQUIRED';
  const gpgHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-github-signature-'));
  fs.chmodSync(gpgHome, 0o700);
  try {
    const show = spawnSync(gpg, ['--batch', '--with-colons', '--import-options', 'show-only', '--import', GITHUB_WEB_FLOW_KEY], {
      env: { ...process.env, GNUPGHOME: gpgHome }, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    assert.equal(show.status, 0, show.stderr || 'unable to inspect pinned GitHub signing key');
    const fingerprints = `${show.stdout}\n${show.stderr}`.split('\n')
      .filter((line) => line.startsWith('fpr:'))
      .map((line) => line.split(':')[9]);
    assert.equal(fingerprints.includes(GITHUB_WEB_FLOW_FINGERPRINT), true, 'pinned GitHub signing key fingerprint drift');
    const imported = spawnSync(gpg, ['--batch', '--import', GITHUB_WEB_FLOW_KEY], {
      env: { ...process.env, GNUPGHOME: gpgHome }, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    assert.equal(imported.status, 0, imported.stderr || 'unable to import pinned GitHub signing key');
    const verified = spawnSync('git', ['-c', `gpg.program=${gpg}`, 'verify-commit', commit], {
      cwd: ROOT, env: { ...process.env, GNUPGHOME: gpgHome }, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    assert.equal(verified.status, 0, `exact-head GitHub signature verification failed: ${verified.stderr || verified.stdout}`);
    assert.match(`${verified.stdout}\n${verified.stderr}`, /GitHub <noreply@github\.com>/, 'exact-head signature was not made by the pinned GitHub identity');
    return 'SIGNATURE_VERIFIED';
  } finally {
    fs.rmSync(gpgHome, { recursive: true, force: true });
  }
}

function validateDurabilityArtifact(head, tree, build, verify) {
  assert.equal(build.artifact, verify.artifact, 'durability receipt artifact path mismatch');
  const artifact = fs.realpathSync(build.artifact);
  assert.equal(path.basename(artifact), head, 'durability artifact is not named for the exact head');
  const artifactManifestPath = path.join(artifact, 'manifest.json');
  const checksumsPath = path.join(artifact, 'SHA256SUMS.txt');
  for (const required of [artifactManifestPath, checksumsPath, path.join(artifact, 'repo.bundle'), path.join(artifact, 'outgoing.patch'), path.join(artifact, 'commits.mbox')]) {
    assert.equal(fs.statSync(required).isFile(), true, `durability artifact file missing: ${path.basename(required)}`);
  }
  const artifactManifest = JSON.parse(fs.readFileSync(artifactManifestPath, 'utf8'));
  assert.equal(artifactManifest.schemaVersion, 1);
  assert.equal(artifactManifest.kind, 'CANA candidate durability artifact');
  assert.deepEqual(
    { commit: artifactManifest.source.commit, tree: artifactManifest.source.tree, status: artifactManifest.source.status },
    { commit: head, tree, status: '' },
    'durability artifact source drift',
  );
  assert.equal(artifactManifest.baseCommit, DURABILITY_BASE, 'durability base drift');
  assert.equal(gitText(['show', '-s', '--format=%T', DURABILITY_BASE]), artifactManifest.baseTree, 'durability base tree drift');
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', DURABILITY_BASE, head], { cwd: ROOT }).status, 0, 'durability base is not an ancestor');

  const checksumEntries = fs.readFileSync(checksumsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^([0-9a-f]{64})  ([^/]+)$/);
    assert.equal(Boolean(match), true, `invalid durability checksum line: ${line}`);
    return { digest: match[1], name: match[2] };
  });
  exactSet(checksumEntries.map(({ name }) => name), ['repo.bundle', 'outgoing.patch', 'commits.mbox', 'manifest.json'], 'durability checksum inventory drift');
  assert.equal(checksumEntries.length, 4, 'durability checksum entries must be unique');
  for (const { digest, name } of checksumEntries) assert.equal(sha256File(path.join(artifact, name)), digest, `durability checksum failed: ${name}`);

  const bundle = path.join(artifact, 'repo.bundle');
  assert.equal(sha256File(bundle), build.bundleSha256, 'durability bundle receipt digest drift');
  const bundleVerify = spawnSync('git', ['bundle', 'verify', bundle], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(bundleVerify.status, 0, bundleVerify.stderr || 'durability bundle verification failed');
  const bundleHeads = gitText(['bundle', 'list-heads', bundle]);
  assert.equal(bundleHeads.split('\n').some((line) => line.startsWith(`${head} `)), true, 'durability bundle does not contain exact head');

  const expectedPatch = gitLargeText(['diff', '--binary', DURABILITY_BASE, head]);
  assert.equal(fs.readFileSync(path.join(artifact, 'outgoing.patch'), 'utf8').trim(), expectedPatch, 'durability binary patch does not reproduce exact source diff');
  const historyPatch = gitLargeText(['log', '--format=commit %H%nAuthor: %an <%ae>%nDate: %aI%n', '-p', '--binary', `${DURABILITY_BASE}..${head}`]);
  assert.equal(artifactManifest.secretScan.scope, `all outgoing commit patches ${DURABILITY_BASE}..${head}`);
  assert.equal(artifactManifest.secretScan.status, 'PASS');
  assert.deepEqual(artifactManifest.secretScan.findings, []);
  assert.equal(artifactManifest.secretScan.historyPatchSha256, sha256(historyPatch), 'durability history secret-scan input drift');
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    /\bsk-[A-Za-z0-9_-]{32,255}\b/g,
    /\bAIza[0-9A-Za-z_-]{35}\b/g,
    /\b(?:sk|rk)_live_[0-9A-Za-z]{16,255}\b/g,
  ];
  for (const pattern of secretPatterns) assert.doesNotMatch(historyPatch, pattern, 'outgoing-history secret scan failed');

  const tarball = `${artifact}.tar.gz`;
  assert.equal(build.tarball, tarball, 'durability tarball path drift');
  assert.equal(fs.statSync(tarball).size, build.tarballBytes, 'durability tarball size drift');
  assert.equal(sha256File(tarball), build.tarballSha256, 'durability tarball receipt digest drift');
  assert.deepEqual(
    { checksumCount: verify.checksumCount, bundle: verify.bundle, gitFsck: verify.gitFsck, bundleReconstructionTree: verify.bundleReconstructionTree, binaryPatchReconstructionTree: verify.binaryPatchReconstructionTree, focusedStatus: verify.focusedExecution?.status },
    { checksumCount: 4, bundle: 'PASS', gitFsck: 'PASS', bundleReconstructionTree: tree, binaryPatchReconstructionTree: tree, focusedStatus: 'PASS' },
    'durability verification receipt drift',
  );
}

export function validateExternalReceipts(manifest) {
  const evidenceRoot = path.join(ROOT, manifest.verification_receipt_policy.evidence_root);
  if (!fs.existsSync(evidenceRoot)) return { exactReceipts: 0, durabilitySecretScan: 'NOT_PRESENT' };
  const head = gitText(['rev-parse', 'HEAD']);
  const tree = gitText(['show', '-s', '--format=%T', head]);
  const receipts = [];
  const expectedKinds = new Set(['verify-focused', 'durability-build', 'durability-verify']);
  for (const name of fs.readdirSync(evidenceRoot)) {
    if (!name.endsWith('.json')) continue;
    try {
      const body = JSON.parse(fs.readFileSync(path.join(evidenceRoot, name), 'utf8'));
      if (expectedKinds.has(body?.kind) && body?.source?.commit === head && body?.source?.tree === tree && body?.source?.status === '' && body?.overall === 'PASS') receipts.push(body);
    } catch { /* reviewer reports and unrelated evidence are not source receipts */ }
  }
  if (receipts.length === 0) return { exactReceipts: 0, durabilitySecretScan: 'NOT_PRESENT' };
  exactSet(receipts.map((body) => body.kind), expectedKinds, 'exact-head verification receipt set drift');
  assert.equal(receipts.length, expectedKinds.size, 'duplicate exact-head verification receipt kind');
  const durabilityBuild = receipts.find((body) => body.kind === 'durability-build');
  const durabilityVerify = receipts.find((body) => body.kind === 'durability-verify');
  assert.equal(durabilityBuild.secretScan, 'PASS', 'exact-head durability secret scan did not pass');
  validateDurabilityArtifact(head, tree, durabilityBuild, durabilityVerify);
  return { exactReceipts: receipts.length, durabilitySecretScan: 'PASS', artifactVerification: 'PASS' };
}
