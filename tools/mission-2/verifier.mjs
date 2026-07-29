import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertMission,
  constantTimeEqual,
  deepFreeze,
  hashCanonical,
  normalizeExactPath,
  requireIso,
  sha256,
} from './canonical.mjs';
import { assertAuthorizationReceipt } from './authorization.mjs';
import { assertLeaseReceipt } from './lease.mjs';

function git(root, args, { bytes = false } = {}) {
  const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root,
    encoding: bytes ? null : 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  });
  if (result.status !== 0) return null;
  return bytes ? result.stdout : result.stdout.trim();
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

function verifierBody(receipt) {
  return {
    schema_version: receipt.schema_version,
    mission_id: receipt.mission_id,
    authorization_receipt_hash: receipt.authorization_receipt_hash,
    execution_receipt_hash: receipt.execution_receipt_hash,
    source_commit: receipt.source_commit,
    source_tree: receipt.source_tree,
    verifier_identity: receipt.verifier_identity,
    executor_identity: receipt.executor_identity,
    verified_at: receipt.verified_at,
    checks: receipt.checks,
    verdict: receipt.verdict,
    implementation_mutated: receipt.implementation_mutated,
    verification_boundary: receipt.verification_boundary,
  };
}

function passes(action) {
  try {
    return action() === true;
  } catch {
    return false;
  }
}

export function assertVerifierReceipt({
  mission,
  authorization,
  executionReceipt,
  verifierReceipt,
}) {
  assertMission(
    verifierReceipt && typeof verifierReceipt === 'object',
    'VERIFIER_RECEIPT_REQUIRED',
    'An independent verifier receipt is required',
  );
  const body = verifierBody(verifierReceipt);
  const expectedKeys = [...Object.keys(body), 'verifier_receipt_hash'].sort();
  assertMission(
    JSON.stringify(Object.keys(verifierReceipt).sort()) === JSON.stringify(expectedKeys),
    'VERIFIER_RECEIPT_MALFORMED',
    'Verifier receipt fields differ from the canonical schema',
  );
  assertMission(
    constantTimeEqual(verifierReceipt.verifier_receipt_hash, hashCanonical(body)),
    'VERIFIER_RECEIPT_TAMPERED',
    'Verifier receipt hash does not recompute',
  );
  assertMission(
    verifierReceipt.schema_version === 'cana.independent-verifier-receipt/2.0.0',
    'VERIFIER_RECEIPT_TAMPERED',
    'Verifier receipt schema is invalid',
  );
  assertMission(verifierReceipt.mission_id === mission.mission_id, 'VERIFIER_MISSION_MISMATCH', 'Verifier mission differs');
  assertMission(
    verifierReceipt.authorization_receipt_hash === authorization.authorization_receipt_hash,
    'VERIFIER_AUTHORIZATION_MISMATCH',
    'Verifier receipt is not bound to the authorization',
  );
  assertMission(
    verifierReceipt.execution_receipt_hash === executionReceipt.execution_receipt_hash,
    'VERIFIER_EXECUTION_MISMATCH',
    'Verifier receipt is not bound to the execution receipt',
  );
  assertMission(
    verifierReceipt.source_commit === mission.source_commit
      && verifierReceipt.source_tree === mission.source_tree,
    'VERIFIER_SOURCE_MISMATCH',
    'Verifier receipt source differs from the mission',
  );
  assertMission(
    verifierReceipt.verifier_identity === mission.verifier_identity,
    'VERIFIER_IDENTITY_MISMATCH',
    'Mission names a different verifier',
  );
  assertMission(
    verifierReceipt.verifier_identity !== executionReceipt.executor_identity,
    'EXECUTOR_SELF_VERIFICATION_DENIED',
    'Executor cannot verify itself',
  );
  const verifiedAt = requireIso(verifierReceipt.verified_at, 'verified_at');
  assertMission(
    new Date(verifiedAt).getTime() >= new Date(executionReceipt.executed_at).getTime()
      && new Date(verifiedAt).getTime() <= new Date(mission.expires_at).getTime(),
    'VERIFIER_TIME_OUTSIDE_MISSION',
    'Verifier receipt time must follow execution and remain inside the sealed mission window',
  );
  assertMission(
    ['APPROVE', 'REJECT', 'INCONCLUSIVE', 'BLOCKED'].includes(verifierReceipt.verdict),
    'VERIFIER_RECEIPT_TAMPERED',
    'Verifier verdict is invalid',
  );
  if (verifierReceipt.verdict === 'APPROVE') {
    assertMission(
      verifierReceipt.implementation_mutated === false
        && verifierReceipt.verification_boundary === 'SEPARATE_PROCESS'
        && Object.values(verifierReceipt.checks).every((value) => value === true),
      'FORGED_VERIFIER_APPROVAL_DENIED',
      'APPROVE requires every independent check to pass without mutation',
    );
  }
  return verifierReceipt;
}

export class IndependentVerifier {
  constructor(identity = 'INDEPENDENT_FALSIFICATION_VERIFIER_V1') {
    this.identity = identity;
  }

  verify({
    mission,
    authorization,
    executionReceipt,
    sandboxRoot,
    operation,
    lease,
    now,
    expectedText,
    leaseAuthorityPublicKey,
    verificationBoundary,
  }) {
    assertMission(
      verificationBoundary === 'SEPARATE_PROCESS',
      'VERIFIER_PROCESS_BOUNDARY_REQUIRED',
      'Independent verification must execute in the separate verifier process',
    );
    assertMission(this.identity === mission.verifier_identity, 'VERIFIER_IDENTITY_MISMATCH', 'Mission names a different verifier');
    assertMission(this.identity !== executionReceipt.executor_identity, 'EXECUTOR_SELF_VERIFICATION_DENIED', 'Executor cannot verify itself');
    assertMission(authorization.verifier_identity === this.identity, 'VERIFIER_NOT_AUTHORIZED', 'Authorization does not name this verifier');
    const admittedOperation = {
      kind: operation?.kind,
      path: operation?.path,
      find: operation?.find,
      replace: operation?.replace,
    };
    assertMission(
      operation
        && JSON.stringify(Object.keys(operation).sort())
          === JSON.stringify(Object.keys(admittedOperation).sort())
        && hashCanonical(admittedOperation) === hashCanonical(mission.verification_contract.operation)
        && expectedText === mission.verification_contract.expected_text,
      'VERIFICATION_CONTRACT_MISMATCH',
      'Verifier propositions differ from the sealed mission verification contract',
    );
    const change = executionReceipt.changed_files?.[0] ?? {};
    const relativePath = passes(() => normalizeExactPath(change.path) === change.path)
      ? change.path
      : null;
    const target = relativePath ? path.join(sandboxRoot, relativePath) : null;
    const bytes = target && fs.existsSync(target) ? fs.readFileSync(target) : null;
    const beforeBytes = executionReceipt.before_bytes;
    const afterBytes = executionReceipt.after_bytes;
    const find = Buffer.from(operation?.find ?? '');
    const replacement = Buffer.from(operation?.replace ?? '');
    const first = Buffer.isBuffer(beforeBytes) ? beforeBytes.indexOf(find) : -1;
    const expectedAfter = first >= 0 && beforeBytes.indexOf(find, first + find.length) === -1
      ? Buffer.concat([
        beforeBytes.subarray(0, first),
        replacement,
        beforeBytes.subarray(first + find.length),
      ])
      : null;
    const expectedReceiptKeys = [
      ...Object.keys(executionBody(executionReceipt)),
      'execution_receipt_hash',
      'before_bytes',
      'after_bytes',
    ].sort();
    const statusBeforeVerification = git(sandboxRoot, ['status', '--porcelain']);
    const diffFiles = git(sandboxRoot, ['diff', '--name-only', '--no-renames'])
      ?.split('\n').filter(Boolean).sort() ?? [];
    const headBytes = relativePath
      ? git(sandboxRoot, ['show', `HEAD:${relativePath}`], { bytes: true })
      : null;
    const checks = {
      mission_identity_bound: executionReceipt.mission_id === mission.mission_id,
      source_commit_bound: executionReceipt.source_commit === mission.source_commit,
      source_tree_bound: executionReceipt.source_tree === mission.source_tree,
      authorization_bound: executionReceipt.authorization_receipt_hash === authorization.authorization_receipt_hash,
      authorization_receipt_valid: passes(() => {
        assertAuthorizationReceipt({
          mission,
          authorization,
          now: new Date(executionReceipt.executed_at),
          executorIdentity: executionReceipt.executor_identity,
        });
        return true;
      }),
      lease_receipt_valid: passes(() => {
        assertLeaseReceipt({
          lease,
          missionId: mission.mission_id,
          authorizationReceiptHash: authorization.authorization_receipt_hash,
          workerId: executionReceipt.executor_identity,
          now: new Date(executionReceipt.executed_at),
          authorityPublicKey: leaseAuthorityPublicKey,
        });
        return executionReceipt.lease_token === lease.token
          && executionReceipt.lease_receipt_hash === lease.lease_receipt_hash;
      }),
      receipt_shape_exact: JSON.stringify(Object.keys(executionReceipt).sort())
        === JSON.stringify(expectedReceiptKeys),
      execution_receipt_hash_valid: passes(() => constantTimeEqual(
        executionReceipt.execution_receipt_hash,
        hashCanonical(executionBody(executionReceipt)),
      )),
      sandbox_head_commit_bound: git(sandboxRoot, ['rev-parse', 'HEAD']) === mission.source_commit,
      sandbox_head_tree_bound: git(sandboxRoot, ['rev-parse', 'HEAD^{tree}']) === mission.source_tree,
      exact_scope: executionReceipt.changed_files?.length === 1
        && relativePath !== null
        && mission.permitted_files.includes(relativePath)
        && JSON.stringify(diffFiles) === JSON.stringify([relativePath]),
      before_blob_matches_source: Buffer.isBuffer(headBytes)
        && Buffer.isBuffer(beforeBytes)
        && headBytes.equals(beforeBytes)
        && sha256(beforeBytes) === change.before_sha256
        && beforeBytes.length === change.before_bytes,
      deterministic_operation_recomputed: operation?.kind === 'REPLACE_EXACT_TEXT'
        && operation.path === relativePath
        && executionReceipt.command?.kind === operation.kind
        && executionReceipt.command.path === relativePath
        && executionReceipt.command.find_sha256 === sha256(find)
        && executionReceipt.command.replacement_sha256 === sha256(replacement)
        && Buffer.isBuffer(expectedAfter)
        && Buffer.isBuffer(afterBytes)
        && expectedAfter.equals(afterBytes),
      after_hash_matches: Buffer.isBuffer(bytes)
        && Buffer.isBuffer(afterBytes)
        && bytes.equals(afterBytes)
        && sha256(bytes) === change.after_sha256
        && afterBytes.length === change.after_bytes,
      checkpoint_bound: executionReceipt.checkpoint?.path === relativePath
        && executionReceipt.checkpoint.before_sha256 === change.before_sha256
        && executionReceipt.checkpoint.planned_after_sha256 === change.after_sha256
        && executionReceipt.checkpoint.lease_token === lease?.token,
      original_defect_absent: Buffer.isBuffer(bytes)
        && bytes.includes(Buffer.from(expectedText)),
      external_effects_absent: executionReceipt.external_effect_count === 0,
      provider_absent: executionReceipt.provider_calls === 0,
      budget_zero: executionReceipt.spend_usd === 0,
      production_unchanged: executionReceipt.production_modified === false,
      rollback_reconstructable: Buffer.isBuffer(beforeBytes)
        && Buffer.isBuffer(afterBytes)
        && sha256(beforeBytes) === change.before_sha256
        && sha256(afterBytes) === change.after_sha256,
    };
    const statusAfterVerification = git(sandboxRoot, ['status', '--porcelain']);
    const bytesAfterVerification = target && fs.existsSync(target)
      ? fs.readFileSync(target)
      : null;
    checks.verifier_preserved_implementation = statusBeforeVerification === statusAfterVerification
      && Buffer.isBuffer(bytes)
      && Buffer.isBuffer(bytesAfterVerification)
      && bytes.equals(bytesAfterVerification);
    const verdict = Object.values(checks).every(Boolean) ? 'APPROVE' : 'REJECT';
    const body = {
      schema_version: 'cana.independent-verifier-receipt/2.0.0',
      mission_id: mission.mission_id,
      authorization_receipt_hash: authorization.authorization_receipt_hash,
      execution_receipt_hash: executionReceipt.execution_receipt_hash,
      source_commit: mission.source_commit,
      source_tree: mission.source_tree,
      verifier_identity: this.identity,
      executor_identity: executionReceipt.executor_identity,
      verified_at: now.toISOString(),
      checks,
      verdict,
      implementation_mutated: checks.verifier_preserved_implementation === false,
      verification_boundary: verificationBoundary,
    };
    return deepFreeze({ ...body, verifier_receipt_hash: hashCanonical(body) });
  }
}
