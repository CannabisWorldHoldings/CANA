import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

import {
  assertProductionBuildDatabaseReady,
  createBuildDatabaseWorkspace,
  prepareProductionBuildDatabase,
} from '../src/lib/build-database.mjs';

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
  assert.deepEqual(fs.readFileSync(databasePath), before);
});

test('artifact build children cannot inherit Node preload or module-path injection', () => {
  const source = fs.readFileSync(buildArtifactPath, 'utf8');
  assert.match(source, /delete environment\.NODE_OPTIONS;/u);
  assert.match(source, /delete environment\.NODE_PATH;/u);
  assert.doesNotMatch(source, /env: createReleaseChildEnvironment\(/u);
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
    fs.renameSync(workspace.databasePath, originalPath);
    fs.symlinkSync(originalPath, workspace.databasePath);
    await assert.rejects(
      assertProductionBuildDatabaseReady({ workspace }),
      (error) => ['BUILD_DATABASE_ROOT_UNSAFE', 'BUILD_DATABASE_SYMLINK_REJECTED'].includes(error?.code),
    );
    fs.rmSync(workspace.databasePath);
    fs.renameSync(originalPath, workspace.databasePath);
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
      assertProductionBuildDatabaseReady({ workspace }),
      assertCode('BUILD_DATABASE_ROOT_UNSAFE'),
    );
    fs.rmSync(workspace.rootPath);
    fs.renameSync(originalRoot, workspace.rootPath);
  });
});

test('database gate detects replacement of the validated target before open', async () => {
  await withPreparedWorkspace(async ({ workspace }) => {
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace,
        beforeDatabaseOpen() {
          fs.renameSync(workspace.databasePath, `${workspace.databasePath}.replaced`);
          fs.writeFileSync(workspace.databasePath, '', { flag: 'wx', mode: 0o600 });
        },
      }),
      assertCode('BUILD_DATABASE_IDENTITY_CHANGED'),
    );
    fs.rmSync(workspace.databasePath);
    fs.renameSync(`${workspace.databasePath}.replaced`, workspace.databasePath);
  });
});

test('database gate detects swap and restoration while Prisma opens the target', async () => {
  await withPreparedWorkspace(async ({ workspace }) => {
    const attackerPath = path.join(tempRoot, 'swap-restore-attacker.db');
    const checkpoint = new PrismaClient({ datasources: { db: { url: workspace.databaseUrl } } });
    try {
      await checkpoint.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      await checkpoint.$disconnect();
    }
    fs.copyFileSync(workspace.databasePath, attackerPath, fs.constants.COPYFILE_EXCL);
    const ownedPath = `${workspace.databasePath}.owned`;
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace,
        async connectDatabase(prisma) {
          fs.renameSync(workspace.databasePath, ownedPath);
          fs.renameSync(attackerPath, workspace.databasePath);
          await prisma.$connect();
          fs.renameSync(workspace.databasePath, attackerPath);
          fs.renameSync(ownedPath, workspace.databasePath);
        },
      }),
      assertCode('BUILD_DATABASE_OPEN_IDENTITY_MISMATCH'),
    );
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
  fs.writeFileSync(unownedPath, 'must survive refusal', { flag: 'wx', mode: 0o600 });
  await assert.rejects(
    async () => workspace.cleanup(),
    assertCode('BUILD_DATABASE_CLEANUP_REFUSED'),
  );
  assert.equal(fs.readFileSync(unownedPath, 'utf8'), 'must survive refusal');
  fs.unlinkSync(unownedPath);
  workspace.cleanup();
});

test('cleanup invalidates only the retained inode after quarantine validation', async () => {
  const { workspace } = await prepareProductionBuildDatabase();
  let ownedAside;
  let replacementPath;
  const invalidatedPath = workspace.cleanup({
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
  fs.chmodSync(ownedAside, 0o700);
  assert.equal(fs.statSync(path.join(ownedAside, 'build.db')).size, 0);
  assert.equal(invalidatedPath, path.dirname(replacementPath));
});

test('gate accepts only its initialized process-local database capability', async () => {
  await withPreparedWorkspace(async ({ workspace, result }) => {
    const before = fs.lstatSync(workspace.databasePath);
    const repeated = await assertProductionBuildDatabaseReady({ workspace });
    const after = fs.lstatSync(workspace.databasePath);
    assert.equal(result.provider, 'sqlite');
    assert.equal(repeated.provider, 'sqlite');
    assert.equal(repeated.checks.every((check) => check.pass), true);
    assert.equal(`${after.dev}:${after.ino}`, `${before.dev}:${before.ino}`);
  });
});

test('build-owned database cleanup detaches and invalidates the exclusive target', async () => {
  const { workspace } = await prepareProductionBuildDatabase();
  assert.equal(fs.existsSync(workspace.databasePath), true);
  const invalidatedPath = workspace.cleanup();
  assert.equal(fs.existsSync(workspace.rootPath), false);
  fs.chmodSync(invalidatedPath, 0o700);
  assert.equal(fs.statSync(path.join(invalidatedPath, 'build.db')).size, 0);
  workspace.cleanup();
});
