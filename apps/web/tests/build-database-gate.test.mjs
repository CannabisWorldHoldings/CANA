import { spawnSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertProductionBuildDatabaseReady } from '../src/lib/build-database.mjs';

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

test('database gate propagates a real Prisma initialization failure', async () => {
  const databaseUrl = `file:${path.join(tempRoot, 'missing-parent', 'build.db')}`;
  await assert.rejects(
    assertProductionBuildDatabaseReady({ databaseUrl, disposable: '1' }),
    assertCode('DATABASE_INITIALIZATION_FAILED'),
  );
});

test('database gate rejects a connectable but unmigrated database', async () => {
  const databasePath = path.join(tempRoot, 'unmigrated.db');
  fs.writeFileSync(databasePath, '');
  await assert.rejects(
    assertProductionBuildDatabaseReady({ databaseUrl: `file:${databasePath}`, disposable: '1' }),
    assertCode('DATABASE_NOT_READY'),
  );
});

test('database gate accepts a migrated disposable database', async () => {
  const databasePath = path.join(tempRoot, 'ready.db');
  const databaseUrl = `file:${databasePath}`;
  fs.writeFileSync(databasePath, '', { flag: 'wx' });
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, DEBUG: 'prisma:*' },
    stdio: 'pipe',
  });

  const result = await assertProductionBuildDatabaseReady({ databaseUrl, disposable: '1' });
  assert.equal(result.provider, 'sqlite');
  assert.equal(result.checks.every((check) => check.pass), true);
});
