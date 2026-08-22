/**
 * ES-0003 — CANA_PROMOTION_IDENTITY_V3.
 *
 * V3 is not a replacement implementation of V2. It executes V2 over an equivalent V2 event
 * and permits succession only when V2's sole refusal is its frozen historical manifest pin.
 * It then reconstructs the one owner-approved PR57 transition from immutable Git objects,
 * exact manifest assignment bytes and the 24 mode/blob/content observations. Unknown future
 * transitions fail closed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CERTIFIABLE_VERDICTS as V2_CERTIFIABLE_VERDICTS,
  DISPATCH_TABLE as V2_DISPATCH_TABLE,
  FORBIDDEN_VERDICTS as V2_FORBIDDEN_VERDICTS,
  evaluatePromotionIdentity,
} from './es-0002.mjs';
import {
  PR57_INHERITED_MAIN_ENTRY_SCHEMA,
  PR57_INHERITED_MAIN_PATHS,
  validateOwnershipManifest,
} from '../durability/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MANIFEST_PATH = 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json';
const V2_JUDGE_SHA256 = '1e6e5c2303c210c8bff137b351fe23de7cd502cc782f1190f2ac5263dd79bcd1';
const V2_CORPUS_SHA256 = 'edefd64754583e4b7b867ed99b45e9f99a30f9143b6ed9d1a393ade7b4c7e29f';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export const EVALUATOR_ID = 'CANA_PROMOTION_IDENTITY_V3';
export const PROMOTION_SCHEMA_VERSION = 3;
export const CASE_ID = 'ES-0003';

export const V3_CONTRACT = Object.freeze({
  evaluator_id: EVALUATOR_ID,
  promotion_schema_version: PROMOTION_SCHEMA_VERSION,
  promotion_event_type: 'manifest-succession-promotion-v3',
  branch_name_used_as_authority: false,
  assignment_name: 'pr57_inherited_main_reconciliation_2026_08_21',
  approved_succession_payload_sha256: '9650b9555d573a046540b56d06b6d2f362ec4384692092b474bfc94a489df23e',
  canonical_main_sha: '4cc502cb317be157f1448e04ee296cb202829ed7',
  reality_closure_candidate_sha: 'e03acd96ccfed958b0a21c76e32c2075038a4e34',
  prior_owner_approved_reconciliation_sha256: '545dcae796ebb8ad8913bee392705f28cb234f990dde20fbf2fa1423dd3d55ed',
  incumbent_manifest_digest: '6474bcec25c6f135cb4520ba199a31bb58f39cc4dc361fec224e34d814d71810',
  new_manifest_digest: '592c19aeda938f5d6b824559d77bcc21213d786815754505fbd5b7c5a9f97ded',
  entry_count: 24,
  entry_schema: Object.freeze(['path', 'git_mode', 'git_blob_sha', 'content_sha256']),
});

export const CERTIFIABLE_VERDICTS = Object.freeze([...V2_CERTIFIABLE_VERDICTS]);
export const FORBIDDEN_VERDICTS = Object.freeze([...V2_FORBIDDEN_VERDICTS]);

export const DISPATCH_TABLE = Object.freeze([
  ...V2_DISPATCH_TABLE.map((entry) => entry.evaluator_id === 'CANA_PROMOTION_IDENTITY_V2'
    ? Object.freeze({
      ...entry,
      lane: 'frozen-replay',
      invoked_by: 'tools/promotion-gate/es-0002-frozen-replay.mjs',
    })
    : entry),
  Object.freeze({
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V3_CONTRACT.promotion_event_type,
    lane: 'manifest-succession',
    invoked_by: 'tools/promotion-gate/es-0003.mjs',
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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function runGit(args, { cwd = ROOT, mirror = null } = {}) {
  const roots = mirror ? [mirror, cwd] : [cwd];
  let last = null;
  for (const root of roots) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
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

function textGit(args, options) {
  const result = runGit(args, options);
  return { ...result, text: result.stdout.toString('utf8').trim() };
}

function safePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('*')
    && !value.includes('..')
    && path.posix.normalize(value) === value;
}

function projectedEntries(assignment) {
  if (!Array.isArray(assignment?.entries) || !Array.isArray(assignment?.entry_schema)) return [];
  const positions = Object.fromEntries(assignment.entry_schema.map((field, index) => [field, index]));
  return assignment.entries.map((entry) => ({
    path: entry[positions.path],
    git_mode: entry[positions.canonical_git_mode],
    git_blob_sha: entry[positions.current_canonical_blob_sha],
    content_sha256: entry[positions.canonical_content_sha256],
  }));
}

function equivalentV2Event(candidate) {
  return {
    ...candidate,
    evaluator_id: 'CANA_PROMOTION_IDENTITY_V2',
    promotion_schema_version: 2,
    promotion_event_type: 'successor-lane-promotion-v2',
    evidence: {
      ...(candidate?.evidence ?? {}),
      evaluator_version: 2,
      judge_source_sha256: V2_JUDGE_SHA256,
      corpus_sha256: V2_CORPUS_SHA256,
    },
  };
}

function inspectEntry(commit, relative, gitOptions) {
  const tree = textGit(['ls-tree', '--full-tree', commit, '--', relative], gitOptions);
  const match = tree.text.match(/^(\d{6})\s+blob\s+([0-9a-f]{40})\t/);
  const content = runGit(['show', `${commit}:${relative}`], gitOptions);
  if (!tree.ok || !match || !content.ok) return null;
  return {
    path: relative,
    git_mode: match[1],
    git_blob_sha: match[2],
    content_sha256: sha256(content.stdout),
  };
}

export function collectManifestSuccessionEvidence(candidate, options = {}) {
  const cwd = options.cwd ?? ROOT;
  const mirror = options.mirror ?? null;
  const gitOptions = { cwd, mirror };
  const errors = [];
  let manifest = null;
  let assignment = null;
  let assignmentSchemaValid = false;
  let newManifestDigest = null;
  let incumbentManifestDigest = null;

  try {
    const raw = fs.readFileSync(path.join(cwd, MANIFEST_PATH), 'utf8');
    manifest = JSON.parse(raw);
    newManifestDigest = sha256(canonicalJson(manifest));
    validateOwnershipManifest(manifest);
    assignment = manifest.explicit_user_assignment[V3_CONTRACT.assignment_name];
    assignmentSchemaValid = true;
  } catch (error) {
    errors.push(`current manifest invalid: ${error.message}`);
  }

  const historical = runGit(
    ['show', `${V3_CONTRACT.reality_closure_candidate_sha}:${MANIFEST_PATH}`],
    gitOptions,
  );
  if (historical.ok) {
    try {
      incumbentManifestDigest = sha256(canonicalJson(JSON.parse(historical.stdout.toString('utf8'))));
    } catch (error) {
      errors.push(`historical manifest invalid: ${error.message}`);
    }
  } else {
    errors.push('historical manifest Git object is unavailable');
  }

  const candidateCommit = candidate?.candidate_commit_sha;
  const resolves = HEX40.test(candidateCommit ?? '')
    && runGit(['cat-file', '-e', `${candidateCommit}^{commit}`], gitOptions).ok;
  const tree = resolves ? textGit(['rev-parse', `${candidateCommit}^{tree}`], gitOptions).text : null;
  const canonicalAncestor = resolves
    && runGit(['merge-base', '--is-ancestor', V3_CONTRACT.canonical_main_sha, candidateCommit], gitOptions).status === 0;
  const candidateAncestor = resolves
    && runGit(['merge-base', '--is-ancestor', V3_CONTRACT.reality_closure_candidate_sha, candidateCommit], gitOptions).status === 0;

  const expectedEntries = projectedEntries(assignment);
  const observedEntries = resolves
    ? PR57_INHERITED_MAIN_PATHS.map((relative) => inspectEntry(candidateCommit, relative, gitOptions))
    : [];
  const gitEntriesMatchAssignment = expectedEntries.length === V3_CONTRACT.entry_count
    && observedEntries.length === expectedEntries.length
    && observedEntries.every((observed, index) => observed
      && canonicalJson(observed) === canonicalJson(expectedEntries[index]));
  assignmentSchemaValid = assignmentSchemaValid
    && assignment?.approval_sha256 === V3_CONTRACT.prior_owner_approved_reconciliation_sha256
    && canonicalJson(assignment.entry_schema) === canonicalJson(PR57_INHERITED_MAIN_ENTRY_SCHEMA)
    && gitEntriesMatchAssignment;

  const v2Result = evaluatePromotionIdentity(equivalentV2Event(candidate), { cwd, mirror });

  return {
    errors,
    candidate_commit_resolves: resolves,
    candidate_tree_sha: tree,
    branch_name_used_as_authority: false,
    canonical_main_ancestor: canonicalAncestor,
    reality_candidate_ancestor: candidateAncestor,
    incumbent_manifest_digest: incumbentManifestDigest,
    new_manifest_digest: newManifestDigest,
    assignment_schema_valid: assignmentSchemaValid,
    expected_entries: expectedEntries,
    v2_result: v2Result,
  };
}

export function assessManifestSuccession(candidate, observed) {
  const checks = [];
  const record = (id, ok, detail) => { checks.push({ id, ok: Boolean(ok), detail }); };
  const claim = candidate?.manifest_succession ?? {};
  const entries = Array.isArray(claim.entries) ? claim.entries : [];
  const expectedEntries = Array.isArray(observed?.expected_entries) ? observed.expected_entries : [];
  const dispatch = dispatchEvaluator(candidate);

  record('dispatch.owned-by-v3', dispatch.dispatched?.evaluator_id === EVALUATOR_ID, dispatch);
  record('identity.evaluator-id', candidate?.evaluator_id === EVALUATOR_ID, { declared: candidate?.evaluator_id ?? null });
  record('identity.candidate-commit-resolves', observed?.candidate_commit_resolves === true, { candidate_commit_sha: candidate?.candidate_commit_sha ?? null });
  record('identity.candidate-tree-matches', HEX40.test(candidate?.candidate_tree_sha ?? '') && candidate.candidate_tree_sha === observed?.candidate_tree_sha, { declared: candidate?.candidate_tree_sha ?? null, observed: observed?.candidate_tree_sha ?? null });
  record('identity.branch-is-evidence-only', /* MUTATION:M10_ALLOW_BRANCH_AS_AUTHORITY */ observed.branch_name_used_as_authority === false, { branch_evidence: candidate?.branch_evidence ?? null });
  record('ancestry.canonical-main-is-ancestor', /* MUTATION:M04_SKIP_CANONICAL_ANCESTRY */ observed.canonical_main_ancestor === true, { canonical_main_sha: V3_CONTRACT.canonical_main_sha });
  record('ancestry.reality-candidate-is-ancestor', /* MUTATION:M03_SKIP_CANDIDATE_ANCESTRY */ observed.reality_candidate_ancestor === true, { reality_closure_candidate_sha: V3_CONTRACT.reality_closure_candidate_sha });
  record('lineage.assignment-name', claim.assignment_name === V3_CONTRACT.assignment_name, { declared: claim.assignment_name ?? null });
  record('lineage.succession-payload-digest', claim.approved_succession_payload_sha256 === V3_CONTRACT.approved_succession_payload_sha256, { declared: claim.approved_succession_payload_sha256 ?? null });
  record('lineage.canonical-main-sha', claim.canonical_main_sha === V3_CONTRACT.canonical_main_sha, { declared: claim.canonical_main_sha ?? null });
  record('lineage.reality-candidate-sha', claim.reality_closure_candidate_sha === V3_CONTRACT.reality_closure_candidate_sha, { declared: claim.reality_closure_candidate_sha ?? null });
  record('lineage.prior-owner-approved-scope-digest', claim.prior_owner_approved_reconciliation_sha256 === V3_CONTRACT.prior_owner_approved_reconciliation_sha256, { declared: claim.prior_owner_approved_reconciliation_sha256 ?? null });
  record('lineage.incumbent-manifest-digest', claim.incumbent_manifest_digest === V3_CONTRACT.incumbent_manifest_digest && observed.incumbent_manifest_digest === V3_CONTRACT.incumbent_manifest_digest, { declared: claim.incumbent_manifest_digest ?? null, observed: observed.incumbent_manifest_digest ?? null });
  record('lineage.new-manifest-digest', /* MUTATION:M12_ALLOW_UNKNOWN_MANIFEST_SUCCESSION */ claim.new_manifest_digest === V3_CONTRACT.new_manifest_digest && observed.new_manifest_digest === V3_CONTRACT.new_manifest_digest, { declared: claim.new_manifest_digest ?? null, observed: observed.new_manifest_digest ?? null });
  record('lineage.assignment-schema-valid', observed.assignment_schema_valid === true && canonicalJson(claim.entry_schema) === canonicalJson(V3_CONTRACT.entry_schema), { observation_errors: observed.errors ?? [] });
  record('lineage.exact-24-path-count', /* MUTATION:M05_IGNORE_PATH_COUNT */ claim.entry_count === 24 && entries.length === 24 && expectedEntries.length === 24, { declared: claim.entry_count ?? null, presented: entries.length, observed: expectedEntries.length });
  const pathsExact = /* MUTATION:M09_ALLOW_WILDCARD_PATH_SET */ entries.length === expectedEntries.length && entries.every((entry, index) => entry.path === expectedEntries[index]?.path);
  record('lineage.entry-paths-exact', pathsExact, { declared: entries.map((entry) => entry.path), expected: expectedEntries.map((entry) => entry.path) });
  const pathsSafe = /* MUTATION:M09_ALLOW_WILDCARD_SYNTAX */ entries.every((entry) => safePath(entry.path));
  record('lineage.entry-paths-safe', pathsSafe, { unsafe: entries.filter((entry) => !safePath(entry.path)).map((entry) => entry.path) });
  record('lineage.git-modes-exact', /* MUTATION:M06_IGNORE_GIT_MODE */ entries.every((entry, index) => entry.git_mode === expectedEntries[index]?.git_mode), null);
  record('lineage.git-blobs-exact', /* MUTATION:M07_IGNORE_GIT_BLOB */ entries.every((entry, index) => entry.git_blob_sha === expectedEntries[index]?.git_blob_sha), null);
  record('lineage.content-sha256-exact', /* MUTATION:M08_IGNORE_CONTENT_SHA256 */ entries.every((entry, index) => entry.content_sha256 === expectedEntries[index]?.content_sha256), null);
  const v2Failures = observed?.v2_result?.failed_checks ?? [];
  record('bridge.v2-only-manifest-shift', canonicalJson(v2Failures) === canonicalJson(['evidence.ownership-manifest-digest']), { v2_failed_checks: v2Failures });
  const ownerGate = candidate?.owner_gate ?? {};
  record('owner-gate.pending-not-laundered', /* MUTATION:M11_ALLOW_OWNER_PENDING_TO_OWNER_APPROVED */ ownerGate.state === 'PENDING' && ownerGate.claimed_owner_approved !== true, { owner_gate: ownerGate });
  record('verdict.no-forbidden-claim', candidate?.claimed_verdict == null || !FORBIDDEN_VERDICTS.includes(candidate.claimed_verdict), { claimed_verdict: candidate?.claimed_verdict ?? null });

  const accepted = checks.every((check) => check.ok);
  const certifiedVerdicts = accepted ? [...CERTIFIABLE_VERDICTS] : [];
  return {
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V3_CONTRACT.promotion_event_type,
    branch_name_used_as_authority: false,
    candidate_commit_sha: candidate?.candidate_commit_sha ?? null,
    candidate_tree_sha: observed?.candidate_tree_sha ?? null,
    checks,
    failed_checks: checks.filter((check) => !check.ok).map((check) => check.id),
    certified_verdicts: certifiedVerdicts,
    technical_promotion_evidence: accepted ? 'VERIFIED' : 'INCOMPLETE',
    owner_promotion_gate: ownerGate.state ?? 'UNKNOWN',
    accepted,
  };
}

export function evaluateManifestSuccession(candidate, options = {}) {
  const observed = collectManifestSuccessionEvidence(candidate, options);
  return assessManifestSuccession(candidate, observed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const candidate = process.argv[2]
    ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
    : null;
  const result = candidate
    ? evaluateManifestSuccession(candidate, { mirror: process.env.CANA_SOURCE_MIRROR ?? null })
    : { contract: V3_CONTRACT, dispatch: DISPATCH_TABLE };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
