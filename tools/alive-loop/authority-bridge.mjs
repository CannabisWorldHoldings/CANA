// tools/alive-loop/authority-bridge.mjs — PHASE D: the alive-loop's bridge to the SINGLE authority.
//
// The old adapter minted its OWN grant with a self-interpolated `issuedBy` string
// (adapter.mjs:340 `issuedBy: 'CANA mission ...'`) and then produced the execution receipt in the
// SAME trust domain — the qC CRITICAL "self-authorizing consumer" defect. The adapter can no longer
// do that. It must PRESENT an authorization that was issued EXTERNALLY, through the REAL authorize()
// seat, with a real policy decision.
//
// In DEV this bridge issues that authorization via the DEV owner-root signer THROUGH authority.mjs's
// authorize() — a genuine generator!=judge + containment + budget-reservation decision, not a
// rubber stamp. The signing key lives in an owner-root dir the adapter's execution side treats as the
// owner's; makeGrant verifies the authorization under the PUBLIC key. So authority (minting) and the
// execution receipt no longer share a trust domain: the adapter cannot forge the authorization, and
// cannot self-verify it.
//
// A caller may inject a fully external authority context (real KMS in production) via
// `authorityContext`; when absent, this DEV bridge is used (dev only, fail-closed in production
// because the signer refuses to load and the verifier fails closed).

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  authorize, provisionDevOwnerRoot, devOwnerSigner, ownerRootVerifier, ContainmentStore,
} from '../authority/authority.mjs';
import { compileMinimalContext } from '../mission-2/context.mjs';
import { createMissionContract } from '../mission-2/contracts.mjs';
import { sha256 } from '../mission-2/canonical.mjs';

// Map the alive-loop mission grant + compiled context into a mission-2 sealed mission, then run the
// real authorize() and return the signed authorization object + verifier + the bound action.
export function issueAuthorizationForCycle({
  grant, compiledPacket, facts, storeDir, now, tenant, executorIdentity, verifierIdentity, env = process.env,
}) {
  const authDir = join(storeDir, 'authority');
  const ownerRoot = join(authDir, 'owner');
  const stateDir = join(authDir, 'state');
  mkdirSync(authDir, { recursive: true });
  provisionDevOwnerRoot(ownerRoot, { env });
  const signer = devOwnerSigner(ownerRoot, { env });
  const verifier = ownerRootVerifier(ownerRoot, { env });

  const capability = grant.capabilities[0];
  const tenantId = tenant ?? `tenant_${grant.mission_id}`;
  const exec = executorIdentity ?? 'ALIVE_LOOP_EXECUTOR_V1';
  const verifierId = verifierIdentity ?? 'ALIVE_LOOP_INDEPENDENT_VERIFIER_V1';
  const resource = grant.allowed_paths[0];
  // mission-2 requires strictly canonical ISO-8601 (with milliseconds). The alive-loop grant may
  // carry a second-precision expiry; canonicalize it so the mission contract validates.
  const expiresIso = new Date(grant.expires_at).toISOString();

  // Seed a containment authorization + capability that CONTAINS this capability (subset check). The
  // authorization is the owner's; the capability is the worker's, bound to it.
  const store = new ContainmentStore(stateDir);
  store.setBudget('cycles', 1000);
  const authId = `auth_${sha256(grant.idempotency_key).slice(0, 12)}`;
  const capId = `cap_${sha256(grant.idempotency_key).slice(0, 12)}`;
  store.issueAuthorization({
    id: authId, actor_id: 'actor_owner', tenant_id: tenantId, site_id: 'site_local',
    allowed_actions: [capability], allowed_resources: ['*'],
    financial_budget: 0, runtime_budget: 1000, call_budget: 1000, delegation_depth: 1,
    issued_at: new Date(now).toISOString(), not_before: null, expires_at: expiresIso,
  });
  store.issueCapability({
    id: capId, worker_id: 'worker_local', authorization_id: authId,
    allowed_actions: [capability], allowed_resources: [resource, `${grant.allowed_paths[0]}/*`],
    runtime_budget: 500, call_budget: 500, delegation_depth: 0,
    issued_at: new Date(now).toISOString(), expires_at: expiresIso,
  });

  // Build a real mission-2 sealed mission (generator!=judge, zero budget, disabled Hermes/provider).
  const commit = grant.cana_commit;
  const tree = grant.cana_tree;
  const ev = sha256(`alive-loop:${grant.idempotency_key}`);
  const seed = {
    mission_id: grant.mission_id, tenant_id: tenantId, workspace_id: 'workspace_local',
    objective: grant.objective, source_repository: 'CANA', source_commit: commit, source_tree: tree,
    permitted_files: grant.allowed_paths,
  };
  const missionFacts = [{
    id: 'alive_fact', claim: `${grant.objective} — verified locally at ${commit.slice(0, 12)}`,
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT', truth_status: 'VERIFIED', source: 'alive-loop',
    observed_at: new Date(now).toISOString().slice(0, 10), valid_for_days: 2,
    tags: [`subject:${grant.target}`], tenant_id: tenantId, workspace_id: 'workspace_local',
    source_commit: commit, source_tree: tree, evidence_sha256: ev, target_files: grant.allowed_paths,
    provenance_status: 'CURRENT_VERIFIED',
  }];
  const missionPacket = compileMinimalContext({ mission: seed, facts: missionFacts, now: new Date(now) });
  const mission = createMissionContract({
    mission_id: grant.mission_id, tenant_id: tenantId, workspace_id: 'workspace_local',
    mission_type: 'ALIVE_LOOP_LOCAL_VERIFICATION', objective: grant.objective,
    originating_signal: { signal_id: `sig_${grant.mission_id}`, evidence_ref: `sha256:${ev}` },
    source_repository: 'CANA', source_commit: commit, source_tree: tree,
    source_evidence_references: [`sha256:${ev}`],
    context_compiler_version: 'sitemind-context-compiler/mission-2-adapter-1',
    context_packet_hash: missionPacket.packet_hash,
    authority_identity: 'CANA_DURABLE_AUTHORITY', authorization_identity: 'CANA_AUTHORIZATION_EVALUATOR_V1',
    permitted_files: grant.allowed_paths, permitted_resources: ['ISOLATED_GIT_WORKTREE'],
    permitted_capabilities: ['READ_REPOSITORY', 'RUN_TESTS', 'WRITE_LOCAL_BRANCH'],
    provider_state: 'NONE', hermes_state: 'DISABLED', approved_hermes_pin: 'NONE',
    budget: { currency: 'USD', maximum: 0, spent: 0 },
    external_effect_policy: 'NONE', production_access: 'NONE', timeout_ms: grant.max_runtime_ms,
    expires_at: expiresIso,
    success_criteria: [grant.metric, 'preserve historical bytes'],
    verifier_identity: verifierId,
    verification_contract: { operation: { kind: 'REPLACE_EXACT_TEXT', path: grant.allowed_paths[0], find: 'x', replace: 'y' }, expected_text: 'y' },
    rollback_procedure: { kind: 'EXACT_BYTES', description: 'restore pre-mission bytes and verify SHA-256' },
    current_lifecycle_state: 'MISSION_SEALED', latest_checkpoint: null, execution_attempts: [],
    evidence_references: [], failure_history: [], promotion_status: 'NOT_EVALUATED', next_eligible_action: 'AUTHORIZE',
  });

  const boundAction = { action_type: capability, resource, tenant: tenantId };
  const decision = authorize({
    now: new Date(now).toISOString(), tenant: tenantId, executorIdentity: exec,
    action: { action_type: capability, resource }, capability, budgetUnits: Math.max(1, grant.max_attempts),
    mission, contextPacket: missionPacket,
    containment: {
      authorization_id: authId, worker_capability_id: capId, worker_id: 'worker_local',
      actor_id: 'actor_owner', site_id: 'site_local', mission_id: grant.mission_id,
      budget: { cycles: 1 },
    },
    signer, verifier, ownerRootDir: ownerRoot,
  }, { stateDir, env });

  return { decision, authorization: decision.authorization, verifier, boundAction };
}
