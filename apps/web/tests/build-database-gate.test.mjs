import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertProductionBuildDatabaseReady,
  createBuildDatabaseWorkspace,
  prepareProductionBuildDatabase,
} from '../src/lib/build-database.mjs';
import { initializeDatabaseConfig } from '../src/lib/db-config.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const buildArtifactPath = path.join(repoRoot, 'deploy/namecheap/build-artifact.mjs');
const prismaCli = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');
const npmCli = path.resolve(
  path.dirname(process.execPath),
  '..',
  'lib',
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);
let tempRoot;
let initialInvalidatedRoots;

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-build-database-gate-'));
  initialInvalidatedRoots = new Set(
    fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('cana-invalidated-database-')),
  );
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (
      entry.startsWith('cana-invalidated-database-')
      && !initialInvalidatedRoots.has(entry)
    ) {
      const invalidatedRoot = path.join(os.tmpdir(), entry);
      fs.chmodSync(invalidatedRoot, 0o700);
      for (const child of fs.readdirSync(invalidatedRoot)) {
        const childPath = path.join(invalidatedRoot, child);
        if (fs.lstatSync(childPath).isDirectory()) fs.chmodSync(childPath, 0o700);
      }
      fs.rmSync(invalidatedRoot, { recursive: true, force: true });
    }
  }
});

function assertCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

function migrate(databaseUrl) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    {
      cwd: webRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function withPreparedWorkspace(run) {
  const prepared = await prepareProductionBuildDatabase();
  try {
    return await run(prepared);
  } finally {
    prepared.workspace.cleanup();
  }
}

function forgedWorkspace(databasePath, rootPath = path.dirname(databasePath)) {
  return Object.freeze({
    rootPath,
    databasePath,
    databaseUrl: pathToFileURL(databasePath).href,
    cleanup() {},
  });
}

test('production build ignores a disposable flag and arbitrary existing database', () => {
  const databasePath = path.join(tempRoot, 'production-like.db');
  fs.writeFileSync(databasePath, '', { flag: 'wx', mode: 0o600 });
  migrate(pathToFileURL(databasePath).href);
  const before = fs.readFileSync(databasePath);
  const result = spawnSync(process.execPath, [npmCli, 'run', 'build', '--', '--webpack'], {
    cwd: webRoot,
    env: {
      ...process.env,
      DATABASE_URL: pathToFileURL(databasePath).href,
      CANA_BUILD_DATABASE_IS_DISPOSABLE: '1',
      CANA_BUILD_DATABASE_ROOT: path.dirname(databasePath),
      CANA_BUILD_DATABASE_OWNERSHIP_PROOF: 'f'.repeat(64),
    },
    encoding: 'utf8',
    timeout: 180_000,
  });

  assert.equal(result.signal, null, `build timed out or was killed: ${result.signal}`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /attempt to write a readonly database|database is locked/u,
  );
  assert.deepEqual(fs.readFileSync(databasePath), before);
});

test('immutable read-only build consumers never issue database-setting PRAGMAs', async () => {
  const queries = [];
  const prisma = {
    async $queryRawUnsafe(statement) {
      queries.push(statement);
      const name = statement.trim().split(/\s+/u)[1];
      const values = {
        journal_mode: 'delete',
        busy_timeout: 5000,
        synchronous: 1,
        foreign_keys: 1,
      };
      return [{ [name]: values[name] }];
    },
  };
  const result = await initializeDatabaseConfig(prisma, {
    databaseUrl: 'file:///tmp/cana-build-database-proof/build.db?connection_limit=1&mode=ro&immutable=1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.mismatches, []);
  assert.equal(queries.length, 4);
  assert.ok(queries.every((statement) => !statement.includes('=')));
});

test('artifact build children cannot inherit Node preload or module-path injection', () => {
  const preloadPath = path.join(tempRoot, 'hostile-preload.cjs');
  const preloadSentinel = path.join(tempRoot, 'hostile-preload-executed');
  fs.writeFileSync(
    preloadPath,
    `require('node:fs').writeFileSync(${JSON.stringify(preloadSentinel)}, 'executed')`,
    { flag: 'wx', mode: 0o600 },
  );
  const result = spawnSync(
    buildArtifactPath,
    ['--verify-child-environment'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CANA_VERIFIED_NODE: process.execPath,
        NODE_OPTIONS: `--require=${preloadPath}`,
        NODE_PATH: tempRoot,
        REQUIRED_NODE: process.version,
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    marker: 'verified',
    nodeOptions: null,
    nodePath: null,
  });
  assert.equal(fs.existsSync(preloadSentinel), false);
});

test('artifact launcher cannot execute a PATH-shadowed Node binary', () => {
  const shadowDirectory = path.join(tempRoot, 'shadow-path');
  const shadowNode = path.join(shadowDirectory, 'node');
  const shadowSentinel = path.join(tempRoot, 'shadow-node-executed');
  fs.mkdirSync(shadowDirectory);
  fs.writeFileSync(
    shadowNode,
    `#!/bin/sh\nprintf executed > ${JSON.stringify(shadowSentinel)}\nexit 99\n`,
    { flag: 'wx', mode: 0o700 },
  );
  const result = spawnSync(
    buildArtifactPath,
    ['--verify-child-environment'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CANA_VERIFIED_NODE: process.execPath,
        PATH: `${shadowDirectory}${path.delimiter}${process.env.PATH}`,
        REQUIRED_NODE: process.version,
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(shadowSentinel), false);
  assert.equal(JSON.parse(result.stdout).marker, 'verified');
});

test('artifact launcher fails closed without a vetted absolute Node executable', () => {
  const shadowDirectory = path.join(tempRoot, 'missing-vetted-node-shadow');
  const shadowNode = path.join(shadowDirectory, 'node');
  const shadowSentinel = path.join(tempRoot, 'missing-vetted-node-executed');
  fs.mkdirSync(shadowDirectory);
  fs.writeFileSync(
    shadowNode,
    `#!/bin/sh\nprintf executed > ${JSON.stringify(shadowSentinel)}\nexit 99\n`,
    { flag: 'wx', mode: 0o700 },
  );
  const environment = {
    ...process.env,
    PATH: `${shadowDirectory}${path.delimiter}${process.env.PATH}`,
  };
  delete environment.CANA_VERIFIED_NODE;
  const result = spawnSync(buildArtifactPath, ['--verify-child-environment'], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.equal(result.status, 126);
  assert.match(result.stderr, /BUILD_NODE_IDENTITY_REFUSED/u);
  assert.equal(fs.existsSync(shadowSentinel), false);
});

test('artifact build rejects injection when its environment-scrubbing launcher is bypassed', () => {
  const environment = {
    ...process.env,
    CANA_ARTIFACT_SECURE_LAUNCH: '1',
    NODE_PATH: tempRoot,
    REQUIRED_NODE: process.version,
  };
  delete environment.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [buildArtifactPath], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BUILD_ENVIRONMENT_INJECTION_REFUSED/u);
});

test('database gate rejects disposable flags and forged build ownership', async () => {
  const databasePath = path.join(tempRoot, 'unowned.db');
  fs.writeFileSync(databasePath, '', { flag: 'wx', mode: 0o600 });
  await assert.rejects(
    assertProductionBuildDatabaseReady({
      databaseUrl: pathToFileURL(databasePath).href,
      disposable: '1',
      buildDatabaseRoot: tempRoot,
      ownershipProof: 'a'.repeat(64),
    }),
    assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
  );
  await assert.rejects(
    assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(databasePath) }),
    assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
  );
});

test('database gate rejects existing and production-like SQLite databases', async () => {
  for (const name of ['existing.db', 'production.db']) {
    const databasePath = path.join(tempRoot, name);
    fs.writeFileSync(databasePath, '', { flag: 'wx', mode: 0o600 });
    migrate(pathToFileURL(databasePath).href);
    const before = fs.readFileSync(databasePath);
    await assert.rejects(
      assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(databasePath) }),
      assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
    );
    assert.deepEqual(fs.readFileSync(databasePath), before);
  }
});

test('malformed, remote, traversal, and network URLs cannot acquire a build capability', async () => {
  const rejected = [
    'file:///tmp/cana%ZZ/build.db',
    'file://remote-host/tmp/build.db',
    'file:relative.db',
    'file:///tmp/cana-build/../shared.db',
    'file:///tmp/cana-build/%2e%2e/shared.db',
    'file:////remote-host/share/build.db',
    'file:///tmp/build.db?mode=shared',
    'file:///tmp/build.db#fragment',
    'file:///tmp/build%00.db',
  ];
  for (const databaseUrl of rejected) {
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace: Object.freeze({
          rootPath: tempRoot,
          databasePath: path.join(tempRoot, 'build.db'),
          databaseUrl,
          cleanup() {},
        }),
      }),
      assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
      databaseUrl,
    );
  }
});

test('absolute outside-root and textual-prefix paths cannot acquire build authority', async () => {
  const ownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-build-database-forged-'));
  const siblingRoot = `${ownedRoot}-sibling`;
  const outsidePath = path.join(tempRoot, 'outside.db');
  const siblingPath = path.join(siblingRoot, 'build.db');
  fs.mkdirSync(siblingRoot);
  fs.writeFileSync(outsidePath, '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(siblingPath, '', { flag: 'wx', mode: 0o600 });
  try {
    for (const databasePath of [outsidePath, siblingPath]) {
      await assert.rejects(
        assertProductionBuildDatabaseReady({
          workspace: forgedWorkspace(databasePath, ownedRoot),
        }),
        assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
      );
    }
  } finally {
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    fs.rmSync(siblingRoot, { recursive: true, force: true });
  }
});

test('database gate rejects a symlink database target', async () => {
  await withPreparedWorkspace(async ({ workspace }) => {
    const originalPath = `${workspace.databasePath}.original`;
    fs.chmodSync(workspace.rootPath, 0o700);
    fs.renameSync(workspace.databasePath, originalPath);
    fs.symlinkSync(originalPath, workspace.databasePath);
    await assert.rejects(
      assertProductionBuildDatabaseReady({ workspace }),
      (error) => ['BUILD_DATABASE_ROOT_UNSAFE', 'BUILD_DATABASE_SYMLINK_REJECTED'].includes(error?.code),
    );
    fs.rmSync(workspace.databasePath);
    fs.renameSync(originalPath, workspace.databasePath);
    fs.chmodSync(workspace.rootPath, 0o500);
  });
});

test('symlinked parent directories cannot acquire a build capability', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-build-database-forged-'));
  const linkedParent = path.join(root, 'linked-parent');
  fs.symlinkSync(root, linkedParent, 'dir');
  try {
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace: forgedWorkspace(path.join(linkedParent, 'build.db'), root),
      }),
      assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('database gate rejects a temporary root replaced by a symlink', async () => {
  await withPreparedWorkspace(async ({ workspace }) => {
    const originalRoot = `${workspace.rootPath}.original`;
    fs.renameSync(workspace.rootPath, originalRoot);
    fs.symlinkSync(originalRoot, workspace.rootPath, 'dir');
    await assert.rejects(
      async () => assertProductionBuildDatabaseReady({ workspace }),
      assertCode('BUILD_DATABASE_ROOT_UNSAFE'),
    );
    fs.unlinkSync(workspace.rootPath);
    fs.renameSync(originalRoot, workspace.rootPath);
  });
});

test('database gate detects replacement of the validated target before open', async () => {
  await withPreparedWorkspace(async ({ workspace }) => {
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace,
        beforeDatabaseOpen() {
          fs.chmodSync(workspace.rootPath, 0o700);
          fs.renameSync(workspace.databasePath, `${workspace.databasePath}.replaced`);
          fs.writeFileSync(workspace.databasePath, '', { flag: 'wx', mode: 0o600 });
        },
      }),
      assertCode('BUILD_DATABASE_IDENTITY_CHANGED'),
    );
    fs.rmSync(workspace.databasePath);
    fs.renameSync(`${workspace.databasePath}.replaced`, workspace.databasePath);
    fs.chmodSync(workspace.rootPath, 0o500);
  });
});

test('locked build root prevents target replacement while Prisma opens the database', async () => {
  await withPreparedWorkspace(async ({ workspace }) => {
    const attackerPath = path.join(tempRoot, 'swap-restore-attacker.db');
    fs.copyFileSync(workspace.databasePath, attackerPath, fs.constants.COPYFILE_EXCL);
    const ownedPath = `${workspace.databasePath}.owned`;
    let swapped = false;
    const readiness = assertProductionBuildDatabaseReady({
      workspace,
      beforeDatabaseOpen() {
        try {
          fs.renameSync(workspace.databasePath, ownedPath);
          fs.copyFileSync(attackerPath, workspace.databasePath, fs.constants.COPYFILE_EXCL);
          swapped = true;
        } catch (error) {
          assert.ok(error?.code === 'EACCES' || error?.code === 'EPERM');
        }
      },
    });
    if (swapped) {
      await assert.rejects(readiness, assertCode('BUILD_DATABASE_IDENTITY_CHANGED'));
      fs.rmSync(workspace.databasePath);
      fs.renameSync(ownedPath, workspace.databasePath);
    } else {
      const result = await readiness;
      assert.equal(result.checks.every((check) => check.pass), true);
    }
  });
});

test('initial migration opens only the target protected by the locked build root', async () => {
  const attackerPath = path.join(tempRoot, 'initial-open-attacker.db');
  fs.writeFileSync(attackerPath, '', { flag: 'wx', mode: 0o600 });
  migrate(pathToFileURL(attackerPath).href);
  const attackerBefore = fs.readFileSync(attackerPath);
  let capturedWorkspace;
  let ownedPath;
  let swapped = false;
  const preparation = prepareProductionBuildDatabase({
    beforeInitialDatabaseOpen(workspace) {
      capturedWorkspace = workspace;
      ownedPath = `${workspace.databasePath}.owned`;
      try {
        fs.renameSync(workspace.databasePath, ownedPath);
        fs.copyFileSync(attackerPath, workspace.databasePath, fs.constants.COPYFILE_EXCL);
        swapped = true;
      } catch (error) {
        assert.ok(error?.code === 'EACCES' || error?.code === 'EPERM');
      }
    },
  });
  if (swapped) {
    await assert.rejects(
      preparation,
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0]?.code, 'BUILD_DATABASE_IDENTITY_CHANGED');
        assert.equal(error.errors[1]?.code, 'BUILD_DATABASE_CLEANUP_REFUSED');
        return true;
      },
    );
    fs.rmSync(capturedWorkspace.databasePath);
    fs.renameSync(ownedPath, capturedWorkspace.databasePath);
    capturedWorkspace.cleanup();
  } else {
    const prepared = await preparation;
    assert.deepEqual(fs.readFileSync(attackerPath), attackerBefore);
    prepared.workspace.cleanup();
  }
  assert.deepEqual(fs.readFileSync(attackerPath), attackerBefore);
});

test('descriptor-bound migration cannot mutate a pathname replacement', async () => {
  const attackerPath = path.join(tempRoot, 'descriptor-bound-attacker.db');
  fs.writeFileSync(attackerPath, '', { flag: 'wx', mode: 0o600 });
  migrate(pathToFileURL(attackerPath).href);
  const attackerBefore = fs.readFileSync(attackerPath);
  let workspace;
  let ownedPath;
  const preparation = prepareProductionBuildDatabase({
    beforeInitialDatabaseConnect(candidate) {
      workspace = candidate;
      ownedPath = `${candidate.databasePath}.owned`;
      fs.chmodSync(candidate.rootPath, 0o700);
      fs.renameSync(candidate.databasePath, ownedPath);
      fs.copyFileSync(attackerPath, candidate.databasePath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(candidate.rootPath, 0o500);
    },
  });
  await assert.rejects(
    preparation,
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0]?.code, 'BUILD_DATABASE_IDENTITY_CHANGED');
      assert.equal(error.errors[1]?.code, 'BUILD_DATABASE_CLEANUP_REFUSED');
      return true;
    },
  );
  assert.deepEqual(fs.readFileSync(workspace.databasePath), attackerBefore);
  assert.deepEqual(fs.readdirSync(workspace.rootPath).sort(), ['build.db', 'build.db.owned']);
  fs.chmodSync(workspace.rootPath, 0o700);
  fs.rmSync(workspace.databasePath);
  fs.renameSync(ownedPath, workspace.databasePath);
  fs.chmodSync(workspace.rootPath, 0o500);
  workspace.cleanup();
});

test('verified immutable open rejects a replacement before any database mutation', async () => {
  await withPreparedWorkspace(async ({ workspace }) => {
    const attackerPath = path.join(tempRoot, 'immutable-open-attacker.db');
    fs.writeFileSync(attackerPath, '', { flag: 'wx', mode: 0o600 });
    migrate(pathToFileURL(attackerPath).href);
    const attackerBefore = fs.readFileSync(attackerPath);
    const ownedPath = `${workspace.databasePath}.owned`;
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace,
        beforeVerifiedDatabaseConnect() {
          fs.chmodSync(workspace.rootPath, 0o700);
          fs.renameSync(workspace.databasePath, ownedPath);
          fs.copyFileSync(attackerPath, workspace.databasePath, fs.constants.COPYFILE_EXCL);
          fs.chmodSync(workspace.rootPath, 0o500);
        },
      }),
      assertCode('BUILD_DATABASE_OPEN_IDENTITY_MISMATCH'),
    );
    assert.deepEqual(fs.readFileSync(workspace.databasePath), attackerBefore);
    assert.deepEqual(fs.readdirSync(workspace.rootPath).sort(), ['build.db', 'build.db.owned']);
    fs.chmodSync(workspace.rootPath, 0o700);
    fs.rmSync(workspace.databasePath);
    fs.renameSync(ownedPath, workspace.databasePath);
    fs.chmodSync(workspace.rootPath, 0o500);
  });
});

test('atomic cleanup refuses a replacement root without deleting it', async () => {
  const owned = await prepareProductionBuildDatabase();
  const replacement = createBuildDatabaseWorkspace();
  const ownedAside = `${owned.workspace.rootPath}.owned`;
  const replacementAside = `${replacement.rootPath}.replacement`;
  fs.renameSync(owned.workspace.rootPath, ownedAside);
  fs.renameSync(replacement.rootPath, owned.workspace.rootPath);
  await assert.rejects(
    async () => owned.workspace.cleanup(),
    assertCode('BUILD_DATABASE_CLEANUP_REFUSED'),
  );
  assert.equal(fs.existsSync(owned.workspace.rootPath), true);
  assert.equal(fs.existsSync(path.join(owned.workspace.rootPath, 'build.db')), true);
  fs.renameSync(owned.workspace.rootPath, replacementAside);
  fs.renameSync(ownedAside, owned.workspace.rootPath);
  fs.renameSync(replacementAside, replacement.rootPath);
  owned.workspace.cleanup();
  replacement.cleanup();
});

test('atomic cleanup refuses unowned root content without deleting it', async () => {
  const { workspace } = await prepareProductionBuildDatabase();
  const unownedPath = path.join(workspace.rootPath, 'unowned.txt');
  fs.chmodSync(workspace.rootPath, 0o700);
  fs.writeFileSync(unownedPath, 'must survive refusal', { flag: 'wx', mode: 0o600 });
  await assert.rejects(
    async () => workspace.cleanup(),
    assertCode('BUILD_DATABASE_CLEANUP_REFUSED'),
  );
  assert.equal(fs.readFileSync(unownedPath, 'utf8'), 'must survive refusal');
  fs.chmodSync(workspace.rootPath, 0o700);
  fs.unlinkSync(unownedPath);
  fs.chmodSync(workspace.rootPath, 0o500);
  workspace.cleanup();
});

test('cleanup removes only the retained inode after quarantine validation', async () => {
  const { workspace } = await prepareProductionBuildDatabase();
  let ownedAside;
  let replacementPath;
  const cleanup = workspace.cleanup({
    afterQuarantineValidation({ quarantinePath }) {
      ownedAside = `${quarantinePath}.owned`;
      replacementPath = path.join(quarantinePath, 'replacement.txt');
      fs.renameSync(quarantinePath, ownedAside);
      fs.mkdirSync(quarantinePath, { mode: 0o700 });
      fs.writeFileSync(replacementPath, 'replacement must survive', {
        flag: 'wx',
        mode: 0o600,
      });
    },
  });
  assert.equal(fs.readFileSync(replacementPath, 'utf8'), 'replacement must survive');
  assert.equal(fs.existsSync(ownedAside), false);
  assert.equal(cleanup.removed, true);
  assert.equal(cleanup.removedContainer, false);
  assert.equal(cleanup.quarantinePath, path.dirname(replacementPath));
});

test('cleanup never unlinks a sidecar replacement after validation', async () => {
  const { workspace } = await prepareProductionBuildDatabase();
  let replacementPath;
  assert.throws(
    () => workspace.cleanup({
      afterQuarantineValidation({ quarantinePath }) {
        replacementPath = path.join(quarantinePath, 'build.db-wal');
        fs.renameSync(replacementPath, `${replacementPath}.owned`);
        fs.writeFileSync(replacementPath, 'replacement must survive', {
          flag: 'wx',
          mode: 0o600,
        });
      },
    }),
    assertCode('BUILD_DATABASE_CLEANUP_FAILED'),
  );
  fs.chmodSync(path.dirname(replacementPath), 0o700);
  assert.equal(fs.readFileSync(replacementPath, 'utf8'), 'replacement must survive');
});

test('closed retained database descriptor produces a named cleanup refusal', async () => {
  const { workspace } = await prepareProductionBuildDatabase();
  const database = fs.lstatSync(workspace.databasePath);
  assert.throws(
    () => workspace.cleanup({
      afterQuarantineValidation() {
        for (const entry of fs.readdirSync('/dev/fd')) {
          const descriptor = Number(entry);
          if (!Number.isSafeInteger(descriptor)) continue;
          try {
            const stats = fs.fstatSync(descriptor);
            if (stats.dev === database.dev && stats.ino === database.ino) {
              fs.closeSync(descriptor);
            }
          } catch {
            // Descriptors can close while the deterministic identity scan runs.
          }
        }
      },
    }),
    assertCode('BUILD_DATABASE_CLEANUP_FAILED'),
  );
});

test('gate accepts only its initialized process-local database capability', async () => {
  await withPreparedWorkspace(async ({ workspace, result }) => {
    const before = fs.lstatSync(workspace.databasePath);
    assert.equal(fs.statSync(workspace.rootPath).mode & 0o777, 0o500);
    assert.deepEqual(
      fs.readdirSync(workspace.rootPath).sort(),
      ['build.db'],
    );
    for (const entry of fs.readdirSync(workspace.rootPath)) {
      const stats = fs.lstatSync(path.join(workspace.rootPath, entry));
      assert.equal(stats.isFile(), true);
      assert.equal(stats.isSymbolicLink(), false);
      assert.equal(stats.nlink, 1);
      assert.equal(stats.mode & 0o077, 0);
    }
    const repeated = await assertProductionBuildDatabaseReady({ workspace });
    const after = fs.lstatSync(workspace.databasePath);
    assert.equal(result.provider, 'sqlite');
    assert.equal(repeated.provider, 'sqlite');
    assert.equal(repeated.checks.every((check) => check.pass), true);
    assert.equal(`${after.dev}:${after.ino}`, `${before.dev}:${before.ino}`);
  });
});

test('build-owned database cleanup removes the exclusive target and quarantine', async () => {
  const invalidatedBefore = new Set(
    fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('cana-invalidated-database-')),
  );
  const { workspace } = await prepareProductionBuildDatabase();
  assert.equal(fs.existsSync(workspace.databasePath), true);
  const cleanup = workspace.cleanup();
  assert.equal(fs.existsSync(workspace.rootPath), false);
  assert.equal(cleanup.removed, true);
  assert.equal(cleanup.removedContainer, true);
  assert.equal(fs.existsSync(path.dirname(cleanup.quarantinePath)), false);
  assert.deepEqual(
    fs.readdirSync(os.tmpdir())
      .filter((entry) => entry.startsWith('cana-invalidated-database-'))
      .filter((entry) => !invalidatedBefore.has(entry)),
    [],
  );
  workspace.cleanup();
});

test('installed build database cleanup preserves signal exit semantics', () => {
  const moduleUrl = pathToFileURL(
    path.join(webRoot, 'src/lib/build-database.mjs'),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { installProductionBuildDatabase } from ${JSON.stringify(moduleUrl)};
       await installProductionBuildDatabase();
       setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);
       setInterval(() => {}, 1_000);`,
    ],
    {
      cwd: webRoot,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );

  assert.equal(result.signal, null);
  assert.equal(result.status, 143, result.stderr || result.stdout);
});

test('cleanup refusal cannot suppress signal termination', () => {
  const moduleUrl = pathToFileURL(
    path.join(webRoot, 'src/lib/build-database.mjs'),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import fs from 'node:fs';
       import path from 'node:path';
       import { fileURLToPath } from 'node:url';
       import { installProductionBuildDatabase } from ${JSON.stringify(moduleUrl)};
       await installProductionBuildDatabase();
       const root = path.dirname(fileURLToPath(process.env.DATABASE_URL));
       fs.chmodSync(root, 0o700);
       fs.writeFileSync(path.join(root, 'unowned.txt'), 'preserve', { flag: 'wx', mode: 0o600 });
       process.stdout.write(root + '\\n');
       setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);
       setInterval(() => {}, 1_000);`,
    ],
    {
      cwd: webRoot,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  const preservedRoot = result.stdout.trim();

  assert.equal(result.signal, null);
  assert.equal(result.status, 143, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(preservedRoot, 'unowned.txt'), 'utf8'), 'preserve');
  fs.rmSync(preservedRoot, { recursive: true, force: true });
});
