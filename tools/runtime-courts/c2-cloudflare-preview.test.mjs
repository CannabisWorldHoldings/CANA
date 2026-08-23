import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import {
  C2Refusal,
  COMPATIBILITY_DATE,
  EXACT_OPENNEXT_VERSION,
  EXACT_WRANGLER_VERSION,
  OPENNEXT_CONFIG_SOURCE,
  assertExactToolPins,
  assertIsolatedWorkDirectory,
  assertLoopbackPreviewUrl,
  assertNoExternalEffects,
  buildC2Plan,
  classifyC2Results,
  createC2Receipt,
  executeLocalPreview,
  main,
  readExactSource,
} from './c2-cloudflare-preview.mjs';

function tempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fixtureRepository({ next = '16.3.0-canary.6', openNextConfig = 'none' } = {}) {
  const root = tempDirectory('c2-source-');
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({
    dependencies: { next },
    devDependencies: { 'eslint-config-next': next },
  }));
  if (openNextConfig === 'file') {
    fs.writeFileSync(
      path.join(root, 'apps', 'web', 'open-next.config.ts'),
      "import { defineCloudflareConfig } from '@opennextjs/cloudflare';\nexport default defineCloudflareConfig();\n",
    );
  } else if (openNextConfig === 'symlink') {
    fs.writeFileSync(path.join(root, 'court-config-target.ts'), 'untrusted destination\n');
    fs.symlinkSync(
      path.join('..', '..', 'court-config-target.ts'),
      path.join(root, 'apps', 'web', 'open-next.config.ts'),
    );
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=C2 test', '-c', 'user.email=c2@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, sha, tree };
}

function c2Env(overrides = {}) {
  return { PRODUCTION_EFFECTS: '0', PATH: process.env.PATH, ...overrides };
}

function expectRefusal(code, fn) {
  assert.throws(fn, (error) => error instanceof C2Refusal && error.code === code);
}

test('GREEN: effects and credential-shaped Cloudflare environment are refused before any local work', () => {
  expectRefusal('C2_PRODUCTION_EFFECTS_REQUIRED', () => assertNoExternalEffects({ env: { PATH: process.env.PATH } }));
  expectRefusal('C2_PRODUCTION_EFFECTS_REQUIRED', () => assertNoExternalEffects({ env: c2Env({ PRODUCTION_EFFECTS: '1' }) }));
  expectRefusal('C2_EXTERNAL_EFFECT_REFUSED', () => assertNoExternalEffects({ env: c2Env({ CLOUDFLARE_API_TOKEN: 'secret' }) }));
  expectRefusal('C2_EXTERNAL_EFFECT_REFUSED', () => assertNoExternalEffects({ env: c2Env(), argv: ['--deploy'] }));
});

test('GREEN: only an empty task-owned directory outside the source tree is isolated', () => {
  const source = fixtureRepository();
  const outer = tempDirectory('c2-work-parent-');
  const workDir = path.join(outer, 'c2-opennext-case');
  fs.mkdirSync(workDir);
  assert.equal(assertIsolatedWorkDirectory(source.root, workDir), fs.realpathSync(workDir));
  expectRefusal('C2_WORKDIR_NOT_ISOLATED', () => assertIsolatedWorkDirectory(source.root, path.join(source.root, 'c2-opennext-escape')));
  expectRefusal('C2_WORKDIR_NOT_ISOLATED', () => assertIsolatedWorkDirectory(source.root, path.join(outer, 'not-task-owned')));
  fs.writeFileSync(path.join(workDir, 'sentinel'), 'x');
  expectRefusal('C2_WORKDIR_NOT_ISOLATED', () => assertIsolatedWorkDirectory(source.root, workDir));
});

test('GREEN: config-free candidate and tool pins fail closed on exact-version drift', () => {
  const source = fixtureRepository();
  assert.deepEqual(readExactSource({ repo: source.root, expectedSha: source.sha, expectedTree: source.tree }), {
    repository: source.root, sha: source.sha, tree: source.tree, nextVersion: '16.3.0-canary.6',
  });
  expectRefusal('C2_SOURCE_SHA_MISMATCH', () => readExactSource({ repo: source.root, expectedSha: '0'.repeat(40), expectedTree: source.tree }));
  expectRefusal('C2_EXACT_VERSION_DRIFT', () => assertExactToolPins({ opennext: '1.20.1', wrangler: EXACT_WRANGLER_VERSION }));
  expectRefusal('C2_EXACT_VERSION_DRIFT', () => assertExactToolPins({ opennext: EXACT_OPENNEXT_VERSION, wrangler: '0.0.0' }));
  const drifted = fixtureRepository({ next: '16.3.0' });
  expectRefusal('C2_EXACT_VERSION_DRIFT', () => readExactSource({ repo: drifted.root, expectedSha: drifted.sha, expectedTree: drifted.tree }));
  const workDir = path.join(tempDirectory('c2-plan-parent-'), 'c2-opennext-plan');
  fs.mkdirSync(workDir);
  const plan = buildC2Plan({
    repo: source.root, expectedSha: source.sha, expectedTree: source.tree, workDir,
    opennext: EXACT_OPENNEXT_VERSION, wrangler: EXACT_WRANGLER_VERSION, env: c2Env(),
  });
  assert.deepEqual(plan.commands[0][1].slice(0, 2), ['install', '--workspaces=false']);
  assert.deepEqual(plan.commands[2], ['npm', ['exec', '--workspaces=false', '--', 'opennextjs-cloudflare', 'build']]);
});

test('RED/GREEN: local execution creates the exact OpenNext config only inside its isolated copy', async () => {
  const source = fixtureRepository();
  const workDir = path.join(tempDirectory('c2-copy-parent-'), 'c2-opennext-copy');
  fs.mkdirSync(workDir);
  const plan = buildC2Plan({
    repo: source.root, expectedSha: source.sha, expectedTree: source.tree, workDir,
    opennext: EXACT_OPENNEXT_VERSION, wrangler: EXACT_WRANGLER_VERSION, env: c2Env(),
  });
  const before = execFileSync('git', ['status', '--porcelain=v1'], { cwd: source.root, encoding: 'utf8' });
  const result = await executeLocalPreview(plan, {
    env: c2Env({ C2_EXECUTE_LOCAL_PREVIEW: '1' }),
    executor: () => ({ ok: false, code: 'C2_OPENNEXT_NEXT_VERSION_UNSUPPORTED' }),
  });
  assert.equal(result.install.code, 'C2_OPENNEXT_NEXT_VERSION_UNSUPPORTED');
  assert.equal(classifyC2Results(result).verdict, 'BLOCKED_CANARY_INCOMPATIBILITY');
  assert.equal(fs.existsSync(path.join(source.root, 'apps', 'web', 'open-next.config.ts')), false);
  const isolatedConfig = path.join(plan.appDir, 'open-next.config.ts');
  assert.equal(fs.readFileSync(isolatedConfig, 'utf8'), OPENNEXT_CONFIG_SOURCE);
  assert.equal(fs.statSync(isolatedConfig).mode & 0o777, 0o600);
  assert.equal(execFileSync('git', ['status', '--porcelain=v1'], { cwd: source.root, encoding: 'utf8' }), before);
});

test('GREEN: isolated config creation refuses a pre-existing file or symlink destination', async () => {
  for (const openNextConfig of ['file', 'symlink']) {
    const source = fixtureRepository({ openNextConfig });
    const workDir = path.join(tempDirectory(`c2-${openNextConfig}-parent-`), `c2-opennext-${openNextConfig}`);
    fs.mkdirSync(workDir);
    const plan = buildC2Plan({
      repo: source.root, expectedSha: source.sha, expectedTree: source.tree, workDir,
      opennext: EXACT_OPENNEXT_VERSION, wrangler: EXACT_WRANGLER_VERSION, env: c2Env(),
    });
    await assert.rejects(
      executeLocalPreview(plan, {
        env: c2Env({ C2_EXECUTE_LOCAL_PREVIEW: '1' }),
        executor: () => ({ ok: false }),
      }),
      (error) => error instanceof C2Refusal && error.code === 'C2_ISOLATED_OUTPUT_DESTINATION_REFUSED',
    );
    assert.equal(fs.existsSync(path.join(plan.appDir, 'wrangler.jsonc')), false);
  }
});

test('GREEN: exact source custody refuses both tracked and untracked candidate changes', () => {
  const tracked = fixtureRepository();
  fs.writeFileSync(path.join(tracked.root, 'apps', 'web', 'package.json'), '{}');
  expectRefusal('C2_SOURCE_NOT_CLEAN', () => readExactSource({ repo: tracked.root, expectedSha: tracked.sha, expectedTree: tracked.tree }));
  const untracked = fixtureRepository();
  fs.writeFileSync(path.join(untracked.root, 'c2-untracked-sentinel'), 'untracked');
  expectRefusal('C2_SOURCE_NOT_CLEAN', () => readExactSource({ repo: untracked.root, expectedSha: untracked.sha, expectedTree: untracked.tree }));
});

test('GREEN: the court only accepts loopback preview endpoints', () => {
  assert.equal(assertLoopbackPreviewUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/');
  expectRefusal('C2_PREVIEW_URL_REFUSED', () => assertLoopbackPreviewUrl('https://example.com/preview'));
});

test('GREEN: classification remains local-only and leaves stable Next recourt open', () => {
  const blocked = classifyC2Results({ attempted: false });
  assert.deepEqual(blocked, {
    verdict: 'ENVIRONMENT_MISSING', executionStatus: 'BLOCKED_NOT_EXECUTED_BY_DEFAULT',
    blockerCode: 'C2_LOCAL_EXECUTION_NOT_ATTEMPTED',
    productionReady: false, stableNextSecurityPatchedRecourt: 'OPEN',
  });
  const compatible = classifyC2Results({
    attempted: true, install: { ok: true }, prismaGenerate: { ok: true }, build: { ok: true }, preview: { ok: true },
    routes: [{ ok: true, route: '/api/health' }, { ok: true, route: '/api/release' }, { ok: true, route: '/' }, { ok: true, route: '/admin' }],
  });
  assert.equal(compatible.verdict, 'COMPATIBLE_LOCAL_PREVIEW');
  assert.equal(compatible.blockerCode, null);
  assert.equal(compatible.productionReady, false);
  assert.equal(compatible.stableNextSecurityPatchedRecourt, 'OPEN');
  assert.equal(classifyC2Results({ attempted: true, install: { ok: true }, prismaGenerate: { ok: true }, build: { ok: false }, preview: { ok: false }, routes: [] }).verdict, 'BLOCKED_CANARY_INCOMPATIBILITY');
  assert.deepEqual(classifyC2Results({
    attempted: true,
    install: { ok: false, code: 'C2_NPM_DEPENDENCY_CONFLICT' },
    build: { ok: false }, preview: { ok: false }, routes: [],
  }), {
    verdict: 'ENVIRONMENT_MISSING',
    executionStatus: 'BLOCKED_ENVIRONMENT_SETUP',
    blockerCode: 'C2_NPM_DEPENDENCY_CONFLICT',
    productionReady: false,
    stableNextSecurityPatchedRecourt: 'OPEN',
  });
  assert.deepEqual(classifyC2Results({
    attempted: true,
    install: { ok: false, code: 'C2_OPENNEXT_NEXT_VERSION_UNSUPPORTED' },
    prismaGenerate: { ok: false, skipped: 'INSTALL_FAILED' },
    build: { ok: false }, preview: { ok: false }, routes: [],
  }), {
    verdict: 'BLOCKED_CANARY_INCOMPATIBILITY',
    executionStatus: 'BLOCKED_CANARY_INCOMPATIBILITY',
    blockerCode: 'C2_OPENNEXT_NEXT_VERSION_UNSUPPORTED',
    productionReady: false,
    stableNextSecurityPatchedRecourt: 'OPEN',
  });
  assert.deepEqual(classifyC2Results({
    attempted: true,
    install: { ok: true },
    prismaGenerate: { ok: false, code: 'C2_PRISMA_CLIENT_UNAVAILABLE' },
    build: { ok: false }, preview: { ok: false }, routes: [],
  }), {
    verdict: 'ENVIRONMENT_MISSING',
    executionStatus: 'BLOCKED_ENVIRONMENT_SETUP',
    blockerCode: 'C2_PRISMA_CLIENT_UNAVAILABLE',
    productionReady: false,
    stableNextSecurityPatchedRecourt: 'OPEN',
  });
  assert.equal(COMPATIBILITY_DATE, '2024-09-23');
  assert.equal(EXACT_WRANGLER_VERSION, '4.86.0');
});

test('GREEN: default invocation preserves the production source and never installs or deploys', async () => {
  const source = fixtureRepository();
  const parent = tempDirectory('c2-default-parent-');
  const workDir = path.join(parent, 'c2-opennext-default');
  fs.mkdirSync(workDir);
  const before = execFileSync('git', ['status', '--porcelain=v1'], { cwd: source.root, encoding: 'utf8' });
  const receipt = await main([
    '--repo', source.root,
    '--expected-sha', source.sha,
    '--expected-tree', source.tree,
    '--work-dir', workDir,
    '--opennext', EXACT_OPENNEXT_VERSION,
    '--wrangler', EXACT_WRANGLER_VERSION,
  ], c2Env());
  const after = execFileSync('git', ['status', '--porcelain=v1'], { cwd: source.root, encoding: 'utf8' });
  assert.equal(after, before);
  assert.equal(receipt.classification.verdict, 'ENVIRONMENT_MISSING');
  assert.equal(fs.readdirSync(workDir).length, 0);
});

test('GREEN: CLI requires the caller to supply literal PRODUCTION_EFFECTS=0', async () => {
  const source = fixtureRepository();
  const parent = tempDirectory('c2-missing-effects-parent-');
  const workDir = path.join(parent, 'c2-opennext-missing-effects');
  fs.mkdirSync(workDir);
  await assert.rejects(
    main([
      '--repo', source.root,
      '--expected-sha', source.sha,
      '--expected-tree', source.tree,
      '--work-dir', workDir,
      '--opennext', EXACT_OPENNEXT_VERSION,
      '--wrangler', EXACT_WRANGLER_VERSION,
    ], { PATH: process.env.PATH }),
    (error) => error instanceof C2Refusal && error.code === 'C2_PRODUCTION_EFFECTS_REQUIRED',
  );
  assert.equal(fs.readdirSync(workDir).length, 0);
});

test('GREEN: receipt is deterministic and contains no production certification', () => {
  const plan = {
    source: { sha: 'a'.repeat(40), tree: 'b'.repeat(40), nextVersion: '16.3.0-canary.6' },
    pins: { opennext: EXACT_OPENNEXT_VERSION, wrangler: EXACT_WRANGLER_VERSION },
    compatibilityDate: COMPATIBILITY_DATE, previewUrl: 'http://127.0.0.1:8787/',
  };
  const results = { attempted: false, reason: 'LOCAL_EXECUTION_DISABLED_BY_DEFAULT' };
  const first = createC2Receipt(plan, results);
  const second = createC2Receipt(plan, results);
  assert.deepEqual(first, second);
  assert.equal(first.effects.productionEffects, 0);
  assert.equal(first.effects.cloudflareEffects, 0);
  assert.equal(first.classification.productionReady, false);
});
