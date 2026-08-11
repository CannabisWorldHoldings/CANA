import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditArtifactExclusions } from './artifact-exclusions.mjs';

const BUILDER = fs.readFileSync(new URL('./build-artifact.mjs', import.meta.url), 'utf8');

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

test('artifact exclusion audit distinguishes executable secret modules from secret material', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'Secret.js'), 'export const Secret = Object.freeze({})');
  fs.writeFileSync(path.join(root, 'secret.json'), '{}');

  const result = auditArtifactExclusions(root);
  assert.deepEqual(result.forbiddenFiles, ['secret.json']);
});

test('artifact exclusion audit accepts only an exact hash-bound dependency literal', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relativePath = 'node_modules/prisma/build/index.js';
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const source = 'const fixture = "postgresql://user:placeholder@localhost/example"';
  fs.writeFileSync(target, source);

  assert.equal(auditArtifactExclusions(root).passed, false);
  assert.equal(auditArtifactExclusions(root, {
    trustedCredentialLiteralSha256: {
      [relativePath]: '0'.repeat(64),
    },
  }).passed, false);
  assert.equal(auditArtifactExclusions(root, {
    trustedCredentialLiteralSha256: {
      [relativePath]: createHash('sha256').update(source).digest('hex'),
    },
  }).passed, true);
});

test('release artifact excludes every legacy ABCA truth bypass', () => {
  const copiedAppScripts = BUILDER.match(/fs\.mkdirSync\(path\.join\(artifactRoot, 'scripts'\)[\s\S]*?for \(const script of \[([\s\S]*?)\]\) \{/);
  assert.ok(copiedAppScripts);
  assert.doesNotMatch(copiedAppScripts[1], /scripts\/(?:etl-abca-retailers|ingest-abca-feed|seed-abca-retailers)\.mjs/);
  assert.match(BUILDER, /no legacy ABCA import bypass shipped/);
});

test('production artifact bootstrap stays demo-free and market-count agnostic', () => {
  assert.doesNotMatch(
    BUILDER,
    /run\('node prisma\/seed\.mjs'/,
    'production artifact isolation must not invoke the demonstration seed',
  );
  assert.match(
    BUILDER,
    /scripts\/init-production-db\.mjs[\s\S]*?cwd: appRoot/,
    'the isolated release must execute its packaged production initializer',
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
  assert.match(BUILDER, /PRISMA_CLI_BINARY_TARGETS: PACKAGED_MIGRATION_BINARY_TARGETS\.join\(','\)/);
  assert.match(BUILDER, /'linux-arm64-openssl-3\.0\.x'/);
  assert.match(BUILDER, /'rhel-openssl-3\.0\.x'/);
  assert.match(BUILDER, /'rhel-openssl-1\.1\.x'/);
  assert.match(BUILDER, /packagedSchemaEngines/);
  assert.match(
    BUILDER,
    /run\('sh migrate\.sh',[\s\S]*?cwd: appRoot/,
    'the isolated court must execute the extracted release migration entrypoint',
  );
  assert.match(BUILDER, /OWD_NODE: process\.execPath/);
  assert.doesNotMatch(BUILDER, /npx --no-install prisma migrate deploy/);
  assert.doesNotMatch(BUILDER, /\.deploy-court\.tar\.gz/);
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
