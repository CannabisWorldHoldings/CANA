/**
 * ES-0005 — fail-closed ZENITH execution-scope manifest succession.
 *
 * V5 preserves V4 as a sealed replay lane and recognizes exactly one later manifest transition:
 * the 53-path ZENITH/VANGUARD durability assignment at commit 3d98fb3. The assignment expressly
 * grants no self-promotion, production, deployment, external-effect, credential, or verification-
 * bypass authority. V5 certifies technical evidence only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CERTIFIABLE_VERDICTS as V4_CERTIFIABLE_VERDICTS,
  DISPATCH_TABLE as V4_DISPATCH_TABLE,
  FORBIDDEN_VERDICTS as V4_FORBIDDEN_VERDICTS,
  evaluateExecutionScopeSuccession,
} from './es-0004.mjs';
import { validateOwnershipManifest } from '../durability/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MANIFEST_PATH = 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json';
const V4_POSITIVE_PATH = path.join(HERE, 'fixtures', 'es-0004-positive.json');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const EVALUATOR_ID = 'CANA_PROMOTION_IDENTITY_V5';
export const PROMOTION_SCHEMA_VERSION = 5;
export const CASE_ID = 'ES-0005';

export const V5_CONTRACT = Object.freeze({
  evaluator_id: EVALUATOR_ID,
  promotion_schema_version: PROMOTION_SCHEMA_VERSION,
  promotion_event_type: 'execution-scope-succession-v5',
  branch_name_used_as_authority: false,
  authorization_source_sha256: 'cac0851c69ff4e0ccbd4223c8f4c58290450950c97dd0f4a4792a3af8d47dc63',
  authorization_effect: 'durability-path-ownership-only',
  assignment_name: 'zenith_vanguard_surgical_convergence_2026_08_23',
  approval_sha256: 'b77bb18f5871539fab856ff39ecb7cb5331c8318814d8f0acf7f49349752a74a',
  incumbent_commit_sha: '21b9bd61c2d7dcb8f8fad91cfc7a380a20564693',
  candidate_commit_sha: '3d98fb38f6c86f3e40b2bdad95d60dc7b651d6a0',
  candidate_tree_sha: 'be736e4fa1719603d35fbba220c67298acbcd292',
  incumbent_manifest_digest: '7054655db82a5ffaf6b7cabd304ef8a9bd4c28c1c5f9def8ffaf581a27fc4908',
  new_manifest_digest: 'ee91c81a3d763987dd15e6a32310e6d33ec28e95292bc2d4f5bed55e13ae613d',
  changed_scope_digest: '6b2293afbf277807a6c8033d12e2ba555f03b82b0d3882904eb8d2ca464a4c74',
  protected_base: Object.freeze({
    commit: '75a01029a75c366fd3254be78cde71a286bafa1a',
    tree: 'fd6dcb24a5805b77aa36426e2bfe549e7c06676e',
  }),
  paths: Object.freeze([
    'apps/web/open-next.config.ts',
    'apps/web/prisma/migration-manifest.json',
    'apps/web/prisma/migrations/20260823000000_content_stability_court/migration.sql',
    'apps/web/prisma/migrations/20260823160000_experience_review_spine/migration.sql',
    'apps/web/prisma/schema.prisma',
    'apps/web/scripts/admit-live-market-identity.mjs',
    'apps/web/src/app/admin/experience-review/page.tsx',
    'apps/web/src/app/admin/login/page.tsx',
    'apps/web/src/app/admin/page.tsx',
    'apps/web/src/lib/experience-review-candidate.mjs',
    'apps/web/src/lib/experience-review-inbox.mjs',
    'apps/web/src/lib/experience-review-mutations.mjs',
    'apps/web/src/lib/reality/entity-resolution.mjs',
    'apps/web/src/lib/reality/market-identity-admission.mjs',
    'apps/web/src/lib/reality/reality-repository.mjs',
    'apps/web/src/lib/tenant-host.mjs',
    'apps/web/tests/experience-review-candidate.test.mjs',
    'apps/web/tests/experience-review-inbox.test.mjs',
    'apps/web/tests/experience-review-mutations.test.mjs',
    'apps/web/tests/market-identity-admission.test.mjs',
    'apps/web/tests/market-identity-movement.test.mjs',
    'apps/web/tests/migration-court.test.mjs',
    'apps/web/tests/migration-manifest.test.mjs',
    'apps/web/tsconfig.json',
    'docs/zenith/CURRENT_STATE_PR_CAPTURE.json',
    'docs/zenith/CURRENT_STATE_RECEIPT_FINAL.json',
    'docs/zenith/DESCENDANT_DISPOSITION.json',
    'docs/zenith/DONOR_INSPECTION_MANIFEST.json',
    'docs/zenith/DONOR_SCAN_INPUTS.json',
    'docs/zenith/NEED_ITEM_INPUTS.json',
    'docs/zenith/NEED_ITEM_LEDGER.json',
    'docs/zenith/PR_CONSUMPTION_LEDGER.json',
    'docs/zenith/SOURCE_HISTORY_PROJECTION.json',
    'docs/zenith/inputs/CURRENT_STATE_RECEIPT.json',
    'docs/zenith/inputs/ZENITH_GRADUATION_RECEIPT.json',
    'tools/durability/cli.mjs',
    'tools/durability/cli.test.mjs',
    'tools/runtime-courts/c2-cloudflare-preview.mjs',
    'tools/runtime-courts/c2-cloudflare-preview.test.mjs',
    'tools/runtime-courts/c3-database-target.mjs',
    'tools/runtime-courts/c3-database-target.test.mjs',
    'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
    'tools/federation/official-retailer-identity-owner.test.mjs',
    'tools/zenith/emit-reconstruction-receipt.mjs',
    'tools/zenith/emit-reconstruction-receipt.test.mjs',
    'tools/zenith/reconstruct-needs.mjs',
    'tools/zenith/reconstruct-needs.test.mjs',
    'tools/zenith/reconstruct-pr-consumption.mjs',
    'tools/zenith/reconstruct-pr-consumption.test.mjs',
    'tools/zenith/reconstruct-source-history.mjs',
    'tools/zenith/reconstruct-source-history.test.mjs',
    'tools/zenith/reconstruction-contracts.mjs',
    'tools/zenith/reconstruction-contracts.test.mjs',
  ]),
  court_blob_sha256: Object.freeze({
    'apps/web/tests/migration-court.test.mjs': 'e670bc17746ab70421fcef2c0774ade4a08ccf3d0df714e2326be14d3490f015',
  }),
  authority_boundaries: Object.freeze({
    credentials: false,
    deployment: false,
    production: false,
    external_effects: false,
    verification_bypass: false,
    self_promotion: false,
  }),
});

export const CERTIFIABLE_VERDICTS = Object.freeze([...V4_CERTIFIABLE_VERDICTS]);
export const FORBIDDEN_VERDICTS = Object.freeze([...V4_FORBIDDEN_VERDICTS]);

export const DISPATCH_TABLE = Object.freeze([
  ...V4_DISPATCH_TABLE.map((entry) => entry.evaluator_id === 'CANA_PROMOTION_IDENTITY_V4'
    ? Object.freeze({
      ...entry,
      lane: 'frozen-replay',
      invoked_by: 'tools/promotion-gate/es-0004-frozen-replay.mjs',
    })
    : entry),
  Object.freeze({
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V5_CONTRACT.promotion_event_type,
    lane: 'zenith-execution-scope-succession',
    invoked_by: 'tools/promotion-gate/es-0005.mjs',
  }),
]);

export function dispatchEvaluator(event) {
  const matches = DISPATCH_TABLE.filter((entry) =>
    entry.promotion_schema_version === event?.promotion_schema_version
    && entry.promotion_event_type === event?.promotion_event_type);
  if (matches.length !== 1) {
    return {
      dispatched: null,
      reason: matches.length === 0
        ? `no evaluator owns schema ${event?.promotion_schema_version} event ${event?.promotion_event_type}`
        : 'ambiguous evaluator dispatch refused',
    };
  }
  return { dispatched: matches[0], reason: 'exactly one evaluator owns this event' };
}

function safePath(relative) {
  return typeof relative === 'string'
    && relative.length > 0
    && !relative.startsWith('/')
    && !relative.includes('\\')
    && !relative.includes('*')
    && !relative.includes('..')
    && path.posix.normalize(relative) === relative;
}

function runGit(args, { cwd = ROOT, mirror = null } = {}) {
  const roots = mirror ? [mirror, cwd] : [cwd];
  let last = null;
  for (const root of roots) {
    const result = spawnSync('git', args, {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
    });
    last = {
      ok: !result.error && result.status === 0,
      status: result.status,
      stdout: result.stdout ?? Buffer.alloc(0),
      stderr: result.stderr ?? Buffer.alloc(0),
    };
    if (last.ok) return last;
  }
  return last;
}

function manifestAt(commit, gitOptions) {
  const result = runGit(['show', `${commit}:${MANIFEST_PATH}`], gitOptions);
  if (!result.ok) return { manifest: null, digest: null };
  try {
    const manifest = JSON.parse(result.stdout.toString('utf8'));
    return { manifest, digest: sha256(canonicalJson(manifest)) };
  } catch {
    return { manifest: null, digest: null };
  }
}

function changedScopeDigest(manifest) {
  return sha256(canonicalJson({
    root_dispatcher: manifest.explicit_user_assignment.root_dispatcher,
    owned_create_paths: manifest.owned_create_paths,
    owned_modify_paths: manifest.owned_modify_paths,
  }));
}

export function collectZenithSuccessionEvidence(candidate, options = {}) {
  const cwd = options.cwd ?? ROOT;
  const mirror = options.mirror ?? null;
  const gitOptions = { cwd, mirror };
  const errors = [];
  let manifestDigest = null;
  let scopeDigest = null;
  let manifestValid = false;
  let authorizationSourceValid = false;
  let assignmentNameValid = false;
  let approvalDigestValid = false;
  let protectedBaseValid = false;
  let assignmentPathsValid = false;
  let courtBlobValid = false;
  let authorityBoundariesValid = false;

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, MANIFEST_PATH), 'utf8'));
    manifestDigest = sha256(canonicalJson(manifest));
    scopeDigest = changedScopeDigest(manifest);
    validateOwnershipManifest(manifest);
    const assignment = manifest.explicit_user_assignment[V5_CONTRACT.assignment_name];
    authorizationSourceValid = assignment?.authorization_source_sha256
      === V5_CONTRACT.authorization_source_sha256;
    assignmentNameValid = assignment != null;
    approvalDigestValid = assignment?.approval_sha256 === V5_CONTRACT.approval_sha256;
    protectedBaseValid = canonicalJson(assignment?.protected_base)
      === canonicalJson(V5_CONTRACT.protected_base);
    assignmentPathsValid = canonicalJson(assignment?.authorized_paths)
      === canonicalJson(V5_CONTRACT.paths);
    courtBlobValid = canonicalJson(assignment?.court_blob_sha256)
      === canonicalJson(V5_CONTRACT.court_blob_sha256);
    authorityBoundariesValid = canonicalJson(assignment?.authority_boundaries)
      === canonicalJson(V5_CONTRACT.authority_boundaries)
      && Object.values(assignment?.authority_boundaries ?? {}).every((value) => value === false);
    manifestValid = assignment?.authorization_effect === V5_CONTRACT.authorization_effect
      && authorizationSourceValid
      && assignmentNameValid
      && approvalDigestValid
      && protectedBaseValid
      && assignmentPathsValid
      && courtBlobValid
      && authorityBoundariesValid;
  } catch (error) {
    errors.push(`current manifest invalid: ${error.message}`);
  }

  const candidateCommit = candidate?.candidate_commit_sha;
  const resolves = candidateCommit === V5_CONTRACT.candidate_commit_sha
    && runGit(['cat-file', '-e', `${candidateCommit}^{commit}`], gitOptions).ok;
  const observedTree = resolves
    ? runGit(['rev-parse', `${candidateCommit}^{tree}`], gitOptions).stdout.toString('utf8').trim()
    : null;
  const parentLine = resolves
    ? runGit(['rev-list', '--parents', '-n', '1', candidateCommit], gitOptions).stdout.toString('utf8').trim().split(/\s+/)
    : [];
  const incumbentIsParent = parentLine.length === 2
    && parentLine[1] === V5_CONTRACT.incumbent_commit_sha;
  const incumbentIsAncestor = resolves
    && runGit(
      ['merge-base', '--is-ancestor', V5_CONTRACT.incumbent_commit_sha, candidateCommit],
      gitOptions,
    ).status === 0;
  const protectedBaseIsAncestor = resolves
    && runGit(
      ['merge-base', '--is-ancestor', V5_CONTRACT.protected_base.commit, candidateCommit],
      gitOptions,
    ).status === 0;
  const protectedBaseTree = runGit(
    ['rev-parse', `${V5_CONTRACT.protected_base.commit}^{tree}`],
    gitOptions,
  );
  const candidateManifest = manifestAt(V5_CONTRACT.candidate_commit_sha, gitOptions);
  const incumbentManifest = manifestAt(V5_CONTRACT.incumbent_commit_sha, gitOptions);

  let v4FailedChecks = null;
  try {
    const v4Positive = JSON.parse(fs.readFileSync(V4_POSITIVE_PATH, 'utf8'));
    v4FailedChecks = evaluateExecutionScopeSuccession(v4Positive, { cwd, mirror }).failed_checks;
  } catch (error) {
    errors.push(`V4 bridge invalid: ${error.message}`);
  }

  return {
    errors,
    branch_name_used_as_authority: false,
    candidate_commit_resolves: resolves,
    candidate_tree_sha: observedTree,
    incumbent_is_parent: incumbentIsParent,
    incumbent_is_ancestor: incumbentIsAncestor,
    protected_base_is_ancestor: protectedBaseIsAncestor,
    protected_base_tree_sha: protectedBaseTree.ok
      ? protectedBaseTree.stdout.toString('utf8').trim()
      : null,
    incumbent_manifest_digest: incumbentManifest.digest,
    current_manifest_digest: manifestDigest,
    candidate_manifest_digest: candidateManifest.digest,
    changed_scope_digest: scopeDigest,
    authorization_source_valid: authorizationSourceValid,
    assignment_name_valid: assignmentNameValid,
    approval_digest_valid: approvalDigestValid,
    protected_base_valid: protectedBaseValid,
    assignment_paths_valid: assignmentPathsValid,
    court_blob_valid: courtBlobValid,
    authority_boundaries_valid: authorityBoundariesValid,
    manifest_valid: manifestValid,
    v4_failed_checks: v4FailedChecks,
  };
}

export function assessZenithSuccession(candidate, observed) {
  const checks = [];
  const record = (id, ok, detail = null) => checks.push({ id, ok: Boolean(ok), detail });
  const claim = candidate?.manifest_succession ?? {};
  const dispatch = dispatchEvaluator(candidate);
  const paths = Array.isArray(claim.paths) ? claim.paths : [];

  record(
    'dispatch.owned-by-v5',
    dispatch.dispatched?.evaluator_id === EVALUATOR_ID && candidate?.evaluator_id === EVALUATOR_ID,
    dispatch,
  );
  record('identity.evaluator-id', candidate?.evaluator_id === EVALUATOR_ID);
  record('identity.candidate-commit-exact', candidate?.candidate_commit_sha === V5_CONTRACT.candidate_commit_sha && observed?.candidate_commit_resolves === true);
  record('identity.candidate-tree-exact', candidate?.candidate_tree_sha === V5_CONTRACT.candidate_tree_sha && observed?.candidate_tree_sha === V5_CONTRACT.candidate_tree_sha);
  record('identity.branch-is-evidence-only', observed?.branch_name_used_as_authority === false);
  record('ancestry.incumbent-is-parent', observed?.incumbent_is_parent === true);
  record('ancestry.incumbent-is-ancestor', observed?.incumbent_is_ancestor === true);
  record('ancestry.protected-base-is-ancestor', observed?.protected_base_is_ancestor === true);
  record('lineage.authorization-source', claim.authorization_source_sha256 === V5_CONTRACT.authorization_source_sha256 && observed?.authorization_source_valid === true);
  record('lineage.assignment-name', claim.assignment_name === V5_CONTRACT.assignment_name && observed?.assignment_name_valid === true);
  record('lineage.approval-digest', claim.approval_sha256 === V5_CONTRACT.approval_sha256 && observed?.approval_digest_valid === true);
  record('lineage.incumbent-commit', claim.incumbent_commit_sha === V5_CONTRACT.incumbent_commit_sha);
  record('lineage.protected-base', canonicalJson(claim.protected_base) === canonicalJson(V5_CONTRACT.protected_base) && observed?.protected_base_valid === true && observed?.protected_base_tree_sha === V5_CONTRACT.protected_base.tree);
  record('lineage.incumbent-manifest', claim.incumbent_manifest_digest === V5_CONTRACT.incumbent_manifest_digest && observed?.incumbent_manifest_digest === V5_CONTRACT.incumbent_manifest_digest);
  record('lineage.new-manifest', claim.new_manifest_digest === V5_CONTRACT.new_manifest_digest && observed?.current_manifest_digest === V5_CONTRACT.new_manifest_digest);
  record('lineage.changed-scope-digest', claim.changed_scope_digest === V5_CONTRACT.changed_scope_digest && observed?.changed_scope_digest === V5_CONTRACT.changed_scope_digest);
  record('lineage.paths-exact', canonicalJson(paths) === canonicalJson(V5_CONTRACT.paths) && observed?.assignment_paths_valid === true);
  record('lineage.paths-safe', paths.length === V5_CONTRACT.paths.length && paths.every(safePath));
  record('lineage.court-blob', canonicalJson(claim.court_blob_sha256) === canonicalJson(V5_CONTRACT.court_blob_sha256) && observed?.court_blob_valid === true);
  record('authority.all-false', canonicalJson(claim.authority_boundaries) === canonicalJson(V5_CONTRACT.authority_boundaries) && observed?.authority_boundaries_valid === true);
  record('lineage.manifest-valid', observed?.manifest_valid === true && (observed?.errors?.length ?? 0) === 0);
  record('lineage.candidate-manifest-exact', observed?.candidate_manifest_digest === V5_CONTRACT.new_manifest_digest && observed?.candidate_manifest_digest === observed?.current_manifest_digest);
  record('bridge.v4-refuses-only-current-succession', canonicalJson(observed?.v4_failed_checks ?? []) === canonicalJson([
    'lineage.new-manifest',
    'lineage.changed-scope-digest',
    'lineage.candidate-manifest-exact',
  ]));
  const ownerGate = candidate?.owner_gate ?? {};
  record('owner-gate.execution-only', ownerGate.state === 'EXECUTION_AUTHORIZED' && ownerGate.claimed_owner_approved !== true);
  record('verdict.no-forbidden-claim', candidate?.claimed_verdict == null || !FORBIDDEN_VERDICTS.includes(candidate.claimed_verdict));

  const accepted = checks.every((check) => check.ok);
  return {
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V5_CONTRACT.promotion_event_type,
    branch_name_used_as_authority: false,
    checks,
    failed_checks: checks.filter((check) => !check.ok).map((check) => check.id),
    certified_verdicts: accepted ? [...CERTIFIABLE_VERDICTS] : [],
    technical_promotion_evidence: accepted ? 'VERIFIED' : 'INCOMPLETE',
    owner_promotion_gate: ownerGate.state ?? 'UNKNOWN',
    accepted,
  };
}

export function evaluateZenithSuccession(candidate, options = {}) {
  const observed = options.observed ?? collectZenithSuccessionEvidence(candidate, options);
  return assessZenithSuccession(candidate, observed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const candidate = process.argv[2]
    ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
    : null;
  const result = candidate
    ? evaluateZenithSuccession(candidate, { mirror: process.env.CANA_SOURCE_MIRROR ?? null })
    : { contract: V5_CONTRACT, dispatch: DISPATCH_TABLE };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
