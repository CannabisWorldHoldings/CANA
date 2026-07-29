import { assertMission, deepFreeze } from './canonical.mjs';

export const CAPABILITY_STATES = Object.freeze([
  'AVAILABLE',
  'CONNECTED',
  'AUTHORIZED',
  'DEGRADED',
  'QUARANTINED',
  'BLOCKED',
]);

function readonly(value) {
  return deepFreeze(structuredClone(value));
}

export class IntelligenceOsReadModel {
  constructor({ repository, protectedBase, store, providerState = 'NONE', hermesState = 'DISABLED' }) {
    this.repository = readonly(repository);
    this.protectedBase = readonly(protectedBase);
    this.store = store;
    this.providerState = providerState;
    this.hermesState = hermesState;
  }

  systemHealth() {
    const projection = this.store.reconstruct();
    return readonly({
      status: 'AVAILABLE',
      storage: 'LOCAL_DURABLE_SHADOW_FIXTURE',
      event_count: projection.event_count,
      provider_state: this.providerState,
      hermes_state: this.hermesState,
      fixture_label: 'MISSION_2_SHADOW_DATA_NOT_LIVE_PRODUCTION',
    });
  }

  canonicalRepositoryIdentity() {
    return this.repository;
  }

  protectedBaseIdentity() {
    return this.protectedBase;
  }

  missionList({ tenantId, workspaceId }) {
    return readonly(Object.values(this.store.reconstruct().missions)
      .filter((mission) => mission.tenant_id === tenantId && mission.workspace_id === workspaceId)
      .map((mission) => ({
        mission_id: mission.mission_id,
        lifecycle_state: mission.current_lifecycle_state,
        promotion_status: mission.promotion_status,
        next_eligible_action: mission.next_eligible_action,
      })));
  }

  missionDetails({ missionId, tenantId, workspaceId }) {
    const mission = this.store.reconstruct().missions[missionId];
    assertMission(mission, 'MISSION_NOT_FOUND', 'Mission not found');
    assertMission(mission.tenant_id === tenantId, 'CROSS_TENANT_DENIED', 'Mission tenant mismatch');
    assertMission(mission.workspace_id === workspaceId, 'CROSS_WORKSPACE_DENIED', 'Mission workspace mismatch');
    return readonly(mission);
  }

  lifecycleEvents({ missionId, tenantId, workspaceId }) {
    this.missionDetails({ missionId, tenantId, workspaceId });
    return readonly(this.store.readEvents()
      .filter((event) => event.mission_id === missionId)
      .map((event) => ({
        event_hash: event.event_hash,
        lifecycle_state: event.lifecycle_state,
        actor: event.actor,
        occurred_at: event.occurred_at,
        mission_version: event.mission_version,
      })));
  }

  missionSurfaces(identity) {
    const mission = this.missionDetails(identity);
    return readonly({
      authorization_state: mission.events.some((hash) => typeof hash === 'string') && mission.version >= 4 ? 'RECORDED' : 'NOT_RECORDED',
      execution_state: mission.current_lifecycle_state,
      evidence_references: mission.evidence_references,
      verifier_result: mission.current_lifecycle_state === 'INDEPENDENTLY_VERIFIED' || mission.version >= 8 ? 'RECORDED' : 'NOT_RECORDED',
      promotion_or_rejection: mission.promotion_status,
      rollback: mission.current_lifecycle_state === 'ROLLED_BACK' ? 'COMPLETE' : 'AVAILABLE_WHEN_CONTRACTED',
      queue_state: mission.next_eligible_action,
      worker_lease: mission.lease,
      heartbeat: mission.lease?.heartbeat_at ?? null,
      provider_state: this.providerState,
      hermes_state: this.hermesState,
      owner_decision_queue: mission.current_lifecycle_state === 'OWNER_DECISION_REQUIRED',
      blocker_ledger: mission.failure_history,
      capability_states: {
        deterministic_mock: 'AUTHORIZED',
        provider: 'BLOCKED',
        hermes: 'BLOCKED',
        production: 'BLOCKED',
      },
      fixture_label: 'MISSION_2_SHADOW_DATA_NOT_LIVE_PRODUCTION',
    });
  }
}
