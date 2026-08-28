import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(webRoot, '../..');
const court = path.join(webRoot, 'scripts/assert-release-build-identity.mjs');
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

function run(releaseSha) {
  const env = { ...process.env };
  if (releaseSha === undefined) delete env.CANA_RELEASE_SHA;
  else env.CANA_RELEASE_SHA = releaseSha;
  return spawnSync(process.execPath, [court], {
    cwd: webRoot,
    env,
    encoding: 'utf8',
  });
}

test('Cloudflare build identity is required and must equal the checked-out commit', () => {
  const absent = run(undefined);
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /CLOUDFLARE_BUILD_RELEASE_SHA_REQUIRED/);

  const mismatch = run('0'.repeat(40));
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /CLOUDFLARE_BUILD_RELEASE_SHA_SOURCE_MISMATCH/);

  const exact = run(head);
  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(exact.stdout.trim(), `CLOUDFLARE_BUILD_RELEASE_SHA_BOUND ${head}`);
});
