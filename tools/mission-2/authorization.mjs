import {
  assertMission,
  deepFreeze,
  hashCanonical,
  requireIso,
  requireText,
} from './canonical.mjs';
import {
  APPROVED_HERMES_PIN_NONE,
  HERMES_DISABLED,
  PROVIDER_NONE,
  validateMissionContract,
} from './contracts.mjs';

export function authorizeMission({ mission: rawMission, contextPacket, now, executorIdentity }) {
  const mission = validateMissionContract(rawMission);
  requireText(executorIdentity, 'executorIdentity');
  assertMission(mission.current_lifecycle_state === 'MISSION_SEALED', 'MISSION_NOT_SEALED', 'Authorization requires a sealed mission');
  assertMission(mission.context_packet_hash === contextPacket.packet_hash, 'CONTEXT_HASH_MISMATCH', 'Context packet hash does not match mission');
  assertMission(contextPacket.tenant_id === mission.tenant_id, 'CROSS_TENANT_DENIED', 'Context tenant mismatch');
  assertMission(contextPacket.workspace_id === mission.workspace_id, 'CROSS_WORKSPACE_DENIED', 'Context workspace mismatch');
  assertMission(contextPacket.source_commit === mission.source_commit, 'WRONG_SOURCE_COMMIT', 'Context source commit mismatch');
  assertMission(contextPacket.source_tree === mission.source_tree, 'WRONG_SOURCE_TREE', 'Context source tree mismatch');
  assertMission(mission.provider_state === PROVIDER_NONE, 'PROVIDER_DENIED', 'Mission 2 provider must remain NONE');
  assertMission(mission.hermes_state === HERMES_DISABLED, 'HERMES_DENIED', 'Hermes must remain disabled');
  assertMission(mission.approved_hermes_pin === APPROVED_HERMES_PIN_NONE, 'HERMES_PIN_DENIED', 'No Hermes pin may be selected');
  assertMission(mission.external_effect_policy === 'NONE', 'EXTERNAL_EFFECT_DENIED', 'External effects are forbidden');
  assertMission(mission.production_access === 'NONE', 'PRODUCTION_ACCESS_DENIED', 'Production access is forbidden');
  assertMission(mission.budget.maximum === 0 && mission.budget.spent === 0, 'NONZERO_BUDGET_DENIED', 'Budget must remain zero');
  assertMission(new Date(mission.expires_at).getTime() > now.getTime(), 'AUTHORIZATION_EXPIRED', 'Mission authorization has expired');
  assertMission(mission.verifier_identity !== executorIdentity, 'EXECUTOR_SELF_VERIFICATION_DENIED', 'Executor and verifier identities must differ');
  assertMission(mission.rollback_procedure.kind === 'EXACT_BYTES', 'ROLLBACK_CONTRACT_REQUIRED', 'Mission 2 requires exact-byte rollback');
  assertMission(mission.permitted_capabilities.length > 0, 'CAPABILITY_REQUIRED', 'At least one exact capability is required');
  const body = {
    schema_version: 'cana.authorization-receipt/2.0.0',
    mission_id: mission.mission_id,
    mission_contract_hash: mission.contract_hash,
    tenant_id: mission.tenant_id,
    workspace_id: mission.workspace_id,
    source_commit: mission.source_commit,
    source_tree: mission.source_tree,
    context_packet_hash: contextPacket.packet_hash,
    permitted_files: mission.permitted_files,
    permitted_capabilities: mission.permitted_capabilities,
    executor_identity: executorIdentity,
    verifier_identity: mission.verifier_identity,
    provider_state: PROVIDER_NONE,
    hermes_state: HERMES_DISABLED,
    approved_hermes_pin: APPROVED_HERMES_PIN_NONE,
    budget_usd: 0,
    external_effects: 'NONE',
    production_access: 'NONE',
    rollback_contract_hash: hashCanonical(mission.rollback_procedure),
    authorized_at: now.toISOString(),
    expires_at: requireIso(mission.expires_at, 'expires_at'),
    decision: 'AUTHORIZED',
  };
  return deepFreeze({ ...body, authorization_receipt_hash: hashCanonical(body) });
}
