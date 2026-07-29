import fs from 'node:fs';
import path from 'node:path';
import {
  assertMission,
  deepFreeze,
  hashCanonical,
  sha256,
} from './canonical.mjs';

export class IndependentVerifier {
  constructor(identity = 'INDEPENDENT_FALSIFICATION_VERIFIER_V1') {
    this.identity = identity;
  }

  verify({ mission, authorization, executionReceipt, sandboxRoot, now, expectedText }) {
    assertMission(this.identity === mission.verifier_identity, 'VERIFIER_IDENTITY_MISMATCH', 'Mission names a different verifier');
    assertMission(this.identity !== executionReceipt.executor_identity, 'EXECUTOR_SELF_VERIFICATION_DENIED', 'Executor cannot verify itself');
    assertMission(authorization.verifier_identity === this.identity, 'VERIFIER_NOT_AUTHORIZED', 'Authorization does not name this verifier');
    const change = executionReceipt.changed_files[0];
    const target = path.join(sandboxRoot, change.path);
    const bytes = fs.readFileSync(target);
    const checks = {
      mission_identity_bound: executionReceipt.mission_id === mission.mission_id,
      source_commit_bound: executionReceipt.source_commit === mission.source_commit,
      source_tree_bound: executionReceipt.source_tree === mission.source_tree,
      authorization_bound: executionReceipt.authorization_receipt_hash === authorization.authorization_receipt_hash,
      exact_scope: executionReceipt.changed_files.length === 1 && mission.permitted_files.includes(change.path),
      after_hash_matches: sha256(bytes) === change.after_sha256,
      original_defect_absent: bytes.includes(Buffer.from(expectedText)),
      external_effects_absent: executionReceipt.external_effect_count === 0,
      provider_absent: executionReceipt.provider_calls === 0,
      budget_zero: executionReceipt.spend_usd === 0,
      production_unchanged: executionReceipt.production_modified === false,
      rollback_available: Buffer.isBuffer(executionReceipt.before_bytes) && Buffer.isBuffer(executionReceipt.after_bytes),
    };
    const verdict = Object.values(checks).every(Boolean) ? 'APPROVE' : 'REJECT';
    const body = {
      schema_version: 'cana.independent-verifier-receipt/2.0.0',
      mission_id: mission.mission_id,
      verifier_identity: this.identity,
      executor_identity: executionReceipt.executor_identity,
      verified_at: now.toISOString(),
      checks,
      verdict,
      implementation_mutated: false,
    };
    return deepFreeze({ ...body, verifier_receipt_hash: hashCanonical(body) });
  }
}
