import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  receiptDirectory,
  sha256Bytes,
  sha256File,
  writeReceipt,
} from '../test-runner/receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const BASE_RECEIPT = path.join(ROOT, 'tools', 'durability', 'base-remote-receipt.json');
const OWNER_KEY_FILE = '/etc/cana/durability-owner-ed25519.pub';
const OWNER_KEY_ID_FILE = '/etc/cana/durability-owner-key-id';
const STAGE_A_ASSIGNMENT = 'stage_a_foundation_2026_07_28';
const STAGE_A_ASSIGNMENT_SHA256 =
  'c4535e12ddecb93df7e1c1ededa14f7be354b4b06f16670c6cac0518961ca618';
const PR2_ASSIGNMENT = 'pr2_exact_ownership_2026_07_28';
const PR2_ASSIGNMENT_SHA256 =
  'bd0659b9aae3db694661e1c8f4b6ccc6c4df473a3e518c5d55c8b032be4b3c02';
const MISSION1_ASSIGNMENT = 'mission1_integration_2026_07_29';
const MISSION1_ASSIGNMENT_SHA256 =
  '3fa119b9e88c1c1cfadf76c751258e8d48325afa4899986715a6a11b8afa7f02';
const MISSION2_ASSIGNMENT = 'mission2_minimum_alive_loop_2026_07_29';
const MISSION2_ASSIGNMENT_SHA256 =
  'ce8c4822fe0046139f29d2b3537aab3ccd6a5ed5af6d86e94306937d69595970';
const MISSION3_M001_ASSIGNMENT = 'mission3_m001_shadow_slice_2026_07_29';
const MISSION3_M001_ASSIGNMENT_SHA256 =
  '8a7ec1a50cad4c8d5c0ff1fb830e0ab3af987a6d49135a31241f9671d8b16452';
const PR29_ASSIGNMENT = 'pr29_canonical_recovery_2026_08_09';
const PR29_ASSIGNMENT_SHA256 =
  '5c3e7f196d9b6f214db76f296f4376fe07c196628aecd38ef4d7fe096716c8a2';
const PR35_ASSIGNMENT = 'pr35_sovereign_continuation_integration_2026_08_09';
const PR35_ASSIGNMENT_SHA256 =
  '84a28b1f58fd8d8ba2a68a2f34b869126bade86c6f6b443014f013a249b97fb5';
const PHASE_B_SLICE1_ASSIGNMENT = 'phase_b_reality_compiler_slice1_2026_08_09';
const PHASE_B_SLICE1_ASSIGNMENT_SHA256 =
  'a0fd370221ad37805e1bf29c2a1bb7024989aa6293a92a9eb1da18560eeda647';
const PHASE_B_SLICE2_ASSIGNMENT = 'phase_b_slice2_live_reality_2026_08_10';
const PHASE_B_SLICE2_ASSIGNMENT_SHA256 =
  'bc7a8b717e7070894fd41b0aa0344c854831e73d37a1083248377ccbb31ef2da';
const CHANGED_FILE_OWNERSHIP_SHA256 =
  '001b2fd111a4f3ddc586f7433d6cb7ffc7e3b85774fe850777136a484e67bb3f';
export const STAGE_A_AUTHORIZED_PATHS = Object.freeze([
  'apps/web/src/app/[domain]/retailer/[id]/page.tsx',
  'apps/web/src/lib/interaction-proof.mjs',
  'apps/web/src/lib/structured-data.mjs',
  'apps/web/tests/interaction-proof.test.mjs',
  'apps/web/tests/structured-data-truth.test.mjs',
  'docs/verification/STAGE_A_DETERMINISM_LEDGER.md',
]);
export const PR2_AUTHORIZED_PATHS = Object.freeze([
  'apps/web/next.config.ts',
  'apps/web/src/lib/build-database.mjs',
  'apps/web/src/lib/db-config.mjs',
  'apps/web/tests/build-database-gate.test.mjs',
  'deploy/namecheap/build-artifact.mjs',
]);
export const MISSION1_EVIDENCE_PATHS = Object.freeze([
  'docs/convergence/mission-1/ARTIFACT_MANIFEST.json',
  'docs/convergence/mission-1/AUTHORITY_CONTRACT.md',
  'docs/convergence/mission-1/CANONICAL_COMPONENT_MAP.md',
  'docs/convergence/mission-1/COMPONENT_DISPOSITION.md',
  'docs/convergence/mission-1/CONVERGENCE_ROLLBACK_PLAN.md',
  'docs/convergence/mission-1/DUPLICATE_AUTHORITY_REPORT.md',
  'docs/convergence/mission-1/HERMES_PIN_RESOLUTION.md',
  'docs/convergence/mission-1/INPUT_HASHES.json',
  'docs/convergence/mission-1/INTELLIGENCE_OS_RECOVERY_STATUS.md',
  'docs/convergence/mission-1/LOCAL_VERIFICATION_RECEIPTS.json',
  'docs/convergence/mission-1/MINIMUM_ALIVE_LOOP_SPEC.md',
  'docs/convergence/mission-1/RUNTIME_INCLUSION_MANIFEST.json',
  'docs/convergence/mission-1/SOURCE_LEDGER.md',
]);
export const MISSION1_VALIDATOR_PATHS = Object.freeze([
  'tools/convergence-census/generate-artifact-manifest.mjs',
  'tools/convergence-census/generate-input-hashes.mjs',
  'tools/convergence-census/verify.mjs',
]);
export const MISSION1_AUTHORIZED_PATHS = Object.freeze([
  ...MISSION1_EVIDENCE_PATHS,
  ...MISSION1_VALIDATOR_PATHS,
]);
export const PR35_AUTHORIZED_PATHS = Object.freeze([
  '.github/workflows/cana-verify.yml',
  'apps/web/prisma/migration-manifest.json',
  'apps/web/prisma/migration-manifest.mjs',
  'apps/web/prisma/migrations/20260809170000_continuation_kernel/migration.sql',
  'apps/web/prisma/schema.prisma',
  'apps/web/scripts/benchmark-product-discovery.mjs',
  'apps/web/scripts/continuation-tick.mjs',
  'apps/web/src/app/api/v1/ask/route.ts',
  'apps/web/src/app/layout.tsx',
  'apps/web/src/lib/ask/ask-work.mjs',
  'apps/web/src/lib/ask/ask-service.mjs',
  'apps/web/src/lib/ask/intent-ir.mjs',
  'apps/web/src/lib/continuation/continuation-core.mjs',
  'apps/web/src/lib/continuation/continuation-repository.mjs',
  'apps/web/src/lib/continuation/continuation-selection.mjs',
  'apps/web/src/lib/continuation/continuation-storage.mjs',
  'apps/web/src/lib/db-config.mjs',
  'apps/web/src/lib/public-submission.mjs',
  'apps/web/tests/ask-intent-ir.test.mjs',
  'apps/web/tests/ask-service-where.test.mjs',
  'apps/web/tests/column-width-cutover-court.test.mjs',
  'apps/web/tests/continuation-core.test.mjs',
  'apps/web/tests/continuation-court.test.mjs',
  'apps/web/tests/deployment-integrity.test.mjs',
  'apps/web/tests/migration-court.test.mjs',
  'apps/web/tests/migration-manifest.test.mjs',
  'apps/web/tests/release-gate.test.mjs',
  'deploy/namecheap/MANIFEST.json',
  'deploy/namecheap/PRODUCTION_CUTOVER_RUNBOOK.md',
  'deploy/namecheap/STAGING_RUNBOOK.md',
  'deploy/namecheap/build-artifact.mjs',
  'deploy/namecheap/deploy.sh',
  'deploy/namecheap/migrate.sh',
  'deploy/namecheap/verify-and-deploy.sh',
  'deploy/namecheap/verify-owner-artifact-input.sh',
  'deploy/namecheap/worker.mjs',
  'docs/capabilities/CANA_CAPABILITY_CONTRACT.schema.json',
  'docs/capabilities/cana.ask-orderweeddc.contract.json',
  'docs/capabilities/cana.continuation-kernel.contract.json',
  'docs/capabilities/cana.provenance-court.contract.json',
  'docs/migration/SQLITE_TO_POSTGRES.md',
  'tools/cpanel-sim/real-prisma-proof.sh',
  'tools/cpanel-sim/run.mjs',
  'tools/durability/cli.mjs',
  'tools/durability/cli.test.mjs',
  'tools/mariadb-sim/generate-schema.mjs',
  'tools/mariadb-sim/run.mjs',
  'tools/mariadb-sim/run.test.mjs',
  'tools/mariadb-sim/schema.prisma',
  'tools/provenance-court/sabotage.test.mjs',
  'tools/provenance-court/verify-chain.mjs',
  'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
]);
export const PHASE_B_SLICE1_AUTHORIZED_PATHS = Object.freeze([
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
export const PHASE_B_SLICE2_AUTHORIZED_PATHS = Object.freeze([
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
export const MISSION2_AUTHORIZED_PATHS = Object.freeze([
  '.github/workflows/cana-verify.yml',
  'apps/web/tests/build-database-gate.test.mjs',
  'docs/CANA_TECHNICAL_STATE.md',
  'docs/convergence/mission-2/BLOCKER_REPAIR_LEDGER.md',
  'docs/convergence/mission-2/COMMIT_LEDGER.md',
  'docs/convergence/mission-2/MISSION_2_CONTRACTS.md',
  'docs/convergence/mission-2/MISSION_3_PREREQUISITES.md',
  'docs/convergence/mission-2/PROTECTED_BASE_RECEIPT.json',
  'docs/convergence/mission-2/evidence/ADVERSARIAL_REPORT.json',
  'docs/convergence/mission-2/evidence/EVIDENCE_MANIFEST.json',
  'docs/convergence/mission-2/evidence/INTELLIGENCE_OS_READ_CONTRACT_RECEIPT.json',
  'docs/convergence/mission-2/evidence/INVALID_MISSION_RECEIPTS.json',
  'docs/convergence/mission-2/evidence/LEGITIMATE_MINIMUM_ALIVE_LOOP_RECEIPT.json',
  'docs/convergence/mission-2/evidence/TRANSCRIPT_SHADOW_MECHANISM_RECEIPT.json',
  'tools/durability/cli.mjs',
  'tools/durability/cli.test.mjs',
  'tools/github-import/prepare.test.mjs',
  'tools/mission-2/authorization.mjs',
  'tools/mission-2/canonical.mjs',
  'tools/mission-2/context.mjs',
  'tools/mission-2/contracts.mjs',
  'tools/mission-2/foundry.mjs',
  'tools/mission-2/intelligence-contracts.mjs',
  'tools/mission-2/kernel.mjs',
  'tools/mission-2/lease.mjs',
  'tools/mission-2/mission-2.test.mjs',
  'tools/mission-2/mock-executor.mjs',
  'tools/mission-2/run-fixtures.mjs',
  'tools/mission-2/store.mjs',
  'tools/mission-2/verifier.mjs',
  'tools/mission-2/verifier-process.mjs',
  'tools/mission-2/verifier-worker.mjs',
  'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
]);
export const MISSION3_M001_AUTHORIZED_PATHS = Object.freeze([
  '.github/workflows/cana-verify.yml',
  'docs/convergence/m001/READ_ONLY_SHADOW_CONTRACT.md',
  'docs/convergence/mission-3/M001_ADMISSION_AND_AUTHORIZATION_RECEIPT.json',
  'docs/convergence/mission-3/M001_CANONICAL_HANDOFF_PACKET.json',
  'docs/convergence/mission-3/M001_DELTA_MAP.json',
  'docs/convergence/mission-3/M001_IMPLEMENTATION_RESULT.json',
  'docs/convergence/mission-3/M001_TEST_AND_ADVERSARIAL_RECEIPT.json',
  'tools/durability/cli.mjs',
  'tools/durability/cli.test.mjs',
  'tools/github-import/prepare.test.mjs',
  'tools/growth-foundry/m001/claim-graph.mjs',
  'tools/growth-foundry/m001/claim-graph.test.mjs',
  'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
]);

function command(commandName, args, {
  cwd = ROOT,
  input,
  timeout = 120_000,
  allowFailure = false,
  maxBuffer = 128 * 1024 * 1024,
  env = process.env,
} = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    input,
    timeout,
    encoding: 'utf8',
    maxBuffer,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`${commandName} failed to start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandName} ${args.join(' ')} exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result;
}

function refusal(message) {
  throw Object.assign(new Error(message), { exitCode: 3 });
}

function stateRoot() {
  const root =
    process.env.CANA_LOCAL_STATE_DIR ??
    path.join(ROOT, '.cana-local', 'durability');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return path.resolve(root);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temporary, file);
}

function git(args, options = {}) {
  return command('git', args, options).stdout.trim();
}

function identity() {
  return {
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    status: git(['status', '--porcelain']),
  };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) refusal(`unexpected durability argument: ${value}`);
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) refusal(`missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

export function matchOwned(relative, pattern) {
  if (pattern.endsWith('/**')) return relative.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith('/*.yml')) {
    const directory = pattern.slice(0, -6);
    return path.posix.dirname(relative) === directory && relative.endsWith('.yml');
  }
  return relative === pattern;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

export function validateOwnershipManifest(ownership) {
  if (
    !ownership ||
    typeof ownership !== 'object' ||
    !ownership.explicit_user_assignment ||
    !Array.isArray(ownership.owned_create_paths) ||
    !Array.isArray(ownership.owned_modify_paths) ||
    !Array.isArray(ownership.planned_candidate_files)
  ) {
    refusal('ownership manifest is malformed');
  }

  const assignment = ownership.explicit_user_assignment[STAGE_A_ASSIGNMENT];
  if (
    !exactKeys(assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'approval_sha256',
      'entries',
    ]) ||
    !Array.isArray(assignment.entries)
  ) {
    refusal('Stage A ownership assignment is malformed');
  }

  const entryKeys = [
    'path',
    'canonical_owner',
    'reason',
    'approving_lineage',
    'commit_provenance',
    'permitted_change_class',
    'material_kind',
    'authorization_effect',
  ];
  const provenanceKeys = ['commit', 'tree', 'relationship'];
  const authorizedOwners = new Set([
    'web-truth-structured-data',
    'privacy-preserving-interaction-proof',
    'verification-evidence',
  ]);
  const permittedChangeClasses = new Set([
    'structured-data-time-determinism',
    'privacy-preserving-nonce-determinism',
    'verification-evidence',
  ]);
  const materialKinds = new Set(['runtime', 'test', 'evidence']);

  for (const entry of assignment.entries) {
    if (
      !exactKeys(entry, entryKeys) ||
      !exactKeys(entry.commit_provenance, provenanceKeys) ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.startsWith('/') ||
      entry.path.includes('\\') ||
      entry.path.includes('*') ||
      entry.path.includes('..') ||
      path.posix.normalize(entry.path) !== entry.path ||
      !authorizedOwners.has(entry.canonical_owner) ||
      typeof entry.reason !== 'string' ||
      entry.reason.length === 0 ||
      typeof entry.approving_lineage !== 'string' ||
      entry.approving_lineage.length === 0 ||
      !/^[0-9a-f]{40}$/.test(entry.commit_provenance.commit) ||
      !/^[0-9a-f]{40}$/.test(entry.commit_provenance.tree) ||
      typeof entry.commit_provenance.relationship !== 'string' ||
      entry.commit_provenance.relationship.length === 0 ||
      !permittedChangeClasses.has(entry.permitted_change_class) ||
      !materialKinds.has(entry.material_kind) ||
      entry.authorization_effect !== 'durability-path-ownership-only'
    ) {
      refusal(`malformed Stage A ownership entry: ${entry?.path ?? '<missing path>'}`);
    }
  }

  const entryPaths = assignment.entries.map((entry) => entry.path);
  if (new Set(entryPaths).size !== entryPaths.length) {
    refusal('duplicate Stage A ownership entry');
  }
  if (
    JSON.stringify([...entryPaths].sort()) !==
    JSON.stringify([...STAGE_A_AUTHORIZED_PATHS].sort())
  ) {
    refusal('Stage A ownership paths do not match the exact owner-authorized set');
  }

  const allOwnedPaths = [...ownership.owned_create_paths, ...ownership.owned_modify_paths];
  if (new Set(allOwnedPaths).size !== allOwnedPaths.length) {
    refusal('duplicate changed-file ownership is not allowed');
  }
  for (const authorizedPath of STAGE_A_AUTHORIZED_PATHS) {
    const exactOccurrences = allOwnedPaths.filter((pattern) => pattern === authorizedPath).length;
    if (exactOccurrences !== 1) {
      refusal(`Stage A path must have exactly one exact ownership entry: ${authorizedPath}`);
    }
    const plannedOccurrences = ownership.planned_candidate_files.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (plannedOccurrences !== 1) {
      refusal(`Stage A path must have exactly one planned-candidate entry: ${authorizedPath}`);
    }
  }

  const { approval_sha256: recordedDigest, ...approvalPayload } = assignment;
  const actualDigest = sha256Bytes(canonicalJson(approvalPayload));
  if (
    recordedDigest !== STAGE_A_ASSIGNMENT_SHA256 ||
    actualDigest !== STAGE_A_ASSIGNMENT_SHA256
  ) {
    refusal('Stage A ownership assignment failed its owner-approval digest');
  }

  const pr2Assignment = ownership.explicit_user_assignment[PR2_ASSIGNMENT];
  if (
    !exactKeys(pr2Assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'approval_sha256',
      'entries',
    ]) ||
    !Array.isArray(pr2Assignment.entries)
  ) {
    refusal('PR #2 ownership assignment is malformed');
  }

  const pr2EntryKeys = [
    'path',
    'canonical_owner',
    'reason',
    'approving_lineage',
    'commit_provenance',
    'originating_commits',
    'permitted_change_class',
    'material_kind',
    'material_class',
    'authorization_effect',
    'ownership_authorizes_execution',
    'ownership_authorizes_deployment',
    'ownership_authorizes_credentials',
    'ownership_authorizes_production_change',
  ];
  const pr2AuthorizedOwners = new Set([
    'deterministic-web-build',
    'deterministic-build-database',
    'build-database-verification',
    'namecheap-artifact-construction',
  ]);
  const pr2PermittedChangeClasses = new Set([
    'deterministic-web-build-configuration',
    'deterministic-build-database-handling',
    'build-database-negative-verification',
    'deterministic-artifact-construction',
  ]);
  const pr2MaterialClasses = new Set([
    'runtime-build-configuration',
    'web-build-tooling',
    'test-verification-material',
    'deployment-artifact-builder',
  ]);

  for (const entry of pr2Assignment.entries) {
    if (
      !exactKeys(entry, pr2EntryKeys) ||
      !exactKeys(entry.commit_provenance, provenanceKeys) ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.startsWith('/') ||
      entry.path.includes('\\') ||
      entry.path.includes('*') ||
      entry.path.includes('..') ||
      path.posix.normalize(entry.path) !== entry.path ||
      !pr2AuthorizedOwners.has(entry.canonical_owner) ||
      typeof entry.reason !== 'string' ||
      entry.reason.length === 0 ||
      typeof entry.approving_lineage !== 'string' ||
      entry.approving_lineage.length === 0 ||
      !/^[0-9a-f]{40}$/.test(entry.commit_provenance.commit) ||
      !/^[0-9a-f]{40}$/.test(entry.commit_provenance.tree) ||
      typeof entry.commit_provenance.relationship !== 'string' ||
      entry.commit_provenance.relationship.length === 0 ||
      !Array.isArray(entry.originating_commits) ||
      entry.originating_commits.length === 0 ||
      entry.originating_commits.some((commit) => !/^[0-9a-f]{40}$/.test(commit)) ||
      !pr2PermittedChangeClasses.has(entry.permitted_change_class) ||
      !materialKinds.has(entry.material_kind) ||
      !pr2MaterialClasses.has(entry.material_class) ||
      entry.authorization_effect !== 'durability-path-ownership-only' ||
      entry.ownership_authorizes_execution !== false ||
      entry.ownership_authorizes_deployment !== false ||
      entry.ownership_authorizes_credentials !== false ||
      entry.ownership_authorizes_production_change !== false
    ) {
      refusal(`malformed PR #2 ownership entry: ${entry?.path ?? '<missing path>'}`);
    }
  }

  const pr2EntryPaths = pr2Assignment.entries.map((entry) => entry.path);
  if (new Set(pr2EntryPaths).size !== pr2EntryPaths.length) {
    refusal('duplicate PR #2 ownership entry');
  }
  if (
    JSON.stringify([...pr2EntryPaths].sort()) !==
    JSON.stringify([...PR2_AUTHORIZED_PATHS].sort())
  ) {
    refusal('PR #2 ownership paths do not match the exact owner-authorized set');
  }

  for (const authorizedPath of PR2_AUTHORIZED_PATHS) {
    const exactOccurrences = allOwnedPaths.filter((pattern) => pattern === authorizedPath).length;
    if (exactOccurrences !== 1) {
      refusal(`PR #2 path must have exactly one exact ownership entry: ${authorizedPath}`);
    }
    const plannedOccurrences = ownership.planned_candidate_files.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (plannedOccurrences !== 1) {
      refusal(`PR #2 path must have exactly one planned-candidate entry: ${authorizedPath}`);
    }
  }

  const mission1Assignment = ownership.explicit_user_assignment[MISSION1_ASSIGNMENT];
  if (
    !exactKeys(mission1Assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'candidate_commit',
      'candidate_tree',
      'evidence_paths',
      'validator_paths',
      'approval_sha256',
    ]) ||
    mission1Assignment.authorization !==
      'CONTINUE CANA STAGE A AUTONOMOUS COMPLETION — DO NOT RETURN FOR THIS BLOCKER' ||
    mission1Assignment.candidate_commit !==
      'c05219c0b50ff02478168bf5619c85e467658153' ||
    mission1Assignment.candidate_tree !==
      '5ae987c33772716b6678c4f9c592a6056e820630' ||
    !Array.isArray(mission1Assignment.evidence_paths) ||
    !Array.isArray(mission1Assignment.validator_paths) ||
    JSON.stringify([...mission1Assignment.evidence_paths].sort()) !==
      JSON.stringify([...MISSION1_EVIDENCE_PATHS].sort()) ||
    JSON.stringify([...mission1Assignment.validator_paths].sort()) !==
      JSON.stringify([...MISSION1_VALIDATOR_PATHS].sort()) ||
    !mission1Assignment.scope.includes('no wildcard') ||
    !mission1Assignment.authorization_effect.includes('no runtime execution')
  ) {
    refusal('Mission 1 ownership assignment is malformed');
  }

  const mission1Paths = [
    ...mission1Assignment.evidence_paths,
    ...mission1Assignment.validator_paths,
  ];
  if (
    new Set(mission1Paths).size !== mission1Paths.length ||
    mission1Paths.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.includes('*') ||
        entry.includes('..') ||
        path.posix.normalize(entry) !== entry,
    )
  ) {
    refusal('Mission 1 ownership paths must be unique exact repository paths');
  }
  for (const authorizedPath of MISSION1_AUTHORIZED_PATHS) {
    const exactOccurrences = allOwnedPaths.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (exactOccurrences !== 1) {
      refusal(
        `Mission 1 path must have exactly one exact ownership entry: ${authorizedPath}`,
      );
    }
    const plannedOccurrences = ownership.planned_candidate_files.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (plannedOccurrences !== 1) {
      refusal(
        `Mission 1 path must have exactly one planned-candidate entry: ${authorizedPath}`,
      );
    }
  }

  const mission2Assignment = ownership.explicit_user_assignment[MISSION2_ASSIGNMENT];
  if (
    !exactKeys(mission2Assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'base_commit',
      'base_tree',
      'authorized_paths',
      'approval_sha256',
    ]) ||
    mission2Assignment.authorization !==
      'ACTIVATE CANA MISSION 2 — MINIMUM ALIVE LOOP AND AUTONOMY FOUNDATION' ||
    mission2Assignment.base_commit !==
      '70a7200fbdbfd46bdcef7143863e33caf6f9d6fe' ||
    mission2Assignment.base_tree !==
      'b7f979a2d1d82b9dbc0b23a015eefaa1402a1dec' ||
    !Array.isArray(mission2Assignment.authorized_paths) ||
    JSON.stringify([...mission2Assignment.authorized_paths].sort()) !==
      JSON.stringify([...MISSION2_AUTHORIZED_PATHS].sort()) ||
    !mission2Assignment.scope.includes('no wildcard') ||
    !mission2Assignment.authorization_effect.includes('no provider') ||
    !mission2Assignment.authorization_effect.includes('no production')
  ) {
    refusal('Mission 2 ownership assignment is malformed');
  }

  const mission2Paths = mission2Assignment.authorized_paths;
  if (
    new Set(mission2Paths).size !== mission2Paths.length ||
    mission2Paths.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.includes('*') ||
        entry.includes('..') ||
        path.posix.normalize(entry) !== entry,
    )
  ) {
    refusal('Mission 2 ownership paths must be unique exact repository paths');
  }
  for (const authorizedPath of MISSION2_AUTHORIZED_PATHS) {
    const exactOccurrences = allOwnedPaths.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (exactOccurrences !== 1) {
      refusal(
        `Mission 2 path must have exactly one exact ownership entry: ${authorizedPath}`,
      );
    }
    const plannedOccurrences = ownership.planned_candidate_files.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (plannedOccurrences !== 1) {
      refusal(
        `Mission 2 path must have exactly one planned-candidate entry: ${authorizedPath}`,
      );
    }
  }

  const mission3M001Assignment =
    ownership.explicit_user_assignment[MISSION3_M001_ASSIGNMENT];
  if (
    !exactKeys(mission3M001Assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'base_commit',
      'base_tree',
      'package_003_sha256',
      'handoff_hash',
      'authorized_paths',
      'approval_sha256',
    ]) ||
    mission3M001Assignment.authorization !==
      'ACTIVATE CANA MISSION 3 — M001 CANONICAL SHADOW SLICE' ||
    mission3M001Assignment.base_commit !==
      'c4d058f5602e6db2196cccba782e1daeaa3a3ce7' ||
    mission3M001Assignment.base_tree !==
      'e6d21f2b9303e33bd0c357c125269bf9619b63d0' ||
    mission3M001Assignment.package_003_sha256 !==
      '173e97573e43f97a1efcfd59b8c33edfb44de4d7afc11735c688c240cbd392fc' ||
    mission3M001Assignment.handoff_hash !==
      'baf1492a1aaa3290886b8f3cd77e68515fe15775618dc5fc173ed235a02b9cd3' ||
    !Array.isArray(mission3M001Assignment.authorized_paths) ||
    JSON.stringify([...mission3M001Assignment.authorized_paths].sort()) !==
      JSON.stringify([...MISSION3_M001_AUTHORIZED_PATHS].sort()) ||
    !mission3M001Assignment.scope.includes('no wildcard') ||
    !mission3M001Assignment.authorization_effect.includes('no live-data') ||
    !mission3M001Assignment.authorization_effect.includes('no provider') ||
    !mission3M001Assignment.authorization_effect.includes('no production')
  ) {
    refusal('Mission 3 M001 ownership assignment is malformed');
  }

  const mission3M001Paths = mission3M001Assignment.authorized_paths;
  if (
    new Set(mission3M001Paths).size !== mission3M001Paths.length ||
    mission3M001Paths.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.includes('*') ||
        entry.includes('..') ||
        path.posix.normalize(entry) !== entry,
    )
  ) {
    refusal('Mission 3 M001 ownership paths must be unique exact repository paths');
  }
  for (const authorizedPath of MISSION3_M001_AUTHORIZED_PATHS) {
    const exactOccurrences = allOwnedPaths.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (exactOccurrences !== 1) {
      refusal(
        `Mission 3 M001 path must have exactly one exact ownership entry: ${authorizedPath}`,
      );
    }
    const plannedOccurrences = ownership.planned_candidate_files.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (plannedOccurrences !== 1) {
      refusal(
        `Mission 3 M001 path must have exactly one planned-candidate entry: ${authorizedPath}`,
      );
    }
  }

  const pr29Assignment = ownership.explicit_user_assignment[PR29_ASSIGNMENT];
  if (
    !exactKeys(pr29Assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'authorized_paths',
      'court_blob_sha256',
      'approval_sha256',
    ]) ||
    !Array.isArray(pr29Assignment.authorized_paths) ||
    pr29Assignment.authorization_effect !==
      'Durability path ownership and exact reviewed-court-blob admission only; no external-effect authority.'
  ) {
    refusal('PR #29 recovery ownership assignment is malformed');
  }
  const pr29Paths = pr29Assignment.authorized_paths;
  if (
    new Set(pr29Paths).size !== pr29Paths.length ||
    pr29Paths.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.includes('*') ||
        entry.includes('..') ||
        path.posix.normalize(entry) !== entry,
    )
  ) {
    refusal('PR #29 recovery paths must be unique exact repository paths');
  }
  for (const authorizedPath of pr29Paths) {
    const exactOccurrences = allOwnedPaths.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (exactOccurrences !== 1) {
      refusal(`PR #29 path must have exactly one exact ownership entry: ${authorizedPath}`);
    }
  }
  const courtEntries = Object.entries(pr29Assignment.court_blob_sha256 ?? {});
  if (
    courtEntries.length !== 5 ||
    courtEntries.some(
      ([courtPath, digest]) =>
        !ownership.global_no_edit.includes(courtPath) ||
        !pr29Paths.includes(courtPath) ||
        !/^[0-9a-f]{64}$/.test(digest),
    )
  ) {
    refusal('PR #29 court blob admission is malformed');
  }

  const pr35Assignment = ownership.explicit_user_assignment[PR35_ASSIGNMENT];
  if (
    !exactKeys(pr35Assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'authorized_paths',
      'court_blob_sha256',
      'approval_sha256',
    ]) ||
    !Array.isArray(pr35Assignment.authorized_paths) ||
    pr35Assignment.authorization_effect !==
      'Durability path ownership and exact reviewed-court-blob admission only; no runtime execution, provider, credential, paid-call, deployment, production, external-effect, verification-bypass or self-promotion authority.'
  ) {
    refusal('PR #35 sovereign integration ownership assignment is malformed');
  }
  const pr35Paths = pr35Assignment.authorized_paths;
  if (
    JSON.stringify(pr35Paths) !== JSON.stringify(PR35_AUTHORIZED_PATHS) ||
    new Set(pr35Paths).size !== pr35Paths.length ||
    pr35Paths.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.includes('*') ||
        entry.includes('..') ||
        path.posix.normalize(entry) !== entry,
    )
  ) {
    refusal('PR #35 sovereign integration paths must be the exact reviewed repository paths');
  }
  for (const authorizedPath of pr35Paths) {
    const exactOccurrences = allOwnedPaths.filter((pattern) => pattern === authorizedPath).length;
    if (exactOccurrences !== 1) {
      refusal(`PR #35 path must have exactly one exact ownership entry: ${authorizedPath}`);
    }
  }
  const pr35CourtEntries = Object.entries(pr35Assignment.court_blob_sha256 ?? {});
  if (
    pr35CourtEntries.length !== 4 ||
    pr35CourtEntries.some(
      ([courtPath, digest]) =>
        !ownership.global_no_edit.includes(courtPath) ||
        !pr35Paths.includes(courtPath) ||
        !/^[0-9a-f]{64}$/.test(digest),
    )
  ) {
    refusal('PR #35 court blob admission is malformed');
  }

  const phaseBAssignment =
    ownership.explicit_user_assignment[PHASE_B_SLICE1_ASSIGNMENT];
  if (
    !exactKeys(phaseBAssignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'base_commit',
      'base_tree',
      'authorized_paths',
      'approval_sha256',
    ]) ||
    phaseBAssignment.authorization !==
      'CANA PHASE B OMEGA INFINITY REALITY COMPILER SLICE 1 EXECUTION' ||
    phaseBAssignment.base_commit !==
      '74dd042f572f64e1da3709f71e602a9c0cda1917' ||
    phaseBAssignment.base_tree !==
      '4596741c54beca9d20ae417877854e7cc39e1ff3' ||
    phaseBAssignment.authorization_effect !==
      'Durability path ownership only; no live-source, provider, credential, paid-call, spending, publishing, deployment, production, external-effect, verification-bypass, self-promotion or cognitive-promotion authority.' ||
    !Array.isArray(phaseBAssignment.authorized_paths) ||
    JSON.stringify(phaseBAssignment.authorized_paths) !==
      JSON.stringify(PHASE_B_SLICE1_AUTHORIZED_PATHS)
  ) {
    refusal('Phase B Reality Compiler ownership assignment is malformed');
  }
  const phaseBPaths = phaseBAssignment.authorized_paths;
  if (
    new Set(phaseBPaths).size !== phaseBPaths.length ||
    phaseBPaths.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.includes('*') ||
        entry.includes('..') ||
        path.posix.normalize(entry) !== entry,
    )
  ) {
    refusal('Phase B Reality Compiler paths must be unique exact repository paths');
  }
  for (const authorizedPath of phaseBPaths) {
    const exactOccurrences = allOwnedPaths.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (exactOccurrences !== 1) {
      refusal(
        `Phase B path must have exactly one exact ownership entry: ${authorizedPath}`,
      );
    }
    const plannedOccurrences = ownership.planned_candidate_files.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (plannedOccurrences !== 1) {
      refusal(
        `Phase B path must have exactly one planned-candidate entry: ${authorizedPath}`,
      );
    }
  }

  const phaseBSlice2Assignment =
    ownership.explicit_user_assignment[PHASE_B_SLICE2_ASSIGNMENT];
  if (
    !exactKeys(phaseBSlice2Assignment, [
      'authorization',
      'scope',
      'authorization_effect',
      'base_commit',
      'base_tree',
      'authorized_paths',
      'court_blob_sha256',
      'approval_sha256',
    ]) ||
    phaseBSlice2Assignment.authorization !==
      'CANA PHASE B SLICE 2 OMEGA INFINITY LIVE REALITY ACQUISITION EXECUTION' ||
    phaseBSlice2Assignment.base_commit !==
      'e3139d960b837a8ea7ef7f01acfab5111dd96cc7' ||
    phaseBSlice2Assignment.base_tree !==
      '5b6c4b85d613d1de71879bc7e27b63cb96ba7405' ||
    phaseBSlice2Assignment.authorization_effect !==
      'Durability path ownership plus one operator-opted, fixed-origin, bounded, read-only DC ABCA public acquisition; no generic network/provider, credential, paid-call, spending, publishing, deployment, production, external-write, verification-bypass, authority-policy, self-promotion or cognitive-promotion authority.' ||
    !Array.isArray(phaseBSlice2Assignment.authorized_paths) ||
    JSON.stringify(phaseBSlice2Assignment.authorized_paths) !==
      JSON.stringify(PHASE_B_SLICE2_AUTHORIZED_PATHS)
  ) {
    refusal('Phase B Slice 2 ownership assignment is malformed');
  }
  const phaseBSlice2Paths = phaseBSlice2Assignment.authorized_paths;
  if (
    new Set(phaseBSlice2Paths).size !== phaseBSlice2Paths.length ||
    JSON.stringify(phaseBSlice2Paths) !==
      JSON.stringify([...phaseBSlice2Paths].sort()) ||
    phaseBSlice2Paths.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.startsWith('/') ||
        entry.includes('\\') ||
        entry.includes('*') ||
        entry.includes('..') ||
        path.posix.normalize(entry) !== entry,
    )
  ) {
    refusal('Phase B Slice 2 paths must be unique exact repository paths');
  }
  for (const authorizedPath of phaseBSlice2Paths) {
    const exactOccurrences = allOwnedPaths.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (exactOccurrences !== 1) {
      refusal(
        `Phase B Slice 2 path must have exactly one exact ownership entry: ${authorizedPath}`,
      );
    }
    const plannedOccurrences = ownership.planned_candidate_files.filter(
      (pattern) => pattern === authorizedPath,
    ).length;
    if (plannedOccurrences !== 1) {
      refusal(
        `Phase B Slice 2 path must have exactly one planned-candidate entry: ${authorizedPath}`,
      );
    }
  }
  const phaseBSlice2CourtEntries = Object.entries(
    phaseBSlice2Assignment.court_blob_sha256 ?? {},
  );
  if (
    phaseBSlice2CourtEntries.length !== 1 ||
    phaseBSlice2CourtEntries[0][0] !== 'apps/web/tests/migration-court.test.mjs' ||
    !ownership.global_no_edit.includes(phaseBSlice2CourtEntries[0][0]) ||
    !/^[0-9a-f]{64}$/.test(phaseBSlice2CourtEntries[0][1])
  ) {
    refusal('Phase B Slice 2 court blob admission is malformed');
  }

  const ownershipDigest = sha256Bytes(canonicalJson({
    root_dispatcher: ownership.explicit_user_assignment.root_dispatcher,
    owned_create_paths: ownership.owned_create_paths,
    owned_modify_paths: ownership.owned_modify_paths,
  }));
  if (ownershipDigest !== CHANGED_FILE_OWNERSHIP_SHA256) {
    refusal('changed-file ownership patterns failed the owner-approved scope digest');
  }

  const { approval_sha256: pr29RecordedDigest, ...pr29ApprovalPayload } =
    pr29Assignment;
  const pr29ActualDigest = sha256Bytes(canonicalJson(pr29ApprovalPayload));
  if (
    pr29RecordedDigest !== PR29_ASSIGNMENT_SHA256 ||
    pr29ActualDigest !== PR29_ASSIGNMENT_SHA256
  ) {
    refusal('PR #29 recovery assignment failed its owner-approval digest');
  }
  const { approval_sha256: pr35RecordedDigest, ...pr35ApprovalPayload } =
    pr35Assignment;
  const pr35ActualDigest = sha256Bytes(canonicalJson(pr35ApprovalPayload));
  if (
    pr35RecordedDigest !== PR35_ASSIGNMENT_SHA256 ||
    pr35ActualDigest !== PR35_ASSIGNMENT_SHA256
  ) {
    refusal('PR #35 sovereign integration assignment failed its owner-approval digest');
  }
  const {
    approval_sha256: phaseBRecordedDigest,
    ...phaseBApprovalPayload
  } = phaseBAssignment;
  const phaseBActualDigest = sha256Bytes(canonicalJson(phaseBApprovalPayload));
  if (
    phaseBRecordedDigest !== PHASE_B_SLICE1_ASSIGNMENT_SHA256 ||
    phaseBActualDigest !== PHASE_B_SLICE1_ASSIGNMENT_SHA256
  ) {
    refusal('Phase B Reality Compiler assignment failed its owner-approval digest');
  }
  const {
    approval_sha256: phaseBSlice2RecordedDigest,
    ...phaseBSlice2ApprovalPayload
  } = phaseBSlice2Assignment;
  const phaseBSlice2ActualDigest = sha256Bytes(
    canonicalJson(phaseBSlice2ApprovalPayload),
  );
  if (
    phaseBSlice2RecordedDigest !== PHASE_B_SLICE2_ASSIGNMENT_SHA256 ||
    phaseBSlice2ActualDigest !== PHASE_B_SLICE2_ASSIGNMENT_SHA256
  ) {
    refusal('Phase B Slice 2 assignment failed its owner-approval digest');
  }

  const { approval_sha256: pr2RecordedDigest, ...pr2ApprovalPayload } = pr2Assignment;
  const pr2ActualDigest = sha256Bytes(canonicalJson(pr2ApprovalPayload));
  if (
    pr2RecordedDigest !== PR2_ASSIGNMENT_SHA256 ||
    pr2ActualDigest !== PR2_ASSIGNMENT_SHA256
  ) {
    refusal('PR #2 ownership assignment failed its owner-approval digest');
  }
  const {
    approval_sha256: mission1RecordedDigest,
    ...mission1ApprovalPayload
  } = mission1Assignment;
  const mission1ActualDigest = sha256Bytes(
    canonicalJson(mission1ApprovalPayload),
  );
  if (
    mission1RecordedDigest !== MISSION1_ASSIGNMENT_SHA256 ||
    mission1ActualDigest !== MISSION1_ASSIGNMENT_SHA256
  ) {
    refusal('Mission 1 ownership assignment failed its owner-approval digest');
  }
  const {
    approval_sha256: mission2RecordedDigest,
    ...mission2ApprovalPayload
  } = mission2Assignment;
  const mission2ActualDigest = sha256Bytes(
    canonicalJson(mission2ApprovalPayload),
  );
  if (
    mission2RecordedDigest !== MISSION2_ASSIGNMENT_SHA256 ||
    mission2ActualDigest !== MISSION2_ASSIGNMENT_SHA256
  ) {
    refusal('Mission 2 ownership assignment failed its owner-approval digest');
  }
  const {
    approval_sha256: mission3M001RecordedDigest,
    ...mission3M001ApprovalPayload
  } = mission3M001Assignment;
  const mission3M001ActualDigest = sha256Bytes(
    canonicalJson(mission3M001ApprovalPayload),
  );
  if (
    mission3M001RecordedDigest !== MISSION3_M001_ASSIGNMENT_SHA256 ||
    mission3M001ActualDigest !== MISSION3_M001_ASSIGNMENT_SHA256
  ) {
    refusal('Mission 3 M001 ownership assignment failed its owner-approval digest');
  }
  return assignment;
}

export function pr2OwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[PR2_ASSIGNMENT];
}

export function mission1OwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[MISSION1_ASSIGNMENT];
}

export function mission2OwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[MISSION2_ASSIGNMENT];
}

export function mission3M001OwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[MISSION3_M001_ASSIGNMENT];
}

export function ownershipPatterns(ownership) {
  validateOwnershipManifest(ownership);
  return [
    ownership.explicit_user_assignment.root_dispatcher,
    ...ownership.owned_create_paths,
    ...ownership.owned_modify_paths,
  ];
}

export function pr29OwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[PR29_ASSIGNMENT];
}

export function pr35OwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[PR35_ASSIGNMENT];
}

export function phaseBRealityCompilerOwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[PHASE_B_SLICE1_ASSIGNMENT];
}

export function phaseBSlice2OwnershipAssignment(ownership) {
  validateOwnershipManifest(ownership);
  return ownership.explicit_user_assignment[PHASE_B_SLICE2_ASSIGNMENT];
}

export function courtEditAdmitted(relative, ownership, bytes, assignmentName) {
  validateOwnershipManifest(ownership);
  const assignment = ownership.explicit_user_assignment[assignmentName];
  const admittedDigest = assignment?.court_blob_sha256?.[relative];
  if (!ownership.global_no_edit.includes(relative) || !admittedDigest) return false;
  const content = bytes ?? fs.readFileSync(path.join(ROOT, relative));
  return admittedDigest === sha256Bytes(content);
}

export function unownedPaths(changed, ownership) {
  const patterns = ownershipPatterns(ownership);
  return changed.filter((file) => !patterns.some((pattern) => matchOwned(file, pattern)));
}

function prerequisites(source) {
  if (source.status) refusal(`durability operation refuses a dirty source:\n${source.status}`);
  if (command('git', ['merge-base', '--is-ancestor', BASE, source.commit], { allowFailure: true }).status !== 0) {
    refusal(`base commit ${BASE} is not an ancestor of ${source.commit}`);
  }
  const fsck = command('git', ['fsck', '--full', '--no-progress'], {
    allowFailure: true,
    timeout: 180_000,
  });
  if (fsck.status !== 0 || /missing|broken|error/i.test(fsck.stdout + fsck.stderr)) {
    refusal(`git integrity failed:\n${fsck.stdout}${fsck.stderr}`);
  }
  const ownership = readJson(
    path.join(ROOT, 'tools', 'test-runner', 'CODEX_CHANGED_FILE_OWNERSHIP.json'),
  );
  validateOwnershipManifest(ownership);
  const changed = git(['diff', '--name-only', `${BASE}..${source.commit}`])
    .split('\n')
    .filter(Boolean);
  const prohibited = changed.filter((file) => {
    if (!ownership.global_no_edit.includes(file)) return false;
    if (!fs.existsSync(path.join(ROOT, file))) return true;
    const digest = sha256File(path.join(ROOT, file));
    return !Object.values(ownership.explicit_user_assignment).some(
      (assignment) => assignment?.court_blob_sha256?.[file] === digest,
    );
  });
  if (prohibited.length) refusal(`prohibited paths changed:\n${prohibited.join('\n')}`);
  const unowned = unownedPaths(changed, ownership);
  if (unowned.length) refusal(`outgoing paths lack lane ownership:\n${unowned.join('\n')}`);
  return { changed, fsck: 'PASS', prohibited: [], unowned: [] };
}

function scanSecrets(text) {
  const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
    ['openai-token', /\bsk-[A-Za-z0-9_-]{32,255}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['stripe-live-key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,255}\b/g],
  ];
  const findings = [];
  for (const [kind, pattern] of patterns) {
    const count = [...text.matchAll(pattern)].length;
    if (count) findings.push({ kind, count });
  }
  return findings;
}

function largeFiles(commit) {
  return git(['ls-tree', '-r', '-l', commit])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+\s+\w+\s+([0-9a-f]+)\s+(\d+|-)\t(.+)$/);
      return match && match[2] !== '-' ? { oid: match[1], bytes: Number(match[2]), path: match[3] } : null;
    })
    .filter((entry) => entry && entry.bytes >= 10 * 1024 * 1024)
    .sort((left, right) => right.bytes - left.bytes);
}

function artifactForCurrent(source) {
  return path.join(stateRoot(), 'artifacts', source.commit);
}

function resolveArtifact(source, parsed) {
  const artifact = path.resolve(parsed.artifact ?? artifactForCurrent(source));
  if (!fs.existsSync(path.join(artifact, 'manifest.json'))) {
    refusal(`no built durability artifact for ${source.commit}; run ./cana durability build first`);
  }
  return artifact;
}

function checksums(artifact) {
  const lines = fs.readFileSync(path.join(artifact, 'SHA256SUMS.txt'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  return lines.map((line) => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error(`invalid checksum line: ${line}`);
    const file = path.join(artifact, match[2]);
    return {
      file: match[2],
      expected: match[1],
      actual: sha256File(file),
      pass: match[1] === sha256File(file),
    };
  });
}

function tarballFor(artifact) {
  return `${artifact}.tar.gz`;
}

function durabilityStatus() {
  const source = identity();
  const base = readJson(BASE_RECEIPT);
  const uploadStateFile = path.join(stateRoot(), 'upload-state.json');
  const upload = fs.existsSync(uploadStateFile) ? readJson(uploadStateFile) : null;
  const recordedCandidateRoundTrip =
    upload?.commit === source.commit &&
    upload?.tree === source.tree &&
    upload?.readback?.sha256 === upload?.artifactSha256 &&
    upload?.readback?.verified === true;
  const atVerifiedBase = source.commit === base.commit && base.remote.uploadDownloadHashRoundTripVerified;
  const state = atVerifiedBase ? 'REMOTELY_DURABLE' : 'LOCAL_ONLY_CANDIDATE';
  const ahead = Number(git(['rev-list', '--count', `${BASE}..${source.commit}`]));
  const body = {
    schemaVersion: 1,
    state,
    current: source,
    remotelyDurableFrontier: base.commit,
    baseCorrection: {
      archive: base.archive,
      driveFileId: base.remote.driveFileId,
      historicalReceiptModified: false,
    },
    candidateCommitsBeyondBase: ahead,
    candidateRoundTrip: false,
    recordedCandidateRoundTrip,
    candidateStatusClaim:
      recordedCandidateRoundTrip
        ? 'A local round-trip record exists but is not trusted by passive status. Run a fresh signed readback to earn a REMOTELY_DURABLE receipt.'
        : 'No candidate remote round trip is proven.',
  };
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  return body;
}

function buildDurability() {
  const source = identity();
  const preflight = prerequisites(source);
  const historyPatch = git([
    'log',
    '--format=commit %H%nAuthor: %an <%ae>%nDate: %aI%n',
    '-p',
    '--binary',
    `${BASE}..${source.commit}`,
  ]);
  const secretFindings = scanSecrets(historyPatch);
  if (secretFindings.length) {
    refusal(`outgoing-history secret scan failed: ${JSON.stringify(secretFindings)}`);
  }
  const artifact = artifactForCurrent(source);
  if (fs.existsSync(artifact)) refusal(`durability artifact already exists: ${artifact}`);
  fs.mkdirSync(artifact, { recursive: true, mode: 0o700 });
  const bundle = path.join(artifact, 'repo.bundle');
  const patch = path.join(artifact, 'outgoing.patch');
  const mailbox = path.join(artifact, 'commits.mbox');
  command('git', ['bundle', 'create', bundle, 'HEAD'], { timeout: 180_000 });
  fs.writeFileSync(
    patch,
    command('git', ['diff', '--binary', BASE, source.commit]).stdout,
    { encoding: 'utf8', mode: 0o600 },
  );
  fs.writeFileSync(
    mailbox,
    command('git', ['format-patch', '--stdout', '--binary', `${BASE}..${source.commit}`]).stdout,
    { encoding: 'utf8', mode: 0o600 },
  );
  const manifest = {
    schemaVersion: 1,
    kind: 'CANA candidate durability artifact',
    createdAt: new Date().toISOString(),
    source,
    baseCommit: BASE,
    baseTree: git(['rev-parse', `${BASE}^{tree}`]),
    preflight,
    secretScan: {
      scope: `all outgoing commit patches ${BASE}..${source.commit}`,
      status: 'PASS',
      findings: [],
      historyPatchSha256: sha256Bytes(historyPatch),
    },
    largeFiles: {
      thresholdBytes: 10 * 1024 * 1024,
      entries: largeFiles(source.commit),
    },
    restoration: {
      bundle: 'repo.bundle',
      binaryPatch: 'outgoing.patch',
      commitMailbox: 'commits.mbox',
    },
    remoteState: 'NOT_UPLOADED',
  };
  writeJson(path.join(artifact, 'manifest.json'), manifest);
  const payloadFiles = ['repo.bundle', 'outgoing.patch', 'commits.mbox', 'manifest.json'];
  const sumBody = payloadFiles
    .map((file) => `${sha256File(path.join(artifact, file))}  ${file}`)
    .join('\n');
  fs.writeFileSync(path.join(artifact, 'SHA256SUMS.txt'), `${sumBody}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  const bundleVerify = command('git', ['bundle', 'verify', bundle], {
    allowFailure: true,
    timeout: 180_000,
  });
  if (bundleVerify.status !== 0) {
    refusal(`git bundle verification failed:\n${bundleVerify.stdout}${bundleVerify.stderr}`);
  }
  const tarball = tarballFor(artifact);
  command('tar', ['-czf', tarball, '-C', path.dirname(artifact), path.basename(artifact)], {
    timeout: 180_000,
  });
  const result = {
    artifact,
    tarball,
    tarballBytes: fs.statSync(tarball).size,
    tarballSha256: sha256File(tarball),
    bundleSha256: sha256File(bundle),
    secretScan: 'PASS',
    remoteState: 'NOT_UPLOADED',
  };
  writeJson(path.join(stateRoot(), 'latest-build.json'), { commit: source.commit, ...result });
  const receipt = writeReceipt('durability-build', {
    overall: 'PASS',
    source,
    ...result,
  });
  process.stdout.write(`${JSON.stringify({ ...result, receipt }, null, 2)}\n`);
  return result;
}

function verifyDurability(parsed) {
  const source = identity();
  prerequisites(source);
  const artifact = resolveArtifact(source, parsed);
  const manifest = readJson(path.join(artifact, 'manifest.json'));
  const sumChecks = checksums(artifact);
  if (sumChecks.some((entry) => !entry.pass)) {
    refusal(`durability checksums failed: ${JSON.stringify(sumChecks.filter((entry) => !entry.pass))}`);
  }
  const bundle = path.join(artifact, 'repo.bundle');
  const verifyBundle = command('git', ['bundle', 'verify', bundle], {
    allowFailure: true,
    timeout: 180_000,
  });
  if (verifyBundle.status !== 0) refusal(`bundle verify failed:\n${verifyBundle.stderr}`);
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-durability-verify-'));
  const clone = path.join(runRoot, 'bundle-clone');
  const patchClone = path.join(runRoot, 'patch-clone');
  let focused;
  try {
    command('git', ['clone', '--quiet', bundle, clone], { timeout: 180_000 });
    command('git', ['checkout', '--quiet', manifest.source.commit], { cwd: clone });
    command('git', ['fsck', '--full', '--no-progress'], { cwd: clone, timeout: 180_000 });
    const cloneTree = command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: clone }).stdout.trim();
    if (cloneTree !== manifest.source.tree) {
      refusal(`bundle reconstruction tree mismatch: ${cloneTree}`);
    }
    command('git', ['clone', '--quiet', '--no-checkout', bundle, patchClone], { timeout: 180_000 });
    command('git', ['checkout', '--quiet', manifest.baseCommit], { cwd: patchClone });
    command('git', ['apply', '--index', '--binary', path.join(artifact, 'outgoing.patch')], {
      cwd: patchClone,
      timeout: 180_000,
    });
    const patchTree = command('git', ['write-tree'], { cwd: patchClone }).stdout.trim();
    if (patchTree !== manifest.source.tree) {
      refusal(`binary-patch reconstruction tree mismatch: ${patchTree}`);
    }
    const focusedEnv = {
      ...process.env,
      CANA_RECEIPT_DIR: path.join(runRoot, 'focused-receipts'),
    };
    delete focusedEnv.CANA_RECEIPT_SESSION;
    focused = command(path.join(clone, 'cana'), ['verify', 'focused'], {
      cwd: clone,
      allowFailure: true,
      timeout: 15 * 60_000,
      env: focusedEnv,
    });
    if (focused.status !== 0) {
      refusal(`focused execution in reconstructed clone failed:\n${focused.stdout}${focused.stderr}`);
    }
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  const receipt = writeReceipt('durability-verify', {
    overall: 'PASS',
    source,
    artifact,
    checksumCount: sumChecks.length,
    bundle: 'PASS',
    gitFsck: 'PASS',
    bundleReconstructionTree: manifest.source.tree,
    binaryPatchReconstructionTree: manifest.source.tree,
    focusedExecution: {
      status: 'PASS',
      outputSha256: sha256Bytes(focused.stdout + focused.stderr),
      outputTail: (focused.stdout + focused.stderr).slice(-2_000),
    },
  });
  process.stdout.write(`${JSON.stringify({ overall: 'PASS', artifact, receipt }, null, 2)}\n`);
  return receipt.body;
}

function restoreDurability(parsed) {
  const source = identity();
  const artifact = resolveArtifact(source, parsed);
  const manifest = readJson(path.join(artifact, 'manifest.json'));
  const target = path.resolve(
    parsed.target ??
    path.join(os.tmpdir(), `cana-restored-${manifest.source.commit.slice(0, 12)}-${crypto.randomBytes(4).toString('hex')}`),
  );
  if (fs.existsSync(target)) refusal(`restore target already exists; refusing to overwrite: ${target}`);
  const sumChecks = checksums(artifact);
  if (sumChecks.some((entry) => !entry.pass)) refusal('restore refused because artifact checksums failed');
  command('git', ['clone', '--quiet', path.join(artifact, 'repo.bundle'), target], { timeout: 180_000 });
  command('git', ['checkout', '--quiet', manifest.source.commit], { cwd: target });
  command('git', ['fsck', '--full', '--no-progress'], { cwd: target, timeout: 180_000 });
  const restored = {
    commit: command('git', ['rev-parse', 'HEAD'], { cwd: target }).stdout.trim(),
    tree: command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: target }).stdout.trim(),
    status: command('git', ['status', '--porcelain'], { cwd: target }).stdout.trim(),
  };
  if (
    restored.commit !== manifest.source.commit ||
    restored.tree !== manifest.source.tree ||
    restored.status
  ) {
    refusal(`restored identity mismatch: ${JSON.stringify(restored)}`);
  }
  const receipt = writeReceipt('durability-restore', {
    overall: 'PASS',
    artifact,
    target,
    restored,
    overwritten: false,
  });
  process.stdout.write(`${JSON.stringify({ target, restored, receipt }, null, 2)}\n`);
  return receipt.body;
}

function remoteTransport(remote, source, destination, direction) {
  const url = new URL(remote);
  if (url.username || url.password || url.search || url.hash) {
    refusal('remote URL must not contain credentials, query parameters, or fragments');
  }
  if (url.protocol === 's3:') {
    return {
      command: 'aws',
      args: direction === 'upload'
        ? ['s3', 'cp', source, remote]
        : ['s3', 'cp', remote, destination],
      sanitized: `s3://${url.host}${url.pathname}`,
    };
  }
  if (url.protocol === 'ssh:') {
    if (!url.hostname || !url.pathname.startsWith('/')) refusal('ssh remote needs a host and absolute path');
    const endpoint = `${url.hostname}:${url.pathname}`;
    return {
      command: 'scp',
      args: direction === 'upload' ? [source, endpoint] : [endpoint, destination],
      sanitized: `ssh://${url.hostname}${url.pathname}`,
    };
  }
  refusal('supported remote transports are s3:// and ssh:// only');
}

function configuredOwnerKey(parsed) {
  if (!parsed.approval) {
    refusal('operation requires a signed owner approval envelope');
  }
  if (!fs.existsSync(OWNER_KEY_FILE) || !fs.existsSync(OWNER_KEY_ID_FILE)) {
    refusal('owner approval trust anchor is absent; Chief Integrator reassignment is required');
  }
  for (const file of [OWNER_KEY_FILE, OWNER_KEY_ID_FILE]) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
      refusal(`owner trust material is not root-owned and write-protected: ${file}`);
    }
  }
  const publicKey = crypto.createPublicKey(fs.readFileSync(OWNER_KEY_FILE, 'utf8'));
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    refusal('owner trust anchor must be an Ed25519 public key');
  }
  const keyId = fs.readFileSync(OWNER_KEY_ID_FILE, 'utf8').trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) {
    refusal('owner key ID is invalid');
  }
  return { keyId, publicKey };
}

function ownerApproval(parsed, expected, key = configuredOwnerKey(parsed)) {
  const envelope = readJson(path.resolve(parsed.approval));
  const payload = {
    schemaVersion: 1,
    action: expected.action,
    commit: expected.commit,
    tree: expected.tree,
    remote: expected.remote,
    artifactSha256: expected.artifactSha256,
    ...(expected.uploadedAt ? { uploadedAt: expected.uploadedAt } : {}),
    approvalId: envelope.payload?.approvalId,
    approvedBy: envelope.payload?.approvedBy,
    expiresAt: envelope.payload?.expiresAt,
  };
  if (
    envelope.schemaVersion !== 1 ||
    envelope.keyId !== key.keyId ||
    envelope.algorithm !== 'Ed25519' ||
    JSON.stringify(envelope.payload) !== JSON.stringify(payload) ||
    typeof envelope.signature !== 'string'
  ) {
    refusal('owner approval envelope does not exactly bind this operation');
  }
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    refusal('owner approval envelope is expired or has an invalid expiry');
  }
  const signed = Buffer.from(JSON.stringify(payload));
  const signature = Buffer.from(envelope.signature, 'base64');
  if (!crypto.verify(null, signed, key.publicKey, signature)) {
    refusal('owner approval signature is invalid');
  }
  return {
    keyId: key.keyId,
    approvalId: payload.approvalId,
    approvedBy: payload.approvedBy,
    expiresAt: payload.expiresAt,
    payloadSha256: sha256Bytes(signed),
  };
}

function uploadDurability(parsed) {
  const remote = parsed.remote ?? process.env.CANA_DURABILITY_REMOTE;
  if (!remote) refusal('upload requires remote configuration');
  const key = configuredOwnerKey(parsed);
  const source = identity();
  prerequisites(source);
  const artifact = resolveArtifact(source, parsed);
  const tarball = tarballFor(artifact);
  if (!fs.existsSync(tarball)) refusal(`artifact tarball is missing: ${tarball}`);
  const transport = remoteTransport(remote, tarball, null, 'upload');
  const artifactSha256 = sha256File(tarball);
  const approval = ownerApproval(parsed, {
    action: 'durability-upload',
    commit: source.commit,
    tree: source.tree,
    remote: transport.sanitized,
    artifactSha256,
  }, key);
  command(transport.command, transport.args, { timeout: 30 * 60_000 });
  const state = {
    schemaVersion: 1,
    commit: source.commit,
    tree: source.tree,
    remote: transport.sanitized,
    artifact: tarball,
    artifactSha256,
    uploadedAt: new Date().toISOString(),
    approval,
    readback: null,
    state: 'UPLOAD_RECORDED_READBACK_PENDING',
  };
  writeJson(path.join(stateRoot(), 'upload-state.json'), state);
  const receipt = writeReceipt('durability-upload', {
    overall: 'PASS',
    ...state,
  });
  process.stdout.write(`${JSON.stringify({ ...state, receipt }, null, 2)}\n`);
  return state;
}

function readbackDurability(parsed) {
  const stateFile = path.join(stateRoot(), 'upload-state.json');
  if (!fs.existsSync(stateFile)) refusal('readback requires a recorded upload');
  const source = identity();
  prerequisites(source);
  const state = readJson(stateFile);
  if (state.commit !== source.commit || state.tree !== source.tree) {
    refusal('readback state does not belong to the current commit and tree');
  }
  const approval = ownerApproval(parsed, {
    action: 'durability-readback',
    commit: state.commit,
    tree: state.tree,
    remote: state.remote,
    artifactSha256: state.artifactSha256,
    uploadedAt: state.uploadedAt,
  });
  const destination = path.join(
    os.tmpdir(),
    `cana-durability-readback-${crypto.randomBytes(8).toString('hex')}.tar.gz`,
  );
  const transport = remoteTransport(state.remote, null, destination, 'readback');
  try {
    command(transport.command, transport.args, { timeout: 30 * 60_000 });
    const downloaded = sha256File(destination);
    if (downloaded !== state.artifactSha256) {
      refusal(`remote readback hash mismatch: expected ${state.artifactSha256}, got ${downloaded}`);
    }
    state.readback = {
      verified: true,
      sha256: downloaded,
      bytes: fs.statSync(destination).size,
      verifiedAt: new Date().toISOString(),
      approval,
    };
    state.state = 'REMOTELY_DURABLE';
    writeJson(stateFile, state);
  } finally {
    fs.rmSync(destination, { force: true });
  }
  const receipt = writeReceipt('durability-readback', {
    overall: 'PASS',
    ...state,
  });
  process.stdout.write(`${JSON.stringify({ ...state, receipt }, null, 2)}\n`);
  return state;
}

export async function runDurability(action, args = []) {
  const parsed = parseArgs(args);
  if (action === 'status') return durabilityStatus();
  if (action === 'build') return buildDurability();
  if (action === 'verify') return verifyDurability(parsed);
  if (action === 'restore') return restoreDurability(parsed);
  if (action === 'upload') return uploadDurability(parsed);
  if (action === 'readback') return readbackDurability(parsed);
  throw Object.assign(new Error(`unknown durability action: ${action}`), { exitCode: 2 });
}
