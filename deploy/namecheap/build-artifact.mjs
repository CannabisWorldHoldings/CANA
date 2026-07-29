/**
 * Builds the Namecheap/cPanel deployment artifact OFF-SERVER — and proves it
 * runs in TRUE ISOLATION before publishing.
 *
 * Bundler: WEBPACK (`next build --webpack`), permanently. Next 16 defaults to
 * Turbopack, whose standalone output externalizes hashed package references
 * (e.g. @prisma/client-<hex>) that are unresolvable outside the build tree —
 * proven in production on business194 (2026-07-23). The webpack standalone
 * path traces real, self-contained node_modules.
 *
 * Phases:
 *   1. Clean: remove .next + old artifact; optional CLEAN_INSTALL=1 npm ci;
 *      record working-tree state in the receipt.
 *   2. Restore brand assets, prisma generate (RHEL engines), build --webpack.
 *   3. Assemble artifact (server, static, public, prisma tooling, bootstrap
 *      script, schema-template db) and prune server-mismatched binaries when
 *      SERVER_OPENSSL=1.1.
 *   4. Hard-stop verification, including a scan of every compiled
 *      .next/server JS file for unresolved hashed externals.
 *   5. Package, then run the ISOLATED RUNTIME TEST: extract the tarball into
 *      a directory outside the repository (no parent node_modules, cleared
 *      NODE_PATH), bootstrap a copied test database, start app.js, and pass
 *      the full HTTP battery + restart persistence + rollback db-integrity.
 *   6. Write the final receipt (bundler, versions, scan + test results) into
 *      the artifact and re-package. The tarball is only kept if EVERYTHING
 *      passed.
 *
 * Run from the repo root:
 *   node deploy/namecheap/build-artifact.mjs
 *   SERVER_OPENSSL=1.1 CLEAN_INSTALL=1 node deploy/namecheap/build-artifact.mjs
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditArtifactExclusions } from './artifact-exclusions.mjs';
import { createReleaseChildEnvironment } from './release-environment.mjs';
import { assertReleaseReproducible } from './release-preflight.mjs';
import { selectTestPrismaEngine } from './select-test-engine.mjs';

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'apps/web');

function buildChildEnvironment(baseEnvironment = process.env) {
  const environment = createReleaseChildEnvironment({ baseEnvironment });
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  return environment;
}

// Pin the build/verify Node to the production runtime (Namecheap Node 20.20.2). A shell
// wrapper resolving a different `node` (e.g. a Hermes v22 binary) invalidates the isolation
// proof. Invoke the exact binary, e.g.:
//   $HOME/.nvm/versions/node/v20.20.2/bin/node deploy/namecheap/build-artifact.mjs
const REQUIRED_NODE = process.env.REQUIRED_NODE || 'v20.20.2';
if (process.version !== REQUIRED_NODE && process.env.ALLOW_NODE_MISMATCH !== '1') {
  throw new Error(
    `Build requires Node ${REQUIRED_NODE} but is running ${process.version} at ${process.execPath}. ` +
    `Invoke the exact binary ($HOME/.nvm/versions/node/${REQUIRED_NODE}/bin/node), ` +
    `or set ALLOW_NODE_MISMATCH=1 to override (never for a release build).`,
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

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
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
    `curl -s -o /dev/null -w "%{http_code}" -H ${JSON.stringify(`Host: ${hostHeader}`)} http://127.0.0.1:${port}${pathname}`,
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

const artifactName = `orderweeddc-${shortSha}`;
const distRoot = path.join(repoRoot, 'dist/namecheap');
const artifactRoot = path.join(distRoot, artifactName);

fs.rmSync(artifactRoot, { recursive: true, force: true });
fs.rmSync(path.join(webRoot, '.next'), { recursive: true, force: true });
fs.mkdirSync(artifactRoot, { recursive: true });

if (process.env.CLEAN_INSTALL === '1') {
  run('npm ci', { cwd: repoRoot });
}

// ---------------------------------------------------------------------------
// Phase 2 — assets, prisma client, webpack standalone build
// ---------------------------------------------------------------------------
run('node scripts/restore-brand-assets.mjs', { cwd: webRoot });
run('npx prisma generate', {
  cwd: webRoot,
  env: releaseChildEnvironment({ DATABASE_URL: 'file:./.cana-prisma-generate-only.db' }),
});
run('npx next build --webpack', {
  cwd: webRoot,
  env: releaseChildEnvironment({
    NEXT_OUTPUT: 'standalone',
    NODE_ENV: 'production',
  }),
});

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
  'scripts/seed-abca-retailers.mjs',
  'scripts/db-inspect.mjs',
  'scripts/restore-brand-assets.mjs',
  'scripts/brand-assets.b64.json',
]) {
  fs.copyFileSync(path.join(webRoot, script), path.join(artifactRoot, script));
}
for (const opsScript of [
  'bootstrap-production-db.sh',
  'restart.sh',
  'rollback.sh',
  'migrate.sh',
  'healthcheck.sh',
  'readycheck.sh',
  'smoke-test.sh',
  'worker.mjs',
  'restore-backup.sh',
]) {
  fs.copyFileSync(
    path.join(repoRoot, 'deploy/namecheap', opsScript),
    path.join(artifactRoot, opsScript),
  );
}
fs.mkdirSync(path.join(artifactRoot, 'prisma'), { recursive: true });
fs.copyFileSync(
  path.join(webRoot, 'prisma/schema.prisma'),
  path.join(artifactRoot, 'prisma/schema.prisma'),
);
// Committed migrations ship verbatim WHEN the migration lane has produced
// them (apps/web/prisma/migrations/**). This builder never authors or edits
// a migration — absence simply means migrate.sh hard-stops on the server.
const migrationsDir = path.join(webRoot, 'prisma/migrations');
if (fs.existsSync(migrationsDir)) {
  copyDir(migrationsDir, path.join(artifactRoot, 'prisma/migrations'));
}
fs.mkdirSync(path.join(artifactRoot, 'docs/competitive'), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, 'docs/competitive/dc-merchant-universe.json'),
  path.join(artifactRoot, 'docs/competitive/dc-merchant-universe.json'),
);

// Schema-template database (schema only, zero data) — see bootstrap script.
const templateDir = path.join(artifactRoot, 'bootstrap');
fs.mkdirSync(templateDir, { recursive: true });
const templateDb = path.join(templateDir, 'orderweeddc-schema-template.db');
fs.rmSync(templateDb, { force: true });
run(`npx prisma db push --skip-generate --schema prisma/schema.prisma`, {
  cwd: webRoot,
  env: releaseChildEnvironment({ DATABASE_URL: `file:${templateDb}` }),
});
const templateInventory = JSON.parse(
  capture(`node scripts/db-inspect.mjs`, {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: `file:${templateDb}` },
  }),
);
const templateSha256 = sha256File(templateDb);

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
checks['schema template present'] = fs.existsSync(templateDb);
checks['schema template has core tables'] =
  templateInventory.coreTablesPresent === true && templateInventory.tableCount > 10;
checks['schema template is data-free'] =
  (templateInventory.counts?.organizations ?? 0) === 0 &&
  (templateInventory.counts?.brands ?? 0) === 0 &&
  (templateInventory.counts?.retailers ?? 0) === 0;
checks['bootstrap script present'] = fs.existsSync(
  path.join(artifactRoot, 'bootstrap-production-db.sh'),
);
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
    schemaTemplate: {
      file: 'bootstrap/orderweeddc-schema-template.db',
      sha256: templateSha256,
      tableCount: templateInventory.tableCount,
      tables: templateInventory.tables,
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
  run(
    `tar -czf ${JSON.stringify(`${artifactName}.tar.gz`)} -C ${JSON.stringify(distRoot)} ${JSON.stringify(artifactName)}`,
    { cwd: distRoot },
  );
  return path.join(distRoot, `${artifactName}.tar.gz`);
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

  // Bootstrap a test database inside isolation (also exercises the script).
  const dataDir = path.join(isoRoot, 'data');
  run(
    `PRISMA_QUERY_ENGINE_LIBRARY=${JSON.stringify(testEnginePath)} OWD_DATA_DIR=${JSON.stringify(dataDir)} OWD_NODE=${JSON.stringify(process.execPath)} sh bootstrap-production-db.sh`,
    { cwd: appRoot },
  );
  const inspect = JSON.parse(
    capture(`${JSON.stringify(process.execPath)} scripts/db-inspect.mjs`, {
      cwd: appRoot,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: `file:${path.join(dataDir, 'prod.db')}`,
        PRISMA_QUERY_ENGINE_LIBRARY: testEnginePath,
      },
    }),
  );
  record(
    'bootstrap: canonical brand + 74 retailers, zero demo',
    inspect.counts?.canonicalBrands === 1 &&
      inspect.counts?.retailers === 74 &&
      inspect.counts?.demonstrationRetailers === 0,
    JSON.stringify(inspect.counts),
  );

  // Start app.js with a minimal, NODE_PATH-free environment.
  const port = 3260;
  const serverEnv = {
    PATH: process.env.PATH,
    HOME: isoRoot,
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: `file:${path.join(dataDir, 'prod.db')}`,
    // Test-only: app.js keeps its production RHEL pin when this is UNSET; here we
    // supply the machine-native engine so the isolated app starts on macOS too.
    PRISMA_QUERY_ENGINE_LIBRARY: testEnginePath,
  };
  const startServer = () =>
    spawn(process.execPath, ['app.js'], {
      cwd: appRoot,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
  let child = startServer();
  let serverLog = '';
  child.stdout.on('data', (d) => (serverLog += d));
  child.stderr.on('data', (d) => (serverLog += d));
  await new Promise((resolve) => setTimeout(resolve, 6000));

  try {
    const health = capture(
      `curl -s -H "Host: orderweeddc.com" http://127.0.0.1:${port}/api/health`,
    );
    const healthJson = JSON.parse(health);
    record(
      '/api/health HEALTHY with real counts (Host: orderweeddc.com)',
      healthJson.status === 'HEALTHY' &&
        healthJson.services?.database?.details?.brandCount === 1 &&
        healthJson.services?.database?.details?.totalRetailers === 74,
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

    // Restart persistence.
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    child = startServer();
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const health2 = JSON.parse(
      capture(`curl -s -H "Host: orderweeddc.com" http://127.0.0.1:${port}/api/health`),
    );
    record(
      'restart persistence: 74 records after restart',
      health2.services?.database?.details?.totalRetailers === 74,
    );
  } finally {
    try {
      child.kill('SIGTERM');
    } catch {}
  }

  const exclusionAudit = auditArtifactExclusions(appRoot);
  record(
    'no forbidden secret files or credential patterns in artifact',
    exclusionAudit.passed,
    `${exclusionAudit.filesScanned} files scanned`,
  );
  results.artifactExclusionAudit = exclusionAudit;

  // Code rollback leaves the database byte-identical.
  const dbBefore = sha256File(path.join(dataDir, 'prod.db'));
  const fakeHome = path.join(isoRoot, 'rollback-home');
  fs.mkdirSync(path.join(fakeHome, 'uploads'), { recursive: true });
  fs.copyFileSync(tarPath, path.join(fakeHome, 'uploads', `${artifactName}.tar.gz`));
  run(
    `HOME=${JSON.stringify(fakeHome)} sh ${JSON.stringify(path.join(repoRoot, 'deploy/namecheap/deploy.sh'))} ${artifactName}.tar.gz`,
  );
  run(
    `HOME=${JSON.stringify(fakeHome)} sh ${JSON.stringify(path.join(repoRoot, 'deploy/namecheap/deploy.sh'))} ${artifactName}.tar.gz`,
  );
  run(
    `HOME=${JSON.stringify(fakeHome)} sh ${JSON.stringify(path.join(repoRoot, 'deploy/namecheap/rollback.sh'))}`,
  );
  const dbAfter = sha256File(path.join(dataDir, 'prod.db'));
  record('rollback leaves database byte-identical', dbBefore === dbAfter, dbBefore);

  results.serverLogTail = serverLog.slice(-400);
  return results;
}

const isolatedResults = await isolatedRuntimeTest();

// ---------------------------------------------------------------------------
// Phase 6 — final receipt (with isolated results) + final package
// ---------------------------------------------------------------------------
writeReceipt({
  isolatedRuntimeTest: {
    passed: true,
    isolationDir: isolatedResults.isolationDir,
    nodeUsed: process.version,
    steps: Object.fromEntries(
      Object.entries(isolatedResults.steps).map(([k, v]) => [k, v.ok]),
    ),
  },
});
tarPath = packageTar();
const tarSha256 = sha256File(tarPath);
fs.writeFileSync(`${tarPath}.sha256`, `${tarSha256}  ${artifactName}.tar.gz\n`);

console.log(`\nArtifact ready: ${tarPath}`);
console.log(`sha256: ${tarSha256}`);
console.log(`Receipt: ${path.join(artifactRoot, 'receipt.json')}`);
