#!/bin/sh
':' //; case "${CANA_VERIFIED_NODE-}" in /*) ;; *) echo "BUILD_NODE_IDENTITY_REFUSED: set CANA_VERIFIED_NODE to the vetted absolute Node executable" >&2; exit 126;; esac; test -x "$CANA_VERIFIED_NODE" || { echo "BUILD_NODE_IDENTITY_REFUSED: CANA_VERIFIED_NODE is not executable" >&2; exit 126; }; unset NODE_OPTIONS NODE_PATH; CANA_ARTIFACT_SECURE_LAUNCH=1; export CANA_ARTIFACT_SECURE_LAUNCH CANA_VERIFIED_NODE; exec "$CANA_VERIFIED_NODE" "$0" "$@"

/**
 * Builds the Namecheap/cPanel deployment artifact OFF-SERVER — and proves it
 * runs in TRUE ISOLATION before publishing.
 *
 * Bundler: WEBPACK (`next build` under the repository-pinned Next 15.5.24),
 * permanently. Next 16 defaults to Turbopack, whose standalone output externalizes hashed package references
 * (e.g. @prisma/client-<hex>) that are unresolvable outside the build tree —
 * proven in production on business194 (2026-07-23). The webpack standalone
 * path traces real, self-contained node_modules.
 *
 * Phases:
 *   1. Clean: remove .next + old artifact; optional CLEAN_INSTALL=1 npm ci;
 *      record working-tree state in the receipt.
 *   2. Restore brand assets, prisma generate (RHEL engines), build with the
 *      pinned Next 15 Webpack default.
 *   3. Assemble artifact (server, static, public, prisma tooling) and prune
 *      server-mismatched binaries when
 *      SERVER_OPENSSL=1.1.
 *   4. Hard-stop verification, including a scan of every compiled
 *      .next/server JS file for unresolved hashed externals.
 *   5. Package, then run the ISOLATED RUNTIME TEST: extract the tarball into
 *      a directory outside the repository (no parent node_modules, cleared
 *      NODE_PATH), migrate a disposable PostgreSQL database, start app.js, and
 *      pass the full HTTP battery + restart persistence + rollback isolation.
 *   6. Write the final receipt (bundler, versions, scan + test results) into
 *      the artifact and re-package. The tarball is only kept if EVERYTHING
 *      passed.
 *
 * Run from the repo root:
 *   CANA_VERIFIED_NODE=$HOME/.nvm/versions/node/v20.20.2/bin/node \
 *     ./deploy/namecheap/build-artifact.mjs
 *   CANA_VERIFIED_NODE=$HOME/.nvm/versions/node/v20.20.2/bin/node \
 *     SERVER_OPENSSL=1.1 CLEAN_INSTALL=1 ./deploy/namecheap/build-artifact.mjs
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  auditArtifactExclusions,
  PINNED_ARTIFACT_EXECUTABLE_SHA256,
} from './artifact-exclusions.mjs';
import { createReleaseChildEnvironment } from './release-environment.mjs';
import { assertReleaseReproducible } from './release-preflight.mjs';
import { selectTestPrismaEngine } from './select-test-engine.mjs';
import { startDisposablePostgres, stopDisposablePostgres } from '../../tools/postgres-sim/runtime.mjs';
import {
  loadCanonicalMigrationManifest,
  validateCanonicalMigrationUniverse,
} from '../../apps/web/prisma/migration-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = path.join(repoRoot, 'apps/web');
const trustedToolPath = [
  path.dirname(process.execPath),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(path.delimiter);

function buildChildEnvironment(baseEnvironment = process.env) {
  const environment = createReleaseChildEnvironment({ baseEnvironment });
  environment.PATH = trustedToolPath;
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  return environment;
}

if (process.argv[2] === '--verify-child-environment') {
  process.stdout.write(execFileSync(
    process.execPath,
    [
      '-e',
      'process.stdout.write(JSON.stringify({ '
        + 'marker: process.env.CANA_CHILD_ENV_PROBE, '
        + 'nodeOptions: process.env.NODE_OPTIONS ?? null, '
        + 'nodePath: process.env.NODE_PATH ?? null }))',
    ],
    {
      encoding: 'utf8',
      env: buildChildEnvironment({
        ...process.env,
        CANA_CHILD_ENV_PROBE: 'verified',
      }),
    },
  ));
  process.exit(0);
}

if (process.env.NODE_OPTIONS !== undefined || process.env.NODE_PATH !== undefined) {
  const error = new Error(
    'Artifact builds refuse ambient NODE_OPTIONS or NODE_PATH injection',
  );
  error.code = 'BUILD_ENVIRONMENT_INJECTION_REFUSED';
  throw error;
}

if (
  process.env.CANA_ARTIFACT_SECURE_LAUNCH !== '1'
  || typeof process.env.CANA_VERIFIED_NODE !== 'string'
  || !path.isAbsolute(process.env.CANA_VERIFIED_NODE)
) {
  const error = new Error(
    'Artifact builds require the vetted absolute Node executable through the secure launcher',
  );
  error.code = 'BUILD_NODE_IDENTITY_REFUSED';
  throw error;
}
let verifiedNodeExecutable;
try {
  verifiedNodeExecutable = fs.realpathSync(process.env.CANA_VERIFIED_NODE);
} catch {
  const error = new Error('The vetted Node executable cannot be resolved');
  error.code = 'BUILD_NODE_IDENTITY_REFUSED';
  throw error;
}
if (fs.realpathSync(process.execPath) !== verifiedNodeExecutable) {
  const error = new Error(
    `Artifact build started with ${process.execPath}, not the vetted Node executable`,
  );
  error.code = 'BUILD_NODE_IDENTITY_REFUSED';
  throw error;
}

// Pin the build/verify Node to the production runtime (Namecheap Node 20.20.2). A shell
// launcher resolving an ambient `node` invalidates the isolation proof. The prelude above
// accepts only the explicitly vetted absolute executable and this process verifies that
// exact real path before running any build command.
const REQUIRED_NODE = 'v20.20.2';
const PACKAGED_MIGRATION_BINARY_TARGETS = Object.freeze([
  'linux-arm64-openssl-3.0.x',
  'rhel-openssl-3.0.x',
  'rhel-openssl-1.1.x',
]);
const artifactToolVerification = [
  '--verify-operational-scripts',
  '--verify-clean-packaging',
  '--verify-package-path-policy',
].includes(process.argv[2]);
if (
  !artifactToolVerification
  && process.version !== REQUIRED_NODE
) {
  throw new Error(
    `Build requires Node ${REQUIRED_NODE} but is running ${process.version} at ${process.execPath}. ` +
    `Invoke the exact binary ($HOME/.nvm/versions/node/${REQUIRED_NODE}/bin/node).`,
  );
}

function run(command, options = {}) {
  console.log(`\n$ ${command}`);
  const { env = process.env, ...rest } = options;
  execSync(command, {
    stdio: 'inherit',
    ...rest,
    env: buildChildEnvironment(env),
  });
}

function capture(command, options = {}) {
  const { env = process.env, ...rest } = options;
  return execSync(command, {
    encoding: 'utf8',
    ...rest,
    env: buildChildEnvironment(env),
  }).trim();
}

function releaseChildEnvironment(overrides = {}) {
  return buildChildEnvironment({ ...process.env, ...overrides });
}

function execFile(command, args, options = {}) {
  const { env = process.env, ...rest } = options;
  return execFileSync(command, args, {
    encoding: 'utf8',
    ...rest,
    env: buildChildEnvironment(env),
  }).trim();
}

function sha256File(target) {
  return createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function assertExists(target, label) {
  if (!fs.existsSync(target)) {
    throw new Error(`Artifact verification failed: missing ${label} (${target})`);
  }
}

const macOsMetadataMemberPattern = /(?:^|\/)(?:\._[^/]*|\.DS_Store|__MACOSX)(?:\/|$)/;
const macOsExtendedHeaderPattern = /(?:LIBARCHIVE|SCHILY)\.xattr|com\.apple\.(?:provenance|ResourceFork|FinderInfo)/i;

function archiveExtendedHeaders(tarPath) {
  const archive = gunzipSync(fs.readFileSync(tarPath));
  const records = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Artifact archive has an invalid tar member size');
    }
    const type = String.fromCharCode(header[156]);
    if (type === 'x' || type === 'g') {
      records.push(
        archive.subarray(offset + 512, offset + 512 + size).toString('utf8'),
      );
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return records;
}

function assertNoMacOsExtendedHeaders(records) {
  const rejected = records.filter((record) => macOsExtendedHeaderPattern.test(record));
  if (rejected.length > 0) {
    const error = new Error('Artifact archive contains macOS extended-attribute metadata');
    error.code = 'ARTIFACT_MACOS_EXTENDED_HEADER_REJECTED';
    throw error;
  }
}

function auditCleanTarArchive(tarPath) {
  const environment = buildChildEnvironment({
    ...process.env,
    COPYFILE_DISABLE: '1',
    COPY_EXTENDED_ATTRIBUTES_DISABLE: '1',
  });
  const listing = execFileSync('tar', ['-tzf', tarPath], {
    encoding: 'utf8',
    env: environment,
  });
  const members = listing.split('\n').filter(Boolean);
  const rejectedMembers = members.filter((member) => macOsMetadataMemberPattern.test(member));
  if (rejectedMembers.length > 0) {
    const error = new Error(
      `Artifact archive contains macOS metadata members: ${rejectedMembers.join(', ')}`,
    );
    error.code = 'ARTIFACT_MACOS_METADATA_MEMBER_REJECTED';
    throw error;
  }
  const extendedHeaders = archiveExtendedHeaders(tarPath);
  assertNoMacOsExtendedHeaders(extendedHeaders);
  return {
    memberCount: members.length,
    rejectedMembers,
    macOsExtendedHeaderCount: extendedHeaders.filter(
      (record) => macOsExtendedHeaderPattern.test(record),
    ).length,
  };
}

function createCleanTar(tarPath, baseDirectory, memberName) {
  const environment = buildChildEnvironment({
    ...process.env,
    COPYFILE_DISABLE: '1',
    COPY_EXTENDED_ATTRIBUTES_DISABLE: '1',
  });
  const tarVersion = execFileSync('tar', ['--version'], {
    encoding: 'utf8',
    env: environment,
  });
  const args = ['--no-xattrs'];
  if (/bsdtar/i.test(tarVersion)) args.push('--no-mac-metadata');
  args.push(
    '--exclude=._*',
    '--exclude=.DS_Store',
    '--exclude=__MACOSX',
    '-czf',
    tarPath,
    '-C',
    baseDirectory,
    memberName,
  );
  fs.rmSync(tarPath, { force: true });
  execFileSync('tar', args, { stdio: 'inherit', env: environment });
  return auditCleanTarArchive(tarPath);
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

function containedRelativePath(root, candidate) {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
  if (
    path.isAbsolute(relative)
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
  ) return null;
  return relative;
}

function installedPackageRoot(packageName, requiringDirectory = repoRoot) {
  const packageSegments = packageName.split('/');
  let directory = requiringDirectory;
  while (containedRelativePath(repoRoot, directory) !== null) {
    const candidate = path.join(directory, 'node_modules', ...packageSegments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (directory === repoRoot) break;
    directory = path.dirname(directory);
  }
  throw new Error(`Artifact build cannot resolve the installed package ${packageName}`);
}

function copyInstalledPackageClosure(packageName, copied = new Set(), requiringDirectory) {
  const packageRoot = installedPackageRoot(packageName, requiringDirectory);
  if (copied.has(packageRoot)) return copied;
  copied.add(packageRoot);
  const relativeRoot = containedRelativePath(path.join(repoRoot, 'node_modules'), packageRoot);
  if (!relativeRoot) {
    throw new Error(
      `Artifact build resolved ${packageName} outside the top-level node_modules`,
    );
  }
  copyDir(packageRoot, path.join(artifactRoot, 'node_modules', relativeRoot));
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {
    copyInstalledPackageClosure(dependency, copied, packageRoot);
  }
  return copied;
}

if (process.argv[2] === '--verify-package-path-policy') {
  const root = path.resolve(process.argv[3] ?? '.');
  const candidate = path.resolve(process.argv[4] ?? '.');
  process.stdout.write(`${JSON.stringify({
    root,
    candidate,
    relativePath: containedRelativePath(root, candidate),
  })}\n`);
  process.exit(0);
}

function databaseDataSha256(postgres) {
  const dump = execFile(
    'docker',
    [
      'exec', postgres.name, 'pg_dump', '-U', 'postgres', '-d', 'cana_verify',
      '--data-only', '--no-owner', '--no-privileges', '--inserts',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const canonicalDump = dump
    .split('\n')
    .filter((line) => !/^\\(?:un)?restrict /.test(line))
    .join('\n');
  return createHash('sha256').update(canonicalDump).digest('hex');
}

function databaseWriteCounters(postgres) {
  const output = execFile(
    'docker',
    [
      'exec', postgres.name, 'psql', '-U', 'postgres', '-d', 'cana_verify',
      '--tuples-only', '--no-align', '--field-separator', '|', '--command',
      'SELECT COALESCE(SUM(n_tup_ins), 0)::bigint, '
        + 'COALESCE(SUM(n_tup_upd), 0)::bigint, '
        + 'COALESCE(SUM(n_tup_del), 0)::bigint FROM pg_stat_user_tables',
    ],
  );
  const values = output.split('|').map((value) => Number(value));
  if (
    values.length !== 3
    || values.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error('Disposable PostgreSQL returned invalid audited write counters');
  }
  const [inserted, updated, deleted] = values;
  return {
    inserted,
    updated,
    deleted,
    total: inserted + updated + deleted,
  };
}

async function availableLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Loopback port allocation failed');
  return address.port;
}

const operationalScripts = Object.freeze([
  'deploy.sh',
  'restart.sh',
  'rollback.sh',
  'migrate.sh',
  'healthcheck.sh',
  'readycheck.sh',
  'smoke-test.sh',
  'worker.mjs',
  'restore-backup.sh',
]);

function copyOperationalScripts(destinationRoot) {
  for (const script of operationalScripts) {
    fs.copyFileSync(
      path.join(repoRoot, 'deploy/namecheap', script),
      path.join(destinationRoot, script),
    );
  }
}

if (process.argv[2] === '--verify-operational-scripts') {
  const courtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orderweeddc-ops-court-'));
  const artifactName = 'orderweeddc-operational-scripts';
  const artifactRoot = path.join(courtRoot, artifactName);
  const tarPath = path.join(courtRoot, `${artifactName}.tar.gz`);
  fs.mkdirSync(artifactRoot);
  copyOperationalScripts(artifactRoot);
  const packagingAudit = createCleanTar(tarPath, courtRoot, artifactName);
  process.stdout.write(
    `${JSON.stringify({ files: operationalScripts, packagingAudit, tarPath })}\n`,
  );
  process.exit(0);
}

if (process.argv[2] === '--verify-clean-packaging') {
  const courtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orderweeddc-clean-tar-court-'));
  const artifactName = 'orderweeddc-clean-tar-fixture';
  const artifactRoot = path.join(courtRoot, artifactName);
  const tarPath = path.join(courtRoot, `${artifactName}.tar.gz`);
  fs.mkdirSync(path.join(artifactRoot, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, '__MACOSX'), { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'release.json'), '{"clean":true}\n');
  fs.writeFileSync(path.join(artifactRoot, '._release.json'), 'apple-double\n');
  fs.writeFileSync(path.join(artifactRoot, 'nested', '._route.js'), 'apple-double\n');
  fs.writeFileSync(path.join(artifactRoot, '.DS_Store'), 'finder\n');
  fs.writeFileSync(path.join(artifactRoot, '__MACOSX', 'resource-fork'), 'fork\n');

  const packagingAudit = createCleanTar(tarPath, courtRoot, artifactName);
  const members = execFile('tar', ['-tzf', tarPath]);
  let provenanceHeaderRejected = false;
  try {
    assertNoMacOsExtendedHeaders([
      '57 LIBARCHIVE.xattr.com.apple.provenance=synthetic-court\n',
      '54 SCHILY.xattr.com.apple.ResourceFork=synthetic-court\n',
    ]);
  } catch (error) {
    provenanceHeaderRejected =
      error?.code === 'ARTIFACT_MACOS_EXTENDED_HEADER_REJECTED';
  }
  if (!provenanceHeaderRejected) {
    throw new Error('Clean packaging court did not reject macOS extended headers');
  }
  process.stdout.write(
    `${JSON.stringify({ members: members.trim().split('\n'), packagingAudit, provenanceHeaderRejected, tarPath })}\n`,
  );
  process.exit(0);
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

async function httpCode(port, hostHeader, pathname) {
  return capture(
    `curl -s -o /dev/null -w "%{http_code}" -H ${JSON.stringify(`Host: ${hostHeader}`)} ${JSON.stringify(`http://127.0.0.1:${port}${pathname}`)}`,
  );
}

// ---------------------------------------------------------------------------
// Phase 0/1 — identity + clean
// ---------------------------------------------------------------------------
const gitSha = capture('git rev-parse HEAD', { cwd: repoRoot });
const shortSha = gitSha.slice(0, 7);
const workingTree = capture('git status --porcelain', { cwd: repoRoot });

// FAIL CLOSED: never build an unreachable or dirty commit into a deployable
// artifact (production incident 2026-07-23 — the live orderweeddc-c1e8ac7 came
// from an unpushed SHA). See release-preflight.mjs. Override for throwaway local
// builds only with ALLOW_DIRTY=1; the remote is GIT_REMOTE (default: origin).
const releaseRepro = assertReleaseReproducible({
  execFile,
  repoRoot,
  remote: process.env.GIT_REMOTE || 'origin',
  workingTree,
  gitSha,
  allowDirty: process.env.ALLOW_DIRTY === '1',
});

const artifactName = `orderweeddc-${gitSha}`;
const distRoot = path.join(repoRoot, 'dist/namecheap');
const artifactRoot = path.join(distRoot, artifactName);

fs.rmSync(artifactRoot, { recursive: true, force: true });
fs.rmSync(path.join(webRoot, '.next'), { recursive: true, force: true });
fs.mkdirSync(artifactRoot, { recursive: true });

if (process.env.CLEAN_INSTALL === '1') {
  run('npm ci', {
    cwd: repoRoot,
    env: releaseChildEnvironment({
      PRISMA_CLI_BINARY_TARGETS: PACKAGED_MIGRATION_BINARY_TARGETS.join(','),
    }),
  });
}

// ---------------------------------------------------------------------------
// Phase 2 — assets, prisma client, webpack standalone build
// ---------------------------------------------------------------------------
run('node scripts/restore-brand-assets.mjs', { cwd: webRoot });
run('npx prisma generate', {
  cwd: webRoot,
  env: releaseChildEnvironment({
    DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/cana_build_only',
    DIRECT_URL: 'postgresql://postgres@127.0.0.1:5432/cana_build_only',
  }),
});
const buildPostgres = startDisposablePostgres({
  label: 'artifact-build',
  publishLoopback: true,
});
let buildError;
let buildDatabaseCleanup = false;
try {
  run('npx next build', {
    cwd: webRoot,
    env: releaseChildEnvironment({
      CANA_BUILD_DATABASE_URL: buildPostgres.databaseUrl,
      NEXT_OUTPUT: 'standalone',
      NODE_ENV: 'production',
    }),
  });
} catch (error) {
  buildError = error;
} finally {
  buildDatabaseCleanup = stopDisposablePostgres(buildPostgres);
}
if (buildError) throw buildError;
if (!buildDatabaseCleanup) {
  throw new Error('Artifact build failed to remove its disposable build PostgreSQL container');
}

// ---------------------------------------------------------------------------
// Phase 3 — assemble
// ---------------------------------------------------------------------------
const standaloneRoot = path.join(webRoot, '.next/standalone');
assertExists(standaloneRoot, 'standalone output');
const nestedWeb = path.join(standaloneRoot, 'apps/web');
const serverDir = fs.existsSync(path.join(nestedWeb, 'server.js'))
  ? nestedWeb
  : standaloneRoot;
assertExists(path.join(serverDir, 'server.js'), 'standalone server.js');

copyDir(serverDir, artifactRoot);
const hoistedModules = path.join(standaloneRoot, 'node_modules');
if (serverDir !== standaloneRoot && fs.existsSync(hoistedModules)) {
  copyDir(hoistedModules, path.join(artifactRoot, 'node_modules'));
}
copyDir(path.join(webRoot, '.next/static'), path.join(artifactRoot, '.next/static'));
copyDir(path.join(webRoot, 'public'), path.join(artifactRoot, 'public'));
fs.copyFileSync(
  path.join(repoRoot, 'deploy/namecheap/app.js'),
  path.join(artifactRoot, 'app.js'),
);

// Release identity — the BUILD-TIME artifact behind GET /api/release.
// A deployed tarball has no .git directory, so this file is the only honest
// answer to "which commit is running". Written before packaging so the
// isolated runtime test exercises the real wire contract, and validated in
// the hard-stop checks below. Contract reader:
// apps/web/src/app/api/release/release-identity.mjs.
function writeReleaseIdentity() {
  const releaseIdentity = {
    gitSha,
    shortSha,
    artifact: artifactName,
    builtAt: new Date().toISOString(),
    bundler: 'webpack',
    builder: 'deploy/namecheap/build-artifact.mjs',
  };
  fs.writeFileSync(
    path.join(artifactRoot, 'release.json'),
    JSON.stringify(releaseIdentity, null, 2),
  );
  return releaseIdentity;
}
const releaseIdentity = writeReleaseIdentity();

fs.mkdirSync(path.join(artifactRoot, 'scripts'), { recursive: true });
for (const script of [
  'scripts/init-production-db.mjs',
  'scripts/db-inspect.mjs',
  'scripts/restore-brand-assets.mjs',
  'scripts/brand-assets.b64.json',
]) {
  fs.copyFileSync(path.join(webRoot, script), path.join(artifactRoot, script));
}
fs.mkdirSync(path.join(artifactRoot, 'src/lib'), { recursive: true });
fs.copyFileSync(
  path.join(webRoot, 'src/lib/db-config.mjs'),
  path.join(artifactRoot, 'src/lib/db-config.mjs'),
);
copyOperationalScripts(artifactRoot);
fs.mkdirSync(path.join(artifactRoot, 'prisma'), { recursive: true });
fs.copyFileSync(
  path.join(webRoot, 'prisma/schema.prisma'),
  path.join(artifactRoot, 'prisma/schema.prisma'),
);
// Committed migrations ship verbatim WHEN the migration lane has produced
// them (apps/web/prisma/migrations/**). This builder never authors or edits
// a migration — absence simply means migrate.sh hard-stops on the server.
const migrationsDir = path.join(webRoot, 'prisma/migrations');
const migrationManifestPath = path.join(webRoot, 'prisma/migration-manifest.json');
const migrationVerifierPath = path.join(webRoot, 'prisma/migration-manifest.mjs');
const migrationUniverse = validateCanonicalMigrationUniverse({
  migrationsDir,
  manifest: loadCanonicalMigrationManifest(migrationManifestPath),
});
copyDir(migrationsDir, path.join(artifactRoot, 'prisma/migrations'));
fs.copyFileSync(migrationManifestPath, path.join(artifactRoot, 'prisma/migration-manifest.json'));
fs.copyFileSync(migrationVerifierPath, path.join(artifactRoot, 'prisma/migration-manifest.mjs'));
const packagedMigrationPackages = [...copyInstalledPackageClosure('prisma')]
  .map((packageRoot) => path.relative(path.join(repoRoot, 'node_modules'), packageRoot))
  .sort();
for (const packageRoot of packagedMigrationPackages) {
  const destination = path.join(artifactRoot, 'node_modules', packageRoot);
  for (const file of walkFiles(destination)) {
    if (/^readme.*\.md$/i.test(path.basename(file))) fs.rmSync(file);
  }
}
const packagedPrismaCliSha256 = sha256File(
  path.join(artifactRoot, 'node_modules/prisma/build/index.js'),
);
if (
  packagedPrismaCliSha256 !==
  PINNED_ARTIFACT_EXECUTABLE_SHA256['node_modules/prisma/build/index.js']
) {
  throw new Error('The packaged Prisma CLI does not match the reviewed dependency bytes');
}
const packagedSchemaEngines = Object.fromEntries(
  PACKAGED_MIGRATION_BINARY_TARGETS.map((binaryTarget) => {
    const relativePath = `node_modules/@prisma/engines/schema-engine-${binaryTarget}`;
    const target = path.join(artifactRoot, relativePath);
    assertExists(target, `artifact-local Prisma schema engine for ${binaryTarget}`);
    return [binaryTarget, {
      relativePath,
      sha256: sha256File(target),
    }];
  }),
);
validateCanonicalMigrationUniverse({
  migrationsDir: path.join(artifactRoot, 'prisma/migrations'),
  manifest: loadCanonicalMigrationManifest(path.join(artifactRoot, 'prisma/migration-manifest.json')),
});
fs.mkdirSync(path.join(artifactRoot, 'docs/competitive'), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, 'docs/competitive/dc-merchant-universe.json'),
  path.join(artifactRoot, 'docs/competitive/dc-merchant-universe.json'),
);

// Server-fit pruning (probe evidence: OpenSSL 1.1.1k on glibc; the server
// pins the rhel-1.1.x engine explicitly, so other engines are dead bytes).
const pruned = [];
if (process.env.SERVER_OPENSSL === '1.1') {
  for (const target of [
    'node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node',
    'node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node',
    'node_modules/@img/sharp-libvips-linuxmusl-x64',
    'node_modules/@img/sharp-linuxmusl-x64',
  ]) {
    const full = path.join(artifactRoot, target);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
      pruned.push(target);
    }
  }
}

const artifactSourceMaps = walkFiles(artifactRoot).filter((file) => file.endsWith('.map'));
for (const file of artifactSourceMaps) fs.rmSync(file);

// ---------------------------------------------------------------------------
// Phase 4 — hard-stop verification (incl. unresolved-external scan)
// ---------------------------------------------------------------------------
const checks = {};
checks['server.js present'] = fs.existsSync(path.join(artifactRoot, 'server.js'));
checks['app.js present'] = fs.existsSync(path.join(artifactRoot, 'app.js'));
checks['.next/static present'] = fs.existsSync(path.join(artifactRoot, '.next/static'));
checks['fonts restored'] = fs.existsSync(
  path.join(artifactRoot, 'public/fonts/inter-var-latin.woff2'),
);
checks['artwork restored'] = fs.existsSync(
  path.join(artifactRoot, 'public/art/hero-dc.jpg'),
);
checks['@prisma/client package present'] = fs.existsSync(
  path.join(artifactRoot, 'node_modules/@prisma/client/package.json'),
);
checks['artifact-local prisma migration CLI present'] = fs.existsSync(
  path.join(artifactRoot, 'node_modules/prisma/build/index.js'),
);
for (const [binaryTarget, engine] of Object.entries(packagedSchemaEngines)) {
  checks[`artifact-local ${binaryTarget} schema engine present`] = fs.existsSync(
    path.join(artifactRoot, engine.relativePath),
  );
}
checks['.prisma/client generated dir present'] = fs.existsSync(
  path.join(artifactRoot, 'node_modules/.prisma/client'),
);
const prismaClientDir = path.join(artifactRoot, 'node_modules/.prisma/client');
const engineFiles = fs.existsSync(prismaClientDir)
  ? fs.readdirSync(prismaClientDir).filter((file) => file.includes('engine'))
  : [];
checks['prisma engines found'] = engineFiles.length > 0;
checks['rhel-openssl-1.1.x engine present (probe: OpenSSL 1.1.1k)'] =
  engineFiles.some((file) => file.includes('rhel-openssl-1.1.x'));
checks['canonical schema is PostgreSQL'] = /provider\s*=\s*"postgresql"/.test(
  fs.readFileSync(path.join(artifactRoot, 'prisma/schema.prisma'), 'utf8'),
);
checks['no SQLite bootstrap shipped'] =
  !fs.existsSync(path.join(artifactRoot, 'bootstrap-production-db.sh')) &&
  !fs.existsSync(path.join(artifactRoot, 'bootstrap'));
checks['no legacy ABCA import bypass shipped'] = [
  'scripts/etl-abca-retailers.mjs',
  'scripts/ingest-abca-feed.mjs',
  'scripts/seed-abca-retailers.mjs',
].every((script) => !fs.existsSync(path.join(artifactRoot, script)));
checks['no live acquisition tooling shipped'] = [
  'scripts/acquire-live-market-reality.mjs',
  'src/lib/reality/live-abca-adapter.mjs',
  'src/lib/reality/live-reality-acquisition.mjs',
].every((file) => !fs.existsSync(path.join(artifactRoot, file)));
checks[`no source maps shipped (${artifactSourceMaps.length} removed)`] =
  walkFiles(artifactRoot).every((file) => !file.endsWith('.map'));
checks['release.json present with full 40-hex gitSha'] =
  fs.existsSync(path.join(artifactRoot, 'release.json')) &&
  /^[0-9a-f]{40}$/.test(releaseIdentity.gitSha) &&
  releaseIdentity.gitSha === gitSha;

// Unresolved hashed-external scan across every compiled server JS file.
// Turbopack emits externals like @prisma/client-2c3a283f134fdcb6 which are
// unresolvable in an isolated artifact — production incident 2026-07-23.
const hashedExternalPattern = /@prisma\/client-[0-9a-f]{8,}/;
const serverJsFiles = walkFiles(path.join(artifactRoot, '.next/server')).filter(
  (file) => file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs'),
);
const unresolvedHits = [];
for (const file of serverJsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(hashedExternalPattern);
  if (match) {
    const pkgName = match[0];
    // Resolvable only if a matching package dir exists inside the artifact.
    if (!fs.existsSync(path.join(artifactRoot, 'node_modules', pkgName))) {
      unresolvedHits.push({ file: path.relative(artifactRoot, file), reference: pkgName });
    }
  }
}
checks[`no unresolved hashed externals (${serverJsFiles.length} server files scanned)`] =
  unresolvedHits.length === 0;

// Source-map exclusion: standalone server output must not ship .map files
// (dead weight + source disclosure). Static client maps are handled by Next.
const serverMapFiles = walkFiles(path.join(artifactRoot, '.next/server')).filter(
  (file) => file.endsWith('.map'),
);
checks['no server source maps in artifact'] = serverMapFiles.length === 0;

function reportChecks() {
  console.log('\nArtifact verification:');
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  if (failed.length > 0) {
    if (unresolvedHits.length > 0) {
      console.error('Unresolved external references:', JSON.stringify(unresolvedHits, null, 2));
    }
    throw new Error(
      `Artifact verification failed: ${failed.map(([name]) => name).join(', ')}`,
    );
  }
}
reportChecks();

// ---------------------------------------------------------------------------
// Phase 5 — package, then ISOLATED runtime test outside the repository
// ---------------------------------------------------------------------------
function writeReceipt(extra = {}) {
  const receipt = {
    artifact: artifactName,
    gitSha,
    releaseRepro,
    workingTree: workingTree === '' ? 'clean' : workingTree.split('\n'),
    builtAt: new Date().toISOString(),
    nodeVersion: process.version,
    nodePath: process.execPath,
    // Hoisted monorepo: resolve through Node so root node_modules works.
    nextVersion: JSON.parse(
      fs.readFileSync(
        capture(`${JSON.stringify(process.execPath)} -e "console.log(require.resolve('next/package.json'))"`, {
          cwd: webRoot,
        }),
        'utf8',
      ),
    ).version,
    prismaVersion: JSON.parse(
      fs.readFileSync(
        capture(`${JSON.stringify(process.execPath)} -e "console.log(require.resolve('@prisma/client/package.json'))"`, {
          cwd: webRoot,
        }),
        'utf8',
      ),
    ).version,
    bundler: 'webpack',
    nextOutput: 'standalone',
    prismaEngines: engineFiles,
    serverFitPruned: pruned,
    unresolvedExternalScan: {
      filesScanned: serverJsFiles.length,
      pattern: hashedExternalPattern.source,
      unresolved: unresolvedHits,
    },
    databaseContract: {
      canonicalProvider: 'postgresql',
      directUrlRequired: true,
      sqliteRole: 'pre-cutover-rollback-snapshot-only',
      buildDatabase: {
        builderOwned: true,
        loopbackOnly: true,
        cleanup: buildDatabaseCleanup,
      },
      migrationUniverse,
      packagedMigrationPackages,
      packagedPrismaCliSha256,
      packagedSchemaEngines,
    },
    checks,
    ...extra,
  };
  fs.writeFileSync(
    path.join(artifactRoot, 'receipt.json'),
    JSON.stringify(receipt, null, 2),
  );
}

function packageTar() {
  const tarPath = path.join(distRoot, `${artifactName}.tar.gz`);
  const packagingAudit = createCleanTar(tarPath, distRoot, artifactName);
  console.log(
    `Clean artifact member audit: ${packagingAudit.memberCount} members, `
      + `${packagingAudit.rejectedMembers.length} rejected metadata members, `
      + `${packagingAudit.macOsExtendedHeaderCount} macOS extended headers`,
  );
  return tarPath;
}

writeReceipt({ isolatedRuntimeTest: 'pending' });
let tarPath = packageTar();

async function isolatedRuntimeTest() {
  const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-isolated-'));
  const results = { isolationDir: isoRoot, steps: {} };
  const record = (name, ok, detail) => {
    results.steps[name] = { ok, detail };
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) throw new Error(`Isolated runtime test failed at: ${name}`);
  };

  console.log(`\nIsolated runtime test in ${isoRoot} (outside the repository):`);
  run(`tar -xzf ${JSON.stringify(tarPath)} -C ${JSON.stringify(isoRoot)}`);
  const appRoot = path.join(isoRoot, artifactName);
  record('artifact extracted outside repo', fs.existsSync(path.join(appRoot, 'server.js')));
  record(
    'no parent node_modules can leak',
    !fs.existsSync(path.join(isoRoot, 'node_modules')) &&
      !fs.existsSync(path.join(os.tmpdir(), 'node_modules')),
  );

  // Platform-aware TEST engine. The production artifact ships and uses the Linux RHEL engine;
  // this isolation test may run on macOS, where dlopen() of a Linux .so.node fails. Select the
  // engine matching THIS machine from the artifact's own generated client dir and thread it
  // through every isolated process. app.js only pins RHEL when PRISMA_QUERY_ENGINE_LIBRARY is
  // unset, so overriding it here changes NOTHING about production behavior.
  const prismaClientDir = path.join(appRoot, 'node_modules/.prisma/client');
  const isoEngineFiles = fs.existsSync(prismaClientDir)
    ? fs.readdirSync(prismaClientDir).filter((f) => f.includes('engine'))
    : [];
  const testEngine = selectTestPrismaEngine(isoEngineFiles, process.platform, process.arch);
  const testEnginePath = path.join(prismaClientDir, testEngine);
  record(
    `native test engine selected for ${process.platform}/${process.arch}`,
    fs.existsSync(testEnginePath),
    testEngine,
  );

  const postgres = startDisposablePostgres({ label: 'artifact', publishLoopback: true });
  let primaryError;
  let cleanupOk = false;
  try {
  const disposableBackupReceipt = path.join(isoRoot, 'disposable-backup-receipt.json');
  fs.writeFileSync(disposableBackupReceipt, JSON.stringify({ scope: 'isolated-build-court' }));
  run('sh migrate.sh --initialize', {
    cwd: appRoot,
    env: {
      PATH: process.env.PATH,
      OWD_NODE: process.execPath,
      DATABASE_URL: postgres.databaseUrl,
      DIRECT_URL: postgres.databaseUrl,
      CANA_PRE_MIGRATION_BACKUP_RECEIPT: disposableBackupReceipt,
      CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER: postgres.systemIdentifier,
      PRISMA_QUERY_ENGINE_LIBRARY: testEnginePath,
    },
  });
  const inspect = JSON.parse(
    capture(`${JSON.stringify(process.execPath)} scripts/db-inspect.mjs`, {
      cwd: appRoot,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: postgres.databaseUrl,
        DIRECT_URL: postgres.databaseUrl,
        PRISMA_QUERY_ENGINE_LIBRARY: testEnginePath,
      },
    }),
  );
  results.productionBootstrap = inspect.counts;
  record(
    'migrations + production bootstrap: canonical brand, empty market, zero demo',
    inspect.counts?.organizations === 1 &&
      inspect.counts?.brands === 1 &&
      inspect.counts?.canonicalBrands === 1 &&
      inspect.counts?.retailers === 0 &&
      inspect.counts?.awaitingVerification === 0 &&
      inspect.counts?.demonstrationRetailers === 0,
    JSON.stringify(inspect.counts),
  );
  const initializedDatabaseSha256 = databaseDataSha256(postgres);
  const runtimeWriteCountersBefore = databaseWriteCounters(postgres);
  results.productionBootstrapDataSha256 = initializedDatabaseSha256;

  // Start app.js with a minimal, NODE_PATH-free environment.
  const port = await availableLoopbackPort();
  const serverEnv = {
    PATH: process.env.PATH,
    HOME: isoRoot,
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: postgres.databaseUrl,
    DIRECT_URL: postgres.databaseUrl,
    CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER: postgres.systemIdentifier,
    // Test-only: app.js keeps its production RHEL pin when this is UNSET; here we
    // supply the machine-native engine so the isolated app starts on macOS too.
    PRISMA_QUERY_ENGINE_LIBRARY: testEnginePath,
  };
  let serverLog = '';
  const startServer = () => {
    const server = spawn(process.execPath, ['app.js'], {
      cwd: appRoot,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    server.stdout.on('data', (data) => { serverLog += data; });
    server.stderr.on('data', (data) => { serverLog += data; });
    return server;
  };
  const stopServer = async (server) => {
    if (!server || server.exitCode !== null) return;
    await new Promise((resolve, reject) => {
      const forceTimer = setTimeout(() => {
        if (server.exitCode === null) server.kill('SIGKILL');
      }, 5_000);
      server.once('error', (error) => {
        clearTimeout(forceTimer);
        reject(error);
      });
      server.once('exit', () => {
        clearTimeout(forceTimer);
        resolve();
      });
      server.kill('SIGTERM');
    });
  };
  const waitForServer = async (server) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) {
        throw new Error(`Isolated app exited before readiness with code ${server.exitCode}`);
      }
      try {
        const release = JSON.parse(capture(
          `curl -fsS -H "Host: orderweeddc.com" http://127.0.0.1:${port}/api/release`,
        ));
        if (release.status === 'RELEASE_SHA_PRESENT' && release.gitSha === gitSha) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Isolated app did not become ready within the bounded startup court');
  };
  const forgedIdentityChild = spawn(process.execPath, ['app.js'], {
    cwd: appRoot,
    env: {
      ...serverEnv,
      CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER: '9999999999999999999',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let forgedIdentityLog = '';
  forgedIdentityChild.stdout.on('data', (data) => { forgedIdentityLog += data; });
  forgedIdentityChild.stderr.on('data', (data) => { forgedIdentityLog += data; });
  const forgedIdentityExit = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      forgedIdentityChild.kill('SIGKILL');
      resolve(null);
    }, 5_000);
    forgedIdentityChild.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  record(
    'app.js refuses a forged loopback disposable-system identity before startup',
    forgedIdentityExit !== null &&
      forgedIdentityExit !== 0 &&
      forgedIdentityLog.includes('Disposable PostgreSQL identity verification failed') &&
      !forgedIdentityLog.includes(postgres.databaseUrl),
  );
  let child = startServer();
  await waitForServer(child);

  try {
    const health = capture(
      `curl -s -H "Host: orderweeddc.com" http://127.0.0.1:${port}/api/health`,
    );
    const healthJson = JSON.parse(health);
    results.health = {
      status: healthJson.status,
      ...healthJson.services?.database?.details,
    };
    record(
      '/api/health HEALTHY with real counts (Host: orderweeddc.com)',
      healthJson.status === 'HEALTHY' &&
        healthJson.services?.database?.details?.brandCount === 1 &&
        healthJson.services?.database?.details?.totalRetailers === 0 &&
        healthJson.services?.database?.details?.verifiedRetailers === 0,
      JSON.stringify(healthJson.services?.database?.details),
    );
    // Release identity endpoint: the deployed runtime must name the exact
    // commit it was built from — the SHA this very build recorded. A wrong,
    // missing, or fabricated SHA fails the artifact before it can ship.
    const releaseWire = JSON.parse(
      capture(
        `curl -s -H "Host: orderweeddc.com" http://127.0.0.1:${port}/api/release`,
      ),
    );
    record(
      '/api/release serves this build\'s exact gitSha (RELEASE_SHA_PRESENT)',
      releaseWire.status === 'RELEASE_SHA_PRESENT' && releaseWire.gitSha === gitSha,
      `${releaseWire.status} ${releaseWire.gitSha}`,
    );
    record(
      '/api/release is never cached (Cache-Control: no-store)',
      capture(
        `curl -s -o /dev/null -D - -H "Host: orderweeddc.com" http://127.0.0.1:${port}/api/release`,
      )
        .toLowerCase()
        .includes('no-store'),
    );

    for (const [label, host, pathname, expected] of [
      ['homepage 200', 'orderweeddc.com', '/', '200'],
      ['pricing 200', 'orderweeddc.com', '/pricing', '200'],
      ['robots.txt 200', 'orderweeddc.com', '/robots.txt', '200'],
      ['sitemap.xml 200', 'orderweeddc.com', '/sitemap.xml', '200'],
      ['llms.txt 200', 'orderweeddc.com', '/llms.txt', '200'],
      ['www redirect 308', 'www.orderweeddc.com', '/', '308'],
      ['unknown host 421', 'evil.example', '/', '421'],
      ['tenant spoof 404', 'orderweeddc.com', '/wellness.localhost', '404'],
      ['localhost Host spoof 421', 'localhost', '/orderweeddc.localhost', '421'],
      ['127.0.0.1 Host spoof 421', '127.0.0.1', '/orderweeddc.localhost', '421'],
    ]) {
      record(label, (await httpCode(port, host, pathname)) === expected);
    }

    for (const [label, query] of [
      ['geo viewport missing bounds', ''],
      ['geo viewport blank bounds', '?south=&west=&north=&east='],
      ['geo viewport reversed bounds', '?south=39&west=-77&north=38&east=-76'],
      ['geo viewport excessive area', '?south=0&west=0&north=2&east=2'],
    ]) {
      const response = capture(
        `curl -s -o /dev/null -D - -w "\\n%{http_code}" -H "Host: orderweeddc.com" ${JSON.stringify(`http://127.0.0.1:${port}/api/geo/viewport${query}`)}`,
      );
      record(
        `${label} returns uncached 400`,
        response.endsWith('\n400') && response.toLowerCase().includes('cache-control: no-store'),
      );
    }

    // Restart persistence.
    await stopServer(child);
    child = startServer();
    await waitForServer(child);
    const health2 = JSON.parse(
      capture(`curl -s -H "Host: orderweeddc.com" http://127.0.0.1:${port}/api/health`),
    );
    const inspectAfterRestart = JSON.parse(
      capture(`${JSON.stringify(process.execPath)} scripts/db-inspect.mjs`, {
        cwd: appRoot,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: postgres.databaseUrl,
          DIRECT_URL: postgres.databaseUrl,
          PRISMA_QUERY_ENGINE_LIBRARY: testEnginePath,
        },
      }),
    );
    await stopServer(child);
    child = null;
    const runtimeWriteCountersAfter = databaseWriteCounters(postgres);
    const marketWrites = runtimeWriteCountersAfter.total - runtimeWriteCountersBefore.total;
    const restartedDatabaseSha256 = databaseDataSha256(postgres);
    const databaseUnchanged = initializedDatabaseSha256 === restartedDatabaseSha256;
    results.restart = {
      status: health2.status,
      health: health2.services?.database?.details,
      counts: inspectAfterRestart.counts,
      databaseDataBeforeSha256: initializedDatabaseSha256,
      databaseDataAfterSha256: restartedDatabaseSha256,
      auditedWriteCountersBefore: runtimeWriteCountersBefore,
      auditedWriteCountersAfter: runtimeWriteCountersAfter,
      marketWrites,
    };
    record(
      'restart persistence: canonical brand, empty market, zero demo',
      health2.status === 'HEALTHY' &&
        health2.services?.database?.details?.brandCount === 1 &&
        health2.services?.database?.details?.totalRetailers === 0 &&
        health2.services?.database?.details?.verifiedRetailers === 0 &&
        inspectAfterRestart.counts?.canonicalBrands === 1 &&
        inspectAfterRestart.counts?.retailers === 0 &&
        inspectAfterRestart.counts?.demonstrationRetailers === 0,
      JSON.stringify(inspectAfterRestart.counts),
    );
    record(
      'runtime and restart perform zero audited PostgreSQL writes',
      marketWrites === 0,
      `${runtimeWriteCountersBefore.total} -> ${runtimeWriteCountersAfter.total}`,
    );
    record(
      'health and restart leave the complete PostgreSQL data state unchanged',
      databaseUnchanged,
      `${initializedDatabaseSha256} -> ${restartedDatabaseSha256}`,
    );
  } finally {
    try {
      await stopServer(child);
    } catch {}
  }

  const exclusionAudit = auditArtifactExclusions(appRoot);
  record(
    'no forbidden secret files or credential patterns in artifact',
    exclusionAudit.passed,
    `${exclusionAudit.filesScanned} files scanned`,
  );
  results.artifactExclusionAudit = exclusionAudit;

  const databaseStateBefore = databaseDataSha256(postgres);
  const fakeHome = path.join(isoRoot, 'rollback-home');
  const appHome = path.join(fakeHome, 'apps/orderweeddc');
  for (const release of ['current', 'previous']) {
    const releaseRoot = path.join(appHome, release);
    fs.mkdirSync(releaseRoot, { recursive: true });
    fs.writeFileSync(path.join(releaseRoot, 'server.js'), '');
    fs.copyFileSync(path.join(appRoot, 'receipt.json'), path.join(releaseRoot, 'receipt.json'));
  }
  run(`OWD_APP_HOME=${JSON.stringify(appHome)} sh ${JSON.stringify(path.join(appRoot, 'rollback.sh'))}`);
  const databaseStateAfter = databaseDataSha256(postgres);
  record(
    'code rollback leaves canonical database state unchanged',
    databaseStateBefore === databaseStateAfter,
    `${databaseStateBefore} -> ${databaseStateAfter}`,
  );
  results.rollback = {
    databaseUnchanged: databaseStateBefore === databaseStateAfter,
    databaseDataBeforeSha256: databaseStateBefore,
    databaseDataAfterSha256: databaseStateAfter,
  };
  results.databaseDataSha256 = databaseStateAfter;

  results.serverLogTail = serverLog.slice(-400);
  } catch (error) {
    primaryError = error;
  }
  if (primaryError) {
    cleanupOk = stopDisposablePostgres(postgres);
    if (!cleanupOk) {
      primaryError.message += '; disposable PostgreSQL cleanup also failed';
    }
    throw primaryError;
  }
  results.postgres = postgres;
  return results;
}

const isolatedResults = await isolatedRuntimeTest();

// ---------------------------------------------------------------------------
// Phase 6 — final receipt (with isolated results) + final package
// ---------------------------------------------------------------------------
let tarSha256;
let finalError;
let finalCleanup = false;
try {
  writeReceipt({
    isolatedRuntimeTest: {
      passed: true,
      isolationDir: isolatedResults.isolationDir,
      nodeUsed: process.version,
      productionBootstrap: isolatedResults.productionBootstrap,
      productionBootstrapDataSha256: isolatedResults.productionBootstrapDataSha256,
      health: isolatedResults.health,
      restart: isolatedResults.restart,
      rollback: isolatedResults.rollback,
      steps: Object.fromEntries(
        Object.entries(isolatedResults.steps).map(([k, v]) => [k, v.ok]),
      ),
    },
  });
  tarPath = packageTar();
  const fakeHome = path.join(isolatedResults.isolationDir, 'delivery-home');
  fs.mkdirSync(path.join(fakeHome, 'uploads'), { recursive: true });
  fs.copyFileSync(tarPath, path.join(fakeHome, 'uploads', `${artifactName}.tar.gz`));
  tarSha256 = sha256File(tarPath);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    run(
      `HOME=${JSON.stringify(fakeHome)} sh ${JSON.stringify(path.join(repoRoot, 'deploy/namecheap/deploy.sh'))} ${artifactName}.tar.gz ${tarSha256}`,
    );
  }
  run(`HOME=${JSON.stringify(fakeHome)} sh ${JSON.stringify(path.join(fakeHome, 'apps/orderweeddc/rollback.sh'))}`);
  const deliveryDatabaseSha256 = databaseDataSha256(isolatedResults.postgres);
  if (deliveryDatabaseSha256 !== isolatedResults.databaseDataSha256) {
    throw new Error('Final artifact deploy/rollback court changed the disposable PostgreSQL data state');
  }
  console.log(`  PASS  final deploy/rollback court leaves PostgreSQL unchanged — ${deliveryDatabaseSha256}`);
  fs.writeFileSync(`${tarPath}.sha256`, `${tarSha256}  ${artifactName}.tar.gz\n`);
} catch (error) {
  finalError = error;
} finally {
  finalCleanup = stopDisposablePostgres(isolatedResults.postgres);
}
if (finalError || !finalCleanup) {
  fs.rmSync(tarPath, { force: true });
  fs.rmSync(`${tarPath}.sha256`, { force: true });
  if (finalError) throw finalError;
  throw new Error('Artifact court failed to remove its disposable PostgreSQL container');
}

console.log(`\nArtifact ready: ${tarPath}`);
console.log(`sha256: ${tarSha256}`);
console.log(`Receipt: ${path.join(artifactRoot, 'receipt.json')}`);
