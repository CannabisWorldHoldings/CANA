import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = path.join(
  ROOT,
  'docs/technical-promotion/POST_CLASS_D_REMAINING_CAPABILITY_LEDGER.jsonl',
);
const MANIFEST = path.join(
  ROOT,
  'docs/technical-promotion/POST_CLASS_D_REQUIRED_CAPABILITY_MANIFEST.json',
);
const SUPERSESSION = path.join(
  ROOT,
  'docs/technical-promotion/CANONICAL_CAPABILITY_SUPERSESSION_LEDGER.md',
);
const EXPECTED_MANIFEST_SHA256 = 'd28676577039c1659a5a360c05898623e98b16696e4efa3613e221e9321b910d';
const ALLOWED_DISPOSITIONS = new Set([
  'CANONICAL',
  'SUPERSEDED',
  'REJECTED_WITH_REASON',
  'DEFERRED_WITH_REASON',
  'BOUNDED_UNKNOWN',
]);
const EXACT_KEYS = [
  'schema',
  'capability_id',
  'high_value',
  'domain',
  'source',
  'current_canonical',
  'disposition',
  'reason',
  'evidence',
  'next_gate',
  'production_effects',
  'assessed_at',
  'assessed_against_sha',
  'assessed_against_tree',
].sort();
const CREDENTIAL_PATTERNS = [
  /postgres(?:ql)?:\/\//i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/i,
  /\b(?:api[_-]?token|oauth[_-]?token|password|secret|authorization)\s*[:=]\s*[^\s,;]{6,}/i,
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const exactSet = (actual, expected, message) => {
  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort(), message);
};
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trimEnd();
const gitObjectExists = (object) => spawnSync(
  'git',
  ['cat-file', '-e', object],
  { cwd: ROOT, encoding: 'utf8' },
).status === 0;

function readLedger() {
  assert.equal(fs.existsSync(LEDGER), true, 'remaining capability ledger is missing');
  return fs.readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`ledger line ${index + 1} is not JSON: ${error.message}`);
      }
    });
}

function readManifest() {
  assert.equal(fs.existsSync(MANIFEST), true, 'required capability manifest is missing');
  const bytes = fs.readFileSync(MANIFEST);
  assert.equal(sha256(bytes), EXPECTED_MANIFEST_SHA256, 'required capability manifest digest drift');
  return JSON.parse(bytes.toString('utf8'));
}

function validateProof(proofId, proof) {
  assert.equal(text(proofId), true, 'proof id must be non-empty');
  assert.equal(proof && typeof proof === 'object' && !Array.isArray(proof), true, proofId);
  if (proof.type === 'git_blob') {
    assert.match(proof.commit, /^[0-9a-f]{40}$/, proofId);
    assert.equal(text(proof.path), true, proofId);
    assert.equal(gitObjectExists(`${proof.commit}:${proof.path}`), true, `${proofId} does not resolve`);
    assert.equal(git(['cat-file', '-t', `${proof.commit}:${proof.path}`]), 'blob', proofId);
    return;
  }
  if (proof.type === 'assessment_observation') {
    for (const key of ['commit', 'tree', 'parent', 'patch_sha256', 'path_list_sha256']) {
      assert.match(proof[key], /^[0-9a-f]{40}$|^[0-9a-f]{64}$/, `${proofId}.${key}`);
    }
    assert.equal(Number.isInteger(proof.changed_path_count) && proof.changed_path_count > 0, true, proofId);
    const available = gitObjectExists(`${proof.commit}^{commit}`);
    assert.equal(available || proof.object_optional === true, true, `${proofId} object unavailable without boundary`);
    if (available) {
      assert.equal(git(['show', '-s', '--format=%T', proof.commit]), proof.tree, `${proofId}.tree`);
      assert.equal(git(['show', '-s', '--format=%P', proof.commit]), proof.parent, `${proofId}.parent`);
      const paths = execFileSync(
        'git',
        ['diff-tree', '--no-commit-id', '--name-only', '-r', proof.commit],
        { cwd: ROOT },
      );
      const patch = execFileSync(
        'git',
        ['show', '--format=', '--binary', proof.commit],
        { cwd: ROOT },
      );
      assert.equal(paths.toString('utf8').trim().split('\n').filter(Boolean).length, proof.changed_path_count, proofId);
      assert.equal(sha256(paths), proof.path_list_sha256, `${proofId}.path_list_sha256`);
      assert.equal(sha256(patch), proof.patch_sha256, `${proofId}.patch_sha256`);
    }
    return;
  }
  if (proof.type === 'external_boundary') {
    assert.equal(text(proof.boundary), true, proofId);
    return;
  }
  assert.fail(`${proofId} has unsupported proof type ${proof.type}`);
}

function validateManifest(manifest) {
  assert.equal(manifest.schema, 'orderweeddc.post-class-d-required-capabilities.v1');
  assert.match(manifest.assessed_against_sha, /^[0-9a-f]{40}$/);
  assert.match(manifest.assessed_against_tree, /^[0-9a-f]{40}$/);
  assert.equal(
    git(['show', '-s', '--format=%T', manifest.assessed_against_sha]),
    manifest.assessed_against_tree,
    'assessment tree mismatch',
  );
  assert.match(manifest.owner_authorization_source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(Array.isArray(manifest.assessment_diff_paths), true);
  assert.equal(manifest.assessment_diff_paths.length > 0, true);
  assert.equal(
    new Set(manifest.assessment_diff_paths).size,
    manifest.assessment_diff_paths.length,
    'duplicate diff paths',
  );

  assert.equal(manifest.proofs && typeof manifest.proofs === 'object', true);
  for (const [proofId, proof] of Object.entries(manifest.proofs)) validateProof(proofId, proof);

  assert.equal(Array.isArray(manifest.required_capabilities), true);
  const ids = manifest.required_capabilities.map((entry) => entry.capability_id);
  assert.equal(new Set(ids).size, ids.length, 'manifest capability ids must be unique');
  for (const entry of manifest.required_capabilities) {
    assert.deepEqual(Object.keys(entry).sort(), ['capability_id', 'expected_disposition', 'proof_ids']);
    assert.equal(text(entry.capability_id), true);
    assert.equal(ALLOWED_DISPOSITIONS.has(entry.expected_disposition), true, entry.capability_id);
    assert.equal(Array.isArray(entry.proof_ids) && entry.proof_ids.length > 0, true, entry.capability_id);
    for (const proofId of entry.proof_ids) {
      const proof = manifest.proofs[proofId];
      assert.equal(Boolean(proof), true, `${entry.capability_id}:${proofId}`);
      if (proof.type === 'external_boundary') {
        assert.equal(entry.expected_disposition, 'BOUNDED_UNKNOWN', `${entry.capability_id}:${proofId}`);
      }
      if (proof.type === 'assessment_observation' && proof.object_optional === true) {
        assert.equal(
          ['DEFERRED_WITH_REASON', 'REJECTED_WITH_REASON'].includes(entry.expected_disposition),
          true,
          `${entry.capability_id}:${proofId}`,
        );
      }
    }
  }

  const byId = new Map(manifest.required_capabilities.map((entry) => [entry.capability_id, entry]));
  assert.equal(Array.isArray(manifest.independent_inventory_markers), true);
  const reconciled = new Set();
  for (const marker of manifest.independent_inventory_markers) {
    assert.deepEqual(Object.keys(marker).sort(), ['capability_id', 'marker', 'proof_id']);
    assert.equal(byId.has(marker.capability_id), true, marker.capability_id);
    const proof = manifest.proofs[marker.proof_id];
    assert.equal(proof?.type, 'git_blob', marker.proof_id);
    const source = git(['show', `${proof.commit}:${proof.path}`]);
    assert.equal(source.includes(marker.marker), true, `${marker.capability_id}:${marker.marker}`);
    reconciled.add(marker.capability_id);
  }
  exactSet(
    reconciled,
    [
      'orderweeddcrsi_mission_lease_idempotency',
      'orderweeddcrsi_receipt_chain',
      'orderweeddcrsi_evidence_envelope',
      'orderweeddcrsi_provider_validation_circuit_breaker',
      'orderweeddcrsi_deterministic_pipeline',
      'orderweeddcrsi_crash_restart_fixtures',
      'orderweeddcrsi_gated_lesson_persistence',
    ],
    'independent ORDERWEEDDCRSI inventory reconciliation drift',
  );
}

function validateLedger(entries, manifest) {
  const required = new Map(
    manifest.required_capabilities.map((entry) => [entry.capability_id, entry]),
  );
  assert.equal(entries.length, required.size, 'ledger row count differs from required manifest');
  exactSet(entries.map((entry) => entry.capability_id), required.keys(), 'ledger capability set drift');

  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), EXACT_KEYS, entry.capability_id);
    assert.equal(entry.schema, 'orderweeddc.post-class-d-capability.v1');
    assert.equal(entry.high_value, true, entry.capability_id);
    for (const field of ['capability_id', 'domain', 'source', 'current_canonical', 'reason', 'next_gate']) {
      assert.equal(text(entry[field]), true, `${entry.capability_id}.${field}`);
    }
    assert.equal(entry.reason.length >= 24, true, entry.capability_id);
    assert.equal(entry.disposition, required.get(entry.capability_id).expected_disposition, entry.capability_id);
    assert.deepEqual(entry.evidence, required.get(entry.capability_id).proof_ids, entry.capability_id);
    assert.equal(entry.production_effects, 0, entry.capability_id);
    assert.match(entry.assessed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, entry.capability_id);
    assert.equal(Number.isNaN(Date.parse(entry.assessed_at)), false, entry.capability_id);
    assert.equal(entry.assessed_against_sha, manifest.assessed_against_sha, entry.capability_id);
    assert.equal(entry.assessed_against_tree, manifest.assessed_against_tree, entry.capability_id);
  }
}

function parseMarkdownDispositions(markdown) {
  const rows = new Map();
  const pattern = /^\| `([^`]+)` \| ([A-Z_]+) \|/gm;
  for (const match of markdown.matchAll(pattern)) {
    assert.equal(rows.has(match[1]), false, `duplicate Markdown row ${match[1]}`);
    rows.set(match[1], match[2]);
  }
  return rows;
}

function assertCredentialFree(value, label) {
  for (const pattern of CREDENTIAL_PATTERNS) {
    assert.doesNotMatch(value, pattern, `${label} contains credential-shaped material`);
  }
}

function changedPathsSinceAssessment(manifest) {
  const paths = new Set();
  for (const args of [
    ['diff', '--name-only', `${manifest.assessed_against_sha}...HEAD`],
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    for (const line of git(args).split('\n').filter(Boolean)) paths.add(line);
  }
  return paths;
}

test('digested assessment manifest independently binds the required universe and typed proofs', () => {
  const manifest = readManifest();
  validateManifest(manifest);
  exactSet(
    changedPathsSinceAssessment(manifest),
    manifest.assessment_diff_paths,
    'assessment has unrelated or missing source drift',
  );
});

test('every required high-value mechanism has one manifest-bound disposition and proof set', () => {
  const manifest = readManifest();
  validateManifest(manifest);
  validateLedger(readLedger(), manifest);
});

test('human ledger is a structural mirror and all claim-bearing artifacts are credential-free', () => {
  const manifest = readManifest();
  const entries = readLedger();
  validateLedger(entries, manifest);
  assert.equal(fs.existsSync(SUPERSESSION), true, 'supersession ledger is missing');
  const markdown = fs.readFileSync(SUPERSESSION, 'utf8');
  const rows = parseMarkdownDispositions(markdown);
  exactSet(rows.keys(), entries.map((entry) => entry.capability_id), 'Markdown capability set drift');
  for (const entry of entries) assert.equal(rows.get(entry.capability_id), entry.disposition, entry.capability_id);
  assertCredentialFree(JSON.stringify(entries), 'JSONL ledger');
  assertCredentialFree(fs.readFileSync(MANIFEST, 'utf8'), 'required manifest');
  assertCredentialFree(markdown, 'supersession ledger');
});

test('adversarial laundering, omissions, evidence drift, and credential material fail closed', () => {
  const manifest = readManifest();
  const entries = readLedger();

  const missing = structuredClone(entries);
  missing.pop();
  assert.throws(() => validateLedger(missing, manifest), /row count/);

  const laundering = structuredClone(entries);
  laundering.find((entry) => entry.capability_id === 'rsi_cross_repository_evaluation').disposition = 'CANONICAL';
  assert.throws(() => validateLedger(laundering, manifest), /rsi_cross_repository_evaluation/);

  const drift = structuredClone(entries);
  drift[0].evidence = ['bogus.missing-proof'];
  assert.throws(() => validateLedger(drift, manifest), /owner_cana_console_surface/);

  const credential = structuredClone(entries);
  credential[0].reason += ' api_token=FAKE_SECRET';
  assert.throws(() => assertCredentialFree(JSON.stringify(credential), 'mutation'), /credential-shaped/);

  const incompleteManifest = structuredClone(manifest);
  incompleteManifest.independent_inventory_markers.pop();
  assert.throws(() => validateManifest(incompleteManifest), /inventory reconciliation drift/);

  const widenedBoundary = structuredClone(manifest);
  widenedBoundary.assessment_diff_paths.push('README.md');
  assert.throws(
    () => exactSet(
      changedPathsSinceAssessment(widenedBoundary),
      widenedBoundary.assessment_diff_paths,
      'assessment has unrelated or missing source drift',
    ),
    /source drift/,
  );
});
