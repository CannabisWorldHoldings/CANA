import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

function productionBuild(env) {
  return spawnSync(process.execPath, [npmCli, 'run', 'build'], {
    cwd: webRoot,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

function assertRejected(result) {
  assert.equal(result.signal, null, `build timed out or was killed: ${result.signal}`);
  assert.notEqual(
    result.status,
    0,
    `build accepted broken database configuration with exit 0:\n${result.stdout}\n${result.stderr}`,
  );
}

test('production build rejects missing DATABASE_URL instead of accepting a false-green receipt', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  assertRejected(productionBuild(env));
});

test('production build rejects a database that cannot initialize', () => {
  const databasePath = path.join(os.tmpdir(), `cana-build-missing-${randomUUID()}`, 'build.db');
  assertRejected(productionBuild({ ...process.env, DATABASE_URL: `file:${databasePath}` }));
});
