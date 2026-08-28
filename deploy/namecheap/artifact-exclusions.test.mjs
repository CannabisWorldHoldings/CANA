import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  auditArtifactExclusions,
  detectMachineLocalPaths,
  normalizeNextStandaloneOutput,
  normalizePrismaGeneratedClient,
  PINNED_ARTIFACT_EXECUTABLE_SHA256,
  portableReleaseReproducibility,
} from './artifact-exclusions.mjs';

const BUILDER = fs.readFileSync(new URL('./build-artifact.mjs', import.meta.url), 'utf8');
const MIGRATE = fs.readFileSync(new URL('./migrate.sh', import.meta.url), 'utf8');
const VERIFY_AND_DEPLOY = fs.readFileSync(
  new URL('./verify-and-deploy.sh', import.meta.url),
  'utf8',
);
const BUILDER_PATH = fileURLToPath(new URL('./build-artifact.mjs', import.meta.url));

test('artifact exclusion audit accepts ordinary release files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'server.js'), 'process.stdout.write("ready")');
  fs.writeFileSync(path.join(root, 'receipt.json'), '{"status":"verified"}');

  assert.deepEqual(auditArtifactExclusions(root), {
    passed: true,
    filesScanned: 2,
    forbiddenFiles: [],
    credentialFindings: [],
    machinePathFindings: [],
    machinePathOccurrences: 0,
  });
});

test('artifact exclusion audit rejects macOS, Linux, Windows, and UNC builder paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-path-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, 'machine-paths.js'),
    [
      'const mac = "/Users/buildbot/work/cana/apps/web";',
      'const linux = "/home/runner/work/cana/apps/web";',
      'const workspace = "/workspace/cana/apps/web";',
      'const windows = "C:\\\\Users\\\\buildbot\\\\work\\\\cana";',
      'const unc = "\\\\\\\\builder-host\\\\share\\\\cana";',
    ].join('\n'),
  );

  const result = auditArtifactExclusions(root);
  assert.equal(result.passed, false);
  assert.deepEqual(
    [...new Set(result.machinePathFindings.map(({ pattern }) => pattern))].sort(),
    [
      'LINUX_BUILD_ROOT',
      'POSIX_USER_HOME',
      'WINDOWS_DRIVE_PATH',
      'WINDOWS_UNC_PATH',
    ],
  );
  assert.equal(result.machinePathOccurrences, 5);
});

test('artifact path detector catches exact generated roots in opaque files', () => {
  const checkout = '/nonstandard/courts/generated-checkout-47';
  const findings = detectMachineLocalPaths(
    Buffer.concat([Buffer.from([0]), Buffer.from(`compiled:${checkout}/apps/web`)]),
    { machineRoots: [{ label: 'CURRENT_CHECKOUT_ROOT', value: checkout }] },
  );
  assert.deepEqual(findings.map(({ pattern, occurrences }) => ({ pattern, occurrences })), [
    { pattern: 'CURRENT_CHECKOUT_ROOT', occurrences: 1 },
  ]);
});

test('artifact path detector permits URLs, application routes, and portable virtual paths', () => {
  const contents = [
    'const api = "https://orderweeddc.com/api/health";',
    'const route = "/dispensaries";',
    'const virtualRuntime = "/home/web_user";',
    'const prismaDownload = "/tmp/prisma-download";',
    'const fileUrl = "file:///portable-artifact/config.json";',
  ].join('\n');
  assert.deepEqual(detectMachineLocalPaths(contents), []);
});

test('artifact path detector stays linear on minified escaped expressions', () => {
  const minified = [
    `const patterns="${'\\\\w+'.repeat(100_000)}";`,
    String.raw`const controls="\\x00-\\x1F\\x7F";`,
    String.raw`const unicode="\\u0300-\\u036f\\ufe20-\\ufe2f";`,
  ].join('');
  assert.deepEqual(detectMachineLocalPaths(minified), []);
});

test('Prisma client normalization removes checkout and schema roots from generated metadata', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-prisma-path-normalize-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'index.js');
  const expectedOutputPath = '/Users/buildbot/cana/node_modules/@cana/prisma-worker';
  const expectedSchemaPath = '/Users/buildbot/cana/apps/web/prisma/schema.prisma';
  fs.writeFileSync(
    file,
    `const config = ${JSON.stringify({
      generator: {
        output: { value: expectedOutputPath, fromEnvVar: null },
        sourceFilePath: expectedSchemaPath,
        config: { engineType: 'client' },
      },
      relativePath: '../../../apps/web/prisma',
    }, null, 2)}\nconfig.dirname = '/'\nmodule.exports = config\n`,
  );

  const result = normalizePrismaGeneratedClient(file, {
    expectedOutputPath,
    expectedSchemaPath,
    portableOutputPath: 'node_modules/@cana/prisma-worker',
  });
  const normalized = fs.readFileSync(file, 'utf8');
  assert.equal(result.outputPath, 'node_modules/@cana/prisma-worker');
  assert.doesNotMatch(normalized, /\/Users\/buildbot/);
  assert.match(normalized, /"engineType": "client"/);
  assert.match(normalized, /"sourceFilePath": "apps\/web\/prisma\/schema\.prisma"/);
});

test('Next standalone normalization removes build config and relocates generated identities', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-next-path-normalize-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const standaloneRoot = path.join(root, 'standalone');
  const serverFile = path.join(standaloneRoot, 'apps/web/server.js');
  const requiredServerFiles = path.join(standaloneRoot, 'apps/web/.next/required-server-files.json');
  const routeFile = path.join(standaloneRoot, 'apps/web/.next/server/app/page.js');
  const buildRoot = '/Users/buildbot/checkouts/cana';
  fs.mkdirSync(path.dirname(serverFile), { recursive: true });
  fs.mkdirSync(path.dirname(requiredServerFiles), { recursive: true });
  fs.mkdirSync(path.dirname(routeFile), { recursive: true });
  fs.writeFileSync(
    serverFile,
    `const nextConfig = ${JSON.stringify({
      outputFileTracingRoot: buildRoot,
      turbopack: { root: buildRoot },
      output: 'standalone',
    }, null, 2)}\n\nprocess.chdir(__dirname)\n`,
  );
  fs.writeFileSync(requiredServerFiles, JSON.stringify({
    appDir: `${buildRoot}/apps/web`,
    relativeAppDir: 'apps/web',
    config: {
      outputFileTracingRoot: buildRoot,
      turbopack: { root: buildRoot },
      output: 'standalone',
    },
  }));
  fs.writeFileSync(
    routeFile,
    [
      `const resolvedPagePath = ${JSON.stringify(`${buildRoot}/apps/web/src/app/page.tsx`)};`,
      `const sourceModule = ${JSON.stringify(`${pathToFileURL(buildRoot).href}/apps/web/src/app/page.tsx`)};`,
    ].join('\n'),
  );

  const result = normalizeNextStandaloneOutput({
    standaloneRoot,
    serverFile,
    requiredServerFiles,
    buildRoot,
  });
  const server = fs.readFileSync(serverFile, 'utf8');
  const required = JSON.parse(fs.readFileSync(requiredServerFiles, 'utf8'));
  const route = fs.readFileSync(routeFile, 'utf8');
  assert.equal(result.serverBuildConfigRemoved, true);
  assert.equal(result.requiredServerManifestRelocated, true);
  assert.doesNotMatch(server, /outputFileTracingRoot|turbopack/);
  assert.equal(required.appDir, 'apps/web');
  assert.equal(required.config.outputFileTracingRoot, undefined);
  assert.equal(required.config.turbopack, undefined);
  assert.match(route, /cana-artifact-source\/apps\/web\/src\/app\/page\.tsx/);
  assert.match(route, /file:\/\/\/cana-artifact-source\/apps\/web\/src\/app\/page\.tsx/);
  assert.doesNotMatch(
    [server, JSON.stringify(required), route].join('\n'),
    /\/Users\/buildbot/,
  );
});

test('release reproducibility receipt retains provenance without the local Git path', () => {
  const result = portableReleaseReproducibility({
    remote: '/Users/buildbot/checkouts/cana/.git',
    remoteReachable: true,
  });
  assert.deepEqual(result, {
    remoteKind: 'LOCAL_GIT_OBJECT_DATABASE',
    remoteReachable: true,
    exactCommitVerified: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /\/Users\/buildbot/);
});

test('artifact exclusion audit rejects secret files without exposing their values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env.production'), 'API_KEY=super-secret-value');

  const result = auditArtifactExclusions(root);
  assert.equal(result.passed, false);
  assert.deepEqual(result.forbiddenFiles, ['.env.production']);
  assert.deepEqual(result.credentialFindings, []);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
});

test('artifact exclusion audit rejects embedded credential patterns', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, 'config.txt'),
    'DATABASE_URL=postgresql://release-user:not-a-real-password@db.example/app',
  );

  const result = auditArtifactExclusions(root);
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.credentialFindings.map(({ pattern }) => pattern).sort(),
    ['credential-bearing database URL'],
  );
});

test('artifact exclusion audit scans credential text embedded in binary files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const token = `ghp_${'A'.repeat(36)}`;
  fs.writeFileSync(
    path.join(root, 'opaque.bin'),
    Buffer.concat([Buffer.from([0]), Buffer.from(token)]),
  );

  const result = auditArtifactExclusions(root);
  assert.equal(result.passed, false);
  assert.deepEqual(result.credentialFindings, [{
    file: 'opaque.bin',
    pattern: 'GitHub token',
  }]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
});

test('artifact exclusion audit distinguishes executable secret modules from secret material', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reviewedModule = path.join(root, 'node_modules/effect/dist/esm/Secret.js');
  fs.mkdirSync(path.dirname(reviewedModule), { recursive: true });
  fs.writeFileSync(reviewedModule, 'export const Secret = Object.freeze({})');
  fs.writeFileSync(path.join(root, 'secrets.js'), 'export const password = "arbitrary"');
  fs.writeFileSync(path.join(root, 'secret.json'), '{}');

  const result = auditArtifactExclusions(root);
  assert.deepEqual(result.forbiddenFiles.sort(), ['secret.json', 'secrets.js']);
});

test('artifact exclusion audit cannot be given a caller-controlled dependency exemption', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relativePath = 'node_modules/prisma/build/index.js';
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const source = 'const fixture = "postgresql://user:placeholder@localhost/example"';
  fs.writeFileSync(target, source);
  const fixtureSha256 = createHash('sha256').update(source).digest('hex');

  const result = auditArtifactExclusions(root, {
    trustedCredentialLiteralSha256: {
      [relativePath]: fixtureSha256,
    },
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.credentialFindings, [{
    file: relativePath,
    pattern: 'credential-bearing database URL',
  }]);
  assert.equal(
    PINNED_ARTIFACT_EXECUTABLE_SHA256[relativePath],
    'c2a77456b70e8ba1e640e122824ed694433828a7c0d76ff3db7fc376b4b0e1a0',
  );
});

test('release artifact excludes every legacy ABCA truth bypass', () => {
  const copiedAppScripts = BUILDER.match(/fs\.mkdirSync\(path\.join\(artifactRoot, 'scripts'\)[\s\S]*?for \(const script of \[([\s\S]*?)\]\) \{/);
  assert.ok(copiedAppScripts);
  assert.doesNotMatch(copiedAppScripts[1], /scripts\/(?:etl-abca-retailers|ingest-abca-feed|seed-abca-retailers)\.mjs/);
  assert.match(BUILDER, /no legacy ABCA import bypass shipped/);
});

test('production artifact bootstrap stays demo-free and market-count agnostic', () => {
  assert.match(BUILDER, /const REQUIRED_NODE = 'v20\.20\.2';/);
  assert.doesNotMatch(BUILDER, /process\.env\.(?:REQUIRED_NODE|ALLOW_NODE_MISMATCH)/);
  assert.doesNotMatch(
    BUILDER,
    /run\('node prisma\/seed\.mjs'/,
    'production artifact isolation must not invoke the demonstration seed',
  );
  assert.match(
    MIGRATE,
    /NODE_ENV=production "\$NODE_BIN" "\$SCHEMA_DIR\/scripts\/init-production-db\.mjs"/,
    'integrated migration mode must execute the packaged production initializer',
  );
  assert.doesNotMatch(
    MIGRATE,
    /node_modules\/\.bin\/prisma/,
    'every Prisma entrypoint must run through the vetted Node binary',
  );
  assert.match(
    BUILDER,
    /src\/lib\/db-config\.mjs/,
    'the packaged read-only database inspector must retain its configuration dependency',
  );
  assert.match(
    BUILDER,
    /copyInstalledPackageClosure\('prisma'\)/,
    'the release must carry its lockfile-installed migration CLI closure',
  );
  assert.match(BUILDER, /packagedPrismaCliSha256 !==[\s\S]*?PINNED_ARTIFACT_EXECUTABLE_SHA256/);
  assert.doesNotMatch(BUILDER, /trustedCredentialLiteralSha256:[\s\S]*?packagedPrismaCliSha256/);
  assert.match(BUILDER, /PRISMA_CLI_BINARY_TARGETS: PACKAGED_MIGRATION_BINARY_TARGETS\.join\(','\)/);
  assert.match(BUILDER, /'linux-arm64-openssl-3\.0\.x'/);
  assert.match(BUILDER, /'rhel-openssl-3\.0\.x'/);
  assert.match(BUILDER, /'rhel-openssl-1\.1\.x'/);
  assert.match(BUILDER, /packagedSchemaEngines/);
  assert.match(
    BUILDER,
    /execFileSync\('\/bin\/sh', \['migrate\.sh', '--initialize'\],[\s\S]*?cwd: appRoot/,
    'the isolated court must execute the extracted release migration entrypoint',
  );
  assert.match(BUILDER, /normalizePrismaGeneratedClient/);
  assert.match(BUILDER, /normalizeNextStandaloneOutput/);
  assert.match(BUILDER, /auditArtifactExclusions\(artifactRoot, \{ machineRoots \}\)/);
  assert.match(BUILDER, /ORIGINAL_BUILD_ROOT_ACCESS_BLOCKED/);
  assert.match(BUILDER, /relocated @cana\/prisma-worker executes through PrismaPg/);
  assert.match(BUILDER, /releaseRepro: portableReleaseReproducibility\(releaseRepro\)/);
  assert.doesNotMatch(BUILDER, /nodePath: process\.execPath/);
  assert.doesNotMatch(BUILDER, /isolationDir: isolatedResults\.isolationDir/);
  assert.match(BUILDER, /copyInstalledPackageClosure\('@cana\/prisma-worker'/);
  assert.match(BUILDER, /copyInstalledPackageClosure\('@prisma\/adapter-pg',/);
  assert.match(BUILDER, /query_compiler_bg\.wasm/);
  assert.match(BUILDER, /current_database\(\)::text AS database/);
  assert.match(BUILDER, /DEBUG_DIAGNOSTIC_RESIDUE/);
  assert.match(BUILDER, /Windows paths containing shell metacharacters are rejected/);
  assert.match(BUILDER, /OWD_NODE: process\.execPath/);
  assert.doesNotMatch(BUILDER, /npx --no-install prisma migrate deploy/);
  assert.doesNotMatch(BUILDER, /\.deploy-court\.tar\.gz/);
  assert.match(BUILDER, /artifactSourceMaps[\s\S]*?no source maps shipped/);
  assert.match(BUILDER, /databaseDataSha256\(postgres\)/);
  assert.match(BUILDER, /databaseWriteCounters\(postgres\)/);
  assert.match(BUILDER, /marketWrites === 0/);
  assert.doesNotMatch(BUILDER, /marketWrites: databaseUnchanged \? 0 : null/);
  assert.match(
    BUILDER,
    /try \{\s*writeReceipt\(\{[\s\S]*?finally \{\s*finalCleanup = stopDisposablePostgres\(isolatedResults\.postgres\)/,
    'final receipt and packaging failures must remain inside the PostgreSQL cleanup guard',
  );
  assert.doesNotMatch(BUILDER, /const port = 3260/);
  assert.doesNotMatch(
    BUILDER,
    /(?:retailers|totalRetailers)\s*===\s*74|74 records after restart/,
    'release correctness must not depend on a mutable live-market cohort count',
  );
  assert.match(BUILDER, /inspect\.counts\?\.retailers === 0/);
  assert.match(BUILDER, /inspect\.counts\?\.demonstrationRetailers === 0/);
  assert.match(BUILDER, /inspect\.counts\?\.awaitingVerification === 0/);
});

test('artifact package closure cannot escape the top-level node_modules tree', () => {
  const courtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-package-path-court-'));
  try {
    const nodeModulesRoot = path.join(courtRoot, 'repo', 'node_modules');
    const nestedPackage = path.join(nodeModulesRoot, 'dependency', 'node_modules', 'nested');
    const workspacePackage = path.join(courtRoot, 'repo', 'apps', 'web', 'node_modules', 'nested');
    const outsidePackage = path.join(courtRoot, 'outside', 'package');
    const symlinkPackage = path.join(nodeModulesRoot, 'symlink-escape');
    fs.mkdirSync(nestedPackage, { recursive: true });
    fs.mkdirSync(workspacePackage, { recursive: true });
    fs.mkdirSync(outsidePackage, { recursive: true });
    fs.symlinkSync(outsidePackage, symlinkPackage, 'dir');
    const environment = { ...process.env, CANA_VERIFIED_NODE: process.execPath };
    const verify = (candidate) => JSON.parse(execFileSync(
      BUILDER_PATH,
      ['--verify-package-path-policy', nodeModulesRoot, candidate],
      { encoding: 'utf8', env: environment },
    ));

    assert.equal(
      verify(nestedPackage).relativePath,
      path.join('dependency', 'node_modules', 'nested'),
    );
    assert.equal(verify(workspacePackage).relativePath, null);
    assert.equal(verify(symlinkPackage).relativePath, null);
  } finally {
    fs.rmSync(courtRoot, { recursive: true, force: true });
  }
});

test('release builder ignores caller PATH when selecting security-critical tools', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-builder-path-court-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'forged-tar-ran');
  const fakeTar = path.join(root, 'tar');
  fs.writeFileSync(
    fakeTar,
    `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 99\n`,
    { mode: 0o700 },
  );

  const result = spawnSync(BUILDER_PATH, ['--verify-clean-packaging'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CANA_VERIFIED_NODE: process.execPath,
      PATH: `${root}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(marker), false);
});

test('owner-facing cPanel commands use the vetted Node launch paths', () => {
  const productionRunbook = fs.readFileSync(
    new URL('../../NAMECHEAP_CPANEL_DEPLOYMENT.md', import.meta.url),
    'utf8',
  );
  const stagingRunbook = fs.readFileSync(new URL('./STAGING_RUNBOOK.md', import.meta.url), 'utf8');
  const cutoverRunbook = fs.readFileSync(
    new URL('./PRODUCTION_CUTOVER_RUNBOOK.md', import.meta.url),
    'utf8',
  );
  const manifest = JSON.parse(fs.readFileSync(new URL('./MANIFEST.json', import.meta.url), 'utf8'));

  assert.match(
    stagingRunbook,
    /CANA_VERIFIED_NODE="\$HOME\/\.nvm\/versions\/node\/v20\.20\.2\/bin\/node"/,
  );
  for (const document of [
    productionRunbook,
    stagingRunbook,
    manifest.commands.initializeDatabase,
  ]) {
    assert.doesNotMatch(
      document,
      /(?:^|[\s;&|(])node\s+scripts\/(?:init-production-db|db-inspect)\.mjs/,
    );
  }
  assert.match(MIGRATE, /NODE_BIN=\/opt\/alt\/alt-nodejs20\/root\/usr\/bin\/node/);
  assert.match(
    VERIFY_AND_DEPLOY,
    /NODE_BIN=\/opt\/alt\/alt-nodejs20\/root\/usr\/bin\/node/,
  );
  assert.match(VERIFY_AND_DEPLOY, /OWD_NODE cannot override the vetted cPanel runtime/);
  assert.match(MIGRATE, /OWD_NODE override is permitted only for a disposable database court/);
  assert.match(VERIFY_AND_DEPLOY, /"\$NODE_BIN" <<'NODE'/);
  assert.doesNotMatch(VERIFY_AND_DEPLOY, /(?:^|\n)node <<'NODE'/);
  for (const runbook of [productionRunbook, stagingRunbook]) {
    assert.match(runbook, /trap 'unset DATABASE_URL DIRECT_URL' EXIT HUP INT TERM/);
    assert.match(runbook, /read -r -s -p '[^']*DATABASE_URL:/);
    assert.match(runbook, /export DATABASE_URL DIRECT_URL/);
    assert.match(runbook, /sh migrate\.sh --initialize/);
  }
  assert.match(manifest.commands.initializeDatabase, /sh migrate\.sh --initialize/);
  const productionDeploySection = cutoverRunbook.match(/## 2\.[\s\S]*?(?=\n## 3\.)/)?.[0];
  const productionMigrationSection = cutoverRunbook.match(/## 3\.[\s\S]*?(?=\n## 4\.)/)?.[0];
  for (const section of [productionDeploySection, productionMigrationSection]) {
    assert.ok(section, 'production deploy and migration sections must exist');
    assert.match(section, /trap 'unset DATABASE_URL DIRECT_URL' EXIT HUP INT TERM/);
    assert.match(section, /read -r -s -p 'PRODUCTION DATABASE_URL: '/);
    assert.match(section, /read -r -s -p 'PRODUCTION DIRECT_URL: '/);
    assert.match(section, /export DATABASE_URL DIRECT_URL/);
  }
  assert.match(cutoverRunbook, /cPanel Terminal does not inherit Setup Node\.js App variables/);
  assert.match(
    cutoverRunbook,
    /prove the previous release is compatible with the\s+current PostgreSQL schema/,
  );
  assert.match(cutoverRunbook, /do not\s+run the code-only rollback/);
  assert.match(
    cutoverRunbook,
    /Restoring the verified provider backup is a\s+separate owner-authorized database operation/,
  );
});

test('integrated migration mode cannot initialize after a migration precondition failure', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-migrate-chain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(new URL('./migrate.sh', import.meta.url), path.join(root, 'migrate.sh'));
  fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'prisma/schema.prisma'), 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }');
  const marker = path.join(root, 'initializer-ran');
  fs.writeFileSync(
    path.join(root, 'scripts/init-production-db.mjs'),
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'bad');`,
  );

  const result = spawnSync('sh', [path.join(root, 'migrate.sh'), '--initialize'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      OWD_NODE: process.execPath,
      DATABASE_URL: 'postgresql://127.0.0.1/example',
      DIRECT_URL: 'postgresql://127.0.0.1/example',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CANA_PRE_MIGRATION_BACKUP_RECEIPT is required/);
  assert.equal(fs.existsSync(marker), false);
});

test('production deployment and migration refuse caller-selected Node executables', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-node-pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'called');
  const fakeNode = path.join(root, 'node');
  fs.writeFileSync(fakeNode, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o700 });
  const commonEnv = {
    ...process.env,
    OWD_NODE: fakeNode,
    CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER: '',
    DATABASE_URL: 'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict',
    DIRECT_URL: 'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict',
  };
  const deploy = spawnSync(
    'sh',
    [
      fileURLToPath(new URL('./verify-and-deploy.sh', import.meta.url)),
      'https://example.invalid/release.tar.gz',
      `orderweeddc-${'a'.repeat(40)}.tar.gz`,
      'b'.repeat(64),
    ],
    { env: commonEnv, encoding: 'utf8' },
  );
  const deployOutput = `${deploy.stdout}${deploy.stderr}`;
  const migrate = spawnSync('sh', [fileURLToPath(new URL('./migrate.sh', import.meta.url))], {
    env: {
      ...commonEnv,
      CANA_PRE_MIGRATION_BACKUP_RECEIPT: path.join(root, 'backup-receipt.json'),
    },
    encoding: 'utf8',
  });
  const migrateOutput = `${migrate.stdout}${migrate.stderr}`;
  assert.notEqual(deploy.status, 0);
  assert.match(deployOutput, /OWD_NODE cannot override/);
  assert.equal(deployOutput.includes(commonEnv.DATABASE_URL), false);
  assert.notEqual(migrate.status, 0);
  assert.match(migrateOutput, /OWD_NODE override is permitted only/);
  assert.equal(migrateOutput.includes(commonEnv.DATABASE_URL), false);
  assert.equal(fs.existsSync(marker), false);

  const forgedCourt = spawnSync('sh', [fileURLToPath(new URL('./migrate.sh', import.meta.url))], {
    env: {
      ...commonEnv,
      CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER: '9999999999999999999',
      CANA_PRE_MIGRATION_BACKUP_RECEIPT: path.join(root, 'backup-receipt.json'),
    },
    encoding: 'utf8',
  });
  assert.notEqual(forgedCourt.status, 0);
  assert.match(`${forgedCourt.stdout}${forgedCourt.stderr}`, /OWD_NODE override is permitted only/);
  assert.equal(fs.existsSync(marker), false);
});

test('release builder keeps live acquisition tooling outside its shipped inventory', (t) => {
  assert.match(BUILDER, /no live acquisition tooling shipped/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-live-reality-build-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = auditArtifactExclusions(root);
  assert.equal(result.passed, true);
  for (const relativePath of [
    'scripts/acquire-live-market-reality.mjs',
    'src/lib/reality/live-abca-adapter.mjs',
    'src/lib/reality/live-reality-acquisition.mjs',
  ]) assert.doesNotMatch(BUILDER, new RegExp(`copyFileSync\\([^\\n]+${relativePath.replaceAll('/', '\\/')}`));
});
