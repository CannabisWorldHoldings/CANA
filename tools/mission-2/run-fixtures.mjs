#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  canonicalize,
  hashCanonical,
  MissionError,
  sha256,
} from './canonical.mjs';
import { createMissionContract, validateFoundryRecord, validateMissionContract } from './contracts.mjs';
import { compileMinimalContext } from './context.mjs';
import { authorizeMission } from './authorization.mjs';
import { MissionStore } from './store.mjs';
import { DeterministicMockExecutor } from './mock-executor.mjs';
import { runIndependentVerification } from './verifier-process.mjs';
import { AutonomyKernel } from './kernel.mjs';
import { buildMeasuredErrorControllerFixture, TRANSCRIPT_FIXTURE_LABEL } from './foundry.mjs';
import { IntelligenceOsReadModel } from './intelligence-contracts.mjs';

const ROOT = path.resolve(process.argv[2] ?? process.cwd());
const OUTPUT = path.resolve(process.argv[3] ?? path.join(ROOT, 'docs/convergence/mission-2/evidence'));
const PROTECTED_COMMIT = '70a7200fbdbfd46bdcef7143863e33caf6f9d6fe';
const PROTECTED_TREE = 'b7f979a2d1d82b9dbc0b23a015eefaa1402a1dec';
const NOW = new Date('2026-07-29T09:00:00.000Z');
const EXPIRES = '2026-07-30T09:00:00.000Z';
const TENANT = 'tenant_cana';
const WORKSPACE = 'workspace_mission_2_shadow';
const EXECUTOR_ID = 'DETERMINISTIC_MOCK_EXECUTOR_V1';
const VERIFIER_ID = 'INDEPENDENT_FALSIFICATION_VERIFIER_V1';
const LEASE_AUTHORITY_SEED = Buffer.from(
  sha256('CANA_MISSION_2_DETERMINISTIC_FIXTURE_LEASE_AUTHORITY'),
  'hex',
);
const TARGET = 'docs/CANA_TECHNICAL_STATE.md';
const NOTICE = [
  '> **Canonical status supersession (2026-07-29):** This document preserves the',
  '> historical `codex/cana-bottleneck-clearance` lane. Current canonical truth is',
  '> bound to protected Mission 2 base `70a7200fbdbfd46bdcef7143863e33caf6f9d6fe`',
  '> with tree `b7f979a2d1d82b9dbc0b23a015eefaa1402a1dec`; Stage A and Mission 1',
  '> GitHub and fresh-clone verification passed. Historical statements below are',
  '> lane-scoped evidence, not the current canonical repository status.',
  '',
  '',
].join('\n');

function git(root, args, options = {}) {
  const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      GIT_AUTHOR_NAME: 'CANA Mission 2 Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'CANA Mission 2 Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: '2026-07-29T09:00:00Z',
      GIT_COMMITTER_DATE: '2026-07-29T09:00:00Z',
    },
    ...options,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function createWorktree(commit) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-worktree-'));
  fs.rmdirSync(directory);
  git(ROOT, ['worktree', 'add', '--detach', directory, commit]);
  return directory;
}

function removeWorktree(directory) {
  git(ROOT, ['worktree', 'remove', '--force', directory]);
}

function missionSeed({ missionId, objective, repository, commit, tree, target }) {
  return {
    mission_id: missionId,
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    objective,
    source_repository: repository,
    source_commit: commit,
    source_tree: tree,
    permitted_files: [target],
  };
}

function compileFixtureContext(seed, evidenceHash, claim) {
  return compileMinimalContext({
    mission: seed,
    now: NOW,
    facts: [{
      id: `${seed.mission_id}_fact`,
      claim,
      authority: 'INDEPENDENTLY_VERIFIED_RECEIPT',
      truth_status: 'VERIFIED',
      source: 'CANA protected evidence',
      observed_at: '2026-07-29T08:00:00.000Z',
      valid_for_days: 1,
      tags: [`subject:${seed.mission_id}`],
      tenant_id: TENANT,
      workspace_id: WORKSPACE,
      source_commit: seed.source_commit,
      source_tree: seed.source_tree,
      evidence_sha256: evidenceHash,
      target_files: seed.permitted_files,
      provenance_status: 'CURRENT_VERIFIED',
    }],
  });
}

function buildMission({
  seed,
  context,
  missionType,
  evidenceHash,
  operation,
  expectedText,
}) {
  return createMissionContract({
    mission_id: seed.mission_id,
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    mission_type: missionType,
    objective: seed.objective,
    originating_signal: {
      signal_id: `${seed.mission_id}_signal`,
      evidence_ref: `sha256:${evidenceHash}`,
    },
    source_repository: seed.source_repository,
    source_commit: seed.source_commit,
    source_tree: seed.source_tree,
    source_evidence_references: [`sha256:${evidenceHash}`],
    context_compiler_version: 'sitemind-context-compiler/mission-2-adapter-1',
    context_packet_hash: context.packet_hash,
    authority_identity: 'CANA_DURABLE_AUTHORITY',
    authorization_identity: 'CANA_AUTHORIZATION_EVALUATOR_V1',
    permitted_files: seed.permitted_files,
    permitted_resources: ['ISOLATED_GIT_WORKTREE'],
    permitted_capabilities: ['READ_REPOSITORY', 'RUN_TESTS', 'WRITE_LOCAL_BRANCH'],
    provider_state: 'NONE',
    hermes_state: 'DISABLED',
    approved_hermes_pin: 'NONE',
    budget: { currency: 'USD', maximum: 0, spent: 0 },
    external_effect_policy: 'NONE',
    production_access: 'NONE',
    timeout_ms: 60_000,
    expires_at: EXPIRES,
    success_criteria: ['Exact authorized target changed', 'Independent verifier approves', 'Exact rollback succeeds'],
    verifier_identity: VERIFIER_ID,
    verification_contract: {
      operation,
      expected_text: expectedText,
    },
    rollback_procedure: {
      kind: 'EXACT_BYTES',
      description: 'Restore exact pre-mission bytes by SHA-256, then reapply only the approved after bytes',
    },
    current_lifecycle_state: 'MISSION_SEALED',
    latest_checkpoint: null,
    execution_attempts: [],
    evidence_references: [],
    failure_history: [],
    promotion_status: 'NOT_EVALUATED',
    next_eligible_action: 'AUTHORIZE',
  });
}

function executeLifecycle({ sandbox, seed, context, mission, authorization, operation, expectedText, truthClaim }) {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${mission.mission_id}-store-`));
  let store = new MissionStore(storeRoot, { leaseAuthoritySeed: LEASE_AUTHORITY_SEED });
  let kernel = new AutonomyKernel({ store, clock: () => NOW });
  kernel.observeSignal(seed, {
    signal_id: mission.originating_signal.signal_id,
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    evidence_ref: mission.originating_signal.evidence_ref,
  });
  kernel.recordContext(seed, context);
  kernel.sealMission(mission);
  kernel.recordAuthorization(mission, authorization);
  const lease = kernel.dispatch(mission, EXECUTOR_ID, 60_000);
  const executor = new DeterministicMockExecutor(
    EXECUTOR_ID,
    store.leaseAuthority().publicKey,
  );
  const interrupted = executor.execute({
    mission,
    authorization: structuredClone(authorization),
    sandboxRoot: sandbox,
    operation,
    now: NOW,
    lease,
    interruptAfterCheckpoint: true,
  });
  kernel.checkpoint(mission, lease.token, interrupted.checkpoint);

  store = new MissionStore(storeRoot);
  kernel = new AutonomyKernel({ store, clock: () => NOW });
  const restoredBeforeExecution = kernel.projection(mission.mission_id);
  const restoredLease = kernel.restoreLease(mission, EXECUTOR_ID);
  const restoredAuthorization = structuredClone(authorization);
  const execution = executor.execute({
    mission,
    authorization: restoredAuthorization,
    sandboxRoot: sandbox,
    operation,
    now: NOW,
    lease: restoredLease,
  });
  const restoredExecution = {
    ...structuredClone(execution),
    before_bytes: Buffer.from(execution.before_bytes),
    after_bytes: Buffer.from(execution.after_bytes),
  };
  kernel.recordExecution(mission, restoredAuthorization, structuredClone(restoredLease), restoredExecution);
  kernel.captureEvidence(mission, restoredExecution);
  const verification = runIndependentVerification({
    mission,
    authorization: restoredAuthorization,
    executionReceipt: restoredExecution,
    sandboxRoot: sandbox,
    operation,
    lease: restoredLease,
    now: NOW,
    expectedText,
    leaseAuthorityPublicKey: store.leaseAuthority().publicKey,
  });
  const restoredVerification = structuredClone(verification);
  const verificationContext = {
    sandboxRoot: sandbox,
    lease: restoredLease,
  };
  kernel.recordVerification(
    mission,
    restoredAuthorization,
    restoredExecution,
    restoredVerification,
    verificationContext,
  );
  kernel.decidePromotion(
    mission,
    restoredAuthorization,
    restoredExecution,
    restoredVerification,
    verificationContext,
  );
  const truth = kernel.updateTruthGraph(mission, restoredVerification, {
    state: 'TECHNICALLY_VERIFIED',
    claim: truthClaim,
  });
  const winner = kernel.updateWinnerMemory(mission, truth, {
    exact_success_conditions: mission.success_criteria,
    reusable_boundaries: ['deterministic mock only', 'no provider', 'no production', 'no commercial value claim'],
    failure_conditions: ['source drift', 'scope broadening', 'verification rejection', 'rollback mismatch'],
    evidence: [restoredExecution.execution_receipt_hash, restoredVerification.verifier_receipt_hash],
    revalidate_after: EXPIRES,
  });
  const beforeRollback = kernel.projection(mission.mission_id);
  const rollback = executor.rollback({ sandboxRoot: sandbox, executionReceipt: restoredExecution });
  kernel.recordRollback(mission, restoredExecution, structuredClone(rollback), sandbox);
  const reapply = executor.reapply({ sandboxRoot: sandbox, executionReceipt: restoredExecution });
  const finalProjection = new MissionStore(storeRoot).reconstruct();
  return {
    mission,
    context,
    authorization: restoredAuthorization,
    lease: restoredLease,
    leaseAuthorityPublicKey: store.leaseAuthority().publicKey,
    interruption: {
      interrupted: interrupted.interrupted,
      checkpoint: interrupted.checkpoint,
      restart_reconstructed_state: restoredBeforeExecution.current_lifecycle_state,
      restart_reconstructed_version: restoredBeforeExecution.version,
    },
    execution: {
      ...restoredExecution,
      before_bytes: restoredExecution.before_bytes.toString('base64'),
      after_bytes: restoredExecution.after_bytes.toString('base64'),
    },
    verification: restoredVerification,
    truth,
    winner,
    before_rollback_state: beforeRollback.current_lifecycle_state,
    rollback,
    reapply,
    final_store_state: finalProjection.missions[mission.mission_id].current_lifecycle_state,
    event_count: finalProjection.event_count,
    event_chain_hash: finalProjection.last_event_hash,
    events: store.readEvents(),
  };
}

function runLegitimateLoop() {
  const sandbox = createWorktree(PROTECTED_COMMIT);
  try {
    if (git(sandbox, ['rev-parse', 'HEAD']) !== PROTECTED_COMMIT) throw new Error('protected commit mismatch');
    if (git(sandbox, ['rev-parse', 'HEAD^{tree}']) !== PROTECTED_TREE) throw new Error('protected tree mismatch');
    const target = path.join(sandbox, TARGET);
    const before = fs.readFileSync(target);
    const evidenceHash = sha256(Buffer.concat([
      before,
      Buffer.from('30eb6c0ba6a1c8a1c7deb74dc4fe0bbd5225574d404eb388c314c61c929d69d6'),
    ]));
    const seed = missionSeed({
      missionId: 'mission_2_legitimate_stale_status',
      objective: 'Correct stale canonical status claims while preserving their historical lane context',
      repository: 'CannabisWorldHoldings/CANA',
      commit: PROTECTED_COMMIT,
      tree: PROTECTED_TREE,
      target: TARGET,
    });
    const context = compileFixtureContext(
      seed,
      evidenceHash,
      'The technical-state document presents the 2026-07-27 recovery lane as current although protected Stage A and Mission 1 receipts prove canonical integration.',
    );
    const admittedOperation = {
      kind: 'REPLACE_EXACT_TEXT',
      path: TARGET,
      find: '# CANA technical state\n\n',
      replace: `# CANA technical state\n\n${NOTICE}`,
    };
    const expectedText = 'Canonical status supersession (2026-07-29)';
    const mission = buildMission({
      seed,
      context,
      missionType: 'STALE_REGISTERED_PROJECT_FACT',
      evidenceHash,
      operation: admittedOperation,
      expectedText,
    });
    const authorization = authorizeMission({ mission, contextPacket: context, now: NOW, executorIdentity: EXECUTOR_ID });
    const lifecycle = executeLifecycle({
      sandbox,
      seed,
      context,
      mission,
      authorization,
      operation: admittedOperation,
      expectedText,
      truthClaim: 'The stale CANA technical-state status is explicitly superseded without erasing its historical evidence.',
    });
    const after = fs.readFileSync(target);
    return {
      schema_version: 'cana.minimum-alive-loop-receipt/2.0.0',
      fixture: false,
      defect_class: 'STALE_REGISTERED_PROJECT_FACT',
      source_before_sha256: sha256(before),
      approved_after_sha256: sha256(after),
      changed_files: [TARGET],
      notice: NOTICE,
      lifecycle,
      assertions: {
        all_required_states_receipted: [
          'SIGNAL_OBSERVED',
          'CONTEXT_COMPILED',
          'MISSION_SEALED',
          'CANA_AUTHORIZED',
          'EXECUTOR_DISPATCHED',
          'ACTION_EXECUTED',
          'EVIDENCE_CAPTURED',
          'INDEPENDENTLY_VERIFIED',
          'PROMOTED',
          'TRUTHGRAPH_UPDATED',
          'WINNER_MEMORY_UPDATED',
          'ROLLED_BACK',
        ].every((state) => lifecycle.events.some((event) => event.lifecycle_state === state)),
        rollback_exact: lifecycle.rollback.exact_bytes_restored,
        approved_reapply_exact: lifecycle.reapply.exact_bytes_reapplied,
        external_effects: 0,
        provider: 'NONE',
        hermes: 'DISABLED',
        budget_usd: 0,
        production_modified: false,
        commercial_value_claimed: false,
      },
      receipt_hash: hashCanonical({
        mission_id: mission.mission_id,
        event_chain_hash: lifecycle.event_chain_hash,
        source_before_sha256: sha256(before),
        approved_after_sha256: sha256(after),
      }),
    };
  } finally {
    removeWorktree(sandbox);
  }
}

function makeShadowRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-shadow-source-'));
  fs.writeFileSync(path.join(root, 'controller-state.json'), '{"desired":10,"measured":7}\n');
  git(root, ['init', '-q']);
  git(root, ['add', 'controller-state.json']);
  git(root, ['commit', '-q', '-m', 'deterministic measured-error fixture']);
  return { root, commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']) };
}

function runShadowMechanism() {
  const source = makeShadowRepository();
  const sourceHash = sha256(TRANSCRIPT_FIXTURE_LABEL);
  const foundry = buildMeasuredErrorControllerFixture({ tenantId: TENANT, workspaceId: WORKSPACE, sourceHash });
  const seed = missionSeed({
    missionId: 'mission_2_measured_error_controller_shadow',
    objective: 'Apply the smallest bounded intervention to the deterministic measured-error fixture',
    repository: 'DETERMINISTIC_TEST_FIXTURE',
    commit: source.commit,
    tree: source.tree,
    target: 'controller-state.json',
  });
  const context = compileFixtureContext(
    seed,
    sourceHash,
    'Desired state 10 minus measured state 7 yields bounded error 3; the authorized intervention is exactly 1.',
  );
  const admittedOperation = {
    kind: 'REPLACE_EXACT_TEXT',
    path: 'controller-state.json',
    find: '"measured":7',
    replace: '"measured":8',
  };
  const expectedText = '"measured":8';
  const mission = buildMission({
    seed,
    context,
    missionType: 'MEASURED_ERROR_CONTROLLER_SHADOW',
    evidenceHash: sourceHash,
    operation: admittedOperation,
    expectedText,
  });
  const authorization = authorizeMission({ mission, contextPacket: context, now: NOW, executorIdentity: EXECUTOR_ID });
  const lifecycle = executeLifecycle({
    sandbox: source.root,
    seed,
    context,
    mission,
    authorization,
    operation: admittedOperation,
    expectedText,
    truthClaim: 'The deterministic measured-error controller applied one bounded shadow intervention.',
  });
  return {
    schema_version: 'cana.transcript-shadow-mechanism-receipt/2.0.0',
    fixture_label: TRANSCRIPT_FIXTURE_LABEL,
    foundry,
    lifecycle,
    value_state: 'VALUE_NOT_ESTABLISHED',
    commercial_value_claimed: false,
    external_effects: 0,
    provider: 'NONE',
    hermes: 'DISABLED',
    budget_usd: 0,
    receipt_hash: hashCanonical({
      foundry_receipt_hash: foundry.receipt_hash,
      event_chain_hash: lifecycle.event_chain_hash,
      value_state: 'VALUE_NOT_ESTABLISHED',
    }),
  };
}

function runInvalidCourts(legitimate) {
  const mission = legitimate.lifecycle.mission;
  const context = legitimate.lifecycle.context;
  const authorization = legitimate.lifecycle.authorization;
  const invalidStore = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-invalid-')));
  const guardRepository = makeShadowRepository();
  const receipts = [];
  const record = (name, expectedCode, action) => {
    const observeDenial = () => {
      try {
        const result = action();
        if (result?.verdict === 'REJECT') return 'VERIFIER_REJECTED_FORGERY';
        return 'UNEXPECTED_ACCEPTANCE';
      } catch (error) {
        return error instanceof MissionError ? error.code : error.code ?? error.name;
      }
    };
    const beforeProjection = invalidStore.reconstruct();
    const guardStatusBefore = git(guardRepository.root, ['status', '--porcelain']);
    const guardBytesBefore = fs.readFileSync(path.join(guardRepository.root, 'controller-state.json'));
    const firstObservedCode = observeDenial();
    const secondObservedCode = observeDenial();
    const afterDeniedAction = invalidStore.reconstruct();
    const guardStatusAfter = git(guardRepository.root, ['status', '--porcelain']);
    const guardBytesAfter = fs.readFileSync(path.join(guardRepository.root, 'controller-state.json'));
    if (firstObservedCode !== expectedCode || secondObservedCode !== expectedCode) {
      throw new Error(`${name}: expected ${expectedCode}, observed ${firstObservedCode}/${secondObservedCode}`);
    }
    const newEvents = invalidStore.readEvents().slice(beforeProjection.event_count);
    const unauthorizedExecutionOccurred = newEvents.some((event) => event.lifecycle_state === 'ACTION_EXECUTED');
    const truthgraphUpdated = newEvents.some((event) => event.lifecycle_state === 'TRUTHGRAPH_UPDATED');
    const winnerMemoryUpdated = newEvents.some((event) => event.lifecycle_state === 'WINNER_MEMORY_UPDATED');
    const guardChanged = guardStatusBefore !== guardStatusAfter
      || !guardBytesBefore.equals(guardBytesAfter);
    if (
      afterDeniedAction.event_count !== beforeProjection.event_count
      || unauthorizedExecutionOccurred
      || truthgraphUpdated
      || winnerMemoryUpdated
      || guardChanged
    ) {
      throw new Error(`${name}: denied action changed guarded state`);
    }
    const missionId = `invalid_${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')}`;
    invalidStore.append({
      missionId,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      lifecycleState: 'SIGNAL_OBSERVED',
      actor: 'RSI_SITEMIND_INTELLIGENCE',
      occurredAt: NOW.toISOString(),
      expectedVersion: 0,
      payload: { next_eligible_action: 'VALIDATE' },
    });
    invalidStore.append({
      missionId,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      lifecycleState: 'REJECTED',
      actor: 'CANA_DURABLE_AUTHORITY',
      occurredAt: NOW.toISOString(),
      expectedVersion: 1,
      payload: {
        failure: { code: firstObservedCode },
        promotion_status: 'REJECTED',
        next_eligible_action: 'NONE',
      },
    });
    receipts.push({
      name,
      denial_code: firstObservedCode,
      unauthorized_execution_occurred: unauthorizedExecutionOccurred,
      truthgraph_updated: truthgraphUpdated,
      winner_memory_updated: winnerMemoryUpdated,
      external_effect_count: guardChanged ? 1 : 0,
      durable_state: 'REJECTED',
      reproducible: firstObservedCode === secondObservedCode,
      measurement: {
        denied_action_event_count_before: beforeProjection.event_count,
        denied_action_event_count_after: afterDeniedAction.event_count,
        guarded_repository_status_before: guardStatusBefore,
        guarded_repository_status_after: guardStatusAfter,
        guarded_file_sha256_before: sha256(guardBytesBefore),
        guarded_file_sha256_after: sha256(guardBytesAfter),
      },
    });
  };

  const seed = {
    mission_id: mission.mission_id,
    tenant_id: mission.tenant_id,
    workspace_id: mission.workspace_id,
    objective: mission.objective,
    source_repository: mission.source_repository,
    source_commit: mission.source_commit,
    source_tree: mission.source_tree,
    permitted_files: mission.permitted_files,
  };
  const baseFact = {
    id: 'invalid_fact',
    claim: 'invalid court',
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT',
    truth_status: 'VERIFIED',
    source: 'invalid court',
    observed_at: '2026-07-29T08:00:00.000Z',
    valid_for_days: 1,
    tags: ['subject:invalid'],
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    source_commit: mission.source_commit,
    source_tree: mission.source_tree,
    evidence_sha256: sha256('invalid'),
    target_files: mission.permitted_files,
    provenance_status: 'CURRENT_VERIFIED',
  };
  record('STALE_SOURCE_COMMIT', 'WRONG_SOURCE_COMMIT', () => compileMinimalContext({ mission: seed, facts: [{ ...baseFact, source_commit: 'a'.repeat(40) }], now: NOW }));
  record('WRONG_SOURCE_TREE', 'WRONG_SOURCE_TREE', () => compileMinimalContext({ mission: seed, facts: [{ ...baseFact, source_tree: 'b'.repeat(40) }], now: NOW }));
  record('UNAUTHORIZED_FILE', 'UNAUTHORIZED_CONTEXT_FILE', () => compileMinimalContext({ mission: seed, facts: [{ ...baseFact, target_files: ['docs/other.md'] }], now: NOW }));
  record('EXPIRED_AUTHORIZATION', 'AUTHORIZATION_EXPIRED', () => authorizeMission({ mission, contextPacket: context, now: new Date(EXPIRES), executorIdentity: EXECUTOR_ID }));
  record('FORGED_RECEIPT', 'VERIFIER_REJECTED_FORGERY', () => runIndependentVerification({
    mission,
    authorization,
    executionReceipt: {
      ...legitimate.lifecycle.execution,
      before_bytes: Buffer.from(legitimate.lifecycle.execution.before_bytes, 'base64'),
      after_bytes: Buffer.from(legitimate.lifecycle.execution.after_bytes, 'base64'),
      changed_files: [{ ...legitimate.lifecycle.execution.changed_files[0], after_sha256: '0'.repeat(64) }],
    },
    sandboxRoot: ROOT,
    operation: mission.verification_contract.operation,
    lease: legitimate.lifecycle.lease,
    now: NOW,
    expectedText: mission.verification_contract.expected_text,
    leaseAuthorityPublicKey: legitimate.lifecycle.leaseAuthorityPublicKey,
  }));
  record('PACKET_TAMPERING', 'CONTEXT_HASH_MISMATCH', () => authorizeMission({ mission, contextPacket: { ...context, packet_hash: '0'.repeat(64) }, now: NOW, executorIdentity: EXECUTOR_ID }));
  record('WIDENED_CAPABILITY', 'CAPABILITY_BROADENING_DENIED', () => createMissionContract({ ...mission, contract_hash: undefined, permitted_capabilities: [...mission.permitted_capabilities, 'DEPLOY_PRODUCTION'] }));
  record('PROVIDER_REQUEST', 'BOUNDARY_VIOLATION', () => createMissionContract({ ...mission, contract_hash: undefined, provider_state: 'OPENAI' }));
  record('HERMES_REQUEST', 'BOUNDARY_VIOLATION', () => createMissionContract({ ...mission, contract_hash: undefined, hermes_state: 'ENABLED' }));
  record('REPLAYED_MISSION', 'STALE_STATE', () => invalidStore.append({
    missionId: 'invalid_stale_source_commit',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    lifecycleState: 'REJECTED',
    actor: 'REPLAY',
    occurredAt: NOW.toISOString(),
    expectedVersion: 1,
  }));
  record('CROSS_TENANT_EVIDENCE', 'CROSS_TENANT_EVIDENCE', () => compileMinimalContext({ mission: seed, facts: [{ ...baseFact, tenant_id: 'other' }], now: NOW }));
  record('EXECUTOR_SELF_VERIFICATION', 'EXECUTOR_SELF_VERIFICATION_DENIED', () => authorizeMission({
    mission: createMissionContract({ ...mission, contract_hash: undefined, verifier_identity: EXECUTOR_ID }),
    contextPacket: context,
    now: NOW,
    executorIdentity: EXECUTOR_ID,
  }));
  record('MISSING_ROLLBACK', 'FIELD_REQUIRED', () => createMissionContract({ ...mission, contract_hash: undefined, rollback_procedure: { kind: '', description: '' } }));
  record('BUDGET_ABOVE_ZERO', 'NONZERO_BUDGET_DENIED', () => createMissionContract({ ...mission, contract_hash: undefined, budget: { currency: 'USD', maximum: 1, spent: 0 } }));
  record('EXTERNAL_EFFECT_REQUEST', 'BOUNDARY_VIOLATION', () => createMissionContract({ ...mission, contract_hash: undefined, external_effect_policy: 'NETWORK' }));
  record('RAW_TRANSCRIPT_HOT_MEMORY', 'RAW_TRANSCRIPT_HOT_MEMORY_DENIED', () => validateFoundryRecord('SOURCE_RECORD', {
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    provenance: TRANSCRIPT_FIXTURE_LABEL,
    source_hash: sha256('transcript'),
    truth_state: 'SOURCE_ONLY',
    raw_transcript: true,
  }));
  record('RESEARCH_CLAIMS_VALUE_PROVEN', 'UNSUPPORTED_VALUE_PROVEN', () => validateFoundryRecord('SOURCE_RECORD', {
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    provenance: TRANSCRIPT_FIXTURE_LABEL,
    source_hash: sha256('value'),
    truth_state: 'VALUE_PROVEN',
  }));
  record('CONTRADICTION_DELETION', 'CONTRADICTION_DELETION_DENIED', () => validateFoundryRecord('CONTRADICTION_RECORD', {
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    provenance: TRANSCRIPT_FIXTURE_LABEL,
    source_hash: sha256('contradiction'),
    truth_state: 'SOURCE_ONLY',
    claims: ['a', 'b'],
    deleted: true,
  }));

  const reconstructed = new MissionStore(invalidStore.root).reconstruct();
  if (!receipts.every((receipt) => reconstructed.missions[`invalid_${receipt.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')}`]?.current_lifecycle_state === 'REJECTED')) {
    throw new Error('invalid mission durability reconstruction failed');
  }
  return {
    schema_version: 'cana.invalid-mission-courts/2.0.0',
    count: receipts.length,
    receipts,
    durable_event_chain_hash: reconstructed.last_event_hash,
    all_failed_closed: receipts.every((receipt) =>
      receipt.unauthorized_execution_occurred === false
      && receipt.truthgraph_updated === false
      && receipt.winner_memory_updated === false
      && receipt.external_effect_count === 0
      && receipt.durable_state === 'REJECTED'
      && receipt.reproducible === true),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${canonicalize(value)}\n`, { flag: 'w', mode: 0o600 });
}

const legitimate = runLegitimateLoop();
const invalid = runInvalidCourts(legitimate);
const shadow = runShadowMechanism();
const readStore = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-read-contract-')));
for (const event of legitimate.lifecycle.events) {
  readStore.append({
    missionId: event.mission_id,
    tenantId: event.tenant_id,
    workspaceId: event.workspace_id,
    lifecycleState: event.lifecycle_state,
    actor: event.actor,
    occurredAt: event.occurred_at,
    expectedVersion: event.mission_version - 1,
    payload: event.payload,
  });
}
const readModel = new IntelligenceOsReadModel({
  repository: { name: 'CannabisWorldHoldings/CANA' },
  protectedBase: { commit: PROTECTED_COMMIT, tree: PROTECTED_TREE },
  store: readStore,
});
const intelligenceContracts = {
  schema_version: 'cana.intelligence-os-read-contract-receipt/2.0.0',
  fixture_label: 'MISSION_2_SHADOW_DATA_NOT_LIVE_PRODUCTION',
  repository: readModel.canonicalRepositoryIdentity(),
  protected_base: readModel.protectedBaseIdentity(),
  health: readModel.systemHealth(),
  missions: readModel.missionList({ tenantId: TENANT, workspaceId: WORKSPACE }),
  mission_details: readModel.missionDetails({ missionId: legitimate.lifecycle.mission.mission_id, tenantId: TENANT, workspaceId: WORKSPACE }),
  lifecycle_events: readModel.lifecycleEvents({ missionId: legitimate.lifecycle.mission.mission_id, tenantId: TENANT, workspaceId: WORKSPACE }),
  surfaces: readModel.missionSurfaces({ missionId: legitimate.lifecycle.mission.mission_id, tenantId: TENANT, workspaceId: WORKSPACE }),
  read_only: true,
  production_included: false,
};
const adversarial = {
  schema_version: 'cana.mission-2-adversarial-report/2.0.0',
  invalid_mission_count: invalid.count,
  invalid_missions_all_failed_closed: invalid.all_failed_closed,
  executed_invalid_courts: invalid.receipts.map((receipt) => ({
    name: receipt.name,
    denial_code: receipt.denial_code,
    reproducible: receipt.reproducible,
    measured_no_execution: receipt.unauthorized_execution_occurred === false,
    measured_no_truthgraph_update: receipt.truthgraph_updated === false,
    measured_no_winner_memory_update: receipt.winner_memory_updated === false,
    measured_no_external_effect: receipt.external_effect_count === 0,
  })),
  observed_lifecycle_proofs: [{
    name: 'INTERRUPTED_EXECUTION_RECOVERY',
    passed: legitimate.lifecycle.interruption.interrupted === true
      && legitimate.lifecycle.interruption.restart_reconstructed_state === 'EXECUTOR_DISPATCHED',
    event_chain_hash: legitimate.lifecycle.event_chain_hash,
  }, {
    name: 'EXACT_ROLLBACK_AND_REAPPLY',
    passed: legitimate.lifecycle.rollback.exact_bytes_restored === true
      && legitimate.lifecycle.reapply.exact_bytes_reapplied === true,
    before_sha256: legitimate.source_before_sha256,
    after_sha256: legitimate.approved_after_sha256,
  }],
  sabotage_detection_proven: invalid.all_failed_closed
    && invalid.receipts.every((receipt) => receipt.reproducible === true),
  external_effects: 0,
  provider: 'NONE',
  hermes: 'DISABLED',
  budget_usd: 0,
};

writeJson(path.join(OUTPUT, 'LEGITIMATE_MINIMUM_ALIVE_LOOP_RECEIPT.json'), legitimate);
writeJson(path.join(OUTPUT, 'INVALID_MISSION_RECEIPTS.json'), invalid);
writeJson(path.join(OUTPUT, 'TRANSCRIPT_SHADOW_MECHANISM_RECEIPT.json'), shadow);
writeJson(path.join(OUTPUT, 'INTELLIGENCE_OS_READ_CONTRACT_RECEIPT.json'), intelligenceContracts);
writeJson(path.join(OUTPUT, 'ADVERSARIAL_REPORT.json'), adversarial);

const manifestEntries = fs.readdirSync(OUTPUT).filter((name) => name !== 'EVIDENCE_MANIFEST.json').sort().map((name) => {
  const bytes = fs.readFileSync(path.join(OUTPUT, name));
  return { path: `docs/convergence/mission-2/evidence/${name}`, bytes: bytes.length, sha256: sha256(bytes) };
});
writeJson(path.join(OUTPUT, 'EVIDENCE_MANIFEST.json'), {
  schema_version: 'cana.mission-2-evidence-manifest/2.0.0',
  protected_commit: PROTECTED_COMMIT,
  protected_tree: PROTECTED_TREE,
  entries: manifestEntries,
  set_hash: hashCanonical(manifestEntries),
});

process.stdout.write(`${canonicalize({
  status: 'PASS',
  legitimate_receipt_hash: legitimate.receipt_hash,
  invalid_count: invalid.count,
  invalid_all_failed_closed: invalid.all_failed_closed,
  shadow_receipt_hash: shadow.receipt_hash,
  output: OUTPUT,
})}\n`);
