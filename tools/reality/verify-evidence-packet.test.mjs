import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { verifyEvidencePacket, verifyPhaseBMigrationManifest } from './verify-evidence-packet.mjs';

const BASE = '74dd042f572f64e1da3709f71e602a9c0cda1917';
const MIGRATIONS = [
  '20260726000000_baseline',
  '20260726000100_ledger_recorded_at_index',
  '20260809100000_geo_kernel',
  '20260809170000_continuation_kernel',
  '20260810000000_market_reality_compiler',
];
const RECEIPTS = Object.freeze({
  'candidate-unit': 'node --test candidate-unit',
  focused: './cana verify focused',
  full: './cana verify full',
  maria: './cana verify maria',
  cpanel: './cana verify cpanel',
  'clean-clone': './cana verify clean-clone',
  release: './cana verify release',
  'durability-build': './cana durability build',
  'durability-verify': './cana durability verify',
  'durability-restore': './cana durability restore --target <empty-directory>',
  'durability-assert': 'node tools/test-runner/assert-ci-durability.mjs <receipt-directory> <restore-directory>',
  'postgresql-manual-qa': 'node apps/web/scripts/verify-market-reality.mjs --manual-qa',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function makeCandidate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-phase-b-repository-'));
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'phase-b@example.invalid']);
  git(root, ['config', 'user.name', 'Phase B packet test']);
  write(root, 'README.md', 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);
  const baseTree = git(root, ['show', '-s', '--format=%T', 'HEAD']);

  const migrations = MIGRATIONS.map((name, index) => {
    const sql = `-- ${name}\nSELECT ${index};\n`;
    write(root, `apps/web/prisma/migrations/${name}/migration.sql`, sql);
    return { name, sha256: sha256(sql) };
  });
  write(root, 'apps/web/prisma/migration-manifest.json', `${JSON.stringify({ version: 1, provider: 'postgresql', migrations }, null, 2)}\n`);
  const snapshot = '{"features":[]}\n';
  const fixtureManifest = { snapshot_sha256: sha256(snapshot), record_count: 74 };
  write(root, 'apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/snapshot.json', snapshot);
  write(root, 'apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/manifest.json', `${JSON.stringify(fixtureManifest)}\n`);
  write(root, 'docs/evidence/phase-b/REALITY_BENCHMARK.json', `${JSON.stringify({
    schema_version: 'cana-reality-benchmark-v1',
    mode: 'OFFLINE_COMMITTED_FIXTURE_REPLAY',
    source: { records: 74, fixture_snapshot_sha256: sha256(snapshot) },
    entity_resolution: { false_automatic_links: 0 },
    court: { unsupported_claims_admitted: 0, tampered_snapshot_decision: 'DENY', stale_current_decision: 'MARK_STALE' },
    organism: { gap_closed_in_deterministic_replay: true },
    cognitive_evolution: { state: 'REFLECTION_ONLY', value_state: 'VALUE_NOT_ESTABLISHED', cognitive_mutations_promoted: 0 },
    effects: { network_live_source_calls: 0, provider_calls: 0, paid_calls: 0, spend_cents: 0, production_mutations: 0, deployments: 0, cognitive_promotions: 0 },
  })}\n`);
  const authorizedPaths = [
    'apps/web/prisma/migration-manifest.json',
    ...MIGRATIONS.map((name) => `apps/web/prisma/migrations/${name}/migration.sql`),
    'apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/manifest.json',
    'apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/snapshot.json',
    'docs/evidence/phase-b/REALITY_BENCHMARK.json',
    'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
  ];
  write(root, 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json', `${JSON.stringify({
    global_no_edit: ['apps/web/tests/migration-court.test.mjs'],
    explicit_user_assignment: {
      phase_b_reality_compiler_slice1_2026_08_09: { authorized_paths: authorizedPaths },
    },
  }, null, 2)}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'candidate']);
  return {
    root,
    baseCommit,
    baseTree,
    commit: git(root, ['rev-parse', 'HEAD']),
    tree: git(root, ['show', '-s', '--format=%T', 'HEAD']),
    authorizedPaths,
  };
}

function makePacket(candidate, { hosted = 'PENDING' } = {}) {
  const packet = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-phase-b-packet-'));
  const fixtureRoot = 'apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05';
  const readCandidate = (file) => execFileSync('git', ['-C', candidate.root, 'show', `${candidate.commit}:${file}`]);
  const snapshot = readCandidate(`${fixtureRoot}/snapshot.json`);
  const fixtureManifest = readCandidate(`${fixtureRoot}/manifest.json`);
  const benchmark = readCandidate('docs/evidence/phase-b/REALITY_BENCHMARK.json');
  const ownership = readCandidate('tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json');
  const changedPaths = git(candidate.root, ['diff', '--name-only', candidate.baseCommit, candidate.commit]).split('\n').filter(Boolean).sort();
  const files = {
    'identity.json': { schema_version: 'cana.phase-b.identity/v1', candidate: { commit: candidate.commit, tree: candidate.tree }, base: { commit: candidate.baseCommit, tree: candidate.baseTree }, runtime: { process_version: process.version, process_exec_path: process.execPath }, clean: true },
    'source-snapshot.json': { schema_version: 'cana.phase-b.source-binding/v1', fixture: { manifest_path: `${fixtureRoot}/manifest.json`, snapshot_path: `${fixtureRoot}/snapshot.json`, manifest_sha256: sha256(fixtureManifest), snapshot_sha256: sha256(snapshot), record_count: 74 }, benchmark: { path: 'docs/evidence/phase-b/REALITY_BENCHMARK.json', sha256: sha256(benchmark) } },
    'scope-diff.json': { schema_version: 'cana.phase-b.scope-diff/v1', assignment: 'phase_b_reality_compiler_slice1_2026_08_09', ownership_path: 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json', ownership_sha256: sha256(ownership), changed_paths: changedPaths, ownership_result: 'PASS' },
    'hosted-runs.json': hosted === 'PENDING'
      ? { schema_version: 'cana.phase-b.hosted-runs/v1', state: 'PENDING', required_run_ids: ['candidate-unit', 'focused-verifier', 'maria-verifier', 'cpanel-verifier', 'durability-proof', 'github-import-offline'], candidate: { commit: candidate.commit, tree: candidate.tree } }
      : { schema_version: 'cana.phase-b.hosted-runs/v1', state: 'VERIFIED', run_ids: { 'candidate-unit': '100', 'focused-verifier': '101', 'maria-verifier': '102', 'cpanel-verifier': '103', 'durability-proof': '104', 'github-import-offline': '105' }, candidate: { commit: candidate.commit, tree: candidate.tree } },
  };
  for (const [id, command] of Object.entries(RECEIPTS)) {
    const stdout = `PASS ${id} commit=${candidate.commit} tree=${candidate.tree}\n`;
    const stdoutPath = `receipts/${id}.stdout.txt`;
    files[stdoutPath] = stdout;
    files[`receipts/${id}.json`] = {
      schema_version: 'cana.phase-b.command-receipt/v1', id, command, status: 'PASS', exit_code: 0,
      candidate: { commit: candidate.commit, tree: candidate.tree },
      runtime: { process_version: process.version, process_exec_path: process.execPath },
      observed_at: '2026-08-10T00:00:00.000Z',
      stdout: { path: stdoutPath, bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
      effects: { network_live_source_calls: 0, provider_calls: 0, paid_calls: 0, spend_cents: 0, production_mutations: 0, deployments: 0, cognitive_promotions: 0 },
    };
  }
  for (const [relativePath, contents] of Object.entries(files)) {
    write(packet, relativePath, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
  }
  const entries = Object.keys(files).sort().map((relativePath) => {
    const bytes = fs.readFileSync(path.join(packet, relativePath));
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
  write(packet, 'MANIFEST.json', `${JSON.stringify({ schema_version: 'cana.phase-b.evidence-packet/v2', base_commit: candidate.baseCommit, candidate: { commit: candidate.commit, tree: candidate.tree }, effects: { network_live_source_calls: 0, provider_calls: 0, paid_calls: 0, spend_cents: 0, production_mutations: 0, deployments: 0, cognitive_promotions: 0 }, entries }, null, 2)}\n`);
  return packet;
}

test('external Phase B packet authenticates exact git identity, source/benchmark hashes, scope, and mandatory local receipts', () => {
  const candidate = makeCandidate();
  const packet = makePacket(candidate);
  try {
    const migration = verifyPhaseBMigrationManifest({ repositoryRoot: candidate.root, commit: candidate.commit });
    assert.equal(migration.migration_count, 5);
    assert.equal(migration.fifth_migration.name, MIGRATIONS[4]);
    const result = verifyEvidencePacket({ repositoryRoot: candidate.root, packetDirectory: packet, expectedBaseCommit: candidate.baseCommit });
    assert.equal(result.status, 'LOCAL_PASS_HOSTED_PENDING');
    assert.equal(result.final_handoff_ready, false);
    assert.equal(result.migration_count, 5);
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
    fs.rmSync(packet, { recursive: true, force: true });
  }
});

test('packet byte tamper, extra path, symlink, and receipt identity mismatch fail closed', () => {
  const candidate = makeCandidate();
  const packet = makePacket(candidate, { hosted: 'VERIFIED' });
  try {
    fs.appendFileSync(path.join(packet, 'receipts', 'focused.stdout.txt'), 'tamper\n');
    assert.throws(() => verifyEvidencePacket({ repositoryRoot: candidate.root, packetDirectory: packet, expectedBaseCommit: candidate.baseCommit }), /CANA_PHASE_B_PACKET_ENTRY_HASH_MISMATCH/);
    fs.rmSync(packet, { recursive: true, force: true });
    const extra = makePacket(candidate, { hosted: 'VERIFIED' });
    write(extra, 'unexpected.txt', 'nope\n');
    assert.throws(() => verifyEvidencePacket({ repositoryRoot: candidate.root, packetDirectory: extra, expectedBaseCommit: candidate.baseCommit }), /CANA_PHASE_B_PACKET_EXTRA_OR_MISSING_PATH/);
    fs.rmSync(extra, { recursive: true, force: true });
    const symlink = makePacket(candidate, { hosted: 'VERIFIED' });
    fs.rmSync(path.join(symlink, 'receipts', 'maria.stdout.txt'));
    fs.symlinkSync('../focused.stdout.txt', path.join(symlink, 'receipts', 'maria.stdout.txt'));
    assert.throws(() => verifyEvidencePacket({ repositoryRoot: candidate.root, packetDirectory: symlink, expectedBaseCommit: candidate.baseCommit }), /CANA_PHASE_B_PACKET_PATH_INVALID/);
    fs.rmSync(symlink, { recursive: true, force: true });
    const identity = makePacket(candidate, { hosted: 'VERIFIED' });
    const receiptPath = path.join(identity, 'receipts', 'release.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.candidate.commit = 'f'.repeat(40);
    write(identity, 'receipts/release.json', `${JSON.stringify(receipt, null, 2)}\n`);
    assert.throws(() => verifyEvidencePacket({ repositoryRoot: candidate.root, packetDirectory: identity, expectedBaseCommit: candidate.baseCommit }), /CANA_PHASE_B_PACKET_ENTRY_HASH_MISMATCH/);
    fs.rmSync(identity, { recursive: true, force: true });
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
    fs.rmSync(packet, { recursive: true, force: true });
  }
});

test('fifth migration hash tamper fails the independent manifest verifier', () => {
  const candidate = makeCandidate();
  try {
    write(candidate.root, `apps/web/prisma/migrations/${MIGRATIONS[4]}/migration.sql`, 'tampered\n');
    git(candidate.root, ['add', '.']);
    git(candidate.root, ['commit', '-m', 'tamper fifth migration']);
    assert.throws(
      () => verifyPhaseBMigrationManifest({ repositoryRoot: candidate.root, commit: git(candidate.root, ['rev-parse', 'HEAD']) }),
      /CANA_PHASE_B_MIGRATION_HASH_MISMATCH/,
    );
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
  }
});
