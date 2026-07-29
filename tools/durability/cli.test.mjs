import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  matchOwned,
  MISSION1_AUTHORIZED_PATHS,
  MISSION1_EVIDENCE_PATHS,
  mission1OwnershipAssignment,
  MISSION1_VALIDATOR_PATHS,
  ownershipPatterns,
  PR2_AUTHORIZED_PATHS,
  pr2OwnershipAssignment,
  STAGE_A_AUTHORIZED_PATHS,
  unownedPaths,
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

test('the five owner-approved PR #2 paths have exact narrow ownership metadata', () => {
  const manifest = ownership();
  const assignment = pr2OwnershipAssignment(manifest);
  const patterns = ownershipPatterns(manifest);
  assert.equal(assignment.entries.length, 5);
  assert.deepEqual(
    assignment.entries.map((entry) => entry.path).sort(),
    [...PR2_AUTHORIZED_PATHS].sort(),
  );
  for (const entry of assignment.entries) {
    assert.ok(patterns.some((pattern) => matchOwned(entry.path, pattern)));
    assert.equal(entry.authorization_effect, 'durability-path-ownership-only');
    assert.equal(entry.ownership_authorizes_execution, false);
    assert.equal(entry.ownership_authorizes_deployment, false);
    assert.equal(entry.ownership_authorizes_credentials, false);
    assert.equal(entry.ownership_authorizes_production_change, false);
  }
  const databaseConfig = assignment.entries.find(
    (entry) => entry.path === 'apps/web/src/lib/db-config.mjs',
  );
  assert.equal(
    databaseConfig.commit_provenance.commit,
    '0fb0db0ae8a9f2dd4649436345a6f187f2f18bad',
  );
  assert.equal(
    databaseConfig.commit_provenance.tree,
    'c00f3208fd157ed2c8e6dd7f1aebaffdb16cc9ac',
  );
  assert.equal(
    databaseConfig.commit_provenance.relationship,
    'mandatory-gate-security-repair-parent',
  );
  for (const entry of assignment.entries.filter((candidate) => candidate !== databaseConfig)) {
    assert.equal(entry.commit_provenance.commit, '8be302b300921734019dc5d4b861611fe9c2186d');
    assert.equal(entry.commit_provenance.tree, '45b43356f17e76f47e62764baa9e9b1ca1d56c1c');
    assert.equal(entry.commit_provenance.relationship, 'approved-pr2-lineage');
  }
});

test('the existing container verifier remains owned without a new exact assignment', () => {
  const manifest = ownership();
  const patterns = ownershipPatterns(manifest);
  const containerVerifier = 'tools/test-runner/container-verify.sh';
  assert.ok(patterns.some((pattern) => matchOwned(containerVerifier, pattern)));
  assert.equal(
    pr2OwnershipAssignment(manifest).entries.some(
      (entry) => entry.path === containerVerifier,
    ),
    false,
  );
});

test('PR #2 ownership does not admit neighboring application, test or deployment files', () => {
  const patterns = ownershipPatterns(ownership());
  for (const neighboringPath of [
    'apps/web/next.config.neighbor.ts',
    'apps/web/src/lib/build-database-neighbor.mjs',
    'apps/web/tests/build-database-neighbor.test.mjs',
    'deploy/namecheap/deploy-neighbor.mjs',
  ]) {
    assert.equal(
      patterns.some((pattern) => matchOwned(neighboringPath, pattern)),
      false,
      neighboringPath,
    );
  }
});

test('PR #2 ownership rejects directory wildcards and recursive authority', () => {
  for (const broadPattern of ['apps/web/*.ts', 'apps/web/src/lib/**']) {
    const manifest = ownership();
    manifest.owned_modify_paths.push(broadPattern);
    assert.throws(
      () => validateOwnershipManifest(manifest),
      /owner-approved scope digest/,
    );
  }
});

test('duplicate and conflicting PR #2 lane ownership are rejected', () => {
  const manifest = ownership();
  const conflicting = structuredClone(
    manifest.explicit_user_assignment.pr2_exact_ownership_2026_07_28.entries[0],
  );
  conflicting.canonical_owner = 'deterministic-build-database';
  manifest.explicit_user_assignment.pr2_exact_ownership_2026_07_28.entries.push(
    conflicting,
  );
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /duplicate PR #2 ownership entry/,
  );
});

test('malformed PR #2 ownership entries are rejected', () => {
  const manifest = ownership();
  delete manifest.explicit_user_assignment.pr2_exact_ownership_2026_07_28.entries[0]
    .material_class;
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /malformed PR #2 ownership entry/,
  );
});

test('a PR #2 path cannot silently change canonical owner', () => {
  const manifest = ownership();
  manifest.explicit_user_assignment.pr2_exact_ownership_2026_07_28.entries[0]
    .canonical_owner = 'deterministic-build-database';
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /failed its owner-approval digest/,
  );
});

test('removing any exact PR #2 entry recreates the durability ownership failure', () => {
  for (const requiredPath of PR2_AUTHORIZED_PATHS) {
    const manifest = ownership();
    manifest.owned_modify_paths = manifest.owned_modify_paths.filter(
      (entry) => entry !== requiredPath,
    );
    assert.throws(
      () => validateOwnershipManifest(manifest),
      /must have exactly one exact ownership entry/,
    );
  }
});

test('PR #2 ownership cannot acquire execution, deployment, credential or production authority', () => {
  const manifest = ownership();
  manifest.explicit_user_assignment.pr2_exact_ownership_2026_07_28.entries[0]
    .ownership_authorizes_execution = true;
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /malformed PR #2 ownership entry/,
  );
  const assignment = pr2OwnershipAssignment(ownership());
  assert.match(
    assignment.authorization_effect,
    /no runtime execution, provider, credential, deployment, production/,
  );
});

test('PR #2 assignment tampering fails the owner-approval digest', () => {
  const manifest = ownership();
  manifest.explicit_user_assignment.pr2_exact_ownership_2026_07_28.scope =
    'Neighboring files are authorized.';
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /failed its owner-approval digest/,
  );
});

test('the exact security-repaired PR #2 change set is durability-owned after reconciliation', () => {
  assert.deepEqual(
    unownedPaths(
      [
        ...PR2_AUTHORIZED_PATHS,
        'tools/test-runner/container-verify.sh',
      ],
      ownership(),
    ),
    [],
  );
});

test('the exact Mission 1 evidence and validator paths have narrow ownership', () => {
  const manifest = ownership();
  const assignment = mission1OwnershipAssignment(manifest);
  const patterns = ownershipPatterns(manifest);
  assert.deepEqual(
    [...assignment.evidence_paths].sort(),
    [...MISSION1_EVIDENCE_PATHS].sort(),
  );
  assert.deepEqual(
    [...assignment.validator_paths].sort(),
    [...MISSION1_VALIDATOR_PATHS].sort(),
  );
  for (const authorizedPath of MISSION1_AUTHORIZED_PATHS) {
    assert.ok(patterns.some((pattern) => matchOwned(authorizedPath, pattern)));
  }
  assert.equal(
    assignment.authorization_effect.includes('no runtime execution'),
    true,
  );
});

test('Mission 1 ownership does not admit neighboring paths or wildcards', () => {
  const patterns = ownershipPatterns(ownership());
  for (const neighboringPath of [
    'docs/convergence/mission-1/UNAPPROVED.md',
    'tools/convergence-census/unapproved.mjs',
  ]) {
    assert.equal(
      patterns.some((pattern) => matchOwned(neighboringPath, pattern)),
      false,
      neighboringPath,
    );
  }

  const manifest = ownership();
  manifest.owned_create_paths.push('docs/convergence/mission-1/**');
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /owner-approved scope digest/,
  );
});

test('Mission 1 ownership rejects tampering, duplicates and malformed entries', () => {
  const tampered = ownership();
  tampered.explicit_user_assignment.mission1_integration_2026_07_29.scope =
    'Neighboring files are authorized.';
  assert.throws(
    () => validateOwnershipManifest(tampered),
    /Mission 1 ownership assignment is malformed/,
  );

  const duplicate = ownership();
  duplicate.explicit_user_assignment.mission1_integration_2026_07_29
    .validator_paths.push(MISSION1_EVIDENCE_PATHS[0]);
  assert.throws(
    () => validateOwnershipManifest(duplicate),
    /Mission 1 ownership assignment is malformed/,
  );

  const malformed = ownership();
  malformed.explicit_user_assignment.mission1_integration_2026_07_29
    .evidence_paths[0] = '../outside';
  assert.throws(
    () => validateOwnershipManifest(malformed),
    /Mission 1 ownership assignment is malformed/,
  );
});

test('Mission 1 ownership cannot silently broaden authority or lose a required path', () => {
  const authority = ownership();
  authority.explicit_user_assignment.mission1_integration_2026_07_29
    .runtime_permissions = ['provider-connect'];
  assert.throws(
    () => validateOwnershipManifest(authority),
    /Mission 1 ownership assignment is malformed/,
  );

  const removed = ownership();
  removed.owned_create_paths = removed.owned_create_paths.filter(
    (entry) => entry !== MISSION1_AUTHORIZED_PATHS[0],
  );
  assert.throws(
    () => validateOwnershipManifest(removed),
    /must have exactly one exact ownership entry/,
  );
});

test('the exact Mission 1 change set is durability-owned after reconciliation', () => {
  assert.deepEqual(
    unownedPaths(MISSION1_AUTHORIZED_PATHS, ownership()),
    [],
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
