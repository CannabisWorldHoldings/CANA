#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SLICE2_ASSIGNMENT = 'phase_b_slice2_live_reality_2026_08_10';
const OWNERSHIP_PATH = 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json';
const SLICE2_MIGRATIONS = Object.freeze([
  '20260726000000_baseline',
  '20260726000100_ledger_recorded_at_index',
  '20260809100000_geo_kernel',
  '20260809170000_continuation_kernel',
  '20260810000000_market_reality_compiler',
  '20260810200000_live_reality_acquisition',
]);
const REQUIRED_HOSTED_RUNS = Object.freeze([
  'candidate-unit',
  'focused-verifier',
  'maria-verifier',
  'cpanel-verifier',
  'durability-proof',
  'github-import-offline',
]);
const REQUIRED_RECEIPTS = Object.freeze([
  'npm-ci',
  'prisma-generate',
  'slice2-unit',
  'focused',
  'maria',
  'cpanel',
  'durability-build',
  'durability-verify',
  'durability-restore',
  'github-prepare',
]);
const REQUIRED_ARTIFACTS = Object.freeze([
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
]);
const ZERO_EFFECT_KEYS = Object.freeze([
  'provider_calls',
  'paid_calls',
  'spend_cents',
  'publish_actions',
  'production_mutations',
  'deployments',
  'cognitive_promotions',
]);
const SOURCE_KEY = 'dcgis_abca_retailers_layer_31';
const SOURCE_URL = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31';

function fail(code) { throw new Error(code); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function git(root, args, encoding = 'utf8') {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding }).toString().trim();
  } catch {
    fail('CANA_SLICE2_PACKET_GIT_IDENTITY_INVALID');
  }
}
function relativeFile(root, relativePath) {
  if (
    typeof relativePath !== 'string'
    || !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.includes('\\')
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) fail('CANA_SLICE2_PACKET_PATH_INVALID');
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) fail('CANA_SLICE2_PACKET_PATH_INVALID');
  let stat;
  try { stat = lstatSync(target); } catch { fail('CANA_SLICE2_PACKET_PATH_INVALID'); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('CANA_SLICE2_PACKET_PATH_INVALID');
  return target;
}
function inventory(root, current = root, prefix = '') {
  const entries = [];
  for (const item of readdirSync(current, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
    const target = path.join(current, item.name);
    if (item.isSymbolicLink()) fail('CANA_SLICE2_PACKET_PATH_INVALID');
    if (item.isDirectory()) entries.push(...inventory(root, target, relativePath));
    else if (item.isFile()) entries.push(relativePath);
    else fail('CANA_SLICE2_PACKET_PATH_INVALID');
  }
  return entries.sort();
}
function jsonFile(root, relativePath) {
  try { return JSON.parse(readFileSync(relativeFile(root, relativePath), 'utf8')); }
  catch (error) {
    if (String(error?.message ?? error).startsWith('CANA_')) throw error;
    fail('CANA_SLICE2_PACKET_JSON_INVALID');
  }
}
function committedBytes(root, commit, relativePath) {
  try { return execFileSync('git', ['-C', root, 'show', `${commit}:${relativePath}`]); }
  catch { fail('CANA_SLICE2_PACKET_COMMITTED_FILE_MISSING'); }
}
function effectsValid(effects, networkCalls) {
  return effects?.network_live_source_calls === networkCalls
    && ZERO_EFFECT_KEYS.every((key) => effects?.[key] === 0);
}
function exactStrings(actual, expected) {
  return JSON.stringify([...(actual ?? [])].sort()) === JSON.stringify([...expected].sort());
}

export function verifySlice2MigrationManifest({ repositoryRoot, commit } = {}) {
  const root = path.resolve(repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const candidate = commit ?? git(root, ['rev-parse', 'HEAD']);
  let manifest;
  try { manifest = JSON.parse(committedBytes(root, candidate, 'apps/web/prisma/migration-manifest.json')); }
  catch (error) {
    if (String(error?.message ?? error).startsWith('CANA_')) throw error;
    fail('CANA_SLICE2_MIGRATION_MANIFEST_INVALID');
  }
  const names = manifest?.migrations?.map((entry) => entry.name) ?? [];
  const diskNames = git(root, ['ls-tree', '-d', '--name-only', `${candidate}:apps/web/prisma/migrations`])
    .split('\n').filter(Boolean).sort();
  if (
    manifest.version !== 1
    || manifest.provider !== 'postgresql'
    || !exactStrings(names, SLICE2_MIGRATIONS)
    || JSON.stringify(names) !== JSON.stringify(SLICE2_MIGRATIONS)
    || JSON.stringify(diskNames) !== JSON.stringify(SLICE2_MIGRATIONS)
  ) fail('CANA_SLICE2_MIGRATION_UNIVERSE_MISMATCH');
  for (const entry of manifest.migrations) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) fail('CANA_SLICE2_MIGRATION_MANIFEST_INVALID');
    const bytes = committedBytes(root, candidate, `apps/web/prisma/migrations/${entry.name}/migration.sql`);
    if (sha256(bytes) !== entry.sha256) fail('CANA_SLICE2_MIGRATION_HASH_MISMATCH');
  }
  return Object.freeze({
    migration_count: names.length,
    slice2_migration: Object.freeze({ ...manifest.migrations.at(-1) }),
  });
}

function verifyBenchmark(benchmark) {
  if (
    benchmark?.schema_version !== 'cana-live-reality-benchmark/v1'
    || benchmark.mode !== 'OFFLINE_SCRIPTED_REPLAY'
    || benchmark.source?.source_key !== SOURCE_KEY
    || benchmark.source?.fixed_url !== SOURCE_URL
    || benchmark.source?.live_network_calls !== 0
    || benchmark.acquisition?.changed !== 1
    || benchmark.acquisition?.unchanged !== 1
    || benchmark.acquisition?.unique_content_artifacts !== 1
    || benchmark.acquisition?.duplicate_content_artifacts !== 0
    || benchmark.acquisition?.revision_drift_denied !== 1
    || benchmark.acquisition?.outage_denied !== 1
    || benchmark.revalidation?.claims_mutated !== 0
    || benchmark.revalidation?.continuation_tick_truth_mutations !== 0
    || benchmark.answerability?.gaps_closed !== 1
    || benchmark.answerability?.duplicate_opportunities !== 0
    || benchmark.answerability?.demand_priority?.hypothesized_value !== null
    || benchmark.safety?.false_sovereign_identity_links !== 0
    || benchmark.safety?.unsupported_decision_eligible_claims !== 0
    || benchmark.safety?.source_failure_demotions !== 0
    || benchmark.safety?.provenance_violations !== 0
    || benchmark.cognitive_evolution?.state !== 'REFLECTION_ONLY'
    || benchmark.cognitive_evolution?.value_state !== 'VALUE_NOT_ESTABLISHED'
    || benchmark.cognitive_evolution?.cognitive_mutations_promoted !== 0
    || benchmark.cognitive_evolution?.next_action !== 'OWNER_REVIEW'
    || !effectsValid(benchmark.effects, 0)
  ) fail('CANA_SLICE2_PACKET_BENCHMARK_INVALID');
}

export function verifySlice2EvidencePacket({ repositoryRoot, packetDirectory, expectedBaseCommit } = {}) {
  const root = path.resolve(repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const packet = path.resolve(packetDirectory ?? '');
  let packetStat;
  try { packetStat = lstatSync(packet); } catch { fail('CANA_SLICE2_PACKET_PATH_INVALID'); }
  if (!packetStat.isDirectory() || packetStat.isSymbolicLink()) fail('CANA_SLICE2_PACKET_PATH_INVALID');
  const manifest = jsonFile(packet, 'MANIFEST.json');
  if (manifest.schema_version !== 'cana.phase-b-slice2.evidence-packet/v1' || !Array.isArray(manifest.entries)) {
    fail('CANA_SLICE2_PACKET_MANIFEST_INVALID');
  }
  const entryPaths = manifest.entries.map((entry) => entry.path);
  if (new Set(entryPaths).size !== entryPaths.length) fail('CANA_SLICE2_PACKET_MANIFEST_INVALID');
  if (!exactStrings(inventory(packet), [...entryPaths, 'MANIFEST.json'])) fail('CANA_SLICE2_PACKET_EXTRA_OR_MISSING_PATH');
  for (const entry of manifest.entries) {
    const bytes = readFileSync(relativeFile(packet, entry.path));
    if (entry.bytes !== bytes.length || entry.sha256 !== sha256(bytes)) fail('CANA_SLICE2_PACKET_ENTRY_HASH_MISMATCH');
  }

  const identity = jsonFile(packet, 'identity.json');
  const candidate = manifest.candidate;
  const base = identity.base;
  if (
    identity.schema_version !== 'cana.phase-b-slice2.identity/v1'
    || identity.clean !== true
    || !candidate
    || !base
    || identity.candidate?.commit !== candidate.commit
    || identity.candidate?.tree !== candidate.tree
    || manifest.base_commit !== base?.commit
    || expectedBaseCommit && base.commit !== expectedBaseCommit
    || !/^v\d+\.\d+\.\d+$/.test(identity.runtime?.process_version ?? '')
    || !path.isAbsolute(identity.runtime?.process_exec_path ?? '')
    || git(root, ['rev-parse', 'HEAD']) !== candidate.commit
    || git(root, ['show', '-s', '--format=%T', candidate.commit]) !== candidate.tree
    || git(root, ['show', '-s', '--format=%T', base.commit]) !== base.tree
    || git(root, ['status', '--porcelain']) !== ''
  ) fail('CANA_SLICE2_PACKET_GIT_IDENTITY_INVALID');

  const bindings = jsonFile(packet, 'artifact-bindings.json');
  if (
    bindings.schema_version !== 'cana.phase-b-slice2.artifact-bindings/v1'
    || !Array.isArray(bindings.artifacts)
    || !exactStrings(bindings.artifacts.map((entry) => entry.path), REQUIRED_ARTIFACTS)
  ) fail('CANA_SLICE2_PACKET_ARTIFACT_BINDING_INVALID');
  for (const entry of bindings.artifacts) {
    if (sha256(committedBytes(root, candidate.commit, entry.path)) !== entry.sha256) {
      fail('CANA_SLICE2_PACKET_ARTIFACT_BINDING_INVALID');
    }
  }
  const benchmark = JSON.parse(committedBytes(
    root,
    candidate.commit,
    'docs/evidence/phase-b-slice2/REALITY_ACQUISITION_BENCHMARK.json',
  ));
  verifyBenchmark(benchmark);
  const reflection = committedBytes(
    root,
    candidate.commit,
    'docs/evidence/phase-b-slice2/COGNITIVE_REFLECTION_RECEIPT.md',
  ).toString('utf8');
  if (
    !reflection.includes('`REFLECTION_ONLY`')
    || !reflection.includes('`VALUE_NOT_ESTABLISHED`')
    || !reflection.includes('Cognitive mutations promoted | `0`')
    || !reflection.includes(`Receipt SHA-256 | \`${benchmark.cognitive_evolution.receipt_sha256}\``)
  ) fail('CANA_SLICE2_PACKET_REFLECTION_INVALID');

  const scope = jsonFile(packet, 'scope-diff.json');
  if (scope.ownership_path !== OWNERSHIP_PATH) fail('CANA_SLICE2_PACKET_SCOPE_INVALID');
  const ownershipBytes = committedBytes(root, candidate.commit, scope.ownership_path);
  const ownership = JSON.parse(ownershipBytes);
  const assignment = ownership.explicit_user_assignment?.[SLICE2_ASSIGNMENT];
  const changedPaths = git(root, ['diff', '--name-only', base.commit, candidate.commit]).split('\n').filter(Boolean).sort();
  const authorized = [...(assignment?.authorized_paths ?? [])].sort();
  const { approval_sha256: recordedApproval, ...approvalBody } = assignment ?? {};
  const actualApproval = sha256(canonicalJson(approvalBody));
  if (
    scope.schema_version !== 'cana.phase-b-slice2.scope-diff/v1'
    || scope.assignment !== SLICE2_ASSIGNMENT
    || scope.ownership_sha256 !== sha256(ownershipBytes)
    || scope.approval_sha256 !== recordedApproval
    || recordedApproval !== actualApproval
    || assignment?.base_commit !== base.commit
    || assignment?.base_tree !== base.tree
    || JSON.stringify(scope.changed_paths) !== JSON.stringify(changedPaths)
    || changedPaths.some((entry) => !authorized.includes(entry))
    || scope.ownership_result !== 'PASS'
  ) fail('CANA_SLICE2_PACKET_SCOPE_INVALID');
  for (const [courtPath, expectedHash] of Object.entries(assignment.court_blob_sha256 ?? {})) {
    if (sha256(committedBytes(root, candidate.commit, courtPath)) !== expectedHash) {
      fail('CANA_SLICE2_PACKET_SCOPE_INVALID');
    }
  }

  for (const id of REQUIRED_RECEIPTS) {
    const receipt = jsonFile(packet, `receipts/${id}.json`);
    const stdout = readFileSync(relativeFile(packet, receipt.stdout?.path));
    if (
      receipt.schema_version !== 'cana.phase-b-slice2.command-receipt/v1'
      || receipt.id !== id
      || typeof receipt.command !== 'string'
      || !receipt.command
      || receipt.status !== 'PASS'
      || receipt.exit_code !== 0
      || receipt.candidate?.commit !== candidate.commit
      || receipt.candidate?.tree !== candidate.tree
      || receipt.runtime?.process_version !== identity.runtime.process_version
      || receipt.runtime?.process_exec_path !== identity.runtime.process_exec_path
      || receipt.stdout?.path !== `receipts/${id}.stdout.txt`
      || receipt.stdout?.bytes !== stdout.length
      || receipt.stdout?.sha256 !== sha256(stdout)
      || !Number.isFinite(new Date(receipt.observed_at).getTime())
      || !effectsValid(receipt.effects, 0)
    ) fail('CANA_SLICE2_PACKET_RECEIPT_INVALID');
  }

  const live = jsonFile(packet, 'live-run.json');
  const liveVerified = live.state === 'VERIFIED'
    && live.source_key === SOURCE_KEY
    && live.fixed_url === SOURCE_URL
    && live.network_live_source_calls === 1
    && live.acquisition_state === 'COMPLETED'
    && ['SOURCE_CHANGED', 'SOURCE_UNCHANGED'].includes(live.acquisition_outcome)
    && /^[a-f0-9]{64}$/.test(live.receipt_sha256 ?? '')
    && live.production_mutations === 0;
  const livePending = live.state === 'NOT_RUN'
    && live.reason === 'AUTHORITY_REQUIRED'
    && live.network_live_source_calls === 0
    && live.production_mutations === 0;
  if (!liveVerified && !livePending) fail('CANA_SLICE2_PACKET_LIVE_RUN_INVALID');
  if (!effectsValid(manifest.effects, liveVerified ? 1 : 0)) {
    fail('CANA_SLICE2_PACKET_EXTERNAL_EFFECT_CLAIM_FAILED');
  }

  const hosted = jsonFile(packet, 'hosted-runs.json');
  if (hosted.candidate?.commit !== candidate.commit || hosted.candidate?.tree !== candidate.tree) {
    fail('CANA_SLICE2_PACKET_HOSTED_RUNS_INVALID');
  }
  const hostedVerified = hosted.state === 'VERIFIED'
    && exactStrings(Object.keys(hosted.run_ids ?? {}), REQUIRED_HOSTED_RUNS)
    && Object.values(hosted.run_ids).every((id) => typeof id === 'string' && id.length > 0);
  const hostedPending = hosted.state === 'PENDING'
    && exactStrings(hosted.required_run_ids, REQUIRED_HOSTED_RUNS);
  if (!hostedVerified && !hostedPending) fail('CANA_SLICE2_PACKET_HOSTED_RUNS_INVALID');
  const migration = verifySlice2MigrationManifest({ repositoryRoot: root, commit: candidate.commit });
  const status = hostedVerified
    ? liveVerified ? 'PASS' : 'LOCAL_AND_HOSTED_PASS_LIVE_PENDING'
    : liveVerified ? 'LOCAL_AND_LIVE_PASS_HOSTED_PENDING' : 'LOCAL_PASS_LIVE_AND_HOSTED_PENDING';
  return Object.freeze({
    status,
    final_handoff_ready: hostedVerified && liveVerified,
    candidate_commit: candidate.commit,
    candidate_tree: candidate.tree,
    migration_count: migration.migration_count,
    changed_path_count: changedPaths.length,
    live_network_calls: liveVerified ? 1 : 0,
    production_mutations: 0,
    cognitive_promotions: 0,
  });
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    process.stdout.write(`${JSON.stringify(verifySlice2EvidencePacket({
      repositoryRoot: option('--repository'),
      packetDirectory: option('--packet'),
      expectedBaseCommit: option('--expected-base'),
    }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', reason: String(error?.message ?? error) })}\n`);
    process.exitCode = 1;
  }
}
