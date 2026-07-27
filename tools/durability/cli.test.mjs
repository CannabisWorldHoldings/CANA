import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function cana(...args) {
  return spawnSync(path.join(ROOT, 'cana'), args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      CANA_LOCAL_STATE_DIR: path.join(ROOT, '.cana-local', 'durability-test-never-created'),
    },
  });
}

test('base receipt records the superseding final Drive round trip', () => {
  const receipt = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'durability', 'base-remote-receipt.json'), 'utf8'),
  );
  assert.equal(receipt.commit, 'c953ebcd25c46ef33af0700d7913a899d839bce8');
  assert.equal(receipt.archive.size, 4_724_563);
  assert.equal(
    receipt.archive.sha256,
    '08aa201e72e1131e26aa0a599bb32867e6be9ed0f13d62659f74daa27bd43ade',
  );
  assert.equal(receipt.remote.driveFileId, '17Ds8hRqyzqtdfUHEweA8Qa2HyqOk06Dg');
  assert.equal(receipt.localOnlyDurabilityGap, 'NONE');
});

test('upload refuses without owner authorization and remote configuration', () => {
  const result = cana('durability', 'upload');
  assert.equal(result.status, 3);
  assert.match(result.stderr, /owner authorization.*remote/i);
  assert.doesNotMatch(result.stdout, /REMOTELY_DURABLE/);
});

test('readback refuses without a recorded upload', () => {
  const result = cana('durability', 'readback');
  assert.equal(result.status, 3);
  assert.match(result.stderr, /recorded upload/i);
  assert.doesNotMatch(result.stdout, /REMOTELY_DURABLE/);
});
