#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolRoot, '../..');
const sourceRoot =
  process.env.CANA_CENSUS_SOURCE_ROOT ||
  '/Users/Apple/Documents/New project/CANA-convergence-sources';
const archivePath =
  process.env.RSI_HERMES_BASELINE_ARCHIVE ||
  '/Users/Apple/Downloads/RSI_HERMES_COEVOLUTION_BASELINE_2026-07-23 (1).zip';
const artifactRoot = path.join(repositoryRoot, 'docs/convergence/mission-1');
const artifactManifestPath = path.join(artifactRoot, 'ARTIFACT_MANIFEST.json');

const requiredArtifacts = [
  'SOURCE_LEDGER.md',
  'INPUT_HASHES.json',
  'CANONICAL_COMPONENT_MAP.md',
  'COMPONENT_DISPOSITION.md',
  'DUPLICATE_AUTHORITY_REPORT.md',
  'AUTHORITY_CONTRACT.md',
  'HERMES_PIN_RESOLUTION.md',
  'MINIMUM_ALIVE_LOOP_SPEC.md',
  'INTELLIGENCE_OS_RECOVERY_STATUS.md',
  'RUNTIME_INCLUSION_MANIFEST.json',
  'CONVERGENCE_ROLLBACK_PLAN.md',
];

const expectedManifestPaths = [
  ...requiredArtifacts.map((artifact) =>
    path.posix.join('docs/convergence/mission-1', artifact),
  ),
  'docs/convergence/mission-1/LOCAL_VERIFICATION_RECEIPTS.json',
  'tools/convergence-census/generate-input-hashes.mjs',
  'tools/convergence-census/generate-artifact-manifest.mjs',
  'tools/convergence-census/verify.mjs',
].sort();

const allowedClassifications = new Set([
  'CANONICAL_ACTIVE',
  'REUSABLE_IMPORT',
  'PARTIAL_IMPLEMENTATION',
  'HISTORICAL_REFERENCE',
  'SUPERSEDED',
  'DUPLICATE',
  'MISSING',
  'BLOCKED',
]);

const expectedOwnerByComponent = new Map([
  ['authority', 'OWNER_CONSTITUTION'],
  ['mission_state', 'CANA_DURABLE_AUTHORITY'],
  ['policy', 'RSI_SITEMIND_INTELLIGENCE'],
  ['context_compiler', 'RSI_SITEMIND_INTELLIGENCE'],
  ['truthgraph', 'RSI_SITEMIND_INTELLIGENCE'],
  ['winner_memory', 'RSI_SITEMIND_INTELLIGENCE'],
  ['signal_to_fix', 'RSI_SITEMIND_INTELLIGENCE'],
  ['evidence', 'CANA_DURABLE_AUTHORITY'],
  ['provider_routing', 'RSI_SITEMIND_INTELLIGENCE'],
  ['capabilities', 'CANA_DURABLE_AUTHORITY'],
  ['hermes_execution', 'HERMES_EXECUTION_SLOT'],
  ['update_watching', 'CANA_DURABLE_AUTHORITY'],
  ['intelligence_os_state', 'INTELLIGENCE_OS_STORE'],
]);

const expectedAuthorityChain = [
  'OWNER_CONSTITUTION',
  'CANA_DURABLE_AUTHORITY',
  'RSI_SITEMIND_INTELLIGENCE',
  'HERMES_EXECUTION_SLOT',
  'BOUNDED_SPECIALIST_WORKERS',
  'ORDERWEEDDC_PRODUCT',
];

const sourceDirectoryById = {
  'canonical-cana': repositoryRoot,
  'rsi-baseline': path.join(sourceRoot, 'RSI'),
  'orderweeddcrsi-main': path.join(sourceRoot, 'ORDERWEEDDCRSI'),
  'orderweeddcrsi-pr-1': path.join(sourceRoot, 'ORDERWEEDDCRSI'),
  orderweeddc: path.join(sourceRoot, 'orderweeddc'),
  'rsi-sitemind-core': path.join(sourceRoot, 'rsi-sitemind-core'),
  'rsi-hermes-bridge': path.join(sourceRoot, 'rsi-hermes-bridge'),
  'rsi-hermes-runtime-overlay': path.join(sourceRoot, 'rsi-hermes-runtime'),
  'hermes-pin-781968b': path.join(sourceRoot, 'rsi-hermes-runtime'),
  'hermes-pin-d9165d7': path.join(sourceRoot, 'rsi-hermes-runtime'),
  'rsi-evaluations': path.join(sourceRoot, 'rsi-evaluations'),
  'rsi-domain-connectors': path.join(sourceRoot, 'rsi-domain-connectors'),
  'rsi-skills': path.join(sourceRoot, 'rsi-skills'),
  'rsi-deployment': path.join(sourceRoot, 'rsi-deployment'),
};

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(repository, ...args) {
  return run('/opt/homebrew/bin/git', ['-C', repository, ...args]).trim();
}

function fail(message) {
  throw new Error(message);
}

for (const artifact of requiredArtifacts) {
  if (!fs.existsSync(path.join(artifactRoot, artifact))) {
    fail(`missing required artifact: ${artifact}`);
  }
}
for (const extra of ['ARTIFACT_MANIFEST.json', 'LOCAL_VERIFICATION_RECEIPTS.json']) {
  if (!fs.existsSync(path.join(artifactRoot, extra))) {
    fail(`missing durable evidence artifact: ${extra}`);
  }
}

const trackedPaths = [
  ...expectedManifestPaths,
  'docs/convergence/mission-1/ARTIFACT_MANIFEST.json',
];
const currentRevision = git(repositoryRoot, 'rev-parse', 'HEAD');
const currentTree = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
const currentBranch = git(repositoryRoot, 'branch', '--show-current');
const expectedRevision = process.env.CANA_CENSUS_EXPECTED_REVISION;
const expectedTree = process.env.CANA_CENSUS_EXPECTED_TREE;
if (!/^[0-9a-f]{40}$/.test(expectedRevision || '')) {
  fail(
    'CANA_CENSUS_EXPECTED_REVISION must be an out-of-band reviewed 40-hex commit',
  );
}
if (!/^[0-9a-f]{40}$/.test(expectedTree || '')) {
  fail('CANA_CENSUS_EXPECTED_TREE must be an out-of-band reviewed 40-hex tree');
}
if (currentRevision !== expectedRevision || currentTree !== expectedTree) {
  fail(
    `Mission 1 identity mismatch: ${currentRevision}/${currentTree} != ${expectedRevision}/${expectedTree}`,
  );
}
if (currentBranch !== 'codex/cana-convergence-mission-1') {
  fail(`unexpected Mission 1 branch: ${currentBranch}`);
}
for (const relativePath of trackedPaths) {
  git(repositoryRoot, 'ls-files', '--error-unmatch', relativePath);
  git(repositoryRoot, 'cat-file', '-e', `HEAD:${relativePath}`);
}
const repositoryStatus = git(
  repositoryRoot,
  'status',
  '--porcelain=v1',
  '--untracked-files=all',
);
if (repositoryStatus) {
  fail(`Mission 1 worktree is not clean:\n${repositoryStatus}`);
}

const hashes = JSON.parse(
  fs.readFileSync(path.join(artifactRoot, 'INPUT_HASHES.json'), 'utf8'),
);
const inclusion = JSON.parse(
  fs.readFileSync(
    path.join(artifactRoot, 'RUNTIME_INCLUSION_MANIFEST.json'),
    'utf8',
  ),
);
const artifactManifest = JSON.parse(
  fs.readFileSync(artifactManifestPath, 'utf8'),
);

const observedManifestPaths = artifactManifest.artifacts
  .map((artifact) => artifact.path)
  .sort();
if (
  JSON.stringify(observedManifestPaths) !==
  JSON.stringify(expectedManifestPaths)
) {
  fail('Mission 1 artifact manifest path set is incomplete or unexpected');
}
for (const artifact of artifactManifest.artifacts) {
  const bytes = fs.readFileSync(path.join(repositoryRoot, artifact.path));
  if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
    fail(`Mission 1 artifact mismatch: ${artifact.path}`);
  }
}
const observedArtifactSetHash = sha256(
  artifactManifest.artifacts
    .map(({ path: relativePath, bytes, sha256: digest }) =>
      [relativePath, bytes, digest].join('\0'),
    )
    .join('\n'),
);
if (observedArtifactSetHash !== artifactManifest.artifact_set_sha256) {
  fail('Mission 1 artifact-set hash mismatch');
}

for (const repository of hashes.repositories) {
  const localPath = sourceDirectoryById[repository.id];
  if (!localPath || !fs.existsSync(path.join(localPath, '.git'))) {
    fail(`missing fresh clone for ${repository.id}: ${localPath || 'unmapped'}`);
  }
  const observedTree = git(localPath, 'rev-parse', `${repository.ref}^{tree}`);
  if (observedTree !== repository.tree) {
    fail(
      `${repository.id} tree mismatch: ${observedTree} != ${repository.tree}`,
    );
  }
  run('/opt/homebrew/bin/git', [
    '-C',
    localPath,
    'fsck',
    '--full',
    '--strict',
  ]);
}

for (const file of hashes.key_files) {
  const localPath = sourceDirectoryById[file.repository_id];
  const bytes = run(
    '/opt/homebrew/bin/git',
    ['-C', localPath, 'show', `${file.ref}:${file.path}`],
    { encoding: 'buffer' },
  );
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
    fail(
      `key-file mismatch: ${file.repository_id}@${file.ref}:${file.path}`,
    );
  }
}

const archiveBytes = fs.readFileSync(archivePath);
if (
  archiveBytes.length !== hashes.archive.bytes ||
  sha256(archiveBytes) !== hashes.archive.sha256
) {
  fail('attached archive size or SHA-256 mismatch');
}
run('/usr/bin/unzip', ['-t', archivePath]);
for (const entry of hashes.archive.entries) {
  const bytes = run('/usr/bin/unzip', ['-p', archivePath, entry.path], {
    encoding: 'buffer',
  });
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    fail(`archive entry mismatch: ${entry.path}`);
  }
}

const ownerEntries = inclusion.canonical_owners;
if (!Array.isArray(ownerEntries)) {
  fail('runtime manifest canonical_owners must be an array');
}
const observedOwners = new Set();
for (const entry of ownerEntries) {
  if (!expectedOwnerByComponent.has(entry.component)) {
    fail(`unknown owner component: ${entry.component}`);
  }
  if (observedOwners.has(entry.component)) {
    fail(`duplicate canonical owner: ${entry.component}`);
  }
  if (typeof entry.owner !== 'string' || !entry.owner.trim()) {
    fail(`empty canonical owner: ${entry.component}`);
  }
  const expectedOwner = expectedOwnerByComponent.get(entry.component);
  if (entry.owner !== expectedOwner) {
    fail(
      `wrong canonical owner for ${entry.component}: ${entry.owner} != ${expectedOwner}`,
    );
  }
  observedOwners.add(entry.component);
}
for (const component of expectedOwnerByComponent.keys()) {
  if (!observedOwners.has(component)) {
    fail(`missing canonical owner: ${component}`);
  }
}
if (
  JSON.stringify(inclusion.authority_chain) !==
  JSON.stringify(expectedAuthorityChain)
) {
  fail('runtime manifest authority chain does not match the binding hierarchy');
}

for (const component of inclusion.components) {
  if (!allowedClassifications.has(component.classification)) {
    fail(
      `invalid classification ${component.classification} for ${component.id}`,
    );
  }
  if (typeof component.included_in_orderweeddc_artifact !== 'boolean') {
    fail(`non-boolean runtime inclusion for ${component.id}`);
  }
}

console.log(
  JSON.stringify(
    {
      verdict: 'PASS',
      required_artifacts: requiredArtifacts.length,
      repository_objects_verified: hashes.repositories.length,
      key_files_verified: hashes.key_files.length,
      archive_files_verified: hashes.archive.entries.length,
      canonical_owners_verified: observedOwners.size,
      classifications_verified: inclusion.components.length,
      mission1_artifacts_verified: artifactManifest.artifacts.length,
      input_set_sha256: hashes.input_set_sha256,
      artifact_set_sha256: artifactManifest.artifact_set_sha256,
      verified_branch: currentBranch,
      verified_revision: currentRevision,
      verified_tree: currentTree,
    },
    null,
    2,
  ),
);
