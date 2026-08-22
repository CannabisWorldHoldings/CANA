/**
 * ES-0004 — fail-closed execution-scope manifest succession.
 *
 * V4 preserves V3 as a sealed replay lane and recognizes exactly one later manifest transition:
 * the eight-path PR59 browser-custody assignment authorized by the owner's full-execution packet.
 * It certifies technical evidence only and cannot certify merge, canonicality, deployment, or
 * owner promotion approval.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CERTIFIABLE_VERDICTS as V3_CERTIFIABLE_VERDICTS,
  DISPATCH_TABLE as V3_DISPATCH_TABLE,
  FORBIDDEN_VERDICTS as V3_FORBIDDEN_VERDICTS,
  evaluateManifestSuccession,
} from './es-0003.mjs';
import {
  PR59_SOVEREIGN_CUSTODY_PATHS,
  validateOwnershipManifest,
} from '../durability/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MANIFEST_PATH = 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json';
const V3_POSITIVE_PATH = path.join(HERE, 'fixtures', 'es-0003-positive.json');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const EVALUATOR_ID = 'CANA_PROMOTION_IDENTITY_V4';
export const PROMOTION_SCHEMA_VERSION = 4;
export const CASE_ID = 'ES-0004';

export const V4_CONTRACT = Object.freeze({
  evaluator_id: EVALUATOR_ID,
  promotion_schema_version: PROMOTION_SCHEMA_VERSION,
  promotion_event_type: 'execution-scope-succession-v4',
  branch_name_used_as_authority: false,
  execution_scope_payload_sha256: '452ab52765c74984d104c134d5e3b2a0ae8aa879d8e66452e72de3095d6da409',
  authorization_source_sha256: '14a3554ec2eb809c98e82b0ee6b57ac30668c6b8f7290dc95712afd63a323565',
  assignment_name: 'pr59_sovereign_custody_2026_08_22',
  assignment_sha256: '5cfdc920488db9935fb0fb905d255edc77d3416fb9255fd13194df7c5815bc73',
  incumbent_commit_sha: '99efaa937d137b7d3502e9ecbe08d92d615d1e1d',
  candidate_commit_sha: '50130a2858939799c3d852571bef6e7a1cdaba7f',
  candidate_tree_sha: 'f76aa42688fac550f94141239eb244455b117682',
  incumbent_manifest_digest: '592c19aeda938f5d6b824559d77bcc21213d786815754505fbd5b7c5a9f97ded',
  new_manifest_digest: '7054655db82a5ffaf6b7cabd304ef8a9bd4c28c1c5f9def8ffaf581a27fc4908',
  changed_scope_digest: 'f90dd4b29d4b7b40c95ee41f77026d47df4abc80c0c5744be98789af0733e40a',
  paths: Object.freeze([...PR59_SOVEREIGN_CUSTODY_PATHS]),
});

export const CERTIFIABLE_VERDICTS = Object.freeze([...V3_CERTIFIABLE_VERDICTS]);
export const FORBIDDEN_VERDICTS = Object.freeze([...V3_FORBIDDEN_VERDICTS]);

export const DISPATCH_TABLE = Object.freeze([
  ...V3_DISPATCH_TABLE.map((entry) => entry.evaluator_id === 'CANA_PROMOTION_IDENTITY_V3'
    ? Object.freeze({
      ...entry,
      lane: 'frozen-replay',
      invoked_by: 'tools/promotion-gate/es-0003-frozen-replay.mjs',
    })
    : entry),
  Object.freeze({
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V4_CONTRACT.promotion_event_type,
    lane: 'execution-scope-succession',
    invoked_by: 'tools/promotion-gate/es-0004.mjs',
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

export function collectExecutionScopeEvidence(candidate, options = {}) {
  const cwd = options.cwd ?? ROOT;
  const mirror = options.mirror ?? null;
  const gitOptions = { cwd, mirror };
  const errors = [];
  let manifest = null;
  let manifestDigest = null;
  let scopeDigest = null;
  let manifestValid = false;
  let assignmentValid = false;

  try {
    manifest = JSON.parse(fs.readFileSync(path.join(cwd, MANIFEST_PATH), 'utf8'));
    manifestDigest = sha256(canonicalJson(manifest));
    scopeDigest = changedScopeDigest(manifest);
    validateOwnershipManifest(manifest);
    const assignment = manifest.explicit_user_assignment[V4_CONTRACT.assignment_name];
    assignmentValid = assignment?.assignment_sha256 === V4_CONTRACT.assignment_sha256
      && assignment?.authorization_source_sha256 === V4_CONTRACT.authorization_source_sha256
      && canonicalJson(assignment?.paths) === canonicalJson(V4_CONTRACT.paths);
    manifestValid = assignmentValid;
  } catch (error) {
    errors.push(`current manifest invalid: ${error.message}`);
  }

  const candidateCommit = candidate?.candidate_commit_sha;
  const resolves = candidateCommit === V4_CONTRACT.candidate_commit_sha
    && runGit(['cat-file', '-e', `${candidateCommit}^{commit}`], gitOptions).ok;
  const observedTree = resolves
    ? runGit(['rev-parse', `${candidateCommit}^{tree}`], gitOptions).stdout.toString('utf8').trim()
    : null;
  const parentLine = resolves
    ? runGit(['rev-list', '--parents', '-n', '1', candidateCommit], gitOptions).stdout.toString('utf8').trim().split(/\s+/)
    : [];
  const incumbentIsParent = parentLine.length === 2
    && parentLine[1] === V4_CONTRACT.incumbent_commit_sha;
  const incumbentIsAncestor = resolves
    && runGit(
      ['merge-base', '--is-ancestor', V4_CONTRACT.incumbent_commit_sha, candidateCommit],
      gitOptions,
    ).status === 0;
  const candidateManifest = manifestAt(V4_CONTRACT.candidate_commit_sha, gitOptions);
  const incumbentManifest = manifestAt(V4_CONTRACT.incumbent_commit_sha, gitOptions);

  const v3Positive = JSON.parse(fs.readFileSync(V3_POSITIVE_PATH, 'utf8'));
  const v3Result = evaluateManifestSuccession(v3Positive, { cwd, mirror });

  return {
    errors,
    branch_name_used_as_authority: false,
    candidate_commit_resolves: resolves,
    candidate_tree_sha: observedTree,
    incumbent_is_parent: incumbentIsParent,
    incumbent_is_ancestor: incumbentIsAncestor,
    incumbent_manifest_digest: incumbentManifest.digest,
    current_manifest_digest: manifestDigest,
    candidate_manifest_digest: candidateManifest.digest,
    changed_scope_digest: scopeDigest,
    manifest_valid: manifestValid,
    assignment_valid: assignmentValid,
    v3_failed_checks: v3Result.failed_checks,
  };
}

export function assessExecutionScopeSuccession(candidate, observed) {
  const checks = [];
  const record = (id, ok, detail = null) => checks.push({ id, ok: Boolean(ok), detail });
  const claim = candidate?.manifest_succession ?? {};
  const dispatch = dispatchEvaluator(candidate);
  const paths = Array.isArray(claim.paths) ? claim.paths : [];

  record(
    'dispatch.owned-by-v4',
    dispatch.dispatched?.evaluator_id === EVALUATOR_ID && candidate?.evaluator_id === EVALUATOR_ID,
    dispatch,
  );
  record('identity.evaluator-id', candidate?.evaluator_id === EVALUATOR_ID);
  record('identity.candidate-commit-exact', candidate?.candidate_commit_sha === V4_CONTRACT.candidate_commit_sha && observed?.candidate_commit_resolves === true);
  record('identity.candidate-tree-exact', candidate?.candidate_tree_sha === V4_CONTRACT.candidate_tree_sha && observed?.candidate_tree_sha === V4_CONTRACT.candidate_tree_sha);
  record('identity.branch-is-evidence-only', observed?.branch_name_used_as_authority === false);
  record('ancestry.incumbent-is-parent', observed?.incumbent_is_parent === true);
  record('ancestry.incumbent-is-ancestor', observed?.incumbent_is_ancestor === true);
  record('lineage.execution-scope-payload', claim.execution_scope_payload_sha256 === V4_CONTRACT.execution_scope_payload_sha256);
  record('lineage.authorization-source', claim.authorization_source_sha256 === V4_CONTRACT.authorization_source_sha256);
  record('lineage.assignment-name', claim.assignment_name === V4_CONTRACT.assignment_name);
  record('lineage.assignment-digest', claim.assignment_sha256 === V4_CONTRACT.assignment_sha256 && observed?.assignment_valid === true);
  record('lineage.incumbent-commit', claim.incumbent_commit_sha === V4_CONTRACT.incumbent_commit_sha);
  record('lineage.incumbent-manifest', claim.incumbent_manifest_digest === V4_CONTRACT.incumbent_manifest_digest && observed?.incumbent_manifest_digest === V4_CONTRACT.incumbent_manifest_digest);
  record('lineage.new-manifest', claim.new_manifest_digest === V4_CONTRACT.new_manifest_digest && observed?.current_manifest_digest === V4_CONTRACT.new_manifest_digest);
  record('lineage.changed-scope-digest', claim.changed_scope_digest === V4_CONTRACT.changed_scope_digest && observed?.changed_scope_digest === V4_CONTRACT.changed_scope_digest);
  record('lineage.paths-exact', canonicalJson(paths) === canonicalJson(V4_CONTRACT.paths));
  record('lineage.paths-safe', paths.every(safePath));
  record('lineage.manifest-valid', observed?.manifest_valid === true && (observed?.errors?.length ?? 0) === 0);
  record('lineage.candidate-manifest-exact', observed?.candidate_manifest_digest === V4_CONTRACT.new_manifest_digest && observed?.candidate_manifest_digest === observed?.current_manifest_digest);
  record('bridge.v3-refuses-only-new-manifest', canonicalJson(observed?.v3_failed_checks ?? []) === canonicalJson(['lineage.new-manifest-digest']));
  const ownerGate = candidate?.owner_gate ?? {};
  record('owner-gate.execution-only', ownerGate.state === 'EXECUTION_AUTHORIZED' && ownerGate.claimed_owner_approved !== true);
  record('verdict.no-forbidden-claim', candidate?.claimed_verdict == null || !FORBIDDEN_VERDICTS.includes(candidate.claimed_verdict));

  const accepted = checks.every((check) => check.ok);
  return {
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V4_CONTRACT.promotion_event_type,
    branch_name_used_as_authority: false,
    checks,
    failed_checks: checks.filter((check) => !check.ok).map((check) => check.id),
    certified_verdicts: accepted ? [...CERTIFIABLE_VERDICTS] : [],
    technical_promotion_evidence: accepted ? 'VERIFIED' : 'INCOMPLETE',
    owner_promotion_gate: ownerGate.state ?? 'UNKNOWN',
    accepted,
  };
}

export function evaluateExecutionScopeSuccession(candidate, options = {}) {
  const observed = options.observed ?? collectExecutionScopeEvidence(candidate, options);
  return assessExecutionScopeSuccession(candidate, observed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const candidate = process.argv[2]
    ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
    : null;
  const result = candidate
    ? evaluateExecutionScopeSuccession(candidate, { mirror: process.env.CANA_SOURCE_MIRROR ?? null })
    : { contract: V4_CONTRACT, dispatch: DISPATCH_TABLE };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
