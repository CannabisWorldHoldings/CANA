import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  verifySlice2EvidencePacket,
  verifySlice2MigrationManifest,
} from './verify-slice2-evidence-packet.mjs';

const MIGRATIONS = [
  '20260726000000_baseline',
  '20260726000100_ledger_recorded_at_index',
  '20260809100000_geo_kernel',
  '20260809170000_continuation_kernel',
  '20260810000000_market_reality_compiler',
  '20260810200000_live_reality_acquisition',
];
const ARTIFACTS = [
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
  'docs/reality/PHASE_B_SLICE2_LIVE_ACQUISITION.md',
];
const RECEIPTS = [
  'npm-ci', 'prisma-generate', 'slice2-unit', 'focused', 'maria', 'cpanel',
  'durability-build', 'durability-verify', 'durability-restore', 'github-prepare',
];
const HOSTED = [
  'candidate-unit', 'focused-verifier', 'maria-verifier', 'cpanel-verifier',
  'durability-proof', 'github-import-offline',
];
const ZERO = {
  network_live_source_calls: 0,
  provider_calls: 0,
  paid_calls: 0,
  spend_cents: 0,
  publish_actions: 0,
  production_mutations: 0,
  deployments: 0,
  cognitive_promotions: 0,
};

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function write(root, relativePath, value) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function benchmark() {
  return {
    schema_version: 'cana-live-reality-benchmark/v1',
    mode: 'OFFLINE_SCRIPTED_REPLAY',
    source: {
      source_key: 'dcgis_abca_retailers_layer_31',
      fixed_url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31',
      live_network_calls: 0,
    },
    acquisition: {
      changed: 1, unchanged: 1, unique_content_artifacts: 1, duplicate_content_artifacts: 0,
      revision_drift_denied: 1, outage_denied: 1,
    },
    revalidation: { claims_mutated: 0, continuation_tick_truth_mutations: 0 },
    answerability: {
      gaps_closed: 1,
      duplicate_opportunities: 0,
      demand_priority: { hypothesized_value: null },
    },
    safety: {
      false_sovereign_identity_links: 0,
      unsupported_decision_eligible_claims: 0,
      source_failure_demotions: 0,
      provenance_violations: 0,
    },
    cognitive_evolution: {
      state: 'REFLECTION_ONLY',
      value_state: 'VALUE_NOT_ESTABLISHED',
      cognitive_mutations_promoted: 0,
      next_action: 'OWNER_REVIEW',
      receipt_sha256: 'a'.repeat(64),
    },
    effects: ZERO,
  };
}

function makeCandidate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-slice2-repository-'));
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'slice2@example.invalid']);
  git(root, ['config', 'user.name', 'Slice 2 packet test']);
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
  write(root, 'apps/web/prisma/migration-manifest.json', { version: 1, provider: 'postgresql', migrations });
  for (const artifact of ARTIFACTS) {
    if (artifact.endsWith('REALITY_ACQUISITION_BENCHMARK.json')) write(root, artifact, benchmark());
    else if (artifact.endsWith('COGNITIVE_REFLECTION_RECEIPT.md')) {
      write(root, artifact, '# Receipt\n\nState `REFLECTION_ONLY`; value `VALUE_NOT_ESTABLISHED`.\n\n| Cognitive mutations promoted | `0` |\n| Receipt SHA-256 | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |\n');
    } else if (artifact.endsWith('.json')) write(root, artifact, { schema_version: 'synthetic-test/v1' });
    else write(root, artifact, `# ${path.basename(artifact)}\n\nSynthetic verifier fixture.\n`);
  }
  const authorizedPaths = [
    'apps/web/prisma/migration-manifest.json',
    ...MIGRATIONS.map((name) => `apps/web/prisma/migrations/${name}/migration.sql`),
    ...ARTIFACTS,
    'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
  ].sort();
  const assignment = {
    authorization: 'SYNTHETIC SLICE 2 PACKET TEST',
    scope: 'Exact synthetic paths only',
    authorization_effect: 'No effects',
    base_commit: baseCommit,
    base_tree: baseTree,
    authorized_paths: authorizedPaths,
    court_blob_sha256: {},
  };
  assignment.approval_sha256 = sha256(canonicalJson(assignment));
  write(root, 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json', {
    global_no_edit: [],
    explicit_user_assignment: { phase_b_slice2_live_reality_2026_08_10: assignment },
  });
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'candidate']);
  return {
    root,
    baseCommit,
    baseTree,
    commit: git(root, ['rev-parse', 'HEAD']),
    tree: git(root, ['show', '-s', '--format=%T', 'HEAD']),
  };
}

function refreshManifest(packet, { effects } = {}) {
  const manifestPath = path.join(packet, 'MANIFEST.json');
  const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const walk = (directory, prefix = '') => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (relative === 'MANIFEST.json') return [];
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
  });
  const entries = walk(packet).sort().map((relativePath) => {
    const bytes = fs.readFileSync(path.join(packet, relativePath));
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
  write(packet, 'MANIFEST.json', {
    schema_version: 'cana.phase-b-slice2.evidence-packet/v1',
    base_commit: prior.base_commit,
    candidate: prior.candidate,
    effects: effects ?? prior.effects,
    entries,
  });
}

function makePacket(candidate, { hosted = 'PENDING', live = 'NOT_RUN' } = {}) {
  const packet = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-slice2-packet-'));
  const committed = (relativePath) => execFileSync('git', ['-C', candidate.root, 'show', `${candidate.commit}:${relativePath}`]);
  const ownershipPath = 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json';
  const ownership = JSON.parse(committed(ownershipPath));
  const assignment = ownership.explicit_user_assignment.phase_b_slice2_live_reality_2026_08_10;
  write(packet, 'identity.json', {
    schema_version: 'cana.phase-b-slice2.identity/v1',
    base: { commit: candidate.baseCommit, tree: candidate.baseTree },
    candidate: { commit: candidate.commit, tree: candidate.tree },
    runtime: { process_version: process.version, process_exec_path: process.execPath },
    clean: true,
  });
  write(packet, 'artifact-bindings.json', {
    schema_version: 'cana.phase-b-slice2.artifact-bindings/v1',
    artifacts: ARTIFACTS.map((artifact) => ({ path: artifact, sha256: sha256(committed(artifact)) })),
  });
  write(packet, 'scope-diff.json', {
    schema_version: 'cana.phase-b-slice2.scope-diff/v1',
    assignment: 'phase_b_slice2_live_reality_2026_08_10',
    ownership_path: ownershipPath,
    ownership_sha256: sha256(committed(ownershipPath)),
    approval_sha256: assignment.approval_sha256,
    changed_paths: git(candidate.root, ['diff', '--name-only', candidate.baseCommit, candidate.commit]).split('\n').filter(Boolean).sort(),
    ownership_result: 'PASS',
  });
  write(packet, 'live-run.json', live === 'VERIFIED' ? {
    state: 'VERIFIED',
    source_key: 'dcgis_abca_retailers_layer_31',
    fixed_url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31',
    network_live_source_calls: 1,
    acquisition_state: 'COMPLETED',
    acquisition_outcome: 'SOURCE_UNCHANGED',
    receipt_sha256: 'b'.repeat(64),
    production_mutations: 0,
  } : {
    state: 'NOT_RUN', reason: 'AUTHORITY_REQUIRED', network_live_source_calls: 0, production_mutations: 0,
  });
  write(packet, 'hosted-runs.json', hosted === 'VERIFIED' ? {
    state: 'VERIFIED',
    candidate: { commit: candidate.commit, tree: candidate.tree },
    run_ids: Object.fromEntries(HOSTED.map((name, index) => [name, String(1000 + index)])),
  } : {
    state: 'PENDING',
    candidate: { commit: candidate.commit, tree: candidate.tree },
    required_run_ids: HOSTED,
  });
  for (const id of RECEIPTS) {
    const stdout = `PASS ${id} ${candidate.commit}\n`;
    write(packet, `receipts/${id}.stdout.txt`, stdout);
    write(packet, `receipts/${id}.json`, {
      schema_version: 'cana.phase-b-slice2.command-receipt/v1',
      id,
      command: `verify ${id}`,
      status: 'PASS',
      exit_code: 0,
      candidate: { commit: candidate.commit, tree: candidate.tree },
      runtime: { process_version: process.version, process_exec_path: process.execPath },
      observed_at: '2026-08-10T00:00:00.000Z',
      stdout: { path: `receipts/${id}.stdout.txt`, bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
      effects: ZERO,
    });
  }
  write(packet, 'MANIFEST.json', {
    schema_version: 'cana.phase-b-slice2.evidence-packet/v1',
    base_commit: candidate.baseCommit,
    candidate: { commit: candidate.commit, tree: candidate.tree },
    effects: { ...ZERO, network_live_source_calls: live === 'VERIFIED' ? 1 : 0 },
    entries: [],
  });
  refreshManifest(packet);
  return packet;
}

test('deterministic Slice 2 packet binds migration, artifacts, scope, receipts, live state, and hosted state', () => {
  const candidate = makeCandidate();
  const pending = makePacket(candidate);
  const complete = makePacket(candidate, { live: 'VERIFIED', hosted: 'VERIFIED' });
  try {
    const migration = verifySlice2MigrationManifest({ repositoryRoot: candidate.root, commit: candidate.commit });
    assert.equal(migration.migration_count, 6);
    assert.equal(migration.slice2_migration.name, MIGRATIONS.at(-1));
    const pendingResult = verifySlice2EvidencePacket({
      repositoryRoot: candidate.root, packetDirectory: pending, expectedBaseCommit: candidate.baseCommit,
    });
    assert.equal(pendingResult.status, 'LOCAL_PASS_LIVE_AND_HOSTED_PENDING');
    assert.equal(pendingResult.final_handoff_ready, false);
    const completeResult = verifySlice2EvidencePacket({
      repositoryRoot: candidate.root, packetDirectory: complete, expectedBaseCommit: candidate.baseCommit,
    });
    assert.equal(completeResult.status, 'PASS');
    assert.equal(completeResult.final_handoff_ready, true);
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
    fs.rmSync(pending, { recursive: true, force: true });
    fs.rmSync(complete, { recursive: true, force: true });
  }
});

test('packet byte tamper, extra file, and symlink fail closed', () => {
  const candidate = makeCandidate();
  try {
    const bytes = makePacket(candidate);
    fs.appendFileSync(path.join(bytes, 'identity.json'), 'tamper');
    assert.throws(() => verifySlice2EvidencePacket({ repositoryRoot: candidate.root, packetDirectory: bytes }), /CANA_SLICE2_PACKET_ENTRY_HASH_MISMATCH/);
    fs.rmSync(bytes, { recursive: true, force: true });
    const extra = makePacket(candidate);
    write(extra, 'unexpected.txt', 'no');
    assert.throws(() => verifySlice2EvidencePacket({ repositoryRoot: candidate.root, packetDirectory: extra }), /CANA_SLICE2_PACKET_EXTRA_OR_MISSING_PATH/);
    fs.rmSync(extra, { recursive: true, force: true });
    const symlink = makePacket(candidate);
    fs.rmSync(path.join(symlink, 'identity.json'));
    fs.symlinkSync('hosted-runs.json', path.join(symlink, 'identity.json'));
    assert.throws(() => verifySlice2EvidencePacket({ repositoryRoot: candidate.root, packetDirectory: symlink }), /CANA_SLICE2_PACKET_PATH_INVALID/);
    fs.rmSync(symlink, { recursive: true, force: true });
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
  }
});

test('identity, ownership, artifact, receipt, hosted, and external-effect tamper fail with stable courts', () => {
  const candidate = makeCandidate();
  const cases = [
    ['identity.json', (value) => { value.candidate.commit = 'f'.repeat(40); }, 'CANA_SLICE2_PACKET_GIT_IDENTITY_INVALID'],
    ['scope-diff.json', (value) => { value.changed_paths = []; }, 'CANA_SLICE2_PACKET_SCOPE_INVALID'],
    ['artifact-bindings.json', (value) => { value.artifacts[0].sha256 = '0'.repeat(64); }, 'CANA_SLICE2_PACKET_ARTIFACT_BINDING_INVALID'],
    ['receipts/focused.json', (value) => { value.status = 'FAIL'; }, 'CANA_SLICE2_PACKET_RECEIPT_INVALID'],
    ['hosted-runs.json', (value) => { value.required_run_ids = []; }, 'CANA_SLICE2_PACKET_HOSTED_RUNS_INVALID'],
  ];
  try {
    for (const [relativePath, mutate, code] of cases) {
      const packet = makePacket(candidate);
      const value = JSON.parse(fs.readFileSync(path.join(packet, relativePath), 'utf8'));
      mutate(value);
      write(packet, relativePath, value);
      refreshManifest(packet);
      assert.throws(() => verifySlice2EvidencePacket({ repositoryRoot: candidate.root, packetDirectory: packet }), new RegExp(code));
      fs.rmSync(packet, { recursive: true, force: true });
    }
    const effects = makePacket(candidate);
    const manifest = JSON.parse(fs.readFileSync(path.join(effects, 'MANIFEST.json'), 'utf8'));
    manifest.effects.paid_calls = 1;
    write(effects, 'MANIFEST.json', manifest);
    assert.throws(() => verifySlice2EvidencePacket({ repositoryRoot: candidate.root, packetDirectory: effects }), /CANA_SLICE2_PACKET_EXTERNAL_EFFECT_CLAIM_FAILED/);
    fs.rmSync(effects, { recursive: true, force: true });
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
  }
});

test('sixth migration hash tamper fails independently', () => {
  const candidate = makeCandidate();
  try {
    write(candidate.root, `apps/web/prisma/migrations/${MIGRATIONS.at(-1)}/migration.sql`, 'tampered\n');
    git(candidate.root, ['add', '.']);
    git(candidate.root, ['commit', '-m', 'tamper migration']);
    assert.throws(() => verifySlice2MigrationManifest({
      repositoryRoot: candidate.root, commit: git(candidate.root, ['rev-parse', 'HEAD']),
    }), /CANA_SLICE2_MIGRATION_HASH_MISMATCH/);
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
  }
});
