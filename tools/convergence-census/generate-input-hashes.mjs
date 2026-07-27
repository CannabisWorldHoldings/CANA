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
const outputPath = path.join(
  repositoryRoot,
  'docs/convergence/mission-1/INPUT_HASHES.json',
);

const repositoryInputs = [
  {
    id: 'canonical-cana',
    localPath: repositoryRoot,
    remote: 'https://github.com/CannabisWorldHoldings/CANA.git',
    visibility: 'private',
    ref: 'ed9b32b4434f2916f90b83f52f892789db9929c4',
    tree: 'fa1f6a9c55d604c8d7091a8115c1a4296be78378',
  },
  {
    id: 'rsi-baseline',
    localPath: path.join(sourceRoot, 'RSI'),
    remote: 'https://github.com/princeleuel1-ops/RSI.git',
    visibility: 'public',
    ref: 'a6410cdca2450b8bf176009673928735e4b821e7',
    tree: '8173517df10e61967c9cefc9aef4c3fe55d1b406',
  },
  {
    id: 'orderweeddcrsi-main',
    localPath: path.join(sourceRoot, 'ORDERWEEDDCRSI'),
    remote: 'https://github.com/cannabisworldholdings-afk/ORDERWEEDDCRSI-.git',
    visibility: 'public',
    ref: '125c81b084c7a76aae0dc28781f106cba3204e7b',
    tree: '58e1f3b1e116519d2fb28d6613c509484eb03d0a',
  },
  {
    id: 'orderweeddcrsi-pr-1',
    localPath: path.join(sourceRoot, 'ORDERWEEDDCRSI'),
    remote: 'https://github.com/cannabisworldholdings-afk/ORDERWEEDDCRSI-.git',
    visibility: 'public',
    ref: '6a6c5affc7dae4fb04598dedae45bb19e25f26e3',
    tree: '017ac908ee8747f6d1c9ac139106f19b1a64337b',
  },
  {
    id: 'orderweeddc',
    localPath: path.join(sourceRoot, 'orderweeddc'),
    remote: 'https://github.com/princeleuel1-ops/orderweeddc.git',
    visibility: 'public',
    ref: '487ece684a226339ab1a7a48a08a268266672329',
    tree: '5e2c8e8e775fbad2839a1b24fdf227367cfa6b7f',
  },
  {
    id: 'rsi-sitemind-core',
    localPath: path.join(sourceRoot, 'rsi-sitemind-core'),
    remote: 'https://github.com/princeleuel1-ops/rsi-sitemind-core.git',
    visibility: 'public',
    ref: '12246cdad148f934ebe0162ce76592e47937d559',
    tree: 'efa0f6bcbe40f14023b39cc1a3529ed4b6896915',
  },
  {
    id: 'rsi-hermes-bridge',
    localPath: path.join(sourceRoot, 'rsi-hermes-bridge'),
    remote: 'https://github.com/princeleuel1-ops/rsi-hermes-bridge.git',
    visibility: 'public',
    ref: 'd5cc516e9c428c617ba3cfc302d4d3f1f6f8e71f',
    tree: '2510b96250ef61f812e5405aaeb0b9f0793d58ef',
  },
  {
    id: 'rsi-hermes-runtime-overlay',
    localPath: path.join(sourceRoot, 'rsi-hermes-runtime'),
    remote: 'https://github.com/princeleuel1-ops/rsi-hermes-runtime.git',
    visibility: 'public',
    ref: '7f8428975490c65a808ef27a47d2d93f5058cccd',
    tree: 'ad3b67a4d2f8c50be029af9a5e4e8d3c1fe09b5d',
  },
  {
    id: 'hermes-pin-781968b',
    localPath: path.join(sourceRoot, 'rsi-hermes-runtime'),
    remote: 'https://github.com/NousResearch/hermes-agent.git',
    visibility: 'public',
    ref: '781968be5e1ec2c253b617409f8bfba652c10186',
    tree: '6759673ab41c40ec98bf9432dace682874b06190',
  },
  {
    id: 'hermes-pin-d9165d7',
    localPath: path.join(sourceRoot, 'rsi-hermes-runtime'),
    remote: 'https://github.com/NousResearch/hermes-agent.git',
    visibility: 'public',
    ref: 'd9165d7a678d4105f42921a7fc1886df3804531b',
    tree: '040ecbb5ae51003f633f50adc792df49eae9d740',
  },
  {
    id: 'rsi-evaluations',
    localPath: path.join(sourceRoot, 'rsi-evaluations'),
    remote: 'https://github.com/princeleuel1-ops/rsi-evaluations.git',
    visibility: 'public',
    ref: '4cc2c2fd6a5bc57859c9dbe54edb469eed6e6f51',
    tree: '4f8be076cad14b0570c7b8fc0402cd7d0f03d273',
  },
  {
    id: 'rsi-domain-connectors',
    localPath: path.join(sourceRoot, 'rsi-domain-connectors'),
    remote: 'https://github.com/princeleuel1-ops/rsi-domain-connectors.git',
    visibility: 'public',
    ref: 'b0f6d06f5508ebf29e9116747d70af0d144025c4',
    tree: 'c119126970a5719cfdfe54fb2b6fedbc6f6d3a6e',
  },
  {
    id: 'rsi-skills',
    localPath: path.join(sourceRoot, 'rsi-skills'),
    remote: 'https://github.com/princeleuel1-ops/rsi-skills.git',
    visibility: 'public',
    ref: '1e7c9fb0d093e2bc52a88633b53aba8a03e5d4df',
    tree: 'bfd5ad9f6a654a97d07b2b17fb3420acb32eff56',
  },
  {
    id: 'rsi-deployment',
    localPath: path.join(sourceRoot, 'rsi-deployment'),
    remote: 'https://github.com/princeleuel1-ops/rsi-deployment.git',
    visibility: 'public',
    ref: 'c72d5443de1ce2921462fd6fdb5a4aa2a62bb1e6',
    tree: '8370b7d55b3962e3891d41e233a80187bb90e46d',
  },
];

const keyFiles = [
  ['canonical-cana', 'deliverables/MISSION_STATE.json'],
  ['canonical-cana', 'skills-src/sitemind-context-compiler.mjs'],
  ['canonical-cana', 'skills-src/cana-signal-to-fix.mjs'],
  ['canonical-cana', 'skills-src/hermes-governed-packet.mjs'],
  ['canonical-cana', 'skills-src/e2e-compiler-packet-binding.mjs'],
  ['canonical-cana', 'CANA_LOOP_ENGINE/supervisor.py'],
  ['canonical-cana', '.cana-governor-v3/scripts/cana_governor.py'],
  ['rsi-baseline', 'SOURCE_IDENTITY.md'],
  ['rsi-baseline', 'VERIFY_RECEIPT.json'],
  ['rsi-baseline', 'repos/rsi-hermes-runtime/UPSTREAM_PIN.json'],
  ['orderweeddcrsi-main', 'runtime/db.py'],
  ['orderweeddcrsi-main', 'runtime/mission.py'],
  ['orderweeddcrsi-main', 'runtime/rsi.py'],
  ['orderweeddcrsi-main', 'runtime/evidence.py'],
  ['orderweeddcrsi-main', 'runtime/model_router.py'],
  ['orderweeddcrsi-main', 'runtime/pipeline.py'],
  ['orderweeddcrsi-main', 'tests/test_core.py'],
  ['orderweeddcrsi-main', 'Makefile'],
  ['orderweeddcrsi-main', 'vendor/HERMES_UPSTREAM_PIN.json'],
  ['orderweeddcrsi-pr-1', 'CANA_HERMES/adapter/parent.py'],
  ['orderweeddcrsi-pr-1', 'CANA_HERMES/adapter/upstream.py'],
  ['orderweeddcrsi-pr-1', 'CANA_HERMES/tests/test_parent.py'],
  ['orderweeddcrsi-pr-1', 'scripts/hermes_revenue_proof.py'],
  ['orderweeddc', 'deploy/namecheap/build-artifact.mjs'],
  ['orderweeddc', 'apps/web/src/lib/site-intelligence.mjs'],
  ['orderweeddc', 'apps/web/src/lib/sitemind.mjs'],
  ['rsi-hermes-runtime-overlay', '.github/workflows/upstream-candidate.yml'],
  ['rsi-hermes-runtime-overlay', 'UPSTREAM_PIN.json'],
  ['hermes-pin-d9165d7', 'LICENSE'],
  ['hermes-pin-d9165d7', 'SECURITY.md'],
  ['hermes-pin-d9165d7', 'pyproject.toml'],
  ['hermes-pin-d9165d7', 'agent/credential_pool.py'],
  ['hermes-pin-d9165d7', 'agent/prompt_builder.py'],
  ['hermes-pin-d9165d7', 'tests/agent/test_credential_pool.py'],
  ['hermes-pin-d9165d7', 'tests/agent/test_turn_context.py'],
  ['hermes-pin-d9165d7', 'tests/agent/test_turn_context_overflow_warning.py'],
  ['hermes-pin-d9165d7', 'tests/gateway/test_telegram_noise_filter.py'],
  ['hermes-pin-d9165d7', 'tests/hermes_cli/test_auth_profile_fallback.py'],
  ['hermes-pin-d9165d7', 'tests/hermes_cli/test_kanban_worktree_isolation.py'],
  ['hermes-pin-d9165d7', 'tests/hermes_cli/test_update_autostash.py'],
];

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

function gitBytes(repository, ref, filePath) {
  return run(
    '/opt/homebrew/bin/git',
    ['-C', repository, 'show', `${ref}:${filePath}`],
    { encoding: 'buffer' },
  );
}

for (const input of repositoryInputs) {
  const observedTree = git(input.localPath, 'rev-parse', `${input.ref}^{tree}`);
  if (observedTree !== input.tree) {
    throw new Error(
      `${input.id} tree mismatch: expected ${input.tree}, observed ${observedTree}`,
    );
  }
  input.commit_count_from_root = Number(
    git(input.localPath, 'rev-list', '--count', input.ref),
  );
  input.root_commits = git(
    input.localPath,
    'rev-list',
    '--max-parents=0',
    input.ref,
  ).split('\n');
  delete input.localPath;
}

const inputsById = new Map(
  repositoryInputs.map((input) => [input.id, input]),
);
const localPathById = new Map([
  ['canonical-cana', repositoryRoot],
  ...repositoryInputs
    .filter(({ id }) => id !== 'canonical-cana')
    .map(({ id }) => {
      const original = {
        'rsi-baseline': 'RSI',
        'orderweeddcrsi-main': 'ORDERWEEDDCRSI',
        'orderweeddcrsi-pr-1': 'ORDERWEEDDCRSI',
        orderweeddc: 'orderweeddc',
        'rsi-sitemind-core': 'rsi-sitemind-core',
        'rsi-hermes-bridge': 'rsi-hermes-bridge',
        'rsi-hermes-runtime-overlay': 'rsi-hermes-runtime',
        'hermes-pin-781968b': 'rsi-hermes-runtime',
        'hermes-pin-d9165d7': 'rsi-hermes-runtime',
        'rsi-evaluations': 'rsi-evaluations',
        'rsi-domain-connectors': 'rsi-domain-connectors',
        'rsi-skills': 'rsi-skills',
        'rsi-deployment': 'rsi-deployment',
      }[id];
      return [id, path.join(sourceRoot, original)];
    }),
]);

const keyFileHashes = keyFiles.map(([repositoryId, filePath]) => {
  const input = inputsById.get(repositoryId);
  const bytes = gitBytes(localPathById.get(repositoryId), input.ref, filePath);
  return {
    repository_id: repositoryId,
    ref: input.ref,
    path: filePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
});

const archiveBytes = fs.readFileSync(archivePath);
run('/usr/bin/unzip', ['-t', archivePath]);
const archiveEntries = run('/usr/bin/unzip', ['-Z1', archivePath])
  .split('\n')
  .filter((entry) => entry && !entry.endsWith('/'))
  .sort()
  .map((entry) => {
    const bytes = run('/usr/bin/unzip', ['-p', archivePath, entry], {
      encoding: 'buffer',
    });
    return {
      path: entry,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  });

const archiveInventoryDigest = sha256(
  archiveEntries
    .map(({ path: entryPath, bytes, sha256: digest }) =>
      [entryPath, bytes, digest].join('\0'),
    )
    .join('\n'),
);

const document = {
  schema_version: '1.0.0',
  generated_at:
    process.env.CANA_CENSUS_GENERATED_AT || '2026-07-27T00:00:00.000Z',
  hash_algorithm: 'SHA-256',
  source_locations: {
    canonical_repository: repositoryRoot,
    fresh_clone_root: sourceRoot,
    attached_archive: archivePath,
  },
  repositories: repositoryInputs,
  observed_remote_only: [
    {
      id: 'hermes-upstream-main-observed-2026-07-27',
      repository: 'NousResearch/hermes-agent',
      ref: 'main',
      commit: 'd71033a4077a6dfdcdb42c9e9eeab4c41e4a7012',
      tree: '129a441930d11bc6bace9c72e81c960289008898',
      commit_verification: 'verified',
      role: 'UNSELECTED_UPDATE_INPUT',
    },
  ],
  key_files: keyFileHashes,
  archive: {
    filename: path.basename(archivePath),
    bytes: archiveBytes.length,
    sha256: sha256(archiveBytes),
    crc_check: 'PASS',
    file_count: archiveEntries.length,
    inventory_sha256: archiveInventoryDigest,
    entries: archiveEntries,
  },
};

document.input_set_sha256 = sha256(
  JSON.stringify({
    repositories: document.repositories,
    observed_remote_only: document.observed_remote_only,
    key_files: document.key_files,
    archive: document.archive,
  }),
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output: outputPath,
      repositories: document.repositories.length,
      key_files: document.key_files.length,
      archive_files: document.archive.file_count,
      input_set_sha256: document.input_set_sha256,
    },
    null,
    2,
  ),
);
