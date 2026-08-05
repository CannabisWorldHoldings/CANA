import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  productDiscoveryOrderBy,
  productDiscoveryWhere,
} from '../src/lib/product-discovery.mjs';

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(scriptPath), '..');
const repositoryRoot = path.resolve(webRoot, '..', '..');
const corpusPath = path.join(webRoot, 'benchmarks', 'discovery-tasks.json');
const schemaPath = path.join(webRoot, 'prisma', 'schema.prisma');
const prismaClientGeneratorPath = path.join(
  path.dirname(require.resolve('@prisma/client/package.json')),
  'generator-build',
  'index.js',
);
const sanitizedProcessMarker = 'ORDERWEEDDC_BENCHMARK_SANITIZED';
const cleanupDirectoryPrefix = 'orderweeddc-discovery-benchmark-';
const allowedMutations = new Set([
  'none',
  'sponsored-first',
  'stale-evidence',
  'cross-tenant',
]);
const requiredCoverage = new Set([
  'text',
  'category',
  'strain type',
  'service type',
  'verified-current',
  'demonstration-only',
  'reported stock',
  'price band',
  'price ordering',
  'recently updated ordering',
  'stale-data rejection',
  'tenant isolation',
]);
const safeEnvironmentKeys = [
  'ComSpec',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  // Public TLS trust-store paths, not credentials. Required so sanitized
  // child processes can verify HTTPS behind corporate/CI TLS-inspection
  // proxies. They contain no secrets and grant no authority.
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

function safeEnvironment(additions = {}) {
  const environment = {};
  for (const key of safeEnvironmentKeys) {
    if (typeof process.env[key] === 'string') {
      environment[key] = process.env[key];
    }
  }
  return {
    ...environment,
    CHECKPOINT_DISABLE: '1',
    CI: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
    ...additions,
  };
}

function disposableEnvironment(temporaryRoot, additions = {}) {
  return safeEnvironment({
    APPDATA: temporaryRoot,
    HOME: temporaryRoot,
    LOCALAPPDATA: temporaryRoot,
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    TMPDIR: temporaryRoot,
    USERPROFILE: temporaryRoot,
    ...additions,
  });
}

function parseMutation(argv) {
  const mutationArgument = argv.find((argument) =>
    argument.startsWith('--mutation='),
  );
  const mutation = mutationArgument
    ? mutationArgument.slice('--mutation='.length)
    : 'none';
  if (!allowedMutations.has(mutation)) {
    throw new TypeError(`Unsupported controlled mutation: ${mutation}`);
  }
  return mutation;
}

function cleanupWatchRequest(argv) {
  const parentArgument = argv.find((argument) =>
    argument.startsWith('--cleanup-parent='),
  );
  if (!parentArgument) return null;
  const pathArgument = argv.find((argument) =>
    argument.startsWith('--cleanup-path='),
  );
  const parentPid = Number(
    parentArgument.slice('--cleanup-parent='.length),
  );
  const cleanupPath = path.resolve(
    pathArgument?.slice('--cleanup-path='.length) ?? '',
  );
  if (
    !Number.isSafeInteger(parentPid) ||
    parentPid < 1 ||
    parentPid === process.pid ||
    path.dirname(cleanupPath) !== path.resolve(os.tmpdir()) ||
    !path.basename(cleanupPath).startsWith(cleanupDirectoryPrefix)
  ) {
    throw new TypeError('Invalid benchmark cleanup-watch request.');
  }
  return { cleanupPath, parentPid };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function watchParentAndCleanup({ cleanupPath, parentPid }) {
  while (processExists(parentPid)) await delay(100);
  await removeDirectoryWithRetries(cleanupPath);
}

async function removeDirectoryWithRetries(cleanupPath, maximumAttempts = 100) {
  let lastError;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
      if (!fs.existsSync(cleanupPath)) return true;
    } catch (error) {
      lastError = error;
    }
    if (attempt === maximumAttempts) break;
    await delay(100);
  }
  throw new Error(
    `Benchmark cleanup exhausted its retry bound: ${
      lastError instanceof Error ? lastError.message : 'directory remains'
    }`,
  );
}

function startCleanupWatchdog(temporaryRoot) {
  const watchdog = spawn(
    process.execPath,
    [
      scriptPath,
      `--cleanup-parent=${process.pid}`,
      `--cleanup-path=${temporaryRoot}`,
    ],
    {
      cwd: webRoot,
      detached: true,
      env: safeEnvironment({ [sanitizedProcessMarker]: '1' }),
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  watchdog.unref();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizedTextBytes(value) {
  return Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');
}

function isolatedPrismaSchema(value) {
  const source = value.toString('utf8').replaceAll('\r\n', '\n');
  const generatorPattern =
    /generator client \{\s*provider = "prisma-client-js"[\s\S]*?\n\}/;
  if (
    !generatorPattern.test(source) ||
    !/provider = "prisma-client-js"/.test(source)
  ) {
    throw new TypeError('The Prisma client generator contract has changed.');
  }
  return source.replace(
    generatorPattern,
    [
      'generator client {',
      `  provider = ${JSON.stringify(
        `${process.execPath} ${prismaClientGeneratorPath}`,
      )}`,
      '  output   = "./client"',
      '  engineType = "binary"',
      '}',
    ].join('\n'),
  );
}

function unique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must be unique.`);
  }
}

export function validateCorpus(corpus) {
  if (
    corpus?.schemaVersion !== '1.0.0' ||
    corpus?.benchmarkOnly !== true ||
    corpus?.corpusType !== 'FROZEN_SYNTHETIC_PRODUCT_DISCOVERY'
  ) {
    throw new TypeError('Corpus metadata does not declare a frozen benchmark.');
  }
  if (
    !Number.isFinite(new Date(corpus.asOf).getTime()) ||
    corpus.organization?.benchmarkOnly !== true
  ) {
    throw new TypeError('Corpus time and organization must be synthetic.');
  }

  const collections = [
    ['tenants', corpus.tenants],
    ['retailers', corpus.retailers],
    ['products', corpus.products],
    ['menu entries', corpus.menuEntries],
    ['scenarios', corpus.scenarios],
  ];
  for (const [label, records] of collections) {
    if (!Array.isArray(records) || records.some((record) => record.benchmarkOnly !== true)) {
      throw new TypeError(`Every ${label} record must be benchmark-only.`);
    }
    unique(records.map(({ id }) => id), `${label} identifiers`);
  }

  if (corpus.scenarios.length !== 12) {
    throw new TypeError('The corpus must contain exactly 12 scenarios.');
  }
  unique(corpus.scenarios.map(({ name }) => name), 'scenario names');
  if (
    corpus.scenarios.some(
      ({ name }) => typeof name !== 'string' || !/\S+\s+\S+/.test(name),
    )
  ) {
    throw new TypeError('Scenario names must be human-readable.');
  }
  const observedCoverage = new Set(
    corpus.scenarios.flatMap(({ coverage }) => coverage ?? []),
  );
  if (
    observedCoverage.size !== requiredCoverage.size ||
    [...requiredCoverage].some((item) => !observedCoverage.has(item))
  ) {
    throw new TypeError('Scenario coverage does not match the frozen contract.');
  }

  const factualRecords = [...corpus.retailers, ...corpus.products, ...corpus.menuEntries];
  if (
    factualRecords.some(
      (record) =>
        record.dataSource !== 'Synthetic benchmark fixture' ||
        record.sourceUrl != null,
    )
  ) {
    throw new TypeError('Fixture records may use only synthetic provenance.');
  }

  const tenantIds = new Set(corpus.tenants.map(({ id }) => id));
  const retailerIds = new Set(corpus.retailers.map(({ id }) => id));
  const productIds = new Set(corpus.products.map(({ id }) => id));
  const menuEntryIds = new Set(corpus.menuEntries.map(({ id }) => id));
  for (const entry of corpus.menuEntries) {
    if (
      !retailerIds.has(entry.retailerId) ||
      !productIds.has(entry.productId) ||
      !Array.isArray(entry.tenantIds) ||
      entry.tenantIds.length === 0 ||
      entry.tenantIds.some((id) => !tenantIds.has(id))
    ) {
      throw new TypeError(`Menu entry ${entry.id} has an invalid fixture link.`);
    }
  }
  for (const scenario of corpus.scenarios) {
    const expected = scenario.expectedRecordIds;
    const excluded = scenario.truthBoundary?.mustExclude;
    if (
      !tenantIds.has(scenario.brandId) ||
      !Array.isArray(expected) ||
      !Array.isArray(excluded) ||
      [...expected, ...excluded].some((id) => !menuEntryIds.has(id))
    ) {
      throw new TypeError(`Scenario ${scenario.id} has an invalid expectation.`);
    }
    unique(expected, `${scenario.id} expected record identifiers`);
    unique(excluded, `${scenario.id} excluded record identifiers`);
  }
  return corpus;
}

function loadCorpus() {
  const bytes = normalizedTextBytes(fs.readFileSync(corpusPath));
  return {
    bytes,
    corpus: validateCorpus(JSON.parse(bytes.toString('utf8'))),
  };
}

function prismaCliPath() {
  return path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
}

function runPrisma(arguments_, databaseUrl, temporaryRoot) {
  const result = spawnSync(
    process.execPath,
    [prismaCliPath(), ...arguments_],
    {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: disposableEnvironment(temporaryRoot, {
        DATABASE_URL: databaseUrl,
      }),
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Disposable Prisma setup failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

export function canonicalGitWorktree(root = repositoryRoot) {
  const resolvedRoot = path.resolve(root);
  const dotGitPath = path.join(resolvedRoot, '.git');
  if (fs.statSync(dotGitPath).isDirectory()) return resolvedRoot;
  const dotGit = fs.readFileSync(dotGitPath, 'utf8').trim();
  if (!dotGit.startsWith('gitdir: ')) {
    throw new Error('The linked Git worktree metadata is invalid.');
  }
  const gitDirectory = dotGit.slice('gitdir: '.length).trim();
  const canonicalDotGit = fs
    .readFileSync(path.join(gitDirectory, 'gitdir'), 'utf8')
    .trim();
  if (path.basename(canonicalDotGit).toLowerCase() !== '.git') {
    throw new Error('The canonical Git worktree metadata is invalid.');
  }
  return path.dirname(canonicalDotGit);
}

function inheritedCredentialEnvironmentCount() {
  const credentialName =
    /(?:API_?KEY|AUTH|CREDENTIAL|PASSWORD|SECRET|TOKEN)/i;
  return Object.keys(process.env).filter((key) => credentialName.test(key))
    .length;
}

function gitRevision(temporaryRoot) {
  const safeRoot = canonicalGitWorktree().replaceAll('\\', '/');
  const result = spawnSync(
    'git',
    ['-c', `safe.directory=${safeRoot}`, 'rev-parse', 'HEAD'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: disposableEnvironment(temporaryRoot),
      windowsHide: true,
    },
  );
  const revision = result.stdout.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('The exact Git revision could not be determined.');
  }
  return revision;
}

function dateFields(record) {
  const converted = { ...record };
  for (const field of [
    'createdAt',
    'updatedAt',
    'verifiedAt',
    'freshnessExpiresAt',
  ]) {
    if (typeof converted[field] === 'string') {
      converted[field] = new Date(converted[field]);
    }
  }
  return converted;
}

function withoutBenchmarkFields(record, extra = []) {
  const cleaned = { ...record };
  delete cleaned.benchmarkOnly;
  for (const field of extra) delete cleaned[field];
  return dateFields(cleaned);
}

async function seedCorpus(prisma, corpus) {
  const fixedTime = new Date(corpus.asOf);
  await prisma.organization.create({
    data: {
      id: corpus.organization.id,
      name: corpus.organization.name,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
  });
  await prisma.brand.createMany({
    data: corpus.tenants.map((tenant) => ({
      ...withoutBenchmarkFields(tenant),
      organizationId: corpus.organization.id,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    })),
  });
  await prisma.retailer.createMany({
    data: corpus.retailers.map((retailer) => ({
      ...withoutBenchmarkFields(retailer),
      city: 'Synthetic City',
      state: 'DC',
      lat: 0,
      lng: 0,
      createdAt: fixedTime,
    })),
  });
  await prisma.product.createMany({
    data: corpus.products.map((product) => ({
      ...withoutBenchmarkFields(product),
      createdAt: fixedTime,
    })),
  });
  await prisma.menuEntry.createMany({
    data: corpus.menuEntries.map((entry) => ({
      ...withoutBenchmarkFields(entry, ['tenantIds']),
      createdAt: fixedTime,
    })),
  });
  await prisma.brandMenu.createMany({
    data: corpus.menuEntries.flatMap((entry) =>
      entry.tenantIds.map((brandId) => ({
        id: `${brandId}-${entry.id}`,
        brandId,
        menuEntryId: entry.id,
      })),
    ),
  });
}

function stripFreshnessConstraints(value) {
  if (Array.isArray(value)) return value.map(stripFreshnessConstraints);
  if (value instanceof Date) return new Date(value);
  if (value == null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'freshnessExpiresAt')
      .map(([key, nested]) => [key, stripFreshnessConstraints(nested)]),
  );
}

function controlledWhere(actualWhere, mutation) {
  if (mutation === 'stale-evidence') {
    return stripFreshnessConstraints(actualWhere);
  }
  if (mutation === 'cross-tenant') {
    const changed = structuredClone(actualWhere);
    delete changed.brandMenus;
    return changed;
  }
  return actualWhere;
}

function controlledOrderBy(actualOrderBy, filters, mutation) {
  if (mutation === 'sponsored-first' && !filters.sort) {
    return [{ retailer: { isSponsored: 'desc' } }, ...actualOrderBy];
  }
  return actualOrderBy;
}

function requestHost(arguments_) {
  const first = arguments_[0];
  if (first instanceof URL) return first.hostname;
  if (typeof first === 'string') {
    try {
      return new URL(first).hostname;
    } catch {
      return '';
    }
  }
  return first?.hostname ?? first?.host ?? '';
}

function socketHost(arguments_) {
  const first = arguments_[0];
  if (Array.isArray(first)) return first[0]?.host ?? '';
  if (first && typeof first === 'object') return first.host ?? '';
  if (typeof arguments_[1] === 'string') return arguments_[1];
  return '';
}

function isLoopback(host) {
  const normalized = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === '' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('127.')
  );
}

function installNetworkBoundary() {
  let attemptedNonLoopbackRequests = 0;
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalConnect = net.Socket.prototype.connect;

  function reject(host) {
    if (!isLoopback(host)) {
      attemptedNonLoopbackRequests += 1;
      throw new Error(`Benchmark blocked a non-loopback request to ${host}.`);
    }
  }

  if (typeof originalFetch === 'function') {
    globalThis.fetch = function boundedFetch(input, ...rest) {
      reject(requestHost([input]));
      return originalFetch.call(this, input, ...rest);
    };
  }
  http.request = function boundedHttpRequest(...arguments_) {
    reject(requestHost(arguments_));
    return originalHttpRequest.apply(this, arguments_);
  };
  https.request = function boundedHttpsRequest(...arguments_) {
    reject(requestHost(arguments_));
    return originalHttpsRequest.apply(this, arguments_);
  };
  net.Socket.prototype.connect = function boundedSocketConnect(...arguments_) {
    reject(socketHost(arguments_));
    return originalConnect.apply(this, arguments_);
  };

  return {
    attempted: () => attemptedNonLoopbackRequests,
    restore() {
      if (typeof originalFetch === 'function') globalThis.fetch = originalFetch;
      http.request = originalHttpRequest;
      https.request = originalHttpsRequest;
      net.Socket.prototype.connect = originalConnect;
    },
  };
}

async function evaluateScenarios(prisma, corpus, mutation) {
  const asOf = new Date(corpus.asOf);
  const results = [];
  for (const scenario of corpus.scenarios) {
    const startedAt = performance.now();
    const actualWhere = productDiscoveryWhere({
      brandId: scenario.brandId,
      filters: scenario.filters,
      asOf,
    });
    const actualOrderBy = [
      ...productDiscoveryOrderBy(scenario.filters.sort),
    ];
    const records = await prisma.menuEntry.findMany({
      where: controlledWhere(actualWhere, mutation),
      orderBy: controlledOrderBy(actualOrderBy, scenario.filters, mutation),
      select: { id: true },
    });
    const observedRecordIds = records.map(({ id }) => id);
    const excludedRecordIdsAbsent = scenario.truthBoundary.mustExclude.every(
      (id) => !observedRecordIds.includes(id),
    );
    const resultMatches =
      JSON.stringify(observedRecordIds) ===
      JSON.stringify(scenario.expectedRecordIds);
    results.push({
      scenarioId: scenario.id,
      name: scenario.name,
      expectedRecordIds: scenario.expectedRecordIds,
      observedRecordIds,
      expectedTruthBoundary: scenario.truthBoundary,
      observedTruthBoundary: {
        excludedRecordIdsAbsent,
        passed: excludedRecordIdsAbsent && resultMatches,
      },
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      status: excludedRecordIdsAbsent && resultMatches ? 'PASS' : 'FAIL',
    });
  }
  return results;
}

async function removeTemporaryState(prisma, temporaryRoot) {
  let disconnectError;
  try {
    if (prisma) await prisma.$disconnect();
  } catch (error) {
    disconnectError = error;
  } finally {
    await removeDirectoryWithRetries(temporaryRoot);
  }
  if (disconnectError) throw disconnectError;
  return !fs.existsSync(temporaryRoot);
}

export function semanticReceipt(receipt) {
  return {
    ...receipt,
    durationMs: undefined,
    scenarios: receipt.scenarios.map((scenario) => ({
      ...scenario,
      durationMs: undefined,
    })),
  };
}

async function runBenchmark({ mutation = 'none' } = {}) {
  if (!allowedMutations.has(mutation)) {
    throw new TypeError(`Unsupported controlled mutation: ${mutation}`);
  }
  const startedAt = performance.now();
  const { bytes, corpus } = loadCorpus();
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), cleanupDirectoryPrefix),
  );
  startCleanupWatchdog(temporaryRoot);
  const databasePath = path.join(temporaryRoot, 'benchmark.sqlite');
  const temporarySchemaPath = path.join(temporaryRoot, 'schema.prisma');
  const temporaryClientPath = path.join(temporaryRoot, 'client', 'index.js');
  const schemaDatabaseUrl = 'file:./benchmark.sqlite';
  const clientDatabaseUrl = `file:${databasePath.replaceAll('\\', '/')}`;
  const receiptPath = path.join(temporaryRoot, 'receipt.json');
  const networkBoundary = installNetworkBoundary();
  let prisma;
  let revision;
  let temporaryStateRemoved = false;
  let receipt;

  // SIGINT/SIGTERM must exit NONZERO so a supervisor can tell an interrupted
  // run from a clean one.
  //
  // The previous handler was `async` and called process.exit(130) inside a
  // `finally` that awaited an async cleanup. Node does not keep the process
  // alive for a pending promise chain started from a signal handler, so the
  // loop drained and the process exited with the already-set exitCode 0 —
  // an interrupted benchmark reported success. Verified: SIGINT produced
  // exitCode=0, signal=null.
  //
  // Fix: set the exit code SYNCHRONOUSLY and immediately, so the value is
  // correct no matter when the process actually terminates. Cleanup is then
  // attempted on a bounded budget and the process is forced down regardless,
  // because a stuck teardown must not leave a zombie holding the temp dir.
  let interrupted = false;
  const interruptCleanup = (signal) => {
    if (interrupted) return;          // a second Ctrl-C must not re-enter
    interrupted = true;
    process.exitCode = 130;           // synchronous: correct even if we are killed next tick
    const force = setTimeout(() => {
      networkBoundary.restore();
      process.exit(130);
    }, 2_000);
    force.unref?.();
    Promise.resolve()
      .then(() => removeTemporaryState(prisma, temporaryRoot))
      .catch(() => {})
      .finally(() => {
        clearTimeout(force);
        networkBoundary.restore();
        process.exit(130);
      });
  };
  process.once('SIGINT', interruptCleanup);
  process.once('SIGTERM', interruptCleanup);

  try {
    revision = gitRevision(temporaryRoot);
    fs.writeFileSync(
      temporarySchemaPath,
      isolatedPrismaSchema(fs.readFileSync(schemaPath)),
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
    runPrisma(
      ['db', 'push', '--schema', temporarySchemaPath, '--skip-generate'],
      schemaDatabaseUrl,
      temporaryRoot,
    );
    runPrisma(
      ['generate', '--schema', temporarySchemaPath],
      schemaDatabaseUrl,
      temporaryRoot,
    );
    const { PrismaClient } = await import(pathToFileURL(temporaryClientPath));
    prisma = new PrismaClient({
      datasources: { db: { url: clientDatabaseUrl } },
      log: [],
    });
    await seedCorpus(prisma, corpus);
    const scenarios = await evaluateScenarios(prisma, corpus, mutation);
    const passed = scenarios.filter(({ status }) => status === 'PASS').length;
    receipt = {
      schemaVersion: '1.0.0',
      gitRevision: revision,
      corpusHash: sha256(bytes),
      corpusType: corpus.corpusType,
      benchmarkOnly: true,
      mutation,
      asOf: corpus.asOf,
      scenarios,
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      aggregate: {
        status: passed === scenarios.length ? 'PASS' : 'FAIL',
        passed,
        failed: scenarios.length - passed,
        total: scenarios.length,
      },
      safety: {
        applicationNonLoopbackRequestsAttempted: networkBoundary.attempted(),
        credentialEnvironmentVariablesInherited:
          inheritedCredentialEnvironmentCount(),
        persistentApplicationDataWrites: 0,
        temporaryDatabaseRemoved: false,
        temporaryReceiptDirectoryRemoved: false,
      },
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    receipt = {
      schemaVersion: '1.0.0',
      gitRevision: revision ?? null,
      corpusHash: sha256(bytes),
      corpusType: corpus.corpusType,
      benchmarkOnly: true,
      mutation,
      asOf: corpus.asOf,
      scenarios: [],
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      aggregate: { status: 'ERROR', passed: 0, failed: 12, total: 12 },
      safety: {
        applicationNonLoopbackRequestsAttempted: networkBoundary.attempted(),
        credentialEnvironmentVariablesInherited:
          inheritedCredentialEnvironmentCount(),
        persistentApplicationDataWrites: 0,
        temporaryDatabaseRemoved: false,
        temporaryReceiptDirectoryRemoved: false,
      },
      error: (error instanceof Error ? error.message : String(error)).slice(
        0,
        2_000,
      ),
    };
  } finally {
    process.removeListener('SIGINT', interruptCleanup);
    process.removeListener('SIGTERM', interruptCleanup);
    try {
      temporaryStateRemoved = await removeTemporaryState(prisma, temporaryRoot);
    } catch (error) {
      temporaryStateRemoved = !fs.existsSync(temporaryRoot);
      receipt.aggregate = { status: 'ERROR', passed: 0, failed: 12, total: 12 };
      receipt.error = [
        receipt.error,
        `Temporary-state cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ]
        .filter(Boolean)
        .join(' ');
    } finally {
      networkBoundary.restore();
    }
  }

  receipt.safety.temporaryDatabaseRemoved = temporaryStateRemoved;
  receipt.safety.temporaryReceiptDirectoryRemoved = temporaryStateRemoved;
  return receipt;
}

function relayThroughSanitizedProcess(arguments_) {
  const result = spawnSync(process.execPath, [scriptPath, ...arguments_], {
    cwd: webRoot,
    encoding: 'utf8',
    env: safeEnvironment({ [sanitizedProcessMarker]: '1' }),
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.stdout) {
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: '1.0.0',
        benchmarkOnly: true,
        aggregate: { status: 'ERROR', passed: 0, failed: 12, total: 12 },
        error: 'The sanitized benchmark process did not emit a receipt.',
      })}\n`,
    );
  }
  process.exitCode = result.status ?? 1;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const cleanupRequest = cleanupWatchRequest(arguments_);
  if (cleanupRequest) {
    await watchParentAndCleanup(cleanupRequest);
    return;
  }
  if (process.env[sanitizedProcessMarker] !== '1') {
    relayThroughSanitizedProcess(arguments_);
    return;
  }
  let receipt;
  try {
    receipt = await runBenchmark({ mutation: parseMutation(arguments_) });
  } catch (error) {
    receipt = {
      schemaVersion: '1.0.0',
      benchmarkOnly: true,
      aggregate: { status: 'ERROR', passed: 0, failed: 12, total: 12 },
      error: error instanceof Error ? error.message : String(error),
    };
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.aggregate.status === 'PASS' ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
  await main();
}
