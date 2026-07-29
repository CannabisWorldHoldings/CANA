import test from 'node:test';
import assert from 'node:assert/strict';
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
import {
  createMissionContract,
  validateFoundryRecord,
  validateMissionContract,
} from './contracts.mjs';
import { compileMinimalContext } from './context.mjs';
import { authorizeMission } from './authorization.mjs';
import { MissionStore } from './store.mjs';
import { DeterministicMockExecutor } from './mock-executor.mjs';
import { IndependentVerifier } from './verifier.mjs';
import { AutonomyKernel } from './kernel.mjs';
import {
  buildMeasuredErrorControllerFixture,
  KnowledgeToMechanismFoundry,
  TRANSCRIPT_FIXTURE_LABEL,
} from './foundry.mjs';
import { IntelligenceOsReadModel } from './intelligence-contracts.mjs';

const NOW = new Date('2026-07-29T09:00:00.000Z');
const EXPIRES = '2026-07-30T09:00:00.000Z';
const TENANT = 'tenant_cana';
const WORKSPACE = 'workspace_shadow';
const EXECUTOR = 'DETERMINISTIC_MOCK_EXECUTOR_V1';
const VERIFIER = 'INDEPENDENT_FALSIFICATION_VERIFIER_V1';
const TARGET = 'docs/status.md';
const BEFORE_TEXT = '# Status\n\nCanonical checks are unproven.\n';
const NOTICE = '# Status\n\nSuperseded: canonical checks are verified at the protected base.\n\nCanonical checks are unproven.\n';

function runGit(root, args) {
  const result = spawnSync('/usr/bin/git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin',
      GIT_AUTHOR_NAME: 'CANA Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'CANA Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-repo-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, TARGET), BEFORE_TEXT);
  runGit(root, ['init', '-q']);
  runGit(root, ['add', TARGET]);
  runGit(root, ['commit', '-q', '-m', 'fixture']);
  return {
    root,
    commit: runGit(root, ['rev-parse', 'HEAD']),
    tree: runGit(root, ['rev-parse', 'HEAD^{tree}']),
  };
}

function missionSeed(repository) {
  return {
    mission_id: 'mission_stale_status_fact',
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    objective: 'Correct the stale canonical verification status without erasing historical context',
    source_repository: 'CannabisWorldHoldings/CANA',
    source_commit: repository.commit,
    source_tree: repository.tree,
    permitted_files: [TARGET],
  };
}

function contextFact(repository, overrides = {}) {
  return {
    id: 'fact_stale_status',
    claim: 'The status document says canonical checks are unproven although exact protected-base receipts prove they passed.',
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT',
    truth_status: 'VERIFIED',
    source: 'CANA protected-base receipt',
    observed_at: '2026-07-29T08:00:00.000Z',
    valid_for_days: 1,
    tags: ['subject:canonical-status'],
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    source_commit: repository.commit,
    source_tree: repository.tree,
    evidence_sha256: sha256('protected-base-receipt'),
    target_files: [TARGET],
    provenance_status: 'CURRENT_VERIFIED',
    ...overrides,
  };
}

function buildMission(repository, contextPacket, overrides = {}) {
  return createMissionContract({
    mission_id: 'mission_stale_status_fact',
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    mission_type: 'STALE_REGISTERED_PROJECT_FACT',
    objective: missionSeed(repository).objective,
    originating_signal: {
      signal_id: 'signal_stale_status_fact',
      evidence_ref: `sha256:${sha256('protected-base-receipt')}`,
    },
    source_repository: 'CannabisWorldHoldings/CANA',
    source_commit: repository.commit,
    source_tree: repository.tree,
    source_evidence_references: [`sha256:${sha256('protected-base-receipt')}`],
    context_compiler_version: 'sitemind-context-compiler/mission-2-adapter-1',
    context_packet_hash: contextPacket.packet_hash,
    authority_identity: 'CANA_DURABLE_AUTHORITY',
    authorization_identity: 'CANA_AUTHORIZATION_EVALUATOR_V1',
    permitted_files: [TARGET],
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
    success_criteria: ['Insert the exact supersession notice once', 'Preserve all historical bytes after the insertion point'],
    verifier_identity: VERIFIER,
    rollback_procedure: {
      kind: 'EXACT_BYTES',
      description: 'Restore the exact pre-mission bytes and verify their SHA-256',
    },
    current_lifecycle_state: 'MISSION_SEALED',
    latest_checkpoint: null,
    execution_attempts: [],
    evidence_references: [],
    failure_history: [],
    promotion_status: 'NOT_EVALUATED',
    next_eligible_action: 'AUTHORIZE',
    ...overrides,
  });
}

function setup() {
  const repository = makeRepository();
  const seed = missionSeed(repository);
  const contextPacket = compileMinimalContext({ mission: seed, facts: [contextFact(repository)], now: NOW });
  const mission = buildMission(repository, contextPacket);
  const authorization = authorizeMission({ mission, contextPacket, now: NOW, executorIdentity: EXECUTOR });
  return { repository, seed, contextPacket, mission, authorization };
}

function operation() {
  return {
    kind: 'REPLACE_EXACT_TEXT',
    path: TARGET,
    before_sha256: sha256(BEFORE_TEXT),
    find: '# Status\n\n',
    replace: '# Status\n\nSuperseded: canonical checks are verified at the protected base.\n\n',
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof MissionError && error.code === code);
}

test('canonical mission contract is deterministic, hashable, tenant-bound, and tamper-evident', () => {
  const { mission } = setup();
  assert.equal(validateMissionContract(mission).contract_hash, mission.contract_hash);
  assert.equal(canonicalize(mission), canonicalize(validateMissionContract(structuredClone(mission))));
  expectCode(() => validateMissionContract({ ...mission, objective: 'tampered' }), 'MISSION_TAMPERED');
  expectCode(() => validateMissionContract({ ...mission, tenant_id: '' }), 'FIELD_REQUIRED');
  expectCode(() => validateMissionContract({ ...mission, permitted_files: ['../escape'] }), 'PATH_TRAVERSAL_DENIED');
});

test('Context Compiler output is minimal, reproducible, source-bound, and tamper-evident', () => {
  const repository = makeRepository();
  const seed = missionSeed(repository);
  const fact = contextFact(repository);
  const a = compileMinimalContext({ mission: seed, facts: [fact], now: NOW });
  const b = compileMinimalContext({ mission: seed, facts: [fact], now: NOW });
  assert.equal(a.canonical_bytes, b.canonical_bytes);
  assert.equal(a.packet_hash, b.packet_hash);
  assert.equal(a.compiled_context.counts.actionable, 1);
  assert.equal(a.compiled_context.counts.reference, 0);
  expectCode(() => compileMinimalContext({ mission: seed, facts: [{ ...fact, source_commit: 'a'.repeat(40) }], now: NOW }), 'WRONG_SOURCE_COMMIT');
  expectCode(() => compileMinimalContext({ mission: seed, facts: [{ ...fact, source_tree: 'b'.repeat(40) }], now: NOW }), 'WRONG_SOURCE_TREE');
  expectCode(() => compileMinimalContext({ mission: seed, facts: [{ ...fact, tenant_id: 'other' }], now: NOW }), 'CROSS_TENANT_EVIDENCE');
  expectCode(() => compileMinimalContext({ mission: seed, facts: [{ ...fact, provenance_status: 'STALE' }], now: NOW }), 'STALE_EVIDENCE');
  expectCode(() => compileMinimalContext({ mission: seed, facts: [fact, { ...fact, id: 'duplicate' }], now: NOW }), 'DUPLICATE_EVIDENCE');
  expectCode(() => compileMinimalContext({ mission: seed, facts: [{ ...fact, target_files: ['docs/other.md'] }], now: NOW }), 'UNAUTHORIZED_CONTEXT_FILE');
});

test('contradictory canonical inputs fail closed', () => {
  const repository = makeRepository();
  const seed = missionSeed(repository);
  const first = contextFact(repository);
  const second = contextFact(repository, {
    id: 'fact_conflict',
    claim: 'Canonical checks remain unverified.',
    evidence_sha256: sha256('different-evidence'),
  });
  expectCode(() => compileMinimalContext({ mission: seed, facts: [first, second], now: NOW }), 'CONTRADICTORY_CANONICAL_INPUTS');
});

test('authorization requires exact Mission 2 boundaries and independent verification', () => {
  const { repository, contextPacket, mission } = setup();
  assert.equal(authorizeMission({ mission, contextPacket, now: NOW, executorIdentity: EXECUTOR }).decision, 'AUTHORIZED');
  for (const [field, value, code] of [
    ['provider_state', 'OPENAI', 'BOUNDARY_VIOLATION'],
    ['hermes_state', 'ENABLED', 'BOUNDARY_VIOLATION'],
    ['approved_hermes_pin', 'd9165d7', 'BOUNDARY_VIOLATION'],
    ['external_effect_policy', 'NETWORK', 'BOUNDARY_VIOLATION'],
    ['production_access', 'READ', 'BOUNDARY_VIOLATION'],
  ]) {
    expectCode(() => buildMission(repository, contextPacket, { [field]: value }), code);
  }
  expectCode(() => buildMission(repository, contextPacket, { budget: { currency: 'USD', maximum: 1, spent: 0 } }), 'NONZERO_BUDGET_DENIED');
  expectCode(() => authorizeMission({
    mission: buildMission(repository, contextPacket, { verifier_identity: EXECUTOR }),
    contextPacket,
    now: NOW,
    executorIdentity: EXECUTOR,
  }), 'EXECUTOR_SELF_VERIFICATION_DENIED');
  expectCode(() => authorizeMission({
    mission: buildMission(repository, contextPacket, { expires_at: NOW.toISOString() }),
    contextPacket,
    now: NOW,
    executorIdentity: EXECUTOR,
  }), 'AUTHORIZATION_EXPIRED');
});

test('durable event log reconstructs after restart and detects mutation, deletion, and reordering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-store-'));
  const store = new MissionStore(root);
  const mission = { mission_id: 'm', tenant_id: TENANT, workspace_id: WORKSPACE };
  store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'SIGNAL_OBSERVED', actor: 'RSI', occurredAt: NOW.toISOString(), expectedVersion: 0 });
  store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'CONTEXT_COMPILED', actor: 'RSI', occurredAt: NOW.toISOString(), expectedVersion: 1 });
  assert.equal(new MissionStore(root).reconstruct().missions.m.current_lifecycle_state, 'CONTEXT_COMPILED');
  expectCode(() => store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'MISSION_SEALED', actor: 'CANA', occurredAt: NOW.toISOString(), expectedVersion: 1 }), 'STALE_STATE');
  expectCode(() => store.append({ missionId: 'm', tenantId: 'other', workspaceId: WORKSPACE, lifecycleState: 'MISSION_SEALED', actor: 'CANA', occurredAt: NOW.toISOString(), expectedVersion: 2 }), 'CROSS_TENANT_DENIED');
  const clean = fs.readFileSync(store.eventsFile, 'utf8');
  const lines = clean.trim().split('\n');
  fs.writeFileSync(store.eventsFile, `${lines.reverse().join('\n')}\n`);
  expectCode(() => store.reconstruct(), 'EVENT_SEQUENCE_CORRUPT');
  fs.writeFileSync(store.eventsFile, clean.replace('CONTEXT_COMPILED', 'MISSION_SEALED'));
  expectCode(() => store.reconstruct(), 'EVENT_HASH_CORRUPT');
  fs.writeFileSync(store.eventsFile, `${clean.split('\n')[0]}\n`);
  expectCode(() => store.reconstruct(), 'EVENT_DELETION_DETECTED');
  void mission;
});

test('illegal lifecycle transitions fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-illegal-'));
  const store = new MissionStore(root);
  store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'SIGNAL_OBSERVED', actor: 'RSI', occurredAt: NOW.toISOString(), expectedVersion: 0 });
  expectCode(() => store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'PROMOTED', actor: 'CANA', occurredAt: NOW.toISOString(), expectedVersion: 1 }), 'ILLEGAL_TRANSITION');
});

test('mock executor changes only one authorized file with no provider, spend, or external effect', () => {
  const { repository, mission, authorization } = setup();
  const executor = new DeterministicMockExecutor();
  const lease = { worker_id: EXECUTOR, token: 'lease', expires_at: EXPIRES };
  const receipt = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease });
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), NOTICE);
  assert.deepEqual(receipt.changed_files.map((change) => change.path), [TARGET]);
  assert.equal(receipt.external_effect_count, 0);
  assert.equal(receipt.provider_calls, 0);
  assert.equal(receipt.spend_usd, 0);
  assert.equal(receipt.production_modified, false);
});

test('mock executor supports deterministic interruption, resume, rollback, and reapply', () => {
  const { repository, mission, authorization } = setup();
  const executor = new DeterministicMockExecutor();
  const lease = { worker_id: EXECUTOR, token: 'lease', expires_at: EXPIRES };
  const interrupted = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease, interruptAfterCheckpoint: true });
  assert.equal(interrupted.interrupted, true);
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), BEFORE_TEXT);
  const receipt = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease });
  const rollback = executor.rollback({ sandboxRoot: repository.root, executionReceipt: receipt });
  assert.equal(rollback.exact_bytes_restored, true);
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), BEFORE_TEXT);
  assert.equal(executor.reapply({ sandboxRoot: repository.root, executionReceipt: receipt }).exact_bytes_reapplied, true);
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), NOTICE);
});

test('mock executor rejects unauthorized, expired, widened, dirty, and symlink targets', () => {
  const { repository, contextPacket, mission, authorization } = setup();
  const executor = new DeterministicMockExecutor();
  const lease = { worker_id: EXECUTOR, token: 'lease', expires_at: EXPIRES };
  expectCode(() => executor.execute({
    mission,
    authorization,
    sandboxRoot: repository.root,
    operation: { ...operation(), path: 'docs/other.md' },
    now: NOW,
    lease,
  }), 'UNAUTHORIZED_FILE');
  expectCode(() => executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: new Date(EXPIRES), lease }), 'EXECUTION_AFTER_EXPIRY');
  const noWrite = buildMission(repository, contextPacket, { permitted_capabilities: ['READ_REPOSITORY'] });
  const noWriteAuth = authorizeMission({ mission: noWrite, contextPacket, now: NOW, executorIdentity: EXECUTOR });
  expectCode(() => executor.execute({ mission: noWrite, authorization: noWriteAuth, sandboxRoot: repository.root, operation: operation(), now: NOW, lease }), 'CAPABILITY_DENIED');
  fs.writeFileSync(path.join(repository.root, 'untracked'), 'dirty');
  expectCode(() => executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease }), 'DIRTY_SANDBOX_DENIED');
  fs.unlinkSync(path.join(repository.root, 'untracked'));
  fs.renameSync(path.join(repository.root, TARGET), path.join(repository.root, 'docs/real.md'));
  fs.symlinkSync('real.md', path.join(repository.root, TARGET));
  expectCode(() => executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease }), 'DIRTY_SANDBOX_DENIED');
});

test('independent verifier cannot be the executor and rejects forged evidence', () => {
  const { repository, mission, authorization } = setup();
  const executor = new DeterministicMockExecutor();
  const lease = { worker_id: EXECUTOR, token: 'lease', expires_at: EXPIRES };
  const receipt = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease });
  const verifier = new IndependentVerifier();
  assert.equal(verifier.verify({ mission, authorization, executionReceipt: receipt, sandboxRoot: repository.root, now: NOW, expectedText: 'Superseded:' }).verdict, 'APPROVE');
  expectCode(() => new IndependentVerifier(EXECUTOR).verify({ mission: { ...mission, verifier_identity: EXECUTOR }, authorization: { ...authorization, verifier_identity: EXECUTOR }, executionReceipt: receipt, sandboxRoot: repository.root, now: NOW, expectedText: 'Superseded:' }), 'EXECUTOR_SELF_VERIFICATION_DENIED');
  const forged = { ...receipt, changed_files: [{ ...receipt.changed_files[0], after_sha256: '0'.repeat(64) }] };
  assert.equal(verifier.verify({ mission, authorization, executionReceipt: forged, sandboxRoot: repository.root, now: NOW, expectedText: 'Superseded:' }).verdict, 'REJECT');
});

test('Autonomy Kernel controls leases, stale workers, duplicate dispatch, promotion, truth, and Winner Memory', () => {
  const { repository, seed, contextPacket, mission, authorization } = setup();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-kernel-'));
  const store = new MissionStore(root);
  const kernel = new AutonomyKernel({ store, clock: () => NOW });
  kernel.observeSignal(seed, { signal_id: 'signal', tenant_id: TENANT, workspace_id: WORKSPACE, evidence: 'receipt' });
  kernel.recordContext(seed, contextPacket);
  kernel.sealMission(mission);
  kernel.recordAuthorization(mission, authorization);
  const lease = kernel.dispatch(mission, EXECUTOR, 60_000);
  expectCode(() => kernel.dispatch(mission, EXECUTOR, 60_000), 'DISPATCH_BEFORE_AUTHORIZATION');
  expectCode(() => kernel.heartbeat(mission, 'stale'), 'STALE_WORKER');
  kernel.heartbeat(mission, lease.token);
  const executor = new DeterministicMockExecutor();
  const execution = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease });
  expectCode(() => kernel.recordExecution(mission, 'stale', execution), 'STALE_WORKER_COMPLETION');
  kernel.recordExecution(mission, lease.token, execution);
  kernel.captureEvidence(mission, execution);
  const verifierReceipt = new IndependentVerifier().verify({ mission, authorization, executionReceipt: execution, sandboxRoot: repository.root, now: NOW, expectedText: 'Superseded:' });
  kernel.recordVerification(mission, verifierReceipt);
  expectCode(() => kernel.updateTruthGraph(mission, verifierReceipt, { state: 'TECHNICALLY_VERIFIED', claim: 'fixed' }), 'TRUTH_UPDATE_BEFORE_PROMOTION');
  kernel.decidePromotion(mission, verifierReceipt);
  const truth = kernel.updateTruthGraph(mission, verifierReceipt, { state: 'TECHNICALLY_VERIFIED', claim: 'The stale canonical status is superseded.' });
  const winner = kernel.updateWinnerMemory(mission, truth, {
    exact_success_conditions: ['exact notice inserted', 'history preserved'],
    reusable_boundaries: ['documentation-only', 'no commercial value claim'],
    failure_conditions: ['source hash drift', 'notice duplication'],
    evidence: [verifierReceipt.verifier_receipt_hash],
    revalidate_after: EXPIRES,
  });
  assert.equal(winner.value_state, 'VALUE_NOT_ESTABLISHED');
  assert.equal(winner.commercial_value_claimed, false);
  assert.equal(kernel.projection(mission.mission_id).current_lifecycle_state, 'WINNER_MEMORY_UPDATED');
});

test('rejected mission cannot update TruthGraph or Winner Memory', () => {
  const { seed, contextPacket, mission, authorization } = setup();
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-reject-')));
  const kernel = new AutonomyKernel({ store, clock: () => NOW });
  kernel.observeSignal(seed, { signal_id: 'signal', tenant_id: TENANT, workspace_id: WORKSPACE });
  kernel.recordContext(seed, contextPacket);
  kernel.sealMission(mission);
  kernel.recordAuthorization(mission, authorization);
  const lease = kernel.dispatch(mission, EXECUTOR, 60_000);
  const fakeExecution = {
    mission_id: mission.mission_id,
    executor_identity: EXECUTOR,
    source_commit: mission.source_commit,
    source_tree: mission.source_tree,
    authorization_receipt_hash: authorization.authorization_receipt_hash,
    execution_receipt_hash: sha256('fake'),
    before_bytes: Buffer.from('a'),
    after_bytes: Buffer.from('b'),
    changed_files: [{ path: TARGET, before_sha256: sha256('a'), after_sha256: sha256('b') }],
    command: {},
    external_effect_count: 0,
    provider_calls: 0,
    spend_usd: 0,
  };
  kernel.recordExecution(mission, lease.token, fakeExecution);
  kernel.captureEvidence(mission, fakeExecution);
  const rejection = {
    verdict: 'REJECT',
    implementation_mutated: false,
    verifier_identity: VERIFIER,
    verifier_receipt_hash: sha256('rejection'),
  };
  kernel.recordVerification(mission, rejection);
  kernel.decidePromotion(mission, rejection);
  expectCode(() => kernel.updateTruthGraph(mission, rejection, { state: 'TECHNICALLY_VERIFIED', claim: 'forged' }), 'TRUTH_UPDATE_BEFORE_PROMOTION');
  expectCode(() => kernel.updateWinnerMemory(mission, { state: 'TECHNICALLY_VERIFIED' }, {}), 'WINNER_MEMORY_BEFORE_TRUTH');
  assert.equal(kernel.projection(mission.mission_id).current_lifecycle_state, 'REJECTED');
});

test('retry classification is bounded and exhaustion is durable', () => {
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-retry-')));
  const kernel = new AutonomyKernel({ store, clock: () => NOW });
  const mission = { mission_id: 'retry', tenant_id: TENANT, workspace_id: WORKSPACE };
  store.append({ missionId: 'retry', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'CANA_AUTHORIZED', actor: 'CANA', occurredAt: NOW.toISOString(), expectedVersion: 0 });
  const lease = kernel.dispatch(mission, EXECUTOR, 60_000);
  assert.ok(lease.token);
  kernel.recordFailure(mission, 'WORKER_INTERRUPTED', { maximum_attempts: 2, backoff_ms: 10 });
  assert.equal(kernel.projection('retry').current_lifecycle_state, 'PAUSED');
  kernel.dispatch(mission, EXECUTOR, 60_000);
  kernel.recordFailure(mission, 'WORKER_INTERRUPTED', { maximum_attempts: 2, backoff_ms: 10 });
  const state = new MissionStore(store.root).reconstruct().missions.retry;
  assert.equal(state.current_lifecycle_state, 'DEAD_LETTER');
  assert.equal(state.failure_history.at(-1).maximum_attempts, 2);
});

test('content-addressed evidence rejects corruption', () => {
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-evidence-')));
  const ref = store.writeEvidence({ stable: true });
  assert.deepEqual(store.readEvidence(ref.ref), { stable: true });
  fs.writeFileSync(path.join(store.evidenceDirectory, `${ref.sha256}.json`), '{"stable":false}');
  expectCode(() => store.readEvidence(ref.ref), 'EVIDENCE_TAMPERED');
});

test('Knowledge Foundry preserves provenance, contradictions, deduplication, and value boundaries', () => {
  const sourceHash = sha256('fixture');
  const fixture = buildMeasuredErrorControllerFixture({ tenantId: TENANT, workspaceId: WORKSPACE, sourceHash });
  assert.equal(fixture.fixture_label, TRANSCRIPT_FIXTURE_LABEL);
  assert.equal(fixture.records.length, 7);
  assert.ok(fixture.records.every((record) => record.provenance === TRANSCRIPT_FIXTURE_LABEL));
  assert.ok(fixture.records.every((record) => record.truth_state !== 'VALUE_PROVEN'));
  const foundry = new KnowledgeToMechanismFoundry();
  const mechanism = {
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    source_hash: sourceHash,
    provenance: TRANSCRIPT_FIXTURE_LABEL,
    truth_state: 'MECHANISM_CANDIDATE',
    mechanism_key: 'same',
    falsification_test: 'fails',
    rollback: 'restore',
  };
  foundry.admit('MECHANISM_CANDIDATE', mechanism);
  expectCode(() => foundry.admit('MECHANISM_CANDIDATE', { ...mechanism, source_hash: sha256('other') }), 'DUPLICATE_MECHANISM_ID');
  expectCode(() => validateFoundryRecord('SOURCE_RECORD', { ...mechanism, truth_state: 'VALUE_PROVEN' }), 'UNSUPPORTED_VALUE_PROVEN');
  expectCode(() => validateFoundryRecord('SOURCE_RECORD', { ...mechanism, raw_transcript: true }), 'RAW_TRANSCRIPT_HOT_MEMORY_DENIED');
  expectCode(() => validateFoundryRecord('CONTRADICTION_RECORD', { ...mechanism, claims: ['a', 'b'], deleted: true }), 'CONTRADICTION_DELETION_DENIED');
});

test('Intelligence OS contracts are read-only, fixture-labeled, and tenant-isolated', () => {
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-read-')));
  store.append({ missionId: 'read', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'SIGNAL_OBSERVED', actor: 'RSI', occurredAt: NOW.toISOString(), expectedVersion: 0 });
  const model = new IntelligenceOsReadModel({
    repository: { name: 'CannabisWorldHoldings/CANA' },
    protectedBase: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
    store,
  });
  assert.equal(model.systemHealth().fixture_label, 'MISSION_2_SHADOW_DATA_NOT_LIVE_PRODUCTION');
  assert.equal(model.missionList({ tenantId: TENANT, workspaceId: WORKSPACE }).length, 1);
  assert.equal(model.lifecycleEvents({ missionId: 'read', tenantId: TENANT, workspaceId: WORKSPACE }).length, 1);
  expectCode(() => model.missionDetails({ missionId: 'read', tenantId: 'other', workspaceId: WORKSPACE }), 'CROSS_TENANT_DENIED');
  assert.throws(() => {
    model.systemHealth().provider_state = 'CONNECTED';
  }, TypeError);
});

test('canonical packet and foundry hashes resist replay and mutation', () => {
  const { mission, contextPacket } = setup();
  assert.notEqual(hashCanonical({ mission: mission.contract_hash, nonce: 1 }), hashCanonical({ mission: mission.contract_hash, nonce: 2 }));
  assert.notEqual(contextPacket.packet_hash, hashCanonical({ ...contextPacket, source_tree: 'f'.repeat(40) }));
});
