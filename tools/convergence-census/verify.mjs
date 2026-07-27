#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolRoot, '../..');

function requiredPath(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must identify the verified local input`);
  }
  return path.resolve(value);
}

const sourceRoot = requiredPath('CANA_CENSUS_SOURCE_ROOT');
const archivePath = requiredPath('RSI_HERMES_BASELINE_ARCHIVE');
const gitEnvironment = {
  PATH: '/usr/bin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_COUNT: '0',
  GIT_TERMINAL_PROMPT: '0',
};
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

const expectedRepositoryIdentities = new Map([
  [
    'canonical-cana',
    {
      remote: 'https://github.com/CannabisWorldHoldings/CANA.git',
      ref: 'ed9b32b4434f2916f90b83f52f892789db9929c4',
      tree: 'fa1f6a9c55d604c8d7091a8115c1a4296be78378',
    },
  ],
  [
    'rsi-baseline',
    {
      remote: 'https://github.com/princeleuel1-ops/RSI.git',
      ref: 'a6410cdca2450b8bf176009673928735e4b821e7',
      tree: '8173517df10e61967c9cefc9aef4c3fe55d1b406',
    },
  ],
  [
    'orderweeddcrsi-main',
    {
      remote:
        'https://github.com/cannabisworldholdings-afk/ORDERWEEDDCRSI-.git',
      ref: '125c81b084c7a76aae0dc28781f106cba3204e7b',
      tree: '58e1f3b1e116519d2fb28d6613c509484eb03d0a',
    },
  ],
  [
    'orderweeddcrsi-pr-1',
    {
      remote:
        'https://github.com/cannabisworldholdings-afk/ORDERWEEDDCRSI-.git',
      ref: '6a6c5affc7dae4fb04598dedae45bb19e25f26e3',
      tree: '017ac908ee8747f6d1c9ac139106f19b1a64337b',
    },
  ],
  [
    'orderweeddc',
    {
      remote: 'https://github.com/princeleuel1-ops/orderweeddc.git',
      ref: '487ece684a226339ab1a7a48a08a268266672329',
      tree: '5e2c8e8e775fbad2839a1b24fdf227367cfa6b7f',
    },
  ],
  [
    'rsi-sitemind-core',
    {
      remote: 'https://github.com/princeleuel1-ops/rsi-sitemind-core.git',
      ref: '12246cdad148f934ebe0162ce76592e47937d559',
      tree: 'efa0f6bcbe40f14023b39cc1a3529ed4b6896915',
    },
  ],
  [
    'rsi-hermes-bridge',
    {
      remote: 'https://github.com/princeleuel1-ops/rsi-hermes-bridge.git',
      ref: 'd5cc516e9c428c617ba3cfc302d4d3f1f6f8e71f',
      tree: '2510b96250ef61f812e5405aaeb0b9f0793d58ef',
    },
  ],
  [
    'rsi-hermes-runtime-overlay',
    {
      remote: 'https://github.com/princeleuel1-ops/rsi-hermes-runtime.git',
      ref: '7f8428975490c65a808ef27a47d2d93f5058cccd',
      tree: 'ad3b67a4d2f8c50be029af9a5e4e8d3c1fe09b5d',
    },
  ],
  [
    'hermes-pin-781968b',
    {
      remote: 'https://github.com/NousResearch/hermes-agent.git',
      ref: '781968be5e1ec2c253b617409f8bfba652c10186',
      tree: '6759673ab41c40ec98bf9432dace682874b06190',
    },
  ],
  [
    'hermes-pin-d9165d7',
    {
      remote: 'https://github.com/NousResearch/hermes-agent.git',
      ref: 'd9165d7a678d4105f42921a7fc1886df3804531b',
      tree: '040ecbb5ae51003f633f50adc792df49eae9d740',
    },
  ],
  [
    'rsi-evaluations',
    {
      remote: 'https://github.com/princeleuel1-ops/rsi-evaluations.git',
      ref: '4cc2c2fd6a5bc57859c9dbe54edb469eed6e6f51',
      tree: '4f8be076cad14b0570c7b8fc0402cd7d0f03d273',
    },
  ],
  [
    'rsi-domain-connectors',
    {
      remote:
        'https://github.com/princeleuel1-ops/rsi-domain-connectors.git',
      ref: 'b0f6d06f5508ebf29e9116747d70af0d144025c4',
      tree: 'c119126970a5719cfdfe54fb2b6fedbc6f6d3a6e',
    },
  ],
  [
    'rsi-skills',
    {
      remote: 'https://github.com/princeleuel1-ops/rsi-skills.git',
      ref: '1e7c9fb0d093e2bc52a88633b53aba8a03e5d4df',
      tree: 'bfd5ad9f6a654a97d07b2b17fb3420acb32eff56',
    },
  ],
  [
    'rsi-deployment',
    {
      remote: 'https://github.com/princeleuel1-ops/rsi-deployment.git',
      ref: 'c72d5443de1ce2921462fd6fdb5a4aa2a62bb1e6',
      tree: '8370b7d55b3962e3891d41e233a80187bb90e46d',
    },
  ],
]);

const expectedKeyFiles = new Set([
  'canonical-cana\0deliverables/MISSION_STATE.json',
  'canonical-cana\0skills-src/sitemind-context-compiler.mjs',
  'canonical-cana\0skills-src/cana-signal-to-fix.mjs',
  'canonical-cana\0skills-src/hermes-governed-packet.mjs',
  'canonical-cana\0skills-src/e2e-compiler-packet-binding.mjs',
  'canonical-cana\0CANA_LOOP_ENGINE/supervisor.py',
  'canonical-cana\0.cana-governor-v3/scripts/cana_governor.py',
  'rsi-baseline\0SOURCE_IDENTITY.md',
  'rsi-baseline\0VERIFY_RECEIPT.json',
  'rsi-baseline\0repos/rsi-hermes-runtime/UPSTREAM_PIN.json',
  'orderweeddcrsi-main\0runtime/db.py',
  'orderweeddcrsi-main\0runtime/mission.py',
  'orderweeddcrsi-main\0runtime/rsi.py',
  'orderweeddcrsi-main\0runtime/evidence.py',
  'orderweeddcrsi-main\0runtime/model_router.py',
  'orderweeddcrsi-main\0runtime/pipeline.py',
  'orderweeddcrsi-main\0tests/test_core.py',
  'orderweeddcrsi-main\0Makefile',
  'orderweeddcrsi-main\0vendor/HERMES_UPSTREAM_PIN.json',
  'orderweeddcrsi-pr-1\0CANA_HERMES/adapter/parent.py',
  'orderweeddcrsi-pr-1\0CANA_HERMES/adapter/upstream.py',
  'orderweeddcrsi-pr-1\0CANA_HERMES/tests/test_parent.py',
  'orderweeddcrsi-pr-1\0scripts/hermes_revenue_proof.py',
  'orderweeddc\0deploy/namecheap/build-artifact.mjs',
  'orderweeddc\0apps/web/src/lib/site-intelligence.mjs',
  'orderweeddc\0apps/web/src/lib/sitemind.mjs',
  'rsi-hermes-runtime-overlay\0.github/workflows/upstream-candidate.yml',
  'rsi-hermes-runtime-overlay\0UPSTREAM_PIN.json',
  'hermes-pin-d9165d7\0LICENSE',
  'hermes-pin-d9165d7\0SECURITY.md',
  'hermes-pin-d9165d7\0pyproject.toml',
  'hermes-pin-d9165d7\0agent/credential_pool.py',
  'hermes-pin-d9165d7\0agent/prompt_builder.py',
  'hermes-pin-d9165d7\0tests/agent/test_credential_pool.py',
  'hermes-pin-d9165d7\0tests/agent/test_turn_context.py',
  'hermes-pin-d9165d7\0tests/agent/test_turn_context_overflow_warning.py',
  'hermes-pin-d9165d7\0tests/gateway/test_telegram_noise_filter.py',
  'hermes-pin-d9165d7\0tests/hermes_cli/test_auth_profile_fallback.py',
  'hermes-pin-d9165d7\0tests/hermes_cli/test_kanban_worktree_isolation.py',
  'hermes-pin-d9165d7\0tests/hermes_cli/test_update_autostash.py',
]);

const expectedArchive = {
  filename: 'RSI_HERMES_COEVOLUTION_BASELINE_2026-07-23 (1).zip',
  bytes: 60056,
  sha256: 'd2eac504df659c35bfa344e1d8102600456bc63408608bb29fc8843faa717ce5',
  file_count: 71,
};

const expectedRemoteOnly = {
  id: 'hermes-upstream-main-observed-2026-07-27',
  repository: 'NousResearch/hermes-agent',
  ref: 'main',
  commit: 'd71033a4077a6dfdcdb42c9e9eeab4c41e4a7012',
  tree: '129a441930d11bc6bace9c72e81c960289008898',
  commit_verification: 'verified',
  role: 'UNSELECTED_UPDATE_INPUT',
};

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
  return run('git', ['-C', repository, ...args], {
    env: gitEnvironment,
  }).trim();
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
const expectedSourceLocations = {
  canonical_repository: 'CANA_CANONICAL_CHECKOUT',
  fresh_clone_root: 'CANA_CENSUS_SOURCE_ROOT',
  attached_archive: 'RSI_HERMES_BASELINE_ARCHIVE',
};
if (
  JSON.stringify(hashes.source_locations) !==
  JSON.stringify(expectedSourceLocations)
) {
  fail('input census source locations must use stable logical identifiers');
}
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

if (hashes.repositories.length !== expectedRepositoryIdentities.size) {
  fail('input census repository count is incomplete or unexpected');
}
const observedRepositoryIds = new Set();
for (const repository of hashes.repositories) {
  const expected = expectedRepositoryIdentities.get(repository.id);
  if (!expected || observedRepositoryIds.has(repository.id)) {
    fail(`input census repository set is invalid at ${repository.id}`);
  }
  for (const field of ['remote', 'ref', 'tree']) {
    if (repository[field] !== expected[field]) {
      fail(`input census identity mismatch: ${repository.id}.${field}`);
    }
  }
  observedRepositoryIds.add(repository.id);
}
for (const repositoryId of expectedRepositoryIdentities.keys()) {
  if (!observedRepositoryIds.has(repositoryId)) {
    fail(`input census repository missing: ${repositoryId}`);
  }
}

if (hashes.key_files.length !== expectedKeyFiles.size) {
  fail('input census key-file count is incomplete or unexpected');
}
const observedKeyFiles = new Set();
for (const file of hashes.key_files) {
  const identity = `${file.repository_id}\0${file.path}`;
  const expectedRepository = expectedRepositoryIdentities.get(
    file.repository_id,
  );
  if (
    !expectedKeyFiles.has(identity) ||
    observedKeyFiles.has(identity) ||
    !expectedRepository ||
    file.ref !== expectedRepository.ref
  ) {
    fail(
      `input census key-file identity or ref is invalid: ${file.repository_id}@${file.ref}:${file.path}`,
    );
  }
  observedKeyFiles.add(identity);
}
if (
  observedKeyFiles.size !== expectedKeyFiles.size ||
  [...expectedKeyFiles].some((key) => !observedKeyFiles.has(key))
) {
  fail('input census key-file set is incomplete or unexpected');
}

for (const [field, expected] of Object.entries(expectedArchive)) {
  if (hashes.archive[field] !== expected) {
    fail(`attached archive identity mismatch: ${field}`);
  }
}
if (
  hashes.observed_remote_only.length !== 1 ||
  JSON.stringify(hashes.observed_remote_only[0]) !==
    JSON.stringify(expectedRemoteOnly)
) {
  fail('observed remote-only input is incomplete or unexpected');
}

const observedInputSetHash = sha256(
  JSON.stringify({
    repositories: hashes.repositories,
    observed_remote_only: hashes.observed_remote_only,
    key_files: hashes.key_files,
    archive: hashes.archive,
  }),
);
if (observedInputSetHash !== hashes.input_set_sha256) {
  fail('input-set aggregate hash mismatch');
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
  run('git', ['-C', localPath, 'fsck', '--full', '--strict'], {
    env: gitEnvironment,
  });
}

for (const file of hashes.key_files) {
  const localPath = sourceDirectoryById[file.repository_id];
  const bytes = run(
    'git',
    ['-C', localPath, 'show', `${file.ref}:${file.path}`],
    { encoding: 'buffer', env: gitEnvironment },
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
run('unzip', ['-t', archivePath], { env: gitEnvironment });
for (const entry of hashes.archive.entries) {
  const bytes = run('unzip', ['-p', archivePath, entry.path], {
    encoding: 'buffer',
    env: gitEnvironment,
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
