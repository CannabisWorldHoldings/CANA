// tools/authority/court-fixtures.mjs — shared, REAL mission-2 fixtures for the authority courts.
// Built from the merged tree's own mission-2 module schemas (byte-identical to the conserved copies
// the tournament used). No mocking of the decision functions — only the mission/context envelope.

import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileMinimalContext } from '../mission-2/context.mjs';
import { createMissionContract } from '../mission-2/contracts.mjs';
import { sha256 } from '../mission-2/canonical.mjs';
import { provisionDevOwnerRoot, devOwnerSigner, ownerRootVerifier } from './signer.mjs';
import { ContainmentStore } from './containment.mjs';

export const NOW = new Date('2026-07-29T09:00:00.000Z');
export const EXPIRES = '2026-07-30T09:00:00.000Z';
export const TENANT = 'tenant_cana';
export const WORKSPACE = 'workspace_shadow';
export const EXECUTOR = 'DETERMINISTIC_MOCK_EXECUTOR_V1';
export const VERIFIER = 'INDEPENDENT_FALSIFICATION_VERIFIER_V1';
export const TARGET = 'docs/status.md';
const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const EV = sha256('protected-base-receipt');

export function seed(over = {}) {
  return {
    mission_id: 'mission_court', tenant_id: TENANT, workspace_id: WORKSPACE,
    objective: 'Correct the stale canonical verification status without erasing historical context',
    source_repository: 'CannabisWorldHoldings/CANA', source_commit: COMMIT, source_tree: TREE,
    permitted_files: [TARGET], ...over,
  };
}
export function fact(over = {}) {
  return {
    id: 'fact_stale_status',
    claim: 'The status document says canonical checks are unproven although exact protected-base receipts prove they passed.',
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT', truth_status: 'VERIFIED',
    source: 'CANA protected-base receipt', observed_at: '2026-07-29T08:00:00.000Z', valid_for_days: 1,
    tags: ['subject:canonical-status'], tenant_id: TENANT, workspace_id: WORKSPACE,
    source_commit: COMMIT, source_tree: TREE, evidence_sha256: EV, target_files: [TARGET],
    provenance_status: 'CURRENT_VERIFIED', ...over,
  };
}
export function contextPacket(over = {}) {
  return compileMinimalContext({ mission: seed(over.missionOver), facts: [fact(over.factOver)], now: NOW });
}
export function mission(packet, over = {}) {
  return createMissionContract({
    mission_id: 'mission_court', tenant_id: TENANT, workspace_id: WORKSPACE,
    mission_type: 'STALE_REGISTERED_PROJECT_FACT', objective: seed().objective,
    originating_signal: { signal_id: 'signal_court', evidence_ref: `sha256:${EV}` },
    source_repository: 'CannabisWorldHoldings/CANA', source_commit: COMMIT, source_tree: TREE,
    source_evidence_references: [`sha256:${EV}`],
    context_compiler_version: 'sitemind-context-compiler/mission-2-adapter-1',
    context_packet_hash: packet.packet_hash,
    authority_identity: 'CANA_DURABLE_AUTHORITY', authorization_identity: 'CANA_AUTHORIZATION_EVALUATOR_V1',
    permitted_files: [TARGET], permitted_resources: ['ISOLATED_GIT_WORKTREE'],
    permitted_capabilities: ['READ_REPOSITORY', 'RUN_TESTS', 'WRITE_LOCAL_BRANCH'],
    provider_state: 'NONE', hermes_state: 'DISABLED', approved_hermes_pin: 'NONE',
    budget: { currency: 'USD', maximum: 0, spent: 0 },
    external_effect_policy: 'NONE', production_access: 'NONE', timeout_ms: 60000, expires_at: EXPIRES,
    success_criteria: ['Insert the exact supersession notice once', 'Preserve all historical bytes after the insertion point'],
    verifier_identity: VERIFIER,
    verification_contract: { operation: { kind: 'REPLACE_EXACT_TEXT', path: TARGET, find: 'Canonical checks are unproven.', replace: 'Superseded: canonical checks are verified.' }, expected_text: 'Superseded:' },
    rollback_procedure: { kind: 'EXACT_BYTES', description: 'Restore the exact pre-mission bytes and verify their SHA-256' },
    current_lifecycle_state: 'MISSION_SEALED', latest_checkpoint: null, execution_attempts: [],
    evidence_references: [], failure_history: [], promotion_status: 'NOT_EVALUATED', next_eligible_action: 'AUTHORIZE',
    ...over,
  });
}

export function buildM2(over = {}) {
  const mo = {
    mission_id: over.missionId ?? 'mission_court',
    ...(over.tenant ? { tenant_id: over.tenant } : {}),
    ...(over.verifierIdentity ? { verifier_identity: over.verifierIdentity } : {}),
    ...(over.mo ?? {}),
  };
  const pkt = contextPacket(over.ctx);
  const m = mission(pkt, mo);
  return { pkt, m };
}

// A real Ed25519 lease authority (mirrors MissionStore.leaseAuthority()).
export function leaseAuthority() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return {
    publicKey: spki, keyId: createHash('sha256').update(Buffer.from(spki, 'base64')).digest('hex'),
    sign: (bytes) => edSign(null, bytes, privateKey).toString('base64'),
  };
}

// A fully-wired, isolated authority environment for a court: temp state dir, owner root, a seeded
// containment authorization + capability + budget matching the Hermes capability vocabulary.
export function makeEnv({ env = process.env, capActions = ['WRITE_LOCAL_BRANCH', 'RUN_TESTS', 'READ_REPOSITORY'], capResources = ['docs/*'], authResources = ['docs/*'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cana-authority-court-'));
  const stateDir = join(root, 'state');
  const ownerRoot = join(root, 'owner');
  provisionDevOwnerRoot(ownerRoot, { env });
  const signer = devOwnerSigner(ownerRoot, { env });
  const verifier = ownerRootVerifier(ownerRoot, { env });
  const store = new ContainmentStore(stateDir);
  store.setBudget('calls', 1000);
  const authId = 'auth_seed';
  const capId = 'cap_seed';
  store.issueAuthorization({
    id: authId, actor_id: 'actor_owner', tenant_id: TENANT, site_id: 'site_1',
    allowed_actions: [...capActions], allowed_resources: [...authResources],
    financial_budget: 0, runtime_budget: 1000, call_budget: 1000, delegation_depth: 2,
    issued_at: NOW.toISOString(), not_before: null, expires_at: EXPIRES,
  });
  store.issueCapability({
    id: capId, worker_id: 'worker_1', authorization_id: authId,
    allowed_actions: [...capActions], allowed_resources: [...capResources],
    runtime_budget: 500, call_budget: 500, delegation_depth: 0,
    issued_at: NOW.toISOString(), expires_at: EXPIRES,
  });
  return {
    root, stateDir, ownerRoot, signer, verifier, store, authId, capId,
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}
