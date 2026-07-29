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
import { assertLeaseReceipt } from './lease.mjs';
import { MissionStore } from './store.mjs';
import { DeterministicMockExecutor } from './mock-executor.mjs';
import { runIndependentVerification } from './verifier-process.mjs';
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

function authorizedSetup(clock = () => NOW) {
  const prepared = setup();
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-authorized-')));
  const kernel = new AutonomyKernel({ store, clock });
  kernel.observeSignal(prepared.seed, {
    signal_id: 'signal',
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    evidence: 'receipt',
  });
  kernel.recordContext(prepared.seed, prepared.contextPacket);
  kernel.sealMission(prepared.mission);
  kernel.recordAuthorization(prepared.mission, prepared.authorization);
  const lease = kernel.dispatch(prepared.mission, EXECUTOR, 60_000);
  return { ...prepared, store, kernel, lease };
}

function mockExecutor(store, identity = EXECUTOR) {
  return new DeterministicMockExecutor(identity, store.leaseAuthority().publicKey);
}

function verifySeparately({
  store,
  mission,
  authorization,
  executionReceipt,
  sandboxRoot,
  operation: requestedOperation,
  lease,
  now = NOW,
  expectedText,
}) {
  return runIndependentVerification({
    mission,
    authorization,
    executionReceipt,
    sandboxRoot,
    operation: requestedOperation,
    lease,
    now,
    expectedText,
    leaseAuthorityPublicKey: store.leaseAuthority().publicKey,
  });
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

function roundTripExecution(receipt) {
  const copy = structuredClone(receipt);
  copy.before_bytes = Buffer.from(receipt.before_bytes);
  copy.after_bytes = Buffer.from(receipt.after_bytes);
  return copy;
}

function validateReceiptsInFreshProcess(payload) {
  const code = `
    const payload = JSON.parse(process.argv[1]);
    const { assertAuthorizationReceipt } = await import(${JSON.stringify(new URL('./authorization.mjs', import.meta.url).href)});
    const { assertLeaseReceipt } = await import(${JSON.stringify(new URL('./lease.mjs', import.meta.url).href)});
    const { assertVerifierReceipt } = await import(${JSON.stringify(new URL('./verifier.mjs', import.meta.url).href)});
    const now = new Date(payload.now);
    assertAuthorizationReceipt({
      mission: payload.mission,
      authorization: payload.authorization,
      now,
      executorIdentity: payload.execution.executor_identity,
    });
    assertLeaseReceipt({
      lease: payload.lease,
      missionId: payload.mission.mission_id,
      authorizationReceiptHash: payload.authorization.authorization_receipt_hash,
      workerId: payload.execution.executor_identity,
      now,
      authorityPublicKey: payload.leaseAuthorityPublicKey,
    });
    assertVerifierReceipt({
      mission: payload.mission,
      authorization: payload.authorization,
      executionReceipt: payload.execution,
      verifierReceipt: payload.verifier,
    });
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', code, JSON.stringify(payload)],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
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

test('authorization and leases survive serialization while tampering and paused dispatch fail closed', () => {
  const {
    repository,
    seed,
    contextPacket,
    mission,
    authorization,
  } = setup();
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-forged-auth-')));
  const kernel = new AutonomyKernel({ store, clock: () => NOW });
  kernel.observeSignal(seed, { signal_id: 'signal', tenant_id: TENANT, workspace_id: WORKSPACE });
  kernel.recordContext(seed, contextPacket);
  kernel.sealMission(mission);
  const {
    authorization_receipt_hash: ignoredAuthorizationHash,
    ...forgedAuthorizationBody
  } = {
    ...authorization,
    authorized_at: new Date(NOW.getTime() - 1).toISOString(),
  };
  void ignoredAuthorizationHash;
  expectCode(
    () => kernel.recordAuthorization(mission, {
      ...forgedAuthorizationBody,
      authorization_receipt_hash: hashCanonical(forgedAuthorizationBody),
    }),
    'FORGED_AUTHORIZATION_DENIED',
  );
  expectCode(
    () => kernel.recordAuthorization(mission, {
      ...authorization,
      authorization_receipt_hash: '0'.repeat(64),
    }),
    'AUTHORIZATION_RECEIPT_TAMPERED',
  );
  const restoredAuthorization = structuredClone(authorization);
  kernel.recordAuthorization(mission, restoredAuthorization);
  const lease = kernel.dispatch(mission, EXECUTOR, 60_000);
  expectCode(() => mockExecutor(store).execute({
    mission,
    authorization: restoredAuthorization,
    sandboxRoot: repository.root,
    operation: operation(),
    now: NOW,
    lease: { ...lease, lease_receipt_hash: '0'.repeat(64) },
  }), 'LEASE_TAMPERED');
  const {
    lease_receipt_hash: ignoredLeaseHash,
    lease_signature: preservedLeaseSignature,
    ...forgedLeaseBody
  } = {
    ...lease,
    token: 'lease_attacker_selected',
    expires_at: '2099-01-01T00:00:00.000Z',
  };
  void ignoredLeaseHash;
  expectCode(() => mockExecutor(store).execute({
    mission,
    authorization: restoredAuthorization,
    sandboxRoot: repository.root,
    operation: operation(),
    now: NOW,
    lease: {
      ...forgedLeaseBody,
      lease_receipt_hash: hashCanonical(forgedLeaseBody),
      lease_signature: preservedLeaseSignature,
    },
  }), 'LEASE_AUTHENTICITY_DENIED');
  const execution = mockExecutor(store).execute({
    mission,
    authorization: restoredAuthorization,
    sandboxRoot: repository.root,
    operation: operation(),
    now: NOW,
    lease: structuredClone(lease),
  });
  assert.equal(execution.authorization_receipt_hash, authorization.authorization_receipt_hash);

  const pausedStore = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-paused-auth-')));
  const pausedKernel = new AutonomyKernel({ store: pausedStore, clock: () => NOW });
  pausedKernel.observeSignal(seed, { signal_id: 'signal', tenant_id: TENANT, workspace_id: WORKSPACE });
  pausedKernel.pause(mission, 'pause before context');
  expectCode(
    () => pausedKernel.dispatch(mission, EXECUTOR, 60_000),
    'DISPATCH_BEFORE_AUTHORIZATION',
  );
});

test('durable event log reconstructs after restart and detects mutation, deletion, and reordering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-store-'));
  const store = new MissionStore(root);
  const mission = { mission_id: 'm', tenant_id: TENANT, workspace_id: WORKSPACE };
  store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'SIGNAL_OBSERVED', actor: 'RSI', occurredAt: NOW.toISOString(), expectedVersion: 0 });
  store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'CONTEXT_COMPILED', actor: 'RSI', occurredAt: NOW.toISOString(), expectedVersion: 1 });
  const forgedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-first-auth-'));
  expectCode(() => new MissionStore(forgedRoot).append({
    missionId: 'forged',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    lifecycleState: 'CANA_AUTHORIZED',
    actor: 'CANA_DURABLE_AUTHORITY',
    occurredAt: NOW.toISOString(),
    expectedVersion: 0,
    payload: { authorization_receipt_hash: 'a'.repeat(64) },
  }), 'INVALID_INITIAL_STATE');
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

test('durable store repairs valid crash windows but detects coordinated tail deletion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-crash-window-'));
  const store = new MissionStore(root);
  store.append({
    missionId: 'm',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    lifecycleState: 'SIGNAL_OBSERVED',
    actor: 'RSI',
    occurredAt: NOW.toISOString(),
    expectedVersion: 0,
  });
  const oneEventHead = fs.readFileSync(store.headFile);
  const oneEventProjection = fs.readFileSync(store.projectionFile);
  store.append({
    missionId: 'm',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    lifecycleState: 'CONTEXT_COMPILED',
    actor: 'RSI',
    occurredAt: NOW.toISOString(),
    expectedVersion: 1,
  });
  fs.writeFileSync(store.headFile, oneEventHead);
  fs.writeFileSync(store.projectionFile, oneEventProjection);
  const recovered = new MissionStore(root).reconstruct();
  assert.equal(recovered.event_count, 2);
  assert.equal(recovered.missions.m.current_lifecycle_state, 'CONTEXT_COMPILED');
  assert.equal(JSON.parse(fs.readFileSync(store.headFile, 'utf8')).event_count, 2);
  assert.equal(JSON.parse(fs.readFileSync(store.projectionFile, 'utf8')).event_count, 2);

  const lines = fs.readFileSync(store.eventsFile, 'utf8').trimEnd().split('\n');
  fs.writeFileSync(store.eventsFile, `${lines[0]}\n`);
  fs.unlinkSync(store.projectionFile);
  expectCode(() => new MissionStore(root).reconstruct(), 'EVENT_DELETION_DETECTED');

  const forgedHead = {
    schema_version: 'cana.mission-store-head/2.0.0',
    event_count: 1,
    last_event_hash: JSON.parse(lines[0]).event_hash,
  };
  fs.writeFileSync(store.headFile, `${canonicalize({
    ...forgedHead,
    head_hash: hashCanonical(forgedHead),
  })}\n`);
  expectCode(() => new MissionStore(root).reconstruct(), 'HEAD_ANCHOR_CORRUPT');
});

test('durable head anchor requires its private external key after state exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-anchor-key-'));
  const store = new MissionStore(root);
  store.append({
    missionId: 'm',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    lifecycleState: 'SIGNAL_OBSERVED',
    actor: 'RSI',
    occurredAt: NOW.toISOString(),
    expectedVersion: 0,
  });
  fs.unlinkSync(store.anchorKeyFile);
  expectCode(() => new MissionStore(root), 'HEAD_ANCHOR_KEY_MISSING');

  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-anchor-key-link-'));
  const symlinkStore = new MissionStore(symlinkRoot);
  const outsideKey = `${symlinkRoot}.outside-key`;
  fs.renameSync(symlinkStore.anchorKeyFile, outsideKey);
  fs.symlinkSync(outsideKey, symlinkStore.anchorKeyFile);
  expectCode(() => new MissionStore(symlinkRoot), 'HEAD_ANCHOR_KEY_SYMLINK_DENIED');
});

test('durable store recovers a dead-process append lock and rejects a live lock', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-stale-lock-'));
  const store = new MissionStore(root);
  fs.writeFileSync(store.lockFile, `${canonicalize({
    schema_version: 'cana.mission-store-lock/1.0.0',
    pid: 2_147_483_647,
    nonce: 'a'.repeat(32),
  })}\n`, { mode: 0o600 });
  store.append({
    missionId: 'm',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    lifecycleState: 'SIGNAL_OBSERVED',
    actor: 'RSI',
    occurredAt: NOW.toISOString(),
    expectedVersion: 0,
  });
  assert.equal(store.reconstruct().event_count, 1);
  fs.writeFileSync(store.lockFile, `${canonicalize({
    schema_version: 'cana.mission-store-lock/1.0.0',
    pid: process.pid,
    nonce: 'b'.repeat(32),
  })}\n`, { mode: 0o600 });
  expectCode(() => store.append({
    missionId: 'm',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    lifecycleState: 'CONTEXT_COMPILED',
    actor: 'RSI',
    occurredAt: NOW.toISOString(),
    expectedVersion: 1,
  }), 'STORE_LOCKED');
});

test('durable store and evidence paths reject symlink roots, parents, and targets', () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-store-real-'));
  const rootLink = `${targetRoot}-link`;
  fs.symlinkSync(targetRoot, rootLink);
  expectCode(() => new MissionStore(rootLink), 'STORE_ROOT_SYMLINK_DENIED');

  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-evidence-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-evidence-outside-'));
  fs.symlinkSync(outside, path.join(evidenceRoot, 'evidence'));
  expectCode(() => new MissionStore(evidenceRoot), 'EVIDENCE_SYMLINK_DENIED');

  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-evidence-target-')));
  const value = { stable: true };
  const digest = sha256(canonicalize(value));
  const outsideFile = path.join(outside, 'outside.json');
  fs.writeFileSync(outsideFile, canonicalize(value));
  fs.symlinkSync(outsideFile, path.join(store.evidenceDirectory, `${digest}.json`));
  expectCode(() => store.writeEvidence(value), 'EVIDENCE_SYMLINK_DENIED');

  const replaced = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-evidence-parent-')));
  fs.rmdirSync(replaced.evidenceDirectory);
  fs.symlinkSync(outside, replaced.evidenceDirectory);
  expectCode(() => replaced.writeEvidence({ redirected: true }), 'EVIDENCE_SYMLINK_DENIED');
});

test('illegal lifecycle transitions fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-illegal-'));
  const store = new MissionStore(root);
  store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'SIGNAL_OBSERVED', actor: 'RSI', occurredAt: NOW.toISOString(), expectedVersion: 0 });
  expectCode(() => store.append({ missionId: 'm', tenantId: TENANT, workspaceId: WORKSPACE, lifecycleState: 'PROMOTED', actor: 'CANA', occurredAt: NOW.toISOString(), expectedVersion: 1 }), 'ILLEGAL_TRANSITION');
});

test('dispatch rejects a lifecycle-shaped authorization without durable receipt evidence', () => {
  const { repository, mission } = setup();
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-forged-auth-chain-')));
  for (const [version, lifecycleState] of [
    [0, 'SIGNAL_OBSERVED'],
    [1, 'CONTEXT_COMPILED'],
    [2, 'MISSION_SEALED'],
    [3, 'CANA_AUTHORIZED'],
  ]) {
    store.append({
      missionId: mission.mission_id,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      lifecycleState,
      actor: 'CANA_DURABLE_AUTHORITY',
      occurredAt: NOW.toISOString(),
      expectedVersion: version,
      payload: lifecycleState === 'CANA_AUTHORIZED'
        ? { authorization_receipt_hash: 'a'.repeat(64) }
        : {},
    });
  }
  const kernel = new AutonomyKernel({ store, clock: () => NOW });
  expectCode(
    () => kernel.dispatch(mission, EXECUTOR, 60_000),
    'AUTHORIZATION_REQUIRED',
  );
  assert.equal(runGit(repository.root, ['status', '--short']), '');
});

test('mock executor changes only one authorized file with no provider, spend, or external effect', () => {
  const { repository, mission, authorization, lease, store } = authorizedSetup();
  const executor = mockExecutor(store);
  assertLeaseReceipt({
    lease,
    missionId: mission.mission_id,
    authorizationReceiptHash: authorization.authorization_receipt_hash,
    workerId: EXECUTOR,
    now: NOW,
    authorityPublicKey: store.leaseAuthority().publicKey,
  });
  assert.equal(executor.leaseAuthorityPublicKey, store.leaseAuthority().publicKey);
  const receipt = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease });
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), NOTICE);
  assert.deepEqual(receipt.changed_files.map((change) => change.path), [TARGET]);
  assert.equal(receipt.external_effect_count, 0);
  assert.equal(receipt.provider_calls, 0);
  assert.equal(receipt.spend_usd, 0);
  assert.equal(receipt.production_modified, false);
});

test('mock executor supports deterministic interruption, resume, rollback, and reapply', () => {
  const { repository, mission, authorization, lease, store } = authorizedSetup();
  const executor = mockExecutor(store);
  const interrupted = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease, interruptAfterCheckpoint: true });
  assert.equal(interrupted.interrupted, true);
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), BEFORE_TEXT);
  expectCode(
    () => executor.execute({
      mission,
      authorization,
      sandboxRoot: repository.root,
      operation: operation(),
      now: NOW,
      lease,
      interruptBeforeAtomicRename: true,
    }),
    'WORKER_INTERRUPTED_BEFORE_ATOMIC_RENAME',
  );
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), BEFORE_TEXT);
  const receipt = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease });
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), NOTICE);
  executor.rollback({ sandboxRoot: repository.root, executionReceipt: receipt });
  expectCode(
    () => executor.execute({
      mission,
      authorization,
      sandboxRoot: repository.root,
      operation: operation(),
      now: NOW,
      lease,
      interruptAfterMutation: true,
    }),
    'WORKER_INTERRUPTED_AFTER_ATOMIC_RENAME',
  );
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), NOTICE);
  assert.equal(
    executor.execute({
      mission,
      authorization,
      sandboxRoot: repository.root,
      operation: operation(),
      now: NOW,
      lease,
    }).execution_receipt_hash,
    receipt.execution_receipt_hash,
  );
  expectCode(
    () => executor.rollback({
      sandboxRoot: repository.root,
      executionReceipt: {
        ...roundTripExecution(receipt),
        execution_receipt_hash: '0'.repeat(64),
      },
    }),
    'EXECUTION_RECEIPT_TAMPERED',
  );
  expectCode(
    () => executor.rollback({
      sandboxRoot: repository.root,
      executionReceipt: receipt,
      interruptAfterMutation: true,
    }),
    'ROLLBACK_INTERRUPTED',
  );
  const rollback = executor.rollback({ sandboxRoot: repository.root, executionReceipt: receipt });
  assert.equal(rollback.exact_bytes_restored, true);
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), BEFORE_TEXT);
  expectCode(
    () => executor.reapply({
      sandboxRoot: repository.root,
      executionReceipt: receipt,
      interruptAfterMutation: true,
    }),
    'REAPPLY_INTERRUPTED',
  );
  assert.equal(executor.reapply({ sandboxRoot: repository.root, executionReceipt: receipt }).exact_bytes_reapplied, true);
  assert.equal(fs.readFileSync(path.join(repository.root, TARGET), 'utf8'), NOTICE);
});

test('mock executor rejects unauthorized, expired, widened, dirty, and symlink targets', () => {
  const {
    repository,
    contextPacket,
    mission,
    authorization,
    lease,
    store,
  } = authorizedSetup();
  const executor = mockExecutor(store);
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
  const noWriteStore = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-no-write-')));
  const noWriteKernel = new AutonomyKernel({ store: noWriteStore, clock: () => NOW });
  const seed = missionSeed(repository);
  noWriteKernel.observeSignal(seed, { signal_id: 'signal', tenant_id: TENANT, workspace_id: WORKSPACE });
  noWriteKernel.recordContext(seed, contextPacket);
  noWriteKernel.sealMission(noWrite);
  noWriteKernel.recordAuthorization(noWrite, noWriteAuth);
  const noWriteLease = noWriteKernel.dispatch(noWrite, EXECUTOR, 60_000);
  expectCode(() => mockExecutor(noWriteStore).execute({
    mission: noWrite,
    authorization: noWriteAuth,
    sandboxRoot: repository.root,
    operation: operation(),
    now: NOW,
    lease: noWriteLease,
  }), 'CAPABILITY_DENIED');
  fs.writeFileSync(path.join(repository.root, 'untracked'), 'dirty');
  expectCode(() => executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease }), 'DIRTY_SANDBOX_DENIED');
  fs.unlinkSync(path.join(repository.root, 'untracked'));
  fs.renameSync(path.join(repository.root, TARGET), path.join(repository.root, 'docs/real.md'));
  fs.symlinkSync('real.md', path.join(repository.root, TARGET));
  expectCode(() => executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease }), 'SYMLINK_TARGET_DENIED');
});

test('independent verifier cannot be the executor and rejects forged evidence', () => {
  const { repository, mission, authorization, lease, store } = authorizedSetup();
  const executor = mockExecutor(store);
  const receipt = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease });
  const verify = (executionReceipt, overrides = {}) => verifySeparately({
    store,
    mission,
    authorization,
    executionReceipt,
    sandboxRoot: repository.root,
    operation: operation(),
    lease,
    now: NOW,
    expectedText: 'Superseded:',
    ...overrides,
  });
  assert.equal(verify(receipt).verdict, 'APPROVE');
  expectCode(() => verifySeparately({
    store,
    mission: { ...mission, verifier_identity: EXECUTOR },
    authorization: { ...authorization, verifier_identity: EXECUTOR },
    executionReceipt: receipt,
    sandboxRoot: repository.root,
    operation: operation(),
    lease,
    now: NOW,
    expectedText: 'Superseded:',
  }), 'EXECUTOR_SELF_VERIFICATION_DENIED');
  const forged = { ...receipt, changed_files: [{ ...receipt.changed_files[0], after_sha256: '0'.repeat(64) }] };
  assert.equal(verify(forged).verdict, 'REJECT');
  assert.equal(verify({ ...receipt, execution_receipt_hash: '0'.repeat(64) }).verdict, 'REJECT');
  assert.equal(verify({
    ...receipt,
    command: { ...receipt.command, find_sha256: '0'.repeat(64) },
  }).verdict, 'REJECT');
  assert.equal(verify({
    ...receipt,
    before_bytes: Buffer.alloc(0),
    after_bytes: Buffer.alloc(0),
  }).verdict, 'REJECT');
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
  const activeLease = kernel.heartbeat(mission, lease.token);
  const executor = mockExecutor(store);
  const execution = executor.execute({ mission, authorization, sandboxRoot: repository.root, operation: operation(), now: NOW, lease: activeLease });
  expectCode(() => kernel.recordExecution(mission, authorization, { ...activeLease, token: 'stale' }, execution), 'STALE_WORKER_COMPLETION');
  expectCode(
    () => kernel.recordExecution(mission, authorization, activeLease, {
      ...roundTripExecution(execution),
      execution_receipt_hash: '0'.repeat(64),
    }),
    'EXECUTION_RECEIPT_TAMPERED',
  );
  const restoredExecution = roundTripExecution(execution);
  kernel.recordExecution(
    mission,
    structuredClone(authorization),
    structuredClone(activeLease),
    restoredExecution,
  );
  kernel.captureEvidence(mission, restoredExecution);
  const verifierReceipt = verifySeparately({
    store,
    mission,
    authorization,
    executionReceipt: restoredExecution,
    sandboxRoot: repository.root,
    operation: operation(),
    lease: activeLease,
    now: NOW,
    expectedText: 'Superseded:',
  });
  const verificationContext = {
    sandboxRoot: repository.root,
    operation: operation(),
    lease: activeLease,
    expectedText: 'Superseded:',
  };
  const {
    verifier_receipt_hash: ignoredVerifierHash,
    ...forgedVerifierBody
  } = {
    ...verifierReceipt,
    checks: { fabricated: true },
    verdict: 'APPROVE',
    implementation_mutated: false,
  };
  void ignoredVerifierHash;
  const forgedVerifierReceipt = {
    ...forgedVerifierBody,
    verifier_receipt_hash: hashCanonical(forgedVerifierBody),
  };
  expectCode(
    () => kernel.recordVerification(
      mission,
      authorization,
      restoredExecution,
      forgedVerifierReceipt,
      verificationContext,
    ),
    'FORGED_VERIFIER_RECEIPT_DENIED',
  );
  expectCode(
    () => kernel.recordVerification(
      mission,
      authorization,
      restoredExecution,
      { ...verifierReceipt, verifier_receipt_hash: '0'.repeat(64) },
      verificationContext,
    ),
    'VERIFIER_RECEIPT_TAMPERED',
  );
  const restoredVerifierReceipt = structuredClone(verifierReceipt);
  validateReceiptsInFreshProcess({
    mission,
    authorization: structuredClone(authorization),
    lease: structuredClone(activeLease),
    execution: {
      ...restoredExecution,
      before_bytes: restoredExecution.before_bytes.toString('base64'),
      after_bytes: restoredExecution.after_bytes.toString('base64'),
    },
    verifier: restoredVerifierReceipt,
    leaseAuthorityPublicKey: store.leaseAuthority().publicKey,
    now: NOW.toISOString(),
  });
  kernel.recordVerification(
    mission,
    structuredClone(authorization),
    restoredExecution,
    restoredVerifierReceipt,
    verificationContext,
  );
  expectCode(() => kernel.updateTruthGraph(mission, verifierReceipt, { state: 'TECHNICALLY_VERIFIED', claim: 'fixed' }), 'TRUTH_UPDATE_BEFORE_PROMOTION');
  kernel.decidePromotion(
    mission,
    structuredClone(authorization),
    restoredExecution,
    structuredClone(restoredVerifierReceipt),
    verificationContext,
  );
  const truth = kernel.updateTruthGraph(mission, restoredVerifierReceipt, { state: 'TECHNICALLY_VERIFIED', claim: 'The stale canonical status is superseded.' });
  const winner = kernel.updateWinnerMemory(mission, truth, {
    exact_success_conditions: ['exact notice inserted', 'history preserved'],
    reusable_boundaries: ['documentation-only', 'no commercial value claim'],
    failure_conditions: ['source hash drift', 'notice duplication'],
    evidence: [restoredVerifierReceipt.verifier_receipt_hash],
    revalidate_after: EXPIRES,
  });
  assert.equal(winner.value_state, 'VALUE_NOT_ESTABLISHED');
  assert.equal(winner.commercial_value_claimed, false);
  assert.equal(kernel.projection(mission.mission_id).current_lifecycle_state, 'WINNER_MEMORY_UPDATED');
  const rollback = executor.rollback({
    sandboxRoot: repository.root,
    executionReceipt: restoredExecution,
  });
  expectCode(
    () => kernel.recordRollback(mission, restoredExecution, {
      ...rollback,
      rollback_receipt_hash: '0'.repeat(64),
    }),
    'ROLLBACK_RECEIPT_TAMPERED',
  );
  kernel.recordRollback(mission, restoredExecution, structuredClone(rollback));
  assert.equal(kernel.projection(mission.mission_id).current_lifecycle_state, 'ROLLED_BACK');
});

test('rejected mission cannot update TruthGraph or Winner Memory', () => {
  const {
    repository,
    seed,
    contextPacket,
    mission,
    authorization,
  } = setup();
  const store = new MissionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cana-m2-reject-')));
  const kernel = new AutonomyKernel({ store, clock: () => NOW });
  kernel.observeSignal(seed, { signal_id: 'signal', tenant_id: TENANT, workspace_id: WORKSPACE });
  kernel.recordContext(seed, contextPacket);
  kernel.sealMission(mission);
  kernel.recordAuthorization(mission, authorization);
  const lease = kernel.dispatch(mission, EXECUTOR, 60_000);
  const execution = mockExecutor(store).execute({
    mission,
    authorization,
    sandboxRoot: repository.root,
    operation: operation(),
    now: NOW,
    lease,
  });
  kernel.recordExecution(mission, authorization, lease, execution);
  kernel.captureEvidence(mission, execution);
  const rejection = verifySeparately({
    store,
    mission,
    authorization,
    executionReceipt: execution,
    sandboxRoot: repository.root,
    operation: operation(),
    lease,
    now: NOW,
    expectedText: 'text that is deliberately absent',
  });
  assert.equal(rejection.verdict, 'REJECT');
  const verificationContext = {
    sandboxRoot: repository.root,
    operation: operation(),
    lease,
    expectedText: 'text that is deliberately absent',
  };
  kernel.recordVerification(
    mission,
    authorization,
    execution,
    rejection,
    verificationContext,
  );
  kernel.decidePromotion(
    mission,
    authorization,
    execution,
    rejection,
    verificationContext,
  );
  expectCode(() => kernel.updateTruthGraph(mission, rejection, { state: 'TECHNICALLY_VERIFIED', claim: 'forged' }), 'TRUTH_UPDATE_BEFORE_PROMOTION');
  expectCode(() => kernel.updateWinnerMemory(mission, { state: 'TECHNICALLY_VERIFIED' }, {}), 'WINNER_MEMORY_BEFORE_TRUTH');
  assert.equal(kernel.projection(mission.mission_id).current_lifecycle_state, 'REJECTED');
});

test('retry classification is bounded and exhaustion is durable', () => {
  let clock = new Date(NOW);
  const {
    store,
    kernel,
    mission,
    lease,
  } = authorizedSetup(() => clock);
  assert.ok(lease.token);
  kernel.recordFailure(mission, 'WORKER_INTERRUPTED', { maximum_attempts: 2, backoff_ms: 10 });
  assert.equal(kernel.projection(mission.mission_id).current_lifecycle_state, 'PAUSED');
  expectCode(() => kernel.resume(mission), 'RETRY_BACKOFF_ACTIVE');
  expectCode(() => kernel.dispatch(mission, EXECUTOR, 60_000), 'DISPATCH_BEFORE_AUTHORIZATION');
  clock = new Date(NOW.getTime() + 10);
  kernel.resume(mission);
  kernel.dispatch(mission, EXECUTOR, 60_000);
  kernel.recordFailure(mission, 'WORKER_INTERRUPTED', { maximum_attempts: 2, backoff_ms: 10 });
  const state = new MissionStore(store.root).reconstruct().missions[mission.mission_id];
  assert.equal(state.current_lifecycle_state, 'DEAD_LETTER');
  assert.equal(state.failure_history.at(-1).maximum_attempts, 2);
  kernel.ownerDecision(mission, 'Owner must decide whether to create a new mission');
  assert.equal(
    new MissionStore(store.root).reconstruct().missions[mission.mission_id].current_lifecycle_state,
    'OWNER_DECISION_REQUIRED',
  );
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
  const common = {
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    source_hash: sourceHash,
    provenance: TRANSCRIPT_FIXTURE_LABEL,
  };
  const validByType = {
    SOURCE_RECORD: {
      ...common,
      truth_state: 'SOURCE_ONLY',
      title: 'source',
      source_kind: 'DETERMINISTIC_FIXTURE',
      fixture_label: TRANSCRIPT_FIXTURE_LABEL,
    },
    INSIGHT_CAPSULE: {
      ...common,
      truth_state: 'SOURCE_ONLY',
      source_record_id: 'source_record_x',
      statement: 'bounded insight',
      authority_classification: 'SOURCE_ONLY',
    },
    DUPLICATE_RELATIONSHIP: {
      ...common,
      truth_state: 'SOURCE_ONLY',
      canonical_record_id: 'source_record_x',
      duplicate_record_id: 'source_record_y',
      relationship_basis: 'same source hash',
    },
    CONTRADICTION_RECORD: {
      ...common,
      truth_state: 'SOURCE_ONLY',
      claims: ['claim one', 'claim two'],
      resolution_state: 'OPEN',
      deleted: false,
    },
    RESEARCH_GAP: {
      ...common,
      truth_state: 'SOURCE_ONLY',
      source_record_id: 'source_record_x',
      question: 'What remains unproven?',
      answer_state: 'UNPROVEN',
    },
    MECHANISM_CANDIDATE: {
      ...common,
      truth_state: 'MECHANISM_CANDIDATE',
      source_record_id: 'source_record_x',
      insight_capsule_id: 'insight_capsule_x',
      mechanism_key: 'same',
      desired_state: 10,
      measured_state: 7,
      bounded_error: 3,
      intervention: 1,
      falsification_test: 'fails',
      rollback: 'restore',
      commercial_value_claimed: false,
    },
    CODEX_HANDOFF_PACKET: {
      ...common,
      truth_state: 'AUTHORIZED_FOR_SHADOW_TEST',
      mechanism_candidate_id: 'mechanism_candidate_x',
      authorized_adapter: 'DETERMINISTIC_MOCK',
      provider: 'NONE',
      hermes: 'DISABLED',
      budget_usd: 0,
    },
    IMPLEMENTATION_RESULT: {
      ...common,
      truth_state: 'TECHNICALLY_VERIFIED',
      mechanism_candidate_id: 'mechanism_candidate_x',
      handoff_packet_id: 'codex_handoff_packet_x',
      test_result: 'PASS',
      measured_before: 7,
      measured_after: 8,
      bounded_intervention: 1,
      external_effects: 0,
      commercial_value_claimed: false,
    },
    MECHANISM_STATE_TRANSITION: {
      ...common,
      truth_state: 'TECHNICALLY_VERIFIED',
      mechanism_candidate_id: 'mechanism_candidate_x',
      from_state: 'AUTHORIZED_FOR_SHADOW_TEST',
      to_state: 'TECHNICALLY_VERIFIED',
      implementation_result_id: 'implementation_result_x',
      value_state: 'VALUE_NOT_ESTABLISHED',
    },
    OWNER_DECISION_REQUEST: {
      ...common,
      truth_state: 'SOURCE_ONLY',
      authority_requirement: 'OWNER',
      question: 'Choose a business direction?',
      options: ['option one', 'option two'],
    },
  };
  for (const [type, valid] of Object.entries(validByType)) {
    assert.equal(validateFoundryRecord(type, valid).type, type);
    const typeSpecificField = Object.keys(valid).find((field) => !Object.hasOwn(common, field) && field !== 'truth_state');
    const malformed = { ...valid };
    delete malformed[typeSpecificField];
    expectCode(() => validateFoundryRecord(type, malformed), 'FOUNDRY_SCHEMA_FIELDS_DENIED');
  }
  expectCode(
    () => validateFoundryRecord('SOURCE_RECORD', { ...validByType.SOURCE_RECORD, neighboring_field: true }),
    'FOUNDRY_SCHEMA_FIELDS_DENIED',
  );

  const foundry = new KnowledgeToMechanismFoundry();
  const source = foundry.admit('SOURCE_RECORD', validByType.SOURCE_RECORD);
  const insight = foundry.admit('INSIGHT_CAPSULE', {
    ...validByType.INSIGHT_CAPSULE,
    source_record_id: source.record_id,
  });
  const mechanism = {
    ...validByType.MECHANISM_CANDIDATE,
    source_record_id: source.record_id,
    insight_capsule_id: insight.record_id,
  };
  foundry.admit('MECHANISM_CANDIDATE', mechanism);
  expectCode(() => foundry.admit('MECHANISM_CANDIDATE', { ...mechanism, source_hash: sha256('other') }), 'DUPLICATE_MECHANISM_ID');
  expectCode(
    () => foundry.admit('DUPLICATE_RELATIONSHIP', validByType.DUPLICATE_RELATIONSHIP),
    'FOUNDRY_REFERENCE_MISSING',
  );
  expectCode(() => validateFoundryRecord('SOURCE_RECORD', { ...validByType.SOURCE_RECORD, truth_state: 'VALUE_PROVEN' }), 'UNSUPPORTED_VALUE_PROVEN');
  expectCode(() => validateFoundryRecord('SOURCE_RECORD', { ...validByType.SOURCE_RECORD, raw_transcript: true }), 'RAW_TRANSCRIPT_HOT_MEMORY_DENIED');
  expectCode(() => validateFoundryRecord('CONTRADICTION_RECORD', { ...validByType.CONTRADICTION_RECORD, deleted: true }), 'CONTRADICTION_DELETION_DENIED');
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
