import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertMission,
  deepFreeze,
  hashCanonical,
  normalizeExactPath,
  sha256,
} from './canonical.mjs';

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

export class DeterministicMockExecutor {
  constructor(identity = 'DETERMINISTIC_MOCK_EXECUTOR_V1') {
    this.identity = identity;
  }

  execute({ mission, authorization, sandboxRoot, operation, now, lease, interruptAfterCheckpoint = false }) {
    assertMission(authorization.decision === 'AUTHORIZED', 'AUTHORIZATION_REQUIRED', 'Executor requires CANA authorization');
    assertMission(authorization.executor_identity === this.identity, 'EXECUTOR_IDENTITY_MISMATCH', 'Authorization names a different executor');
    assertMission(mission.provider_state === 'NONE' && mission.hermes_state === 'DISABLED', 'EXECUTION_ROUTE_DENIED', 'Mock execution requires provider NONE and Hermes disabled');
    assertMission(mission.external_effect_policy === 'NONE' && mission.budget.maximum === 0, 'EXECUTION_BOUNDARY_DENIED', 'Mock execution requires no effects and zero budget');
    assertMission(new Date(authorization.expires_at).getTime() > now.getTime(), 'EXECUTION_AFTER_EXPIRY', 'Execution authorization expired');
    assertMission(lease && lease.worker_id === this.identity, 'LEASE_REQUIRED', 'Executor requires its exact worker lease');
    assertMission(new Date(lease.expires_at).getTime() > now.getTime(), 'LEASE_EXPIRED', 'Worker lease expired');
    assertMission(operation.kind === 'REPLACE_EXACT_TEXT', 'UNSUPPORTED_MOCK_OPERATION', 'Mock executor supports only deterministic exact-text replacement');
    const relativePath = normalizeExactPath(operation.path);
    assertMission(mission.permitted_files.includes(relativePath), 'UNAUTHORIZED_FILE', `File is not authorized: ${relativePath}`);
    assertMission(mission.permitted_capabilities.includes('WRITE_LOCAL_BRANCH'), 'CAPABILITY_DENIED', 'WRITE_LOCAL_BRANCH capability absent');
    assertMission(git(sandboxRoot, ['rev-parse', 'HEAD']) === mission.source_commit, 'CHANGED_SOURCE_STATE', 'Sandbox commit differs from mission source');
    assertMission(git(sandboxRoot, ['rev-parse', 'HEAD^{tree}']) === mission.source_tree, 'CHANGED_SOURCE_STATE', 'Sandbox tree differs from mission source');
    assertMission(git(sandboxRoot, ['status', '--porcelain']) === '', 'DIRTY_SANDBOX_DENIED', 'Sandbox must start clean');
    const target = assertNoSymlink(sandboxRoot, relativePath);
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
    return deepFreeze({ ...body, execution_receipt_hash: hashCanonical(body), before_bytes: before, after_bytes: after });
  }

  rollback({ sandboxRoot, executionReceipt }) {
    const change = executionReceipt.changed_files[0];
    const target = assertNoSymlink(sandboxRoot, change.path);
    const current = fs.readFileSync(target);
    assertMission(sha256(current) === change.after_sha256, 'ROLLBACK_SOURCE_MISMATCH', 'Rollback source bytes changed');
    writeSameFile(target, current, executionReceipt.before_bytes);
    assertMission(sha256(fs.readFileSync(target)) === change.before_sha256, 'ROLLBACK_FAILED', 'Rollback did not restore exact bytes');
    return deepFreeze({
      mission_id: executionReceipt.mission_id,
      path: change.path,
      restored_sha256: change.before_sha256,
      exact_bytes_restored: true,
      rollback_receipt_hash: hashCanonical({
        mission_id: executionReceipt.mission_id,
        path: change.path,
        restored_sha256: change.before_sha256,
      }),
    });
  }

  reapply({ sandboxRoot, executionReceipt }) {
    const change = executionReceipt.changed_files[0];
    const target = assertNoSymlink(sandboxRoot, change.path);
    const current = fs.readFileSync(target);
    assertMission(sha256(current) === change.before_sha256, 'REAPPLY_SOURCE_MISMATCH', 'Reapply requires exact pre-mission bytes');
    writeSameFile(target, current, executionReceipt.after_bytes);
    assertMission(sha256(fs.readFileSync(target)) === change.after_sha256, 'REAPPLY_FAILED', 'Reapply did not restore approved bytes');
    return deepFreeze({ path: change.path, reapplied_sha256: change.after_sha256, exact_bytes_reapplied: true });
  }
}
