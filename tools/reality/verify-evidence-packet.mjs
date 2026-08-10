#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_RECEIPTS = Object.freeze([
  'candidate-unit',
  'focused',
  'full',
  'maria',
  'cpanel',
  'clean-clone',
  'release',
  'durability-build',
  'durability-verify',
  'durability-restore',
  'durability-assert',
  'postgresql-manual-qa',
]);
const ZERO_EFFECTS = Object.freeze([
  'network_live_source_calls',
  'provider_calls',
  'paid_calls',
  'spend_cents',
  'production_mutations',
  'deployments',
  'cognitive_promotions',
]);
const PHASE_B_MIGRATION = '20260810000000_market_reality_compiler';
const REQUIRED_HOSTED_RUNS = Object.freeze([
  'candidate-unit',
  'focused-verifier',
  'maria-verifier',
  'cpanel-verifier',
  'durability-proof',
  'github-import-offline',
]);

function fail(code) {
  throw new Error(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(root, args, encoding = 'utf8') {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding }).toString().trim();
  } catch {
    fail('CANA_PHASE_B_PACKET_GIT_IDENTITY_INVALID');
  }
}

function relativeFile(root, relativePath) {
  if (
    typeof relativePath !== 'string'
    || !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.includes('\\')
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) fail('CANA_PHASE_B_PACKET_PATH_INVALID');
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) fail('CANA_PHASE_B_PACKET_PATH_INVALID');
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('CANA_PHASE_B_PACKET_PATH_INVALID');
  return target;
}

function inventory(root, current = root, prefix = '') {
  const entries = [];
  for (const item of readdirSync(current, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
    const target = path.join(current, item.name);
    if (item.isSymbolicLink()) fail('CANA_PHASE_B_PACKET_PATH_INVALID');
    if (item.isDirectory()) entries.push(...inventory(root, target, relativePath));
    else if (item.isFile()) entries.push(relativePath);
    else fail('CANA_PHASE_B_PACKET_PATH_INVALID');
  }
  return entries.sort();
}

function jsonFile(root, relativePath) {
  try {
    return JSON.parse(readFileSync(relativeFile(root, relativePath), 'utf8'));
  } catch (error) {
    if (String(error?.message ?? error).startsWith('CANA_')) throw error;
    fail('CANA_PHASE_B_PACKET_JSON_INVALID');
  }
}

function committedBytes(root, commit, relativePath) {
  try {
    return execFileSync('git', ['-C', root, 'show', `${commit}:${relativePath}`]);
  } catch {
    fail('CANA_PHASE_B_PACKET_COMMITTED_FILE_MISSING');
  }
}

function zeroEffects(effects) {
  return effects && ZERO_EFFECTS.every((key) => effects[key] === 0);
}

export function verifyPhaseBMigrationManifest({ repositoryRoot, commit } = {}) {
  const root = path.resolve(repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const candidate = commit ?? git(root, ['rev-parse', 'HEAD']);
  let manifest;
  try {
    manifest = JSON.parse(committedBytes(root, candidate, 'apps/web/prisma/migration-manifest.json').toString('utf8'));
  } catch (error) {
    if (String(error?.message ?? error).startsWith('CANA_')) throw error;
    fail('CANA_PHASE_B_MIGRATION_MANIFEST_INVALID');
  }
  if (manifest.version !== 1 || manifest.provider !== 'postgresql' || !Array.isArray(manifest.migrations)) {
    fail('CANA_PHASE_B_MIGRATION_MANIFEST_INVALID');
  }
  const names = manifest.migrations.map((entry) => entry.name);
  const diskNames = git(root, ['ls-tree', '-d', '--name-only', `${candidate}:apps/web/prisma/migrations`])
    .split('\n').filter(Boolean).sort();
  if (JSON.stringify(names) !== JSON.stringify([...names].sort()) || JSON.stringify(names) !== JSON.stringify(diskNames)) {
    fail('CANA_PHASE_B_MIGRATION_UNIVERSE_MISMATCH');
  }
  if (names.length !== 5 || names[4] !== PHASE_B_MIGRATION) fail('CANA_PHASE_B_MIGRATION_UNIVERSE_MISMATCH');
  for (const entry of manifest.migrations) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) fail('CANA_PHASE_B_MIGRATION_MANIFEST_INVALID');
    const bytes = committedBytes(root, candidate, `apps/web/prisma/migrations/${entry.name}/migration.sql`);
    if (sha256(bytes) !== entry.sha256) fail('CANA_PHASE_B_MIGRATION_HASH_MISMATCH');
  }
  return Object.freeze({ migration_count: names.length, fifth_migration: Object.freeze({ ...manifest.migrations[4] }) });
}

export function verifyEvidencePacket({ repositoryRoot, packetDirectory, expectedBaseCommit } = {}) {
  const root = path.resolve(repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const packet = path.resolve(packetDirectory ?? '');
  const packetStat = lstatSync(packet);
  if (!packetStat.isDirectory() || packetStat.isSymbolicLink()) fail('CANA_PHASE_B_PACKET_PATH_INVALID');
  const manifest = jsonFile(packet, 'MANIFEST.json');
  if (manifest.schema_version !== 'cana.phase-b.evidence-packet/v2' || !Array.isArray(manifest.entries)) {
    fail('CANA_PHASE_B_PACKET_MANIFEST_INVALID');
  }
  if (!zeroEffects(manifest.effects)) fail('CANA_PHASE_B_PACKET_EXTERNAL_EFFECT_CLAIM_FAILED');
  const entryPaths = manifest.entries.map((entry) => entry.path);
  if (new Set(entryPaths).size !== entryPaths.length) fail('CANA_PHASE_B_PACKET_MANIFEST_INVALID');
  const actualPaths = inventory(packet);
  const expectedPaths = [...entryPaths, 'MANIFEST.json'].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) fail('CANA_PHASE_B_PACKET_EXTRA_OR_MISSING_PATH');
  for (const entry of manifest.entries) {
    const bytes = readFileSync(relativeFile(packet, entry.path));
    if (entry.bytes !== bytes.length || entry.sha256 !== sha256(bytes)) fail('CANA_PHASE_B_PACKET_ENTRY_HASH_MISMATCH');
  }

  const identity = jsonFile(packet, 'identity.json');
  const candidate = manifest.candidate;
  const base = identity.base;
  if (
    identity.schema_version !== 'cana.phase-b.identity/v1'
    || identity.clean !== true
    || !candidate
    || identity.candidate?.commit !== candidate.commit
    || identity.candidate?.tree !== candidate.tree
    || typeof identity.runtime?.process_version !== 'string'
    || !/^v\d+\.\d+\.\d+$/.test(identity.runtime.process_version)
    || !path.isAbsolute(identity.runtime?.process_exec_path ?? '')
    || manifest.base_commit !== base?.commit
    || expectedBaseCommit && base.commit !== expectedBaseCommit
    || git(root, ['rev-parse', 'HEAD']) !== candidate.commit
    || git(root, ['show', '-s', '--format=%T', candidate.commit]) !== candidate.tree
    || git(root, ['show', '-s', '--format=%T', base.commit]) !== base.tree
    || git(root, ['status', '--porcelain']) !== ''
  ) fail('CANA_PHASE_B_PACKET_GIT_IDENTITY_INVALID');

  const source = jsonFile(packet, 'source-snapshot.json');
  const fixtureManifestBytes = committedBytes(root, candidate.commit, source.fixture?.manifest_path);
  const snapshotBytes = committedBytes(root, candidate.commit, source.fixture?.snapshot_path);
  const benchmarkBytes = committedBytes(root, candidate.commit, source.benchmark?.path);
  const fixtureManifest = JSON.parse(fixtureManifestBytes.toString('utf8'));
  const benchmark = JSON.parse(benchmarkBytes.toString('utf8'));
  if (
    source.schema_version !== 'cana.phase-b.source-binding/v1'
    || source.fixture.manifest_sha256 !== sha256(fixtureManifestBytes)
    || source.fixture.snapshot_sha256 !== sha256(snapshotBytes)
    || source.benchmark.sha256 !== sha256(benchmarkBytes)
    || fixtureManifest.snapshot_sha256 !== sha256(snapshotBytes)
    || fixtureManifest.record_count !== source.fixture.record_count
    || benchmark.schema_version !== 'cana-reality-benchmark-v1'
    || benchmark.mode !== 'OFFLINE_COMMITTED_FIXTURE_REPLAY'
    || benchmark.source?.records !== source.fixture.record_count
    || benchmark.source?.fixture_snapshot_sha256 !== sha256(snapshotBytes)
    || benchmark.entity_resolution?.false_automatic_links !== 0
    || benchmark.court?.unsupported_claims_admitted !== 0
    || benchmark.court?.tampered_snapshot_decision !== 'DENY'
    || benchmark.court?.stale_current_decision !== 'MARK_STALE'
    || benchmark.organism?.gap_closed_in_deterministic_replay !== true
    || benchmark.cognitive_evolution?.state !== 'REFLECTION_ONLY'
    || benchmark.cognitive_evolution?.value_state !== 'VALUE_NOT_ESTABLISHED'
    || benchmark.cognitive_evolution?.cognitive_mutations_promoted !== 0
    || !zeroEffects(benchmark.effects)
  ) fail('CANA_PHASE_B_PACKET_SOURCE_BINDING_FAILED');

  const scope = jsonFile(packet, 'scope-diff.json');
  const ownershipBytes = committedBytes(root, candidate.commit, scope.ownership_path);
  const ownership = JSON.parse(ownershipBytes.toString('utf8'));
  const assignment = ownership.explicit_user_assignment?.[scope.assignment];
  const changedPaths = git(root, ['diff', '--name-only', base.commit, candidate.commit]).split('\n').filter(Boolean).sort();
  const authorized = [...(assignment?.authorized_paths ?? [])].sort();
  if (
    scope.schema_version !== 'cana.phase-b.scope-diff/v1'
    || scope.ownership_sha256 !== sha256(ownershipBytes)
    || scope.ownership_result !== 'PASS'
    || JSON.stringify(scope.changed_paths) !== JSON.stringify(changedPaths)
    || JSON.stringify(authorized) !== JSON.stringify(changedPaths)
    || changedPaths.some((file) => !authorized.includes(file))
    || changedPaths.some((file) =>
      (ownership.global_no_edit ?? []).includes(file)
      && file !== 'apps/web/tests/migration-court.test.mjs')
  ) fail('CANA_PHASE_B_PACKET_SCOPE_INVALID');

  for (const id of REQUIRED_RECEIPTS) {
    const receipt = jsonFile(packet, `receipts/${id}.json`);
    const stdout = readFileSync(relativeFile(packet, receipt.stdout?.path));
    if (
      receipt.schema_version !== 'cana.phase-b.command-receipt/v1'
      || receipt.id !== id
      || typeof receipt.command !== 'string'
      || !receipt.command
      || receipt.status !== 'PASS'
      || receipt.exit_code !== 0
      || receipt.candidate?.commit !== candidate.commit
      || receipt.candidate?.tree !== candidate.tree
      || receipt.stdout.bytes !== stdout.length
      || receipt.stdout.sha256 !== sha256(stdout)
      || receipt.stdout.path !== `receipts/${id}.stdout.txt`
      || receipt.runtime?.process_version !== identity.runtime.process_version
      || receipt.runtime?.process_exec_path !== identity.runtime.process_exec_path
      || !Number.isFinite(new Date(receipt.observed_at).getTime())
      || !zeroEffects(receipt.effects)
    ) fail('CANA_PHASE_B_PACKET_RECEIPT_INVALID');
  }

  const hosted = jsonFile(packet, 'hosted-runs.json');
  if (hosted.candidate?.commit !== candidate.commit || hosted.candidate?.tree !== candidate.tree) {
    fail('CANA_PHASE_B_PACKET_HOSTED_RUNS_INVALID');
  }
  const hostedVerified = hosted.state === 'VERIFIED'
    && hosted.run_ids
    && JSON.stringify(Object.keys(hosted.run_ids).sort()) === JSON.stringify([...REQUIRED_HOSTED_RUNS].sort())
    && Object.values(hosted.run_ids).every((id) => typeof id === 'string' && id.length > 0);
  const hostedPending = hosted.state === 'PENDING'
    && JSON.stringify([...(hosted.required_run_ids ?? [])].sort()) === JSON.stringify([...REQUIRED_HOSTED_RUNS].sort());
  if (!hostedVerified && !hostedPending) fail('CANA_PHASE_B_PACKET_HOSTED_RUNS_INVALID');
  const migration = verifyPhaseBMigrationManifest({ repositoryRoot: root, commit: candidate.commit });
  return Object.freeze({
    status: hostedVerified ? 'PASS' : 'LOCAL_PASS_HOSTED_PENDING',
    final_handoff_ready: hostedVerified,
    candidate_commit: candidate.commit,
    candidate_tree: candidate.tree,
    migration_count: migration.migration_count,
    source_records: source.fixture.record_count,
    external_effects: 0,
  });
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    console.log(JSON.stringify(verifyEvidencePacket({
      repositoryRoot: option('--repository'),
      packetDirectory: option('--packet'),
      expectedBaseCommit: option('--expected-base'),
    }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', reason: String(error?.message ?? error) }));
    process.exitCode = 1;
  }
}
