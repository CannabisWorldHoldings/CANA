import {
  assertMission,
  deepFreeze,
  deterministicId,
  hashCanonical,
} from './canonical.mjs';

const ACTION_BY_STATE = Object.freeze({
  SIGNAL_OBSERVED: 'COMPILE_CONTEXT',
  CONTEXT_COMPILED: 'SEAL_MISSION',
  MISSION_SEALED: 'AUTHORIZE',
  CANA_AUTHORIZED: 'DISPATCH',
  EXECUTOR_DISPATCHED: 'EXECUTE',
  ACTION_EXECUTED: 'CAPTURE_EVIDENCE',
  EVIDENCE_CAPTURED: 'VERIFY_INDEPENDENTLY',
  INDEPENDENTLY_VERIFIED: 'PROMOTE_OR_REJECT',
  PROMOTED: 'UPDATE_TRUTHGRAPH',
  TRUTHGRAPH_UPDATED: 'UPDATE_WINNER_MEMORY',
  WINNER_MEMORY_UPDATED: 'CLOSE_OR_ROLLBACK',
  PAUSED: 'RESUME',
  REJECTED: 'NONE',
  CANCELLED: 'NONE',
  DEAD_LETTER: 'OWNER_DECISION',
  OWNER_DECISION_REQUIRED: 'OWNER_DECISION',
  ROLLED_BACK: 'NONE',
});

const RETRYABLE_ERRORS = new Set([
  'WORKER_INTERRUPTED',
  'VERIFIER_INTERRUPTED',
  'ROLLBACK_INTERRUPTED',
  'TRANSIENT_STORE_BUSY',
]);

export class AutonomyKernel {
  constructor({ store, clock }) {
    this.store = store;
    this.clock = clock;
  }

  projection(missionId) {
    const mission = this.store.reconstruct().missions[missionId];
    assertMission(mission, 'MISSION_NOT_FOUND', `Mission not found: ${missionId}`);
    return mission;
  }

  append(mission, lifecycleState, actor, payload = {}) {
    const current = this.store.reconstruct().missions[mission.mission_id] ?? null;
    return this.store.append({
      missionId: mission.mission_id,
      tenantId: mission.tenant_id,
      workspaceId: mission.workspace_id,
      lifecycleState,
      actor,
      occurredAt: this.clock().toISOString(),
      expectedVersion: current?.version ?? 0,
      payload: {
        tenant_id: mission.tenant_id,
        workspace_id: mission.workspace_id,
        next_eligible_action: ACTION_BY_STATE[lifecycleState] ?? 'NONE',
        ...payload,
      },
    });
  }

  observeSignal(missionSeed, signal) {
    assertMission(signal.tenant_id === missionSeed.tenant_id, 'CROSS_TENANT_DENIED', 'Signal tenant mismatch');
    assertMission(signal.workspace_id === missionSeed.workspace_id, 'CROSS_WORKSPACE_DENIED', 'Signal workspace mismatch');
    const evidence = this.store.writeEvidence(signal);
    return this.append(missionSeed, 'SIGNAL_OBSERVED', 'RSI_SITEMIND_INTELLIGENCE', {
      evidence_ref: evidence.ref,
      signal_id: signal.signal_id,
    });
  }

  recordContext(missionSeed, contextPacket) {
    const evidence = this.store.writeEvidence(contextPacket);
    return this.append(missionSeed, 'CONTEXT_COMPILED', 'RSI_SITEMIND_INTELLIGENCE', {
      evidence_ref: evidence.ref,
      context_packet_hash: contextPacket.packet_hash,
    });
  }

  sealMission(mission) {
    const evidence = this.store.writeEvidence(mission);
    return this.append(mission, 'MISSION_SEALED', 'CANA_DURABLE_AUTHORITY', {
      evidence_ref: evidence.ref,
      mission_contract_hash: mission.contract_hash,
    });
  }

  recordAuthorization(mission, authorization) {
    const evidence = this.store.writeEvidence(authorization);
    return this.append(mission, 'CANA_AUTHORIZED', 'CANA_DURABLE_AUTHORITY', {
      evidence_ref: evidence.ref,
      authorization_receipt_hash: authorization.authorization_receipt_hash,
    });
  }

  dispatch(mission, workerId, leaseDurationMs) {
    const current = this.projection(mission.mission_id);
    assertMission(current.current_lifecycle_state === 'CANA_AUTHORIZED' || current.current_lifecycle_state === 'PAUSED', 'DISPATCH_BEFORE_AUTHORIZATION', 'Dispatch requires authorization');
    assertMission(!current.lease || new Date(current.lease.expires_at).getTime() <= this.clock().getTime(), 'DUPLICATE_DISPATCH', 'An active worker lease already exists');
    const issuedAt = this.clock();
    const lease = deepFreeze({
      worker_id: workerId,
      token: deterministicId('lease', {
        mission_id: mission.mission_id,
        worker_id: workerId,
        version: current.version,
        issued_at: issuedAt.toISOString(),
      }),
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + leaseDurationMs).toISOString(),
      heartbeat_at: issuedAt.toISOString(),
    });
    this.append(mission, 'EXECUTOR_DISPATCHED', 'CANA_AUTONOMY_KERNEL', { lease });
    return lease;
  }

  heartbeat(mission, leaseToken) {
    const current = this.projection(mission.mission_id);
    assertMission(current.lease?.token === leaseToken, 'STALE_WORKER', 'Heartbeat lease token is stale');
    assertMission(new Date(current.lease.expires_at).getTime() > this.clock().getTime(), 'LEASE_EXPIRED', 'Worker lease expired');
    const lease = { ...current.lease, heartbeat_at: this.clock().toISOString() };
    this.append(mission, current.current_lifecycle_state, 'CANA_AUTONOMY_KERNEL', { lease });
    return deepFreeze(lease);
  }

  checkpoint(mission, leaseToken, checkpoint) {
    const current = this.projection(mission.mission_id);
    assertMission(current.lease?.token === leaseToken, 'STALE_WORKER', 'Checkpoint lease token is stale');
    this.append(mission, current.current_lifecycle_state, 'CANA_AUTONOMY_KERNEL', { checkpoint });
  }

  recordExecution(mission, leaseToken, executionReceipt) {
    const current = this.projection(mission.mission_id);
    assertMission(current.lease?.token === leaseToken, 'STALE_WORKER_COMPLETION', 'Worker completion lease token is stale');
    assertMission(new Date(current.lease.expires_at).getTime() > this.clock().getTime(), 'LEASE_EXPIRED', 'Worker returned after lease expiry');
    const evidence = this.store.writeEvidence({
      ...executionReceipt,
      before_bytes: executionReceipt.before_bytes.toString('base64'),
      after_bytes: executionReceipt.after_bytes.toString('base64'),
    });
    return this.append(mission, 'ACTION_EXECUTED', executionReceipt.executor_identity, {
      evidence_ref: evidence.ref,
      attempt: {
        attempt: current.execution_attempts.length + 1,
        lease_token: leaseToken,
        result: 'EXECUTED',
      },
      lease: null,
    });
  }

  captureEvidence(mission, executionReceipt) {
    const evidence = this.store.writeEvidence({
      mission_id: mission.mission_id,
      execution_receipt_hash: executionReceipt.execution_receipt_hash,
      changed_files: executionReceipt.changed_files,
      command: executionReceipt.command,
      external_effect_count: executionReceipt.external_effect_count,
      provider_calls: executionReceipt.provider_calls,
      spend_usd: executionReceipt.spend_usd,
    });
    return this.append(mission, 'EVIDENCE_CAPTURED', 'CANA_DURABLE_AUTHORITY', { evidence_ref: evidence.ref });
  }

  recordVerification(mission, verifierReceipt) {
    const evidence = this.store.writeEvidence(verifierReceipt);
    return this.append(mission, 'INDEPENDENTLY_VERIFIED', verifierReceipt.verifier_identity, {
      evidence_ref: evidence.ref,
      verifier_verdict: verifierReceipt.verdict,
    });
  }

  decidePromotion(mission, verifierReceipt) {
    const approve = verifierReceipt.verdict === 'APPROVE' && verifierReceipt.implementation_mutated === false;
    const next = approve ? 'PROMOTED' : 'REJECTED';
    const payload = {
      promotion_status: approve ? 'TECHNICALLY_VERIFIED' : 'REJECTED',
      verifier_receipt_hash: verifierReceipt.verifier_receipt_hash,
    };
    if (!approve) payload.failure = { code: 'INDEPENDENT_VERIFICATION_REJECTED', verdict: verifierReceipt.verdict };
    return this.append(mission, next, 'CANA_DURABLE_AUTHORITY', payload);
  }

  updateTruthGraph(mission, verifierReceipt, truth) {
    const current = this.projection(mission.mission_id);
    assertMission(current.current_lifecycle_state === 'PROMOTED', 'TRUTH_UPDATE_BEFORE_PROMOTION', 'TruthGraph update requires CANA promotion');
    assertMission(verifierReceipt.verdict === 'APPROVE', 'TRUTH_UPDATE_WITHOUT_APPROVAL', 'TruthGraph requires independent approval');
    assertMission(truth.state === 'TECHNICALLY_VERIFIED' || truth.state === 'VALUE_NOT_ESTABLISHED', 'INVALID_TRUTH_STATE', 'Shadow technical truth cannot claim value');
    const record = deepFreeze({
      schema_version: 'cana.truthgraph-node/2.0.0',
      node_id: deterministicId('truth', { mission_id: mission.mission_id, source_tree: mission.source_tree }),
      mission_id: mission.mission_id,
      tenant_id: mission.tenant_id,
      workspace_id: mission.workspace_id,
      state: truth.state,
      claim: truth.claim,
      verifier_receipt_hash: verifierReceipt.verifier_receipt_hash,
      value_state: 'VALUE_NOT_ESTABLISHED',
    });
    const evidence = this.store.writeEvidence(record);
    this.append(mission, 'TRUTHGRAPH_UPDATED', 'RSI_SITEMIND_INTELLIGENCE', { evidence_ref: evidence.ref });
    return record;
  }

  updateWinnerMemory(mission, truthRecord, learning) {
    const current = this.projection(mission.mission_id);
    assertMission(current.current_lifecycle_state === 'TRUTHGRAPH_UPDATED', 'WINNER_MEMORY_BEFORE_TRUTH', 'Winner Memory requires promoted TruthGraph state');
    assertMission(truthRecord.state === 'TECHNICALLY_VERIFIED', 'UNVERIFIED_WINNER_DENIED', 'Winner Memory requires a technically verified mechanism');
    const record = deepFreeze({
      schema_version: 'cana.winner-memory/2.0.0',
      lesson_id: deterministicId('winner', {
        mission_id: mission.mission_id,
        exact_success_conditions: learning.exact_success_conditions,
      }),
      category: 'TECHNICAL_MECHANISM',
      mission_id: mission.mission_id,
      tenant_id: mission.tenant_id,
      workspace_id: mission.workspace_id,
      exact_source_commit: mission.source_commit,
      exact_source_tree: mission.source_tree,
      exact_success_conditions: learning.exact_success_conditions,
      reusable_boundaries: learning.reusable_boundaries,
      failure_conditions: learning.failure_conditions,
      evidence: learning.evidence,
      revalidate_after: learning.revalidate_after,
      value_state: 'VALUE_NOT_ESTABLISHED',
      commercial_value_claimed: false,
    });
    const evidence = this.store.writeEvidence(record);
    this.append(mission, 'WINNER_MEMORY_UPDATED', 'RSI_SITEMIND_INTELLIGENCE', { evidence_ref: evidence.ref });
    return record;
  }

  recordRollback(mission, rollbackReceipt) {
    const evidence = this.store.writeEvidence(rollbackReceipt);
    return this.append(mission, 'ROLLED_BACK', 'CANA_DURABLE_AUTHORITY', {
      evidence_ref: evidence.ref,
      promotion_status: 'ROLLED_BACK',
    });
  }

  pause(mission, reason) {
    return this.append(mission, 'PAUSED', 'CANA_AUTONOMY_KERNEL', { checkpoint: { reason } });
  }

  cancel(mission, reason) {
    return this.append(mission, 'CANCELLED', 'CANA_DURABLE_AUTHORITY', { failure: { code: 'CANCELLED', reason } });
  }

  recordFailure(mission, errorCode, retryPolicy) {
    const current = this.projection(mission.mission_id);
    const attempt = current.execution_attempts.length + 1;
    const retryable = RETRYABLE_ERRORS.has(errorCode);
    const exhausted = attempt >= retryPolicy.maximum_attempts;
    const next = !retryable || exhausted ? 'DEAD_LETTER' : 'PAUSED';
    return this.append(mission, next, 'CANA_AUTONOMY_KERNEL', {
      failure: {
        code: errorCode,
        retryable,
        attempt,
        maximum_attempts: retryPolicy.maximum_attempts,
        backoff_ms: retryable && !exhausted ? retryPolicy.backoff_ms : null,
      },
      attempt: { attempt, result: next },
      promotion_status: next === 'DEAD_LETTER' ? 'REJECTED' : current.promotion_status,
      lease: null,
    });
  }

  ownerDecision(mission, reason) {
    return this.append(mission, 'OWNER_DECISION_REQUIRED', 'CANA_DURABLE_AUTHORITY', {
      failure: { code: 'OWNER_DECISION_REQUIRED', reason },
    });
  }

  eligibleMissions({ tenantId, workspaceId }) {
    const missions = Object.values(this.store.reconstruct().missions)
      .filter((mission) => mission.tenant_id === tenantId && mission.workspace_id === workspaceId)
      .filter((mission) => !['REJECTED', 'CANCELLED', 'DEAD_LETTER', 'OWNER_DECISION_REQUIRED', 'ROLLED_BACK'].includes(mission.current_lifecycle_state))
      .map((mission) => ({ mission_id: mission.mission_id, next_eligible_action: mission.next_eligible_action, version: mission.version }));
    return deepFreeze(missions.sort((a, b) => a.mission_id.localeCompare(b.mission_id)));
  }

  capabilityQuarantine(mission, capability, reason) {
    const receipt = {
      schema_version: 'cana.capability-quarantine/2.0.0',
      mission_id: mission.mission_id,
      capability,
      reason,
      quarantined_at: this.clock().toISOString(),
    };
    return deepFreeze({ ...receipt, receipt_hash: hashCanonical(receipt) });
  }
}
