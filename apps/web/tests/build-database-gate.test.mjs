import { spawnSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertProductionBuildDatabaseReady,
  createBuildDatabaseWorkspace,
} from '../src/lib/build-database.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const prismaCli = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');
const npmCli = path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
let tempRoot;

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-build-database-gate-'));
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function assertCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

function workspaceOptions(workspace, overrides = {}) {
  return {
    databaseUrl: workspace.databaseUrl,
    disposable: '1',
    buildDatabaseRoot: workspace.rootPath,
    ownershipProof: workspace.ownershipProof,
    ...overrides,
  };
}

function migrateWorkspace(workspace) {
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: workspace.databaseUrl, DEBUG: 'prisma:*' },
    stdio: 'pipe',
  });
}

async function withWorkspace(run) {
  const workspace = createBuildDatabaseWorkspace();
  try {
    return await run(workspace);
  } finally {
    workspace.cleanup();
  }
}

test('production build rejects missing DATABASE_URL instead of accepting a false-green receipt', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.CANA_BUILD_DATABASE_IS_DISPOSABLE;
  const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
    cwd: webRoot,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });

  assert.equal(result.signal, null, `build timed out or was killed: ${result.signal}`);
  assert.notEqual(result.status, 0, 'build accepted missing DATABASE_URL with exit 0');
});

test('database gate requires an explicit disposable-build boundary', async () => {
  await assert.rejects(
    assertProductionBuildDatabaseReady({ databaseUrl: `file:${path.join(tempRoot, 'unmarked.db')}` }),
    assertCode('DISPOSABLE_DATABASE_REQUIRED'),
  );
});

test('database gate rejects a disposable flag without build ownership proof', async () => {
  const databasePath = path.join(tempRoot, 'unowned.db');
  fs.writeFileSync(databasePath, '', { flag: 'wx' });
  await assert.rejects(
    assertProductionBuildDatabaseReady({
      databaseUrl: pathToFileURL(databasePath).href,
      disposable: '1',
    }),
    assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
  );
});

test('database gate rejects existing and production-like SQLite databases', async () => {
  for (const name of ['existing.db', 'production.db']) {
    const databasePath = path.join(tempRoot, name);
    fs.writeFileSync(databasePath, '', { flag: 'wx' });
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        databaseUrl: pathToFileURL(databasePath).href,
        disposable: '1',
      }),
      assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
    );
  }
});

test('database gate rejects malformed, remote, traversal, and network file URLs', async () => {
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
      assertProductionBuildDatabaseReady({ databaseUrl, disposable: '1' }),
      assertCode('BUILD_DATABASE_URL_UNSAFE'),
      databaseUrl,
    );
  }
});

test('database gate rejects an absolute database path outside the owned root', async () => {
  await withWorkspace(async (workspace) => {
    const outsidePath = path.join(tempRoot, 'outside.db');
    fs.writeFileSync(outsidePath, '', { flag: 'wx' });
    await assert.rejects(
      assertProductionBuildDatabaseReady(workspaceOptions(workspace, {
        databaseUrl: pathToFileURL(outsidePath).href,
      })),
      assertCode('BUILD_DATABASE_PATH_OUTSIDE_ROOT'),
    );
  });
});

test('database gate rejects a path that only shares the owned root prefix', async () => {
  await withWorkspace(async (workspace) => {
    const siblingRoot = `${workspace.rootPath}-sibling`;
    const siblingPath = path.join(siblingRoot, 'build.db');
    fs.mkdirSync(siblingRoot);
    fs.writeFileSync(siblingPath, '', { flag: 'wx' });
    try {
      await assert.rejects(
        assertProductionBuildDatabaseReady(workspaceOptions(workspace, {
          databaseUrl: pathToFileURL(siblingPath).href,
        })),
        assertCode('BUILD_DATABASE_PATH_OUTSIDE_ROOT'),
      );
    } finally {
      fs.rmSync(siblingRoot, { recursive: true, force: true });
    }
  });
});

test('database gate rejects a symlink database target', async () => {
  await withWorkspace(async (workspace) => {
    const originalPath = `${workspace.databasePath}.original`;
    fs.renameSync(workspace.databasePath, originalPath);
    fs.symlinkSync(originalPath, workspace.databasePath);
    await assert.rejects(
      assertProductionBuildDatabaseReady(workspaceOptions(workspace)),
      assertCode('BUILD_DATABASE_SYMLINK_REJECTED'),
    );
  });
});

test('database gate rejects a symlinked parent directory', async () => {
  await withWorkspace(async (workspace) => {
    const linkedParent = path.join(workspace.rootPath, 'linked-parent');
    fs.symlinkSync(workspace.rootPath, linkedParent, 'dir');
    await assert.rejects(
      assertProductionBuildDatabaseReady(workspaceOptions(workspace, {
        databaseUrl: pathToFileURL(path.join(linkedParent, 'build.db')).href,
      })),
      assertCode('BUILD_DATABASE_SYMLINK_REJECTED'),
    );
  });
});

test('database gate rejects a temporary root that is itself symlinked', async () => {
  await withWorkspace(async (workspace) => {
    const rootLink = path.join(tempRoot, 'root-link');
    fs.symlinkSync(workspace.rootPath, rootLink, 'dir');
    try {
      await assert.rejects(
        assertProductionBuildDatabaseReady(workspaceOptions(workspace, {
          buildDatabaseRoot: rootLink,
          databaseUrl: pathToFileURL(path.join(rootLink, 'build.db')).href,
        })),
        assertCode('BUILD_DATABASE_ROOT_UNSAFE'),
      );
    } finally {
      fs.rmSync(rootLink, { force: true });
    }
  });
});

test('database gate detects replacement of the validated target before use', async () => {
  await withWorkspace(async (workspace) => {
    migrateWorkspace(workspace);
    await assert.rejects(
      assertProductionBuildDatabaseReady(workspaceOptions(workspace, {
        beforeDatabaseOpen() {
          fs.renameSync(workspace.databasePath, `${workspace.databasePath}.replaced`);
          fs.writeFileSync(workspace.databasePath, '', { flag: 'wx', mode: 0o600 });
        },
      })),
      assertCode('BUILD_DATABASE_IDENTITY_CHANGED'),
    );
  });
});

test('database gate rejects a connectable but unmigrated build-owned database', async () => {
  await withWorkspace(async (workspace) => {
    await assert.rejects(
      assertProductionBuildDatabaseReady(workspaceOptions(workspace)),
      assertCode('DATABASE_NOT_READY'),
    );
  });
});

test('database gate accepts only a migrated database exclusively created by this build', async () => {
  await withWorkspace(async (workspace) => {
    const before = fs.lstatSync(workspace.databasePath);
    migrateWorkspace(workspace);
    const result = await assertProductionBuildDatabaseReady(workspaceOptions(workspace));
    const after = fs.lstatSync(workspace.databasePath);

    assert.equal(result.provider, 'sqlite');
    assert.equal(result.checks.every((check) => check.pass), true);
    assert.equal(`${after.dev}:${after.ino}`, `${before.dev}:${before.ino}`);
    assert.equal(fs.existsSync(workspace.rootPath), true);
  });
});

test('build-owned database cleanup removes the exclusive root and target', () => {
  const workspace = createBuildDatabaseWorkspace();
  assert.equal(fs.existsSync(workspace.databasePath), true);
  assert.equal(fs.lstatSync(workspace.databasePath).isFile(), true);
  workspace.cleanup();
  assert.equal(fs.existsSync(workspace.rootPath), false);
});

test('legacy existing-file acceptance is closed even when the disposable flag is set', async () => {
  const databasePath = path.join(tempRoot, 'legacy-ready.db');
  fs.writeFileSync(databasePath, '', { flag: 'wx' });
  const databaseUrl = pathToFileURL(databasePath).href;
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, DEBUG: 'prisma:*' },
    stdio: 'pipe',
  });
  await assert.rejects(
    assertProductionBuildDatabaseReady({ databaseUrl, disposable: '1' }),
    assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
  );
});
