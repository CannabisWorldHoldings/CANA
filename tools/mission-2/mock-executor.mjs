import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertMission,
  constantTimeEqual,
  deepFreeze,
  hashCanonical,
  normalizeExactPath,
  sha256,
} from './canonical.mjs';
import { assertAuthorizationReceipt } from './authorization.mjs';
import { assertAdmittedLease, assertLeaseReceipt } from './lease.mjs';

const admittedExecutionReceipts = new WeakSet();
const admittedRollbackReceipts = new WeakSet();

function git(root, args) {
  const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  });
  assertMission(result.status === 0, 'GIT_COMMAND_FAILED', `git ${args.join(' ')} failed`, {
    stderr: result.stderr.trim(),
  });
  return result.stdout.trim();
}

function assertNoSymlink(root, relativePath) {
  const rootReal = fs.realpathSync(root);
  let current = rootReal;
  for (const part of relativePath.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    assertMission(!stat.isSymbolicLink(), 'SYMLINK_TARGET_DENIED', `Symlink component denied: ${relativePath}`);
  }
  const targetReal = fs.realpathSync(current);
  const relation = path.relative(rootReal, targetReal);
  assertMission(relation && !relation.startsWith('..') && !path.isAbsolute(relation), 'TARGET_ESCAPE_DENIED', 'Target escaped sandbox');
  return targetReal;
}

function writeSameFile(file, before, after) {
  const flags = fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(file, flags);
  try {
    const beforeStat = fs.fstatSync(descriptor);
    const pathStat = fs.statSync(file);
    assertMission(beforeStat.dev === pathStat.dev && beforeStat.ino === pathStat.ino, 'TARGET_REPLACED', 'Validated target was replaced before use');
    const current = fs.readFileSync(descriptor);
    assertMission(current.equals(before), 'TARGET_REPLACED', 'Validated target bytes changed before use');
    fs.ftruncateSync(descriptor, 0);
    fs.writeSync(descriptor, after, 0, after.length, 0);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function executionBody(receipt) {
  return {
    schema_version: receipt.schema_version,
    mission_id: receipt.mission_id,
    authorization_receipt_hash: receipt.authorization_receipt_hash,
    executor_identity: receipt.executor_identity,
    source_commit: receipt.source_commit,
    source_tree: receipt.source_tree,
    lease_token: receipt.lease_token,
    lease_receipt_hash: receipt.lease_receipt_hash,
    executed_at: receipt.executed_at,
    changed_files: receipt.changed_files,
    command: receipt.command,
    checkpoint: receipt.checkpoint,
    external_effect_count: receipt.external_effect_count,
    provider_calls: receipt.provider_calls,
    spend_usd: receipt.spend_usd,
    production_modified: receipt.production_modified,
  };
}

export function assertExecutionReceipt({
  mission,
  authorization,
  lease,
  executionReceipt,
  requireAdmission = false,
}) {
  assertMission(
    executionReceipt && typeof executionReceipt === 'object',
    'EXECUTION_RECEIPT_REQUIRED',
    'An execution receipt is required',
  );
  if (requireAdmission) {
    assertMission(
      admittedExecutionReceipts.has(executionReceipt),
      'FORGED_EXECUTION_RECEIPT_DENIED',
      'Execution receipt was not produced by the deterministic mock adapter',
    );
  }
  const body = executionBody(executionReceipt);
  const expectedKeys = [
    ...Object.keys(body),
    'execution_receipt_hash',
    'before_bytes',
    'after_bytes',
  ].sort();
  assertMission(
    JSON.stringify(Object.keys(executionReceipt).sort()) === JSON.stringify(expectedKeys),
    'EXECUTION_RECEIPT_MALFORMED',
    'Execution receipt fields differ from the canonical schema',
  );
  assertMission(
    constantTimeEqual(executionReceipt.execution_receipt_hash, hashCanonical(body)),
    'EXECUTION_RECEIPT_TAMPERED',
    'Execution receipt hash does not recompute',
  );
  assertMission(
    executionReceipt.schema_version === 'cana.mock-execution-receipt/2.0.0',
    'EXECUTION_RECEIPT_TAMPERED',
    'Execution receipt schema is invalid',
  );
  assertMission(executionReceipt.mission_id === mission.mission_id, 'EXECUTION_MISSION_MISMATCH', 'Execution mission differs');
  assertMission(
    executionReceipt.authorization_receipt_hash === authorization.authorization_receipt_hash,
    'EXECUTION_AUTHORIZATION_MISMATCH',
    'Execution authorization differs',
  );
  assertMission(
    executionReceipt.executor_identity === authorization.executor_identity,
    'EXECUTOR_IDENTITY_MISMATCH',
    'Execution receipt names a different executor',
  );
  assertMission(
    executionReceipt.source_commit === mission.source_commit
      && executionReceipt.source_tree === mission.source_tree,
    'EXECUTION_SOURCE_MISMATCH',
    'Execution receipt source differs from the sealed mission',
  );
  assertMission(
    executionReceipt.lease_token === lease.token
      && executionReceipt.lease_receipt_hash === lease.lease_receipt_hash,
    'EXECUTION_LEASE_MISMATCH',
    'Execution receipt is not bound to the admitted worker lease',
  );
  const executedAt = new Date(executionReceipt.executed_at);
  assertMission(!Number.isNaN(executedAt.getTime()), 'EXECUTION_RECEIPT_TAMPERED', 'Execution timestamp is invalid');
  assertAuthorizationReceipt({
    mission,
    authorization,
    now: executedAt,
    executorIdentity: executionReceipt.executor_identity,
  });
  assertLeaseReceipt({
    lease,
    missionId: mission.mission_id,
    authorizationReceiptHash: authorization.authorization_receipt_hash,
    workerId: executionReceipt.executor_identity,
    now: executedAt,
  });
  assertMission(
    Array.isArray(executionReceipt.changed_files) && executionReceipt.changed_files.length === 1,
    'EXECUTION_RECEIPT_TAMPERED',
    'Deterministic mock receipt must contain one exact changed file',
  );
  const change = executionReceipt.changed_files[0];
  const relativePath = normalizeExactPath(change.path);
  assertMission(
    mission.permitted_files.includes(relativePath),
    'UNAUTHORIZED_CHANGE_DETECTED',
    'Execution receipt includes an unauthorized file',
  );
  assertMission(
    Buffer.isBuffer(executionReceipt.before_bytes) && Buffer.isBuffer(executionReceipt.after_bytes),
    'EXECUTION_RECEIPT_TAMPERED',
    'Execution receipt must carry exact before and after bytes',
  );
  assertMission(
    sha256(executionReceipt.before_bytes) === change.before_sha256
      && sha256(executionReceipt.after_bytes) === change.after_sha256
      && executionReceipt.before_bytes.length === change.before_bytes
      && executionReceipt.after_bytes.length === change.after_bytes,
    'EXECUTION_RECEIPT_TAMPERED',
    'Execution before/after bytes do not match the declared change',
  );
  assertMission(
    executionReceipt.command?.kind === 'REPLACE_EXACT_TEXT'
      && executionReceipt.command.path === relativePath
      && executionReceipt.checkpoint?.path === relativePath
      && executionReceipt.checkpoint.before_sha256 === change.before_sha256
      && executionReceipt.checkpoint.planned_after_sha256 === change.after_sha256
      && executionReceipt.checkpoint.lease_token === lease.token,
    'EXECUTION_RECEIPT_TAMPERED',
    'Execution command or checkpoint is not bound to the exact change',
  );
  assertMission(
    executionReceipt.external_effect_count === 0
      && executionReceipt.provider_calls === 0
      && executionReceipt.spend_usd === 0
      && executionReceipt.production_modified === false,
    'EXECUTION_BOUNDARY_DENIED',
    'Execution receipt reports a forbidden effect',
  );
  return executionReceipt;
}

export function assertRollbackReceipt({
  mission,
  executionReceipt,
  rollbackReceipt,
  requireAdmission = false,
}) {
  assertMission(
    rollbackReceipt && typeof rollbackReceipt === 'object',
    'ROLLBACK_RECEIPT_REQUIRED',
    'An exact rollback receipt is required',
  );
  if (requireAdmission) {
    assertMission(
      admittedRollbackReceipts.has(rollbackReceipt),
      'FORGED_ROLLBACK_RECEIPT_DENIED',
      'Rollback receipt was not produced by the deterministic mock adapter',
    );
  }
  const body = {
    schema_version: rollbackReceipt.schema_version,
    mission_id: rollbackReceipt.mission_id,
    execution_receipt_hash: rollbackReceipt.execution_receipt_hash,
    path: rollbackReceipt.path,
    restored_sha256: rollbackReceipt.restored_sha256,
    exact_bytes_restored: rollbackReceipt.exact_bytes_restored,
  };
  const expectedKeys = [...Object.keys(body), 'rollback_receipt_hash'].sort();
  assertMission(
    JSON.stringify(Object.keys(rollbackReceipt).sort()) === JSON.stringify(expectedKeys)
      && constantTimeEqual(rollbackReceipt.rollback_receipt_hash, hashCanonical(body)),
    'ROLLBACK_RECEIPT_TAMPERED',
    'Rollback receipt does not match the canonical body',
  );
  const change = executionReceipt.changed_files[0];
  assertMission(
    rollbackReceipt.schema_version === 'cana.mock-rollback-receipt/2.0.0'
      && rollbackReceipt.mission_id === mission.mission_id
      && rollbackReceipt.execution_receipt_hash === executionReceipt.execution_receipt_hash
      && rollbackReceipt.path === change.path
      && rollbackReceipt.restored_sha256 === change.before_sha256
      && rollbackReceipt.exact_bytes_restored === true,
    'ROLLBACK_RECEIPT_TAMPERED',
    'Rollback receipt is not bound to the exact execution',
  );
  return rollbackReceipt;
}

export class DeterministicMockExecutor {
  constructor(identity = 'DETERMINISTIC_MOCK_EXECUTOR_V1') {
    this.identity = identity;
  }

  execute({ mission, authorization, sandboxRoot, operation, now, lease, interruptAfterCheckpoint = false }) {
    assertMission(
      new Date(authorization?.expires_at).getTime() > now.getTime(),
      'EXECUTION_AFTER_EXPIRY',
      'Execution authorization expired',
    );
    assertAuthorizationReceipt({
      mission,
      authorization,
      now,
      executorIdentity: this.identity,
    });
    assertAdmittedLease({
      lease,
      missionId: mission.mission_id,
      authorizationReceiptHash: authorization.authorization_receipt_hash,
      workerId: this.identity,
      now,
    });
    assertMission(mission.provider_state === 'NONE' && mission.hermes_state === 'DISABLED', 'EXECUTION_ROUTE_DENIED', 'Mock execution requires provider NONE and Hermes disabled');
    assertMission(mission.external_effect_policy === 'NONE' && mission.budget.maximum === 0, 'EXECUTION_BOUNDARY_DENIED', 'Mock execution requires no effects and zero budget');
    assertMission(operation.kind === 'REPLACE_EXACT_TEXT', 'UNSUPPORTED_MOCK_OPERATION', 'Mock executor supports only deterministic exact-text replacement');
    const relativePath = normalizeExactPath(operation.path);
    assertMission(mission.permitted_files.includes(relativePath), 'UNAUTHORIZED_FILE', `File is not authorized: ${relativePath}`);
    assertMission(mission.permitted_capabilities.includes('WRITE_LOCAL_BRANCH'), 'CAPABILITY_DENIED', 'WRITE_LOCAL_BRANCH capability absent');
    assertMission(git(sandboxRoot, ['rev-parse', 'HEAD']) === mission.source_commit, 'CHANGED_SOURCE_STATE', 'Sandbox commit differs from mission source');
    assertMission(git(sandboxRoot, ['rev-parse', 'HEAD^{tree}']) === mission.source_tree, 'CHANGED_SOURCE_STATE', 'Sandbox tree differs from mission source');
    const target = assertNoSymlink(sandboxRoot, relativePath);
    assertMission(git(sandboxRoot, ['status', '--porcelain']) === '', 'DIRTY_SANDBOX_DENIED', 'Sandbox must start clean');
    const before = fs.readFileSync(target);
    assertMission(sha256(before) === operation.before_sha256, 'BEFORE_HASH_MISMATCH', 'Target before hash differs');
    const find = Buffer.from(operation.find);
    const replacement = Buffer.from(operation.replace);
    const first = before.indexOf(find);
    assertMission(first >= 0 && before.indexOf(find, first + find.length) === -1, 'NON_DETERMINISTIC_MATCH', 'Exact target text must occur once');
    const after = Buffer.concat([before.subarray(0, first), replacement, before.subarray(first + find.length)]);
    const checkpoint = deepFreeze({
      kind: 'READY_TO_WRITE',
      path: relativePath,
      before_sha256: sha256(before),
      planned_after_sha256: sha256(after),
      lease_token: lease.token,
    });
    if (interruptAfterCheckpoint) {
      return deepFreeze({
        interrupted: true,
        checkpoint,
        executor_identity: this.identity,
        external_effect_count: 0,
        provider_calls: 0,
        spend_usd: 0,
      });
    }
    writeSameFile(target, before, after);
    const changedFiles = git(sandboxRoot, ['diff', '--name-only']).split('\n').filter(Boolean).sort();
    assertMission(changedFiles.length === 1 && changedFiles[0] === relativePath, 'UNAUTHORIZED_CHANGE_DETECTED', 'Mock executor changed files outside its grant', { changedFiles });
    const body = {
      schema_version: 'cana.mock-execution-receipt/2.0.0',
      mission_id: mission.mission_id,
      authorization_receipt_hash: authorization.authorization_receipt_hash,
      executor_identity: this.identity,
      source_commit: mission.source_commit,
      source_tree: mission.source_tree,
      lease_token: lease.token,
      lease_receipt_hash: lease.lease_receipt_hash,
      executed_at: now.toISOString(),
      changed_files: [{
        path: relativePath,
        before_sha256: sha256(before),
        after_sha256: sha256(after),
        before_bytes: before.length,
        after_bytes: after.length,
      }],
      command: {
        kind: operation.kind,
        path: relativePath,
        find_sha256: sha256(find),
        replacement_sha256: sha256(replacement),
      },
      checkpoint,
      external_effect_count: 0,
      provider_calls: 0,
      spend_usd: 0,
      production_modified: false,
    };
    const receipt = deepFreeze({
      ...body,
      execution_receipt_hash: hashCanonical(body),
      before_bytes: before,
      after_bytes: after,
    });
    admittedExecutionReceipts.add(receipt);
    return receipt;
  }

  rollback({ sandboxRoot, executionReceipt }) {
    assertMission(
      admittedExecutionReceipts.has(executionReceipt),
      'FORGED_EXECUTION_RECEIPT_DENIED',
      'Rollback requires an admitted execution receipt',
    );
    const change = executionReceipt.changed_files[0];
    const target = assertNoSymlink(sandboxRoot, change.path);
    const current = fs.readFileSync(target);
    assertMission(sha256(current) === change.after_sha256, 'ROLLBACK_SOURCE_MISMATCH', 'Rollback source bytes changed');
    writeSameFile(target, current, executionReceipt.before_bytes);
    assertMission(sha256(fs.readFileSync(target)) === change.before_sha256, 'ROLLBACK_FAILED', 'Rollback did not restore exact bytes');
    const body = {
      schema_version: 'cana.mock-rollback-receipt/2.0.0',
      mission_id: executionReceipt.mission_id,
      execution_receipt_hash: executionReceipt.execution_receipt_hash,
      path: change.path,
      restored_sha256: change.before_sha256,
      exact_bytes_restored: true,
    };
    const receipt = deepFreeze({ ...body, rollback_receipt_hash: hashCanonical(body) });
    admittedRollbackReceipts.add(receipt);
    return receipt;
  }

  reapply({ sandboxRoot, executionReceipt }) {
    assertMission(
      admittedExecutionReceipts.has(executionReceipt),
      'FORGED_EXECUTION_RECEIPT_DENIED',
      'Reapply requires an admitted execution receipt',
    );
    const change = executionReceipt.changed_files[0];
    const target = assertNoSymlink(sandboxRoot, change.path);
    const current = fs.readFileSync(target);
    assertMission(sha256(current) === change.before_sha256, 'REAPPLY_SOURCE_MISMATCH', 'Reapply requires exact pre-mission bytes');
    writeSameFile(target, current, executionReceipt.after_bytes);
    assertMission(sha256(fs.readFileSync(target)) === change.after_sha256, 'REAPPLY_FAILED', 'Reapply did not restore approved bytes');
    return deepFreeze({ path: change.path, reapplied_sha256: change.after_sha256, exact_bytes_reapplied: true });
  }
}
