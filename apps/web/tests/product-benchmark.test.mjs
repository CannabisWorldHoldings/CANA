import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { productDiscoveryOrderBy } from '../src/lib/product-discovery.mjs';
import {
  canonicalGitWorktree,
  normalizedTextBytes,
  semanticReceipt,
  validateCorpus,
} from '../scripts/benchmark-product-discovery.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const runnerPath = path.join(webRoot, 'scripts', 'benchmark-product-discovery.mjs');
const fixturePath = path.join(webRoot, 'benchmarks', 'discovery-tasks.json');
const existingTestPath = path.join(testDirectory, 'product-discovery.test.mjs');
const benchmarkDirectory = path.resolve(os.tmpdir());
const benchmarkDirectoryPrefix = 'orderweeddc-discovery-benchmark-';
const baselineTestHash =
  '681c62550fe3f9d3d12120d104a5d431ffc45ffdd9d199d9e2261ee36172173c';
const frozenCorpusHash =
  '3e10cbde6012d4e5916f0f1d356cad4f0afdbf5dd4e276ee977320378309f004';

function safeEnvironment() {
  const environment = {};
  for (const key of [
    'ComSpec',
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR',
    // Public TLS trust-store paths, not credentials. Required behind
    // corporate/CI TLS-inspection proxies.
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  return environment;
}

function runBenchmark(mutation = 'none') {
  const arguments_ = [
    runnerPath,
    ...(mutation === 'none' ? [] : [`--mutation=${mutation}`]),
  ];
  const result = spawnSync(process.execPath, arguments_, {
    cwd: webRoot,
    encoding: 'utf8',
    env: safeEnvironment(),
    timeout: 120_000,
    windowsHide: true,
  });
  assert.doesNotThrow(
    () => JSON.parse(result.stdout),
    `runner stdout was not JSON: ${result.stdout}\n${result.stderr}`,
  );
  return { ...result, receipt: JSON.parse(result.stdout) };
}

test('frozen discovery corpus has exactly twelve synthetic task contracts', () => {
  const fixtureBytes = normalizedTextBytes(fs.readFileSync(fixturePath));
  const corpus = validateCorpus(JSON.parse(fixtureBytes.toString('utf8')));
  assert.equal(corpus.scenarios.length, 12);
  assert.equal(new Set(corpus.scenarios.map(({ id }) => id)).size, 12);
  assert.equal(
    crypto.createHash('sha256').update(fixtureBytes).digest('hex'),
    frozenCorpusHash,
  );
  assert.ok(
    [
      corpus.organization,
      ...corpus.tenants,
      ...corpus.retailers,
      ...corpus.products,
      ...corpus.menuEntries,
      ...corpus.scenarios,
    ].every(({ benchmarkOnly }) => benchmarkOnly === true),
  );
});

test('clean benchmark is deterministic and exercises all twelve scenarios', () => {
  const first = runBenchmark();
  const second = runBenchmark();
  assert.equal(first.status, 0, JSON.stringify(first.receipt));
  assert.equal(second.status, 0, JSON.stringify(second.receipt));
  assert.equal(first.receipt.aggregate.status, 'PASS');
  assert.deepEqual(first.receipt.aggregate, {
    status: 'PASS',
    passed: 12,
    failed: 0,
    total: 12,
  });
  assert.match(first.receipt.gitRevision, /^[0-9a-f]{40}$/);
  assert.match(first.receipt.corpusHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(semanticReceipt(first.receipt), semanticReceipt(second.receipt));
  assert.deepEqual(first.receipt.safety, {
    applicationNonLoopbackRequestsAttempted: 0,
    credentialEnvironmentVariablesInherited: 0,
    persistentApplicationDataWrites: 0,
    temporaryDatabaseRemoved: true,
    temporaryReceiptDirectoryRemoved: true,
  });
});

test('interruption removes the disposable database and receipt directory', async () => {
  const before = new Set(
    fs
      .readdirSync(benchmarkDirectory)
      .filter((name) => name.startsWith(benchmarkDirectoryPrefix)),
  );
  const child = spawn(process.execPath, [runnerPath], {
    cwd: webRoot,
    env: {
      ...safeEnvironment(),
      ORDERWEEDDC_BENCHMARK_SANITIZED: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  const deadline = Date.now() + 10_000;
  let temporaryDirectory;
  while (!temporaryDirectory && Date.now() < deadline) {
    temporaryDirectory = fs
      .readdirSync(benchmarkDirectory)
      .find(
        (name) =>
          name.startsWith(benchmarkDirectoryPrefix) && !before.has(name),
      );
    if (!temporaryDirectory) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(temporaryDirectory, 'benchmark temporary directory was not created');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(child.kill('SIGINT'), true);
  const [exitCode] = await once(child, 'exit');
  assert.notEqual(exitCode, 0);

  const cleanupDeadline = Date.now() + 10_000;
  while (
    fs.existsSync(path.join(benchmarkDirectory, temporaryDirectory)) &&
    Date.now() < cleanupDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(
    fs.existsSync(path.join(benchmarkDirectory, temporaryDirectory)),
    false,
  );
});

test('Git revision resolution supports primary repository metadata directories', () => {
  const temporaryRepository = fs.mkdtempSync(
    path.join(os.tmpdir(), 'orderweeddc-primary-git-fixture-'),
  );
  try {
    fs.mkdirSync(path.join(temporaryRepository, '.git'));
    assert.equal(
      canonicalGitWorktree(temporaryRepository),
      temporaryRepository,
    );
  } finally {
    fs.rmSync(temporaryRepository, { recursive: true, force: true });
  }
});

for (const mutation of [
  'sponsored-first',
  'stale-evidence',
  'cross-tenant',
]) {
  test(`controlled ${mutation} regression exits nonzero and is detected`, () => {
    const result = runBenchmark(mutation);
    assert.notEqual(result.status, 0);
    assert.equal(
      result.receipt.aggregate.status,
      'FAIL',
      JSON.stringify(result.receipt),
    );
    assert.ok(result.receipt.aggregate.failed >= 1);
    assert.ok(
      result.receipt.scenarios.some(({ status }) => status === 'FAIL'),
    );
    assert.equal(
      result.receipt.safety.applicationNonLoopbackRequestsAttempted,
      0,
    );
    assert.equal(result.receipt.safety.temporaryDatabaseRemoved, true);
    assert.equal(result.receipt.safety.temporaryReceiptDirectoryRemoved, true);
  });
}

test('default and rejected sponsored ordering contain no prohibited signals', () => {
  const prohibited =
    /sponsor|popular|review|engagement|effect|purchase|loyalty|behavior/i;
  assert.doesNotMatch(
    JSON.stringify(productDiscoveryOrderBy('TRUTH_FIRST')),
    prohibited,
  );
  assert.deepEqual(
    productDiscoveryOrderBy('SPONSORED'),
    productDiscoveryOrderBy('TRUTH_FIRST'),
  );

  const corpus = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  for (const scenario of corpus.scenarios) {
    assert.doesNotMatch(
      JSON.stringify({
        expectedRecordIds: scenario.expectedRecordIds,
        sort: scenario.filters.sort,
      }),
      prohibited,
    );
  }
});

test('existing product-discovery contract remains normalized-text identical', () => {
  const observed = crypto
    .createHash('sha256')
    .update(normalizedTextBytes(fs.readFileSync(existingTestPath)))
    .digest('hex');
  assert.equal(observed, baselineTestHash);
});
