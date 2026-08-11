import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  auditArtifactExclusions,
  PINNED_ARTIFACT_EXECUTABLE_SHA256,
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
  });
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
    /run\('sh migrate\.sh --initialize',[\s\S]*?cwd: appRoot/,
    'the isolated court must execute the extracted release migration entrypoint',
  );
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
  const migrate = spawnSync('sh', [fileURLToPath(new URL('./migrate.sh', import.meta.url))], {
    env: {
      ...commonEnv,
      CANA_PRE_MIGRATION_BACKUP_RECEIPT: path.join(root, 'backup-receipt.json'),
    },
    encoding: 'utf8',
  });
  assert.notEqual(deploy.status, 0);
  assert.match(`${deploy.stdout}${deploy.stderr}`, /OWD_NODE cannot override/);
  assert.notEqual(migrate.status, 0);
  assert.match(`${migrate.stdout}${migrate.stderr}`, /OWD_NODE override is permitted only/);
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
