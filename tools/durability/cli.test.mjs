import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  courtEditAdmitted,
  matchOwned,
  MISSION1_AUTHORIZED_PATHS,
  MISSION1_EVIDENCE_PATHS,
  mission1OwnershipAssignment,
  MISSION1_VALIDATOR_PATHS,
  MISSION2_AUTHORIZED_PATHS,
  mission2OwnershipAssignment,
  MISSION3_M001_AUTHORIZED_PATHS,
  mission3M001OwnershipAssignment,
  ownershipPatterns,
  PR35_AUTHORIZED_PATHS,
  PR2_AUTHORIZED_PATHS,
  pr29OwnershipAssignment,
  pr35OwnershipAssignment,
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

const PHASE_B_ASSIGNMENT = 'phase_b_reality_compiler_slice1_2026_08_09';
const PHASE_B_SLICE2_ASSIGNMENT = 'phase_b_slice2_live_reality_2026_08_10';
const PHASE_B_SLICE2_BASE = 'e3139d960b837a8ea7ef7f01acfab5111dd96cc7';
const PHASE_B_SLICE2_TREE = '5b6c4b85d613d1de71879bc7e27b63cb96ba7405';
const PHASE_B_EXPECTED_PATHS = Object.freeze([
  '.github/workflows/cana-verify.yml',
  '.omo/plans/cana-phase-b-reality-compiler.md',
  'apps/web/benchmarks/discovery-tasks.json',
  'apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/manifest.json',
  'apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/snapshot.json',
  'apps/web/prisma/migration-manifest.json',
  'apps/web/prisma/migrations/20260810000000_market_reality_compiler/migration.sql',
  'apps/web/prisma/schema.prisma',
  'apps/web/scripts/capture-dc-abca-snapshot.mjs',
  'apps/web/scripts/compile-market-reality.mjs',
  'apps/web/scripts/continuation-tick.mjs',
  'apps/web/scripts/etl-abca-retailers.mjs',
  'apps/web/scripts/ingest-abca-feed.mjs',
  'apps/web/scripts/replay-reality-benchmark.mjs',
  'apps/web/scripts/seed-abca-retailers.mjs',
  'apps/web/scripts/test-site-intelligence.mjs',
  'apps/web/scripts/verify-market-reality.mjs',
  'apps/web/src/lib/ask/market-gap-recheck.mjs',
  'apps/web/src/lib/continuation/continuation-consumers.mjs',
  'apps/web/src/lib/continuation/continuation-repository.mjs',
  'apps/web/src/lib/continuation/continuation-selection.mjs',
  'apps/web/src/lib/continuation/continuation-storage.mjs',
  'apps/web/src/lib/data-status.mjs',
  'apps/web/src/lib/directory-search.mjs',
  'apps/web/src/lib/public-retailer.mjs',
  'apps/web/src/lib/reality/entity-resolution.mjs',
  'apps/web/src/lib/reality/market-claim-adapter.mjs',
  'apps/web/src/lib/reality/market-claim-court.mjs',
  'apps/web/src/lib/reality/official-source-snapshot.mjs',
  'apps/web/src/lib/reality/reality-compiler.mjs',
  'apps/web/src/lib/reality/reality-repository.mjs',
  'apps/web/src/lib/seo-truth.mjs',
  'apps/web/src/lib/site-intelligence.mjs',
  'apps/web/src/lib/site-intelligence.server.ts',
  'apps/web/tests/data-status.test.mjs',
  'apps/web/tests/directory-search.test.mjs',
  'apps/web/tests/entity-resolution-benchmark.test.mjs',
  'apps/web/tests/ask-service-where.test.mjs',
  'apps/web/tests/legacy-abca-etl.test.mjs',
  'apps/web/tests/migration-court.test.mjs',
  'apps/web/tests/neighborhood-search.test.mjs',
  'apps/web/tests/product-benchmark.test.mjs',
  'apps/web/tests/reality-cognitive-evolution.test.mjs',
  'apps/web/tests/reality-compiler.test.mjs',
  'apps/web/tests/reality-organism-loop.test.mjs',
  'apps/web/tests/verification-laundering.test.mjs',
  'apps/web/tests/product-discovery.test.mjs',
  'apps/web/tests/public-retailer.test.mjs',
  'apps/web/tests/retailer-compare.test.mjs',
  'apps/web/tests/security-boundary.test.mjs',
  'apps/web/tests/site-intelligence.test.mjs',
  'apps/web/tests/tenant-retailer.test.mjs',
  'deploy/namecheap/artifact-exclusions.test.mjs',
  'deploy/namecheap/build-artifact.mjs',
  'docs/RSI_SITE_INTELLIGENCE_LINEAGE.md',
  'docs/capabilities/cana.ask-orderweeddc.contract.json',
  'docs/capabilities/cana.continuation-kernel.contract.json',
  'docs/evidence/phase-b/CLAIM_STATE_MACHINE.md',
  'docs/evidence/phase-b/COGNITIVE_EVOLUTION_STATE.md',
  'docs/evidence/phase-b/COGNITIVE_REFLECTION_RECEIPT.md',
  'docs/evidence/phase-b/CURRENT_VERIFIED_STATE.md',
  'docs/evidence/phase-b/EVIDENCE_LEDGER.md',
  'docs/evidence/phase-b/PHASE_B_ARCHITECTURE.md',
  'docs/evidence/phase-b/REALITY_BENCHMARK.json',
  'docs/evidence/phase-b/SOURCE_AUTHORITY_MATRIX.md',
  'docs/evidence/phase-b/TRUTH_WRITE_READ_MAP.md',
  'docs/evidence/phase-b/VERIFICATION_LAUNDERING_COURT.md',
  'docs/migration/SQLITE_TO_POSTGRES.md',
  'docs/reality/PHASE_B_SLICE1_CONTRACT.md',
  'tools/durability/cli.mjs',
  'tools/durability/cli.test.mjs',
  'tools/mariadb-sim/generate-schema.mjs',
  'tools/mariadb-sim/schema.prisma',
  'tools/reality/verify-evidence-packet.mjs',
  'tools/reality/verify-evidence-packet.test.mjs',
  'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
]);

const PHASE_B_SLICE2_EXPECTED_PATHS = Object.freeze([
  '.github/workflows/cana-verify.yml',
  '.omo/plans/cana-phase-b-slice2-live-reality.md',
  'apps/web/prisma/migration-manifest.json',
  'apps/web/prisma/migrations/20260810200000_live_reality_acquisition/migration.sql',
  'apps/web/prisma/schema.prisma',
  'apps/web/scripts/acquire-live-market-reality.mjs',
  'apps/web/scripts/replay-live-reality-benchmark.mjs',
  'apps/web/src/lib/ask/answerability-frontier.mjs',
  'apps/web/src/lib/ask/ask-service.mjs',
  'apps/web/src/lib/ask/ask-work.mjs',
  'apps/web/src/lib/ask/market-gap-recheck.mjs',
  'apps/web/src/lib/continuation/continuation-consumers.mjs',
  'apps/web/src/lib/reality/acquisition-state-machine.mjs',
  'apps/web/src/lib/reality/evidence-revocation.mjs',
  'apps/web/src/lib/reality/freshness-debt.mjs',
  'apps/web/src/lib/reality/live-abca-adapter.mjs',
  'apps/web/src/lib/reality/live-reality-acquisition.mjs',
  'apps/web/src/lib/reality/market-claim-adapter.mjs',
  'apps/web/src/lib/reality/market-claim-court.mjs',
  'apps/web/src/lib/reality/official-source-snapshot.mjs',
  'apps/web/src/lib/reality/reality-compiler.mjs',
  'apps/web/src/lib/reality/reality-repository.mjs',
  'apps/web/src/lib/reality/source-portfolio-router.mjs',
  'apps/web/tests/answerability-frontier.test.mjs',
  'apps/web/tests/ask-frontier-dedupe.test.mjs',
  'apps/web/tests/ask-service-where.test.mjs',
  'apps/web/tests/live-abca-adapter.test.mjs',
  'apps/web/tests/live-reality-acquisition.test.mjs',
  'apps/web/tests/live-reality-court.test.mjs',
  'apps/web/tests/migration-court.test.mjs',
  'apps/web/tests/migration-manifest.test.mjs',
  'apps/web/tests/reality-cognitive-evolution.test.mjs',
  'apps/web/tests/reality-compiler.test.mjs',
  'apps/web/tests/reality-organism-loop.test.mjs',
  'apps/web/tests/security-boundary.test.mjs',
  'apps/web/tests/verification-laundering.test.mjs',
  'deploy/namecheap/artifact-exclusions.test.mjs',
  'deploy/namecheap/build-artifact.mjs',
  'docs/evidence/phase-b-slice2/ACQUISITION_STATE_MACHINE.md',
  'docs/evidence/phase-b-slice2/ACQUISITION_WRITE_READ_MAP.md',
  'docs/evidence/phase-b-slice2/ADVERSARIAL_COURT_RESULTS.md',
  'docs/evidence/phase-b-slice2/ANSWERABILITY_FRONTIER.json',
  'docs/evidence/phase-b-slice2/BLAST_RADIUS_REPORT.json',
  'docs/evidence/phase-b-slice2/CIRCUIT_BREAKER_STATE.json',
  'docs/evidence/phase-b-slice2/COGNITIVE_EVOLUTION_STATE.md',
  'docs/evidence/phase-b-slice2/COGNITIVE_REFLECTION_RECEIPT.md',
  'docs/evidence/phase-b-slice2/CONTENT_ACQUISITION_IDENTITY.md',
  'docs/evidence/phase-b-slice2/CURRENT_VERIFIED_STATE.md',
  'docs/evidence/phase-b-slice2/EVIDENCE_REVOCATION_POLICY.md',
  'docs/evidence/phase-b-slice2/EXECUTION_PROVENANCE.md',
  'docs/evidence/phase-b-slice2/FRESHNESS_POLICY_MAP.md',
  'docs/evidence/phase-b-slice2/LIVE_PROVENANCE_POLICY.md',
  'docs/evidence/phase-b-slice2/LIVE_SOURCE_REGISTRY.md',
  'docs/evidence/phase-b-slice2/PRODUCTION_SHADOW_READINESS.md',
  'docs/evidence/phase-b-slice2/REALITY_ACQUISITION_BENCHMARK.json',
  'docs/evidence/phase-b-slice2/REVALIDATION_LEDGER.md',
  'docs/evidence/phase-b-slice2/SLICE2_ARCHITECTURE.md',
  'docs/evidence/phase-b-slice2/SOURCE_CAPABILITY_RECEIPT.json',
  'docs/evidence/phase-b-slice2/SOURCE_LIFECYCLE.md',
  'docs/evidence/phase-b-slice2/SOURCE_PORTFOLIO_MATRIX.md',
  'docs/evidence/phase-b-slice2/SOURCE_RELIABILITY_STATE.json',
  'docs/evidence/phase-b-slice2/TEMPORAL_INTEGRITY.md',
  'docs/migration/SQLITE_TO_POSTGRES.md',
  'docs/reality/PHASE_B_SLICE2_LIVE_ACQUISITION.md',
  'tools/cpanel-sim/run.mjs',
  'tools/durability/cli.mjs',
  'tools/durability/cli.test.mjs',
  'tools/mariadb-sim/generate-schema.mjs',
  'tools/mariadb-sim/run.mjs',
  'tools/mariadb-sim/run.test.mjs',
  'tools/mariadb-sim/schema.prisma',
  'tools/reality/verify-evidence-packet.mjs',
  'tools/reality/verify-evidence-packet.test.mjs',
  'tools/reality/verify-slice2-evidence-packet.mjs',
  'tools/reality/verify-slice2-evidence-packet.test.mjs',
  'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
]);

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

test('PR #29 recovery paths have exact ownership without neighboring authority', () => {
  const manifest = ownership();
  const assignment = pr29OwnershipAssignment(manifest);
  assert.ok(assignment.authorized_paths.length > 60);
  assert.ok(assignment.authorized_paths.every((entry) => !entry.includes('*')));
  assert.deepEqual(unownedPaths(assignment.authorized_paths, manifest), []);
  assert.deepEqual(
    unownedPaths(['apps/web/src/lib/geo/geo-repository-neighbor.mjs'], manifest),
    ['apps/web/src/lib/geo/geo-repository-neighbor.mjs'],
  );
});

test('PR #29 court admission is bound to the exact reviewed bytes', () => {
  const manifest = ownership();
  for (const courtPath of Object.keys(pr29OwnershipAssignment(manifest).court_blob_sha256)) {
    const reviewedBytes = execFileSync(
      'git', ['show', `77451edb8963c950d182b5c14f60a8a1fc17005c:${courtPath}`], { cwd: ROOT },
    );
    assert.equal(courtEditAdmitted(courtPath, manifest, reviewedBytes, 'pr29_canonical_recovery_2026_08_09'), true);
    assert.equal(courtEditAdmitted(courtPath, manifest, Buffer.from('tampered court'), 'pr29_canonical_recovery_2026_08_09'), false);
  }
});

test('PR #29 ownership and court metadata tampering fail closed', () => {
  const wildcard = ownership();
  wildcard.explicit_user_assignment.pr29_canonical_recovery_2026_08_09.authorized_paths[0] =
    'apps/web/**';
  assert.throws(() => validateOwnershipManifest(wildcard), /unique exact repository paths/);

  const digest = ownership();
  digest.explicit_user_assignment.pr29_canonical_recovery_2026_08_09
    .court_blob_sha256['apps/web/tests/release-gate.test.mjs'] = '0'.repeat(64);
  assert.throws(
    () => validateOwnershipManifest(digest),
    /failed its owner-approval digest/,
  );
});

test('ownership manifest rejects an injected assignment that self-attests court bytes', () => {
  const manifest = ownership();
  manifest.explicit_user_assignment.attacker_injected_assignment = {
    court_blob_sha256: {
      'apps/web/tests/migration-court.test.mjs': '0'.repeat(64),
    },
  };
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /unknown or missing assignments/,
  );
});

test('PR #35 sovereign integration has exact ownership without neighboring authority', () => {
  const manifest = ownership();
  const assignment = pr35OwnershipAssignment(manifest);
  assert.deepEqual(assignment.authorized_paths, [...PR35_AUTHORIZED_PATHS]);
  assert.equal(assignment.authorized_paths.length, 52);
  assert.ok(assignment.authorized_paths.every((entry) => !entry.includes('*')));
  assert.deepEqual(unownedPaths(assignment.authorized_paths, manifest), []);
  assert.deepEqual(
    unownedPaths(['apps/web/src/lib/continuation/neighboring-sovereign-brain.mjs'], manifest),
    ['apps/web/src/lib/continuation/neighboring-sovereign-brain.mjs'],
  );
});

test('PR #35 court admission is bound to the exact integrated bytes', () => {
  const manifest = ownership();
  for (const courtPath of Object.keys(pr35OwnershipAssignment(manifest).court_blob_sha256)) {
    const reviewedBytes = execFileSync(
      'git', ['show', `e3139d960b837a8ea7ef7f01acfab5111dd96cc7:${courtPath}`], { cwd: ROOT },
    );
    assert.equal(courtEditAdmitted(courtPath, manifest, reviewedBytes, 'pr35_sovereign_continuation_integration_2026_08_09'), true);
    assert.equal(courtEditAdmitted(courtPath, manifest, Buffer.from('tampered PR35 court'), 'pr35_sovereign_continuation_integration_2026_08_09'), false);
  }
});

test('PR #35 court admission rejects the older PR #29 blob for the same path', () => {
  const manifest = ownership();
  const courtPath = 'apps/web/tests/migration-court.test.mjs';
  const olderBytes = execFileSync(
    'git', ['show', `77451edb8963c950d182b5c14f60a8a1fc17005c:${courtPath}`], { cwd: ROOT },
  );
  assert.equal(
    courtEditAdmitted(courtPath, manifest, olderBytes, 'pr35_sovereign_continuation_integration_2026_08_09'),
    false,
  );
});

test('PR #35 ownership and court metadata tampering fail closed', () => {
  const wildcard = ownership();
  wildcard.explicit_user_assignment.pr35_sovereign_continuation_integration_2026_08_09
    .authorized_paths[0] = 'apps/web/**';
  assert.throws(() => validateOwnershipManifest(wildcard), /exact reviewed repository paths/);

  const digest = ownership();
  digest.explicit_user_assignment.pr35_sovereign_continuation_integration_2026_08_09
    .court_blob_sha256['apps/web/tests/migration-court.test.mjs'] = '0'.repeat(64);
  assert.throws(
    () => validateOwnershipManifest(digest),
    /failed its owner-approval digest/,
  );
});

test('Phase B Reality Compiler paths have exact ownership without neighboring authority', () => {
  const manifest = ownership();
  const assignment = manifest.explicit_user_assignment[PHASE_B_ASSIGNMENT];
  assert.ok(assignment, 'Phase B ownership assignment must exist before implementation');
  assert.deepEqual(assignment.authorized_paths, [...PHASE_B_EXPECTED_PATHS]);
  assert.equal(assignment.base_commit, '74dd042f572f64e1da3709f71e602a9c0cda1917');
  assert.equal(assignment.base_tree, '4596741c54beca9d20ae417877854e7cc39e1ff3');
  assert.ok(assignment.authorized_paths.every((entry) => !entry.includes('*')));
  assert.deepEqual(unownedPaths(assignment.authorized_paths, manifest), []);
  assert.deepEqual(
    unownedPaths(['apps/web/src/lib/reality-neighbor.mjs'], manifest),
    ['apps/web/src/lib/reality-neighbor.mjs'],
  );
});

test('Phase B ownership wildcard, base drift, authority broadening and digest tamper fail closed', () => {
  for (const mutate of [
    (value) => { value.authorized_paths[0] = 'apps/web/**'; },
    (value) => { value.base_commit = '0'.repeat(40); },
    (value) => { value.authorization_effect += ' deployment authority'; },
    (value) => { value.approval_sha256 = '0'.repeat(64); },
  ]) {
    const manifest = ownership();
    const assignment = manifest.explicit_user_assignment[PHASE_B_ASSIGNMENT];
    assert.ok(assignment, 'Phase B ownership assignment must exist before tamper courts');
    mutate(assignment);
    assert.throws(
      () => validateOwnershipManifest(manifest),
      /Phase B|owner-approval digest|changed-file ownership patterns/,
    );
  }
});

test('Phase B Slice 2 live reality paths have exact ownership without neighboring authority', () => {
  const manifest = ownership();
  const assignment = manifest.explicit_user_assignment[PHASE_B_SLICE2_ASSIGNMENT];
  assert.ok(assignment, 'Phase B Slice 2 ownership assignment must exist before implementation');
  assert.deepEqual(assignment.authorized_paths, [...PHASE_B_SLICE2_EXPECTED_PATHS]);
  assert.equal(assignment.base_commit, PHASE_B_SLICE2_BASE);
  assert.equal(assignment.base_tree, PHASE_B_SLICE2_TREE);
  assert.equal(new Set(assignment.authorized_paths).size, assignment.authorized_paths.length);
  assert.deepEqual(assignment.authorized_paths, [...assignment.authorized_paths].sort());
  assert.ok(assignment.authorized_paths.every((entry) => !entry.includes('*')));
  assert.deepEqual(unownedPaths(assignment.authorized_paths, manifest), []);
  assert.deepEqual(
    unownedPaths(['apps/web/src/lib/reality/live-provider-neighbor.mjs'], manifest),
    ['apps/web/src/lib/reality/live-provider-neighbor.mjs'],
  );
});

test('Phase B Slice 2 court admission is bound to the exact reviewed bytes', () => {
  const manifest = ownership();
  const courtPath = 'apps/web/tests/migration-court.test.mjs';
  assert.equal(
    courtEditAdmitted(courtPath, manifest, undefined, PHASE_B_SLICE2_ASSIGNMENT),
    true,
  );
  assert.equal(
    courtEditAdmitted(courtPath, manifest, Buffer.from('tampered Slice 2 court'), PHASE_B_SLICE2_ASSIGNMENT),
    false,
  );
});

test('Phase B Slice 2 wildcard, base drift, authority broadening and digest tamper fail closed', () => {
  for (const mutate of [
    (value) => { value.authorized_paths[0] = 'apps/web/**'; },
    (value) => { value.base_commit = '0'.repeat(40); },
    (value) => { value.authorization_effect += ' production mutation authority'; },
    (value) => { value.approval_sha256 = '0'.repeat(64); },
  ]) {
    const manifest = ownership();
    const assignment = manifest.explicit_user_assignment[PHASE_B_SLICE2_ASSIGNMENT];
    assert.ok(assignment, 'Phase B Slice 2 ownership assignment must exist before tamper courts');
    mutate(assignment);
    assert.throws(
      () => validateOwnershipManifest(manifest),
      /Phase B Slice 2|owner-approval digest|changed-file ownership patterns/,
    );
  }
});

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

test('the migration-court path repair has exact ownership without neighboring authority', () => {
  const manifest = ownership();
  assert.deepEqual(
    unownedPaths(['apps/web/tests/migration-court.test.mjs'], manifest),
    [],
  );
  assert.deepEqual(
    unownedPaths(['apps/web/tests/migration-court-neighbor.test.mjs'], manifest),
    ['apps/web/tests/migration-court-neighbor.test.mjs'],
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

test('the production database byte-preservation runtime path has exact ownership only', () => {
  const manifest = ownership();
  const exactPath = 'apps/web/src/lib/prisma.ts';
  const neighboringPath = 'apps/web/src/lib/prisma-neighbor.ts';
  assert.deepEqual(unownedPaths([exactPath], manifest), []);
  assert.equal(manifest.global_no_edit.includes(exactPath), false);
  assert.deepEqual(unownedPaths([neighboringPath], manifest), [neighboringPath]);
});

test('the production database test and launcher paths have exact ownership only', () => {
  const manifest = ownership();
  const exactPaths = [
    'apps/web/tests/clean-database-court.test.mjs',
    'apps/web/tests/deployment-integrity.test.mjs',
    'deploy/namecheap/app.js',
  ];
  assert.deepEqual(unownedPaths(exactPaths, manifest), []);
  const neighboringPaths = [
    'apps/web/tests/clean-database-court-neighbor.test.mjs',
    'apps/web/tests/deployment-integrity-neighbor.test.mjs',
    'deploy/namecheap/app-neighbor.js',
  ];
  assert.deepEqual(unownedPaths(neighboringPaths, manifest), neighboringPaths);
});

test('database byte-preservation ownership rejects every neighboring-path tamper', () => {
  for (const neighboringPath of [
    'apps/web/src/lib/prisma-neighbor.ts',
    'apps/web/tests/clean-database-court-neighbor.test.mjs',
    'apps/web/tests/deployment-integrity-neighbor.test.mjs',
    'deploy/namecheap/app-neighbor.js',
  ]) {
    const manifest = ownership();
    manifest.owned_modify_paths.push(neighboringPath);
    assert.throws(
      () => validateOwnershipManifest(manifest),
      /owner-approved scope digest/,
      neighboringPath,
    );
  }
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

test('the exact Mission 2 surfaces have narrow durability ownership', () => {
  const manifest = ownership();
  const assignment = mission2OwnershipAssignment(manifest);
  const patterns = ownershipPatterns(manifest);
  assert.deepEqual(
    [...assignment.authorized_paths].sort(),
    [...MISSION2_AUTHORIZED_PATHS].sort(),
  );
  for (const authorizedPath of MISSION2_AUTHORIZED_PATHS) {
    assert.ok(
      patterns.some((pattern) => matchOwned(authorizedPath, pattern)),
      authorizedPath,
    );
  }
  assert.deepEqual(unownedPaths(MISSION2_AUTHORIZED_PATHS, manifest), []);
  assert.equal(assignment.authorization_effect.includes('no provider'), true);
  assert.equal(assignment.authorization_effect.includes('no production'), true);
});

test('Mission 2 ownership does not admit neighboring paths or wildcards', () => {
  const patterns = ownershipPatterns(ownership());
  for (const neighboringPath of [
    'docs/convergence/mission-2/UNAPPROVED.md',
    'tools/mission-2/unapproved.mjs',
  ]) {
    assert.equal(
      patterns.some((pattern) => matchOwned(neighboringPath, pattern)),
      false,
      neighboringPath,
    );
  }

  const manifest = ownership();
  manifest.owned_create_paths.push('tools/mission-2/**');
  assert.throws(
    () => validateOwnershipManifest(manifest),
    /owner-approved scope digest/,
  );
});

test('Mission 2 ownership rejects tampering, duplicates and malformed paths', () => {
  const tampered = ownership();
  tampered.explicit_user_assignment.mission2_minimum_alive_loop_2026_07_29.scope =
    'Neighboring files are authorized.';
  assert.throws(
    () => validateOwnershipManifest(tampered),
    /Mission 2 ownership assignment is malformed/,
  );

  const duplicate = ownership();
  duplicate.explicit_user_assignment.mission2_minimum_alive_loop_2026_07_29
    .authorized_paths.push(MISSION2_AUTHORIZED_PATHS[0]);
  assert.throws(
    () => validateOwnershipManifest(duplicate),
    /Mission 2 ownership assignment is malformed/,
  );

  const malformed = ownership();
  malformed.explicit_user_assignment.mission2_minimum_alive_loop_2026_07_29
    .authorized_paths[0] = '../outside';
  assert.throws(
    () => validateOwnershipManifest(malformed),
    /Mission 2 ownership assignment is malformed/,
  );
});

test('Mission 2 ownership cannot broaden authority or lose a required path', () => {
  const authority = ownership();
  authority.explicit_user_assignment.mission2_minimum_alive_loop_2026_07_29
    .runtime_permissions = ['provider-connect'];
  assert.throws(
    () => validateOwnershipManifest(authority),
    /Mission 2 ownership assignment is malformed/,
  );

  const removed = ownership();
  removed.owned_create_paths = removed.owned_create_paths.filter(
    (entry) => entry !== 'tools/mission-2/kernel.mjs',
  );
  assert.throws(
    () => validateOwnershipManifest(removed),
    /must have exactly one exact ownership entry/,
  );
});

test('the exact Mission 3 M001 surfaces have narrow durability ownership', () => {
  const manifest = ownership();
  const assignment = mission3M001OwnershipAssignment(manifest);
  const handoff = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        'docs',
        'convergence',
        'mission-3',
        'M001_CANONICAL_HANDOFF_PACKET.json',
      ),
      'utf8',
    ),
  );
  assert.deepEqual(
    [...assignment.authorized_paths].sort(),
    [...MISSION3_M001_AUTHORIZED_PATHS].sort(),
  );
  assert.deepEqual(
    [...handoff.owned_files].sort(),
    [...MISSION3_M001_AUTHORIZED_PATHS].sort(),
  );
  assert.deepEqual(unownedPaths(MISSION3_M001_AUTHORIZED_PATHS, manifest), []);
  assert.equal(assignment.package_003_sha256, handoff.package_003.sha256);
  assert.equal(assignment.handoff_hash, handoff.handoff_hash);
  assert.equal(assignment.authorization_effect.includes('no live-data'), true);
  assert.equal(assignment.authorization_effect.includes('no provider'), true);
  assert.equal(assignment.authorization_effect.includes('no production'), true);
});

test('Mission 3 M001 ownership admits no neighboring path or wildcard', () => {
  const patterns = ownershipPatterns(ownership());
  for (const neighboringPath of [
    'docs/convergence/mission-3/M002_DELTA_MAP.json',
    'tools/growth-foundry/m001/live-source.mjs',
    'tools/growth-foundry/m002/claim-graph.mjs',
  ]) {
    assert.equal(
      patterns.some((pattern) => matchOwned(neighboringPath, pattern)),
      false,
      neighboringPath,
    );
  }

  const wildcard = ownership();
  wildcard.owned_create_paths.push('tools/growth-foundry/m001/**');
  assert.throws(
    () => validateOwnershipManifest(wildcard),
    /owner-approved scope digest/,
  );
});

test('Mission 3 M001 ownership rejects tampering, duplicates and authority broadening', () => {
  const tampered = ownership();
  tampered.explicit_user_assignment.mission3_m001_shadow_slice_2026_07_29
    .handoff_hash = '0'.repeat(64);
  assert.throws(
    () => validateOwnershipManifest(tampered),
    /Mission 3 M001 ownership assignment is malformed/,
  );

  const duplicate = ownership();
  duplicate.explicit_user_assignment.mission3_m001_shadow_slice_2026_07_29
    .authorized_paths.push(MISSION3_M001_AUTHORIZED_PATHS[0]);
  assert.throws(
    () => validateOwnershipManifest(duplicate),
    /Mission 3 M001 ownership assignment is malformed/,
  );

  const authority = ownership();
  authority.explicit_user_assignment.mission3_m001_shadow_slice_2026_07_29
    .runtime_permissions = ['provider-connect'];
  assert.throws(
    () => validateOwnershipManifest(authority),
    /Mission 3 M001 ownership assignment is malformed/,
  );
});

test('removing one M001 exact path recreates the durability ownership failure', () => {
  const removed = ownership();
  removed.owned_create_paths = removed.owned_create_paths.filter(
    (entry) => entry !== 'tools/growth-foundry/m001/claim-graph.mjs',
  );
  assert.throws(
    () => validateOwnershipManifest(removed),
    /Mission 3 M001 path must have exactly one exact ownership entry/,
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
