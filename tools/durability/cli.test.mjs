import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  matchOwned,
  ownershipPatterns,
  STAGE_A_AUTHORIZED_PATHS,
  validateOwnershipManifest,
} from './cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNERSHIP_FILE = path.join(
  ROOT,
  'tools',
  'test-runner',
  'CODEX_CHANGED_FILE_OWNERSHIP.json',
);

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

function ownership() {
  return JSON.parse(fs.readFileSync(OWNERSHIP_FILE, 'utf8'));
}

test('the six owner-approved Stage A paths have exact changed-file ownership', () => {
  const manifest = ownership();
  const assignment = validateOwnershipManifest(manifest);
  const patterns = ownershipPatterns(manifest);
  assert.equal(assignment.entries.length, 6);
  assert.deepEqual(
    assignment.entries.map((entry) => entry.path).sort(),
    [...STAGE_A_AUTHORIZED_PATHS].sort(),
  );
  for (const authorizedPath of STAGE_A_AUTHORIZED_PATHS) {
    assert.ok(patterns.some((pattern) => matchOwned(authorizedPath, pattern)));
  }
});

test('the Stage A assignment records canonical provenance for structured-data paths', () => {
  const assignment = validateOwnershipManifest(ownership());
  const structuredDataEntries = assignment.entries.filter(
    (entry) => entry.canonical_owner === 'web-truth-structured-data',
  );
  assert.equal(structuredDataEntries.length, 3);
  for (const entry of structuredDataEntries) {
    assert.equal(
      entry.commit_provenance.commit,
      'bf9127467e075d9e3348122cd8b5d849ff7674af',
    );
    assert.equal(entry.commit_provenance.relationship, 'canonical-main');
  }
});

test('an unlisted Stage A neighboring path remains unowned', () => {
  const patterns = ownershipPatterns(ownership());
  assert.equal(
    patterns.some((pattern) =>
      matchOwned('apps/web/src/lib/interaction-proof-neighbor.mjs', pattern),
    ),
    false,
  );
});

test('a directory wildcard cannot replace an exact Stage A path', () => {
  const manifest = ownership();
  manifest.owned_modify_paths.push('apps/web/src/lib/**');
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /owner-approved scope digest/,
  );
});

test('Stage A ownership-assignment tampering fails the approval digest', () => {
  const manifest = ownership();
  manifest.explicit_user_assignment.stage_a_foundation_2026_07_28.scope =
    'Neighboring files are also authorized.';
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /failed its owner-approval digest/,
  );
});

test('duplicate changed-file ownership is rejected', () => {
  const manifest = ownership();
  manifest.owned_create_paths.push(STAGE_A_AUTHORIZED_PATHS[0]);
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /duplicate changed-file ownership/,
  );
});

test('malformed Stage A ownership entries are rejected', () => {
  const manifest = ownership();
  delete manifest.explicit_user_assignment.stage_a_foundation_2026_07_28.entries[0]
    .material_kind;
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /malformed Stage A ownership entry/,
  );
});

test('a Stage A path cannot change canonical owner without approval-digest failure', () => {
  const manifest = ownership();
  manifest.explicit_user_assignment.stage_a_foundation_2026_07_28.entries[0]
    .canonical_owner = 'verification-evidence';
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /failed its owner-approval digest/,
  );
});

test('Stage A path authorization cannot acquire runtime permissions', () => {
  const manifest = ownership();
  manifest.explicit_user_assignment.stage_a_foundation_2026_07_28.entries[0]
    .runtime_permissions = ['provider-connect'];
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /malformed Stage A ownership entry/,
  );
  const assignment = validateOwnershipManifest(ownership());
  assert.match(assignment.authorization_effect, /no runtime, provider, credential/);
  assert.ok(
    assignment.entries.every(
      (entry) => entry.authorization_effect === 'durability-path-ownership-only',
    ),
  );
});

test('removing one required exact entry recreates the durability ownership failure', () => {
  const manifest = ownership();
  manifest.owned_modify_paths = manifest.owned_modify_paths.filter(
    (entry) => entry !== STAGE_A_AUTHORIZED_PATHS[0],
  );
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /must have exactly one exact ownership entry/,
  );
});

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
