import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function cana(args, env = {}) {
  return spawnSync(path.join(ROOT, 'cana'), args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      CANA_LOCAL_STATE_DIR: path.join(ROOT, '.cana-local', 'durability-test-never-created'),
      ...env,
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
  const result = cana(['durability', 'upload']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /remote configuration/i);
  assert.doesNotMatch(result.stdout, /REMOTELY_DURABLE/);
});

test('a caller-set authorization environment variable cannot authorize upload', () => {
  const result = cana(
    ['durability', 'upload', '--remote', 's3://example.invalid/candidate.tar.gz'],
    { CANA_DURABILITY_OWNER_AUTHORIZED: 'YES' },
  );
  assert.equal(result.status, 3);
  assert.match(result.stderr, /signed owner approval/i);
  assert.doesNotMatch(result.stdout, /REMOTELY_DURABLE/);
});

test('readback refuses without a recorded upload', () => {
  const result = cana(['durability', 'readback']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /recorded upload/i);
  assert.doesNotMatch(result.stdout, /REMOTELY_DURABLE/);
});

test('status refuses to trust a forged local round-trip record', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-durability-status-test-'));
  try {
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout.trim();
    fs.writeFileSync(
      path.join(stateRoot, 'upload-state.json'),
      `${JSON.stringify({
        commit,
        tree,
        artifactSha256: 'a'.repeat(64),
        readback: { verified: true, sha256: 'a'.repeat(64) },
        state: 'REMOTELY_DURABLE',
      })}\n`,
    );
    const result = cana(['durability', 'status'], { CANA_LOCAL_STATE_DIR: stateRoot });
    assert.equal(result.status, 0);
    const status = JSON.parse(result.stdout);
    assert.equal(status.state, 'LOCAL_ONLY_CANDIDATE');
    assert.equal(status.candidateRoundTrip, false);
    assert.equal(status.recordedCandidateRoundTrip, true);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
