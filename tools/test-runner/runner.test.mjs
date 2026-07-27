import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function cana(...args) {
  return spawnSync(path.join(ROOT, 'cana'), args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CANA_RECEIPT_DIR: path.join(ROOT, '.test-receipts-never-created') },
  });
}

test('the root dispatcher refuses an unknown verification profile', () => {
  const result = cana('verify', 'not-a-profile');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown verification profile/i);
});

test('the root dispatcher refuses an unknown command', () => {
  const result = cana('owner-gated-production-deploy');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: \.\/cana/i);
});

test('help names every required verification and durability surface', () => {
  const result = cana('--help');
  assert.equal(result.status, 0, result.stderr);
  for (const command of [
    'verify focused',
    'verify full',
    'verify clean-clone',
    'verify release',
    'verify maria',
    'verify cpanel',
    'durability status',
    'durability build',
    'durability verify',
    'durability restore',
    'durability upload',
    'durability readback',
  ]) {
    assert.match(result.stdout, new RegExp(command.replaceAll('-', '\\-')));
  }
});
