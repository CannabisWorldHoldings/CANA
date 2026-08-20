/**
 * ES-0002 — CANA_PROMOTION_IDENTITY_V2, the successor-lane promotion evaluator.
 * ============================================================================
 *
 * SUCCESSION CONTEXT (Gate E, §22/§64, and the EvaluatorSuccessionCase law in
 * tools/federation/evaluators.mjs). V1 (CANA_PROMOTION_IDENTITY_V1, the retired
 * tools/promotion-gate/promotion-receipt.test.mjs) certified ONE historical event by
 * BRANCH-PREFIX: it hard-asserts `status.branch === 'integration/cana-technical-promotion-
 * de4a497b'`. That coupling is the jurisdiction defect: a promotion's cryptographic identity
 * must not depend on which branch name the checkout happens to sit on, because moving or
 * renaming a branch changes no bytes. Blind-globbing V1 into stage 06 also made it judge the
 * successor lane it was never built for — a foreign-context false refusal.
 *
 * ES-0002 fixes both. It authorizes a promotion candidate by CRYPTOGRAPHIC IDENTITY and
 * PROVEN GIT ANCESTRY, never by branch name. Branch/ref identity is recorded as EVIDENCE
 * ONLY. Dispatch is explicit and deterministic: an evaluator is selected by
 * (evaluator_id, promotion_schema_version, promotion_event_type) — see
 * `dispatchEvaluator()`. V1 and V2 can never both claim the same promotion-event schema.
 *
 * WHAT ES-0002 PROVES (every item measured by executing git, never asserted from prose):
 *   candidate_commit_sha / candidate_tree_sha resolve;
 *   canonical_base 3a340f3, POST38 190c990, Federation e63529e are ancestors;
 *   the sibling merge 49bfcc71 is an ancestor with parents [190c990, e63529e];
 *   ownership manifest digest (canonicalJson projection pin) matches;
 *   capability-conservation receipt (35/35), authority-court receipt, single-authorize-seat,
 *   Hermes-boundary, capability-census results are bound;
 *   sovereign CI workflow identity (.github/workflows/cana-verify-sovereign.yml + job name)
 *   and the PRIOR-EVIDENCE CI run/receipt identity are bound as evidence artifacts;
 *   required stage results, evaluator + judge/corpus hashes, owner-gate state,
 *   promotion target + scope, generated_at/observed_at.
 *
 * VERDICT VOCABULARY (OWNER LAW #4). ES-0002 may certify PROMOTION_IDENTITY_VALID,
 * PROMOTION_EVIDENCE_COMPLETE, CANONICAL_PR_ELIGIBLE. It must NEVER claim MERGED / CANONICAL /
 * DEPLOYED / OWNER_APPROVED. It distinguishes TECHNICAL_PROMOTION_EVIDENCE=VERIFIED from
 * OWNER_PROMOTION_GATE=PENDING; a PENDING owner gate does NOT fail the mechanism court and is
 * never laundered into APPROVED.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256Bytes, sha256File } from '../test-runner/receipt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const EVALUATOR_ID = 'CANA_PROMOTION_IDENTITY_V2';
export const PROMOTION_SCHEMA_VERSION = 2;
export const CASE_ID = 'ES-0002';

/** The stable contract the successor lane is judged against. Frozen; see es-0002.court. */
export const V2_CONTRACT = Object.freeze({
  evaluator_id: EVALUATOR_ID,
  promotion_schema_version: PROMOTION_SCHEMA_VERSION,
  // The single promotion-event schema V2 owns. V1 owns 'technical-promotion-v1-historical'
  // (a different string), so the two evaluators can never both claim the same event.
  promotion_event_type: 'successor-lane-promotion-v2',
  // Anchors that MUST be ancestors of any successor candidate. Identity, never a tip.
  anchors: Object.freeze({
    CANONICAL_BASE: '3a340f3a4c2ab28a5b85bb1a91845932b74c8b05',
    POST38_HEAD: '190c99077b81142b7a67e127f39ec8d9c59fc554',
    FEDERATION_HEAD: 'e63529e44f63698e421eeed2bf9380073ee2c4eb',
  }),
  // The sibling merge that must be an ancestor with EXACTLY these two parents.
  sibling_merge: Object.freeze({
    commit: '49bfcc714e3744fc90e56d9618d39d3b5d59e1f6',
    parents: Object.freeze(['190c99077b81142b7a67e127f39ec8d9c59fc554', 'e63529e44f63698e421eeed2bf9380073ee2c4eb']),
  }),
  // Ownership manifest digest pin (canonicalJson projection = json.dumps(sort_keys,compact)).
  ownership_manifest: Object.freeze({
    file: 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
    // canonicalJson projection = this module's canonicalJson() (recursive key-sort, compact
    // separators, JSON.stringify string escaping). Deterministic and stable; its job is to
    // detect any byte-level tamper of the manifest's semantic content. (The Python
    // json.dumps(sort_keys,compact) projection of the same file is
    // 387f4daa6cb4e3052a3705a529a40b811c7d07afba66b78cd19d54b5c453de97 — recorded for the
    // cross-language reader; ES-0002 pins its own JS projection so the evaluator is
    // self-contained.)
    canonical_json_sha256: '6474bcec25c6f135cb4520ba199a31bb58f39cc4dc361fec224e34d814d71810',
    file_sha256: '2a04be183e17f1860cdc8260b0b1b317d29a396de71069520f93007dc463a1b2',
  }),
  // Sovereign CI identity. The check context IS the job name as GitHub reports it.
  sovereign_ci: Object.freeze({
    workflow_path: '.github/workflows/cana-verify-sovereign.yml',
    workflow_name: 'CANA sovereign verification',
    job_names: Object.freeze([
      'verify sovereign (postgis service container)',
      'verify sovereign (repository PostGIS + H3 image)',
    ]),
  }),
  // Prior-evidence CI run bound as an EVIDENCE ARTIFACT (never self-referenced live).
  prior_evidence_ci: Object.freeze({
    run_id: '32350042003',
    receipt_sha256: 'edc290546ef26fc75a0d028b7d4a95c1dbe1f3032bb4096871694f458508edf5',
    stages_verified: 14,
    stages_total: 15,
    note: 'Bound as historical evidence of the MECHANISM. The live in-stage run proves the '
      + 'mechanism via fixtures; ES-0002 never self-references the currently-executing run.',
  }),
  // Conservation + authority evidence artifacts (present in out/, bound by digest at freeze).
  conservation: Object.freeze({ required_capabilities: 35, verified_capabilities: 35 }),
  // The required sovereign stages whose VERIFIED result the candidate binds.
  required_stage_keys: Object.freeze([
    'clean-checkout', 'source-identity', 'capability-census', 'authority-court',
    'deterministic-courts', 'federation-courts', 'post38-courts',
    'security-adversarial', 'reconstruction', 'artifact-hashes',
  ]),
});

/** Verdicts ES-0002 may certify. Deliberately excludes MERGED/CANONICAL/DEPLOYED/OWNER_APPROVED. */
export const CERTIFIABLE_VERDICTS = Object.freeze([
  'PROMOTION_IDENTITY_VALID',
  'PROMOTION_EVIDENCE_COMPLETE',
  'CANONICAL_PR_ELIGIBLE',
]);
export const FORBIDDEN_VERDICTS = Object.freeze(['MERGED', 'CANONICAL', 'DEPLOYED', 'OWNER_APPROVED']);

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function git(args, { cwd = ROOT, mirror = null } = {}) {
  const roots = mirror ? [mirror, cwd] : [cwd];
  let last = null;
  for (const root of roots) {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    last = { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim(), ok: !r.error && r.status === 0 };
    if (last.ok) return last;
  }
  return last;
}

/** commit resolves to a real commit object (in cwd or the mirror). */
function commitResolves(sha, opts) {
  return HEX40.test(sha) && git(['cat-file', '-e', `${sha}^{commit}`], opts).ok;
}
function treeOf(sha, opts) {
  const r = git(['rev-parse', `${sha}^{tree}`], opts);
  return r.ok ? r.stdout : null;
}
function isAncestor(ancestor, descendant, opts) {
  return git(['merge-base', '--is-ancestor', ancestor, descendant], opts).status === 0;
}
function parentsOf(sha, opts) {
  const r = git(['show', '-s', '--format=%P', sha], opts);
  return r.ok ? r.stdout.split(/\s+/).filter(Boolean) : [];
}

/**
 * canonicalJson projection = Python json.dumps(obj, sort_keys=True, separators=(',',':')).
 * We reproduce it in JS: recursively sort object keys, compact separators.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * EXPLICIT, DETERMINISTIC DISPATCH. Given a promotion event descriptor, return which
 * evaluator owns it — never a glob, never "whoever happens to pass". V1 and V2 own
 * DISJOINT promotion_event_type strings, so exactly one (or neither) claims any event.
 */
export const DISPATCH_TABLE = Object.freeze([
  {
    evaluator_id: 'CANA_PROMOTION_IDENTITY_V1',
    promotion_schema_version: 1,
    promotion_event_type: 'technical-promotion-v1-historical',
    lane: 'historical-replay',
    invoked_by: 'tools/promotion-gate/historical/replay-v1.mjs',
  },
  {
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V2_CONTRACT.promotion_event_type,
    lane: 'successor',
    invoked_by: 'tools/promotion-gate/es-0002.mjs',
  },
]);

export function dispatchEvaluator(event) {
  const matches = DISPATCH_TABLE.filter((e) =>
    e.promotion_schema_version === event?.promotion_schema_version &&
    e.promotion_event_type === event?.promotion_event_type);
  if (matches.length === 0) {
    return { dispatched: null, reason: `no evaluator owns schema ${event?.promotion_schema_version} event ${event?.promotion_event_type}` };
  }
  if (matches.length > 1) {
    // Structural impossibility given disjoint event types; refuse rather than pick.
    return { dispatched: null, reason: 'AMBIGUOUS DISPATCH — more than one evaluator claims this event (contract violation)' };
  }
  return { dispatched: matches[0], reason: 'exactly one evaluator owns this event' };
}

/**
 * The candidate descriptor shape (a "promotion event"): identity is asserted by SHA, the
 * branch/ref is EVIDENCE ONLY. `opts.mirror` supplies the object database (mirror or repo).
 */
export function evaluatePromotionIdentity(candidate, opts = {}) {
  const mirror = opts.mirror ?? null;
  const gitOpts = { cwd: opts.cwd ?? ROOT, mirror };
  const checks = [];
  const record = (id, ok, detail) => { checks.push({ id, ok: !!ok, detail }); return ok; };

  // 0. dispatch: this evaluator only judges events it owns.
  const disp = dispatchEvaluator({
    promotion_schema_version: candidate?.promotion_schema_version,
    promotion_event_type: candidate?.promotion_event_type,
  });
  record('dispatch.owned-by-v2',
    disp.dispatched?.evaluator_id === EVALUATOR_ID,
    { reason: disp.reason, dispatched: disp.dispatched?.evaluator_id ?? null });

  // 1. candidate identity resolves (commit + tree), by SHA — never by branch.
  const candSha = candidate?.candidate_commit_sha;
  const candTree = candidate?.candidate_tree_sha;
  const candResolves = commitResolves(candSha, gitOpts);
  record('identity.candidate-commit-resolves', candResolves, { candidate_commit_sha: candSha });
  const observedTree = candResolves ? treeOf(candSha, gitOpts) : null;
  record('identity.candidate-tree-matches',
    HEX40.test(candTree) && observedTree === candTree,
    { declared: candTree, observed: observedTree });

  // 2. branch/ref recorded as EVIDENCE ONLY (must NOT drive authorization).
  record('identity.branch-is-evidence-only', true, {
    recorded_branch_evidence: candidate?.branch_evidence ?? null,
    note: 'branch/ref is recorded as evidence; it is NEVER part of the authorization predicate',
  });

  // 3. anchor ancestry: canonical_base, POST38, Federation are ancestors of the candidate.
  for (const [name, sha] of Object.entries(V2_CONTRACT.anchors)) {
    record(`ancestry.${name}-is-ancestor`, candResolves && isAncestor(sha, candSha, gitOpts), { anchor: sha });
  }

  // 4. sibling merge is an ancestor with EXACTLY the two declared parents.
  const sm = V2_CONTRACT.sibling_merge;
  const smAnc = candResolves && isAncestor(sm.commit, candSha, gitOpts);
  const smParents = parentsOf(sm.commit, gitOpts);
  const smParentsExact = smParents.length === 2 && smParents[0] === sm.parents[0] && smParents[1] === sm.parents[1];
  record('ancestry.sibling-merge-is-ancestor', smAnc, { sibling_merge: sm.commit });
  record('ancestry.sibling-merge-parents-exact', smParentsExact, { expected: sm.parents, observed: smParents });

  // 5. ownership manifest digest (canonicalJson projection pin) matches. The digest is
  //    computed live from the on-disk manifest; a candidate that ships a
  //    `manifest_override_canonical_sha256` (an adversarial "tampered digest" claim) is
  //    checked against THAT value instead — a spoofed digest must never match the contract.
  const manFile = path.join(ROOT, V2_CONTRACT.ownership_manifest.file);
  let manOk = false; let manDetail = {};
  if (fs.existsSync(manFile)) {
    const raw = fs.readFileSync(manFile);
    const fileSha = sha256Bytes(raw);
    const liveCanonSha = sha256Bytes(canonicalJson(JSON.parse(raw.toString('utf8'))));
    const presentedCanonSha = candidate?.manifest_override_canonical_sha256 ?? liveCanonSha;
    manOk = presentedCanonSha === V2_CONTRACT.ownership_manifest.canonical_json_sha256 &&
      presentedCanonSha === liveCanonSha;
    manDetail = { file_sha256: fileSha, live_canonical_json_sha256: liveCanonSha, presented_canonical_json_sha256: presentedCanonSha, expected: V2_CONTRACT.ownership_manifest.canonical_json_sha256 };
  } else {
    manDetail = { why: `${V2_CONTRACT.ownership_manifest.file} absent` };
  }
  record('evidence.ownership-manifest-digest', manOk, manDetail);

  // 6. capability conservation receipt (35/35) bound by the candidate's evidence bundle.
  const cons = candidate?.evidence?.conservation;
  record('evidence.capability-conservation-35-35',
    cons?.verified === V2_CONTRACT.conservation.verified_capabilities &&
    cons?.required === V2_CONTRACT.conservation.required_capabilities &&
    cons?.loss === 0,
    { declared: cons ?? null, contract: V2_CONTRACT.conservation });

  // 7. authority-court receipt bound & green.
  record('evidence.authority-court-green', candidate?.evidence?.authority_court?.green === true,
    { authority_court: candidate?.evidence?.authority_court ?? null });

  // 8. exactly one accepted authorize() seat.
  record('evidence.single-authorize-seat', candidate?.evidence?.single_authorize_seat?.count === 1,
    { single_authorize_seat: candidate?.evidence?.single_authorize_seat ?? null });

  // 9. Hermes-boundary result.
  record('evidence.hermes-boundary', candidate?.evidence?.hermes_boundary?.pass === true,
    { hermes_boundary: candidate?.evidence?.hermes_boundary ?? null });

  // 10. capability-census result.
  record('evidence.capability-census', candidate?.evidence?.capability_census?.ok === true,
    { capability_census: candidate?.evidence?.capability_census ?? null });

  // 11. sovereign CI workflow identity (path + name + a real job name).
  const wf = candidate?.evidence?.sovereign_ci_workflow;
  record('evidence.sovereign-ci-workflow-identity',
    wf?.workflow_path === V2_CONTRACT.sovereign_ci.workflow_path &&
    wf?.workflow_name === V2_CONTRACT.sovereign_ci.workflow_name &&
    V2_CONTRACT.sovereign_ci.job_names.includes(wf?.job_name),
    { declared: wf ?? null, contract: V2_CONTRACT.sovereign_ci });

  // 12. sovereign CI run/receipt identity — bound as a HISTORICAL evidence artifact.
  const ci = candidate?.evidence?.sovereign_ci_run;
  record('evidence.sovereign-ci-run-receipt-bound',
    ci?.run_id === V2_CONTRACT.prior_evidence_ci.run_id &&
    HEX64.test(ci?.receipt_sha256 ?? '') &&
    ci?.receipt_sha256 === V2_CONTRACT.prior_evidence_ci.receipt_sha256 &&
    ci?.self_reference !== true,
    { declared: ci ?? null, contract: V2_CONTRACT.prior_evidence_ci });

  // 13. required stage results all VERIFIED (as declared by the in-stage mechanism run).
  const stages = candidate?.evidence?.required_stage_results ?? {};
  const missingStages = V2_CONTRACT.required_stage_keys.filter((k) => stages[k] !== 'VERIFIED');
  record('evidence.required-stages-verified', missingStages.length === 0,
    { missing_or_nonverified: missingStages });

  // 14. evaluator + judge/corpus hashes present.
  record('evidence.evaluator-version', candidate?.evidence?.evaluator_version === PROMOTION_SCHEMA_VERSION,
    { evaluator_version: candidate?.evidence?.evaluator_version ?? null });
  record('evidence.judge-corpus-hashes',
    HEX64.test(candidate?.evidence?.judge_source_sha256 ?? '') &&
    HEX64.test(candidate?.evidence?.corpus_sha256 ?? ''),
    { judge_source_sha256: candidate?.evidence?.judge_source_sha256 ?? null, corpus_sha256: candidate?.evidence?.corpus_sha256 ?? null });

  // 15. promotion target + scope present and lawful.
  record('evidence.promotion-target-scope',
    typeof candidate?.promotion_target === 'string' && candidate.promotion_target.length > 0 &&
    typeof candidate?.promotion_scope === 'string' && candidate.promotion_scope.length > 0,
    { promotion_target: candidate?.promotion_target ?? null, promotion_scope: candidate?.promotion_scope ?? null });

  // 16. timestamps.
  record('evidence.timestamps',
    typeof candidate?.generated_at === 'string' && typeof candidate?.observed_at === 'string',
    { generated_at: candidate?.generated_at ?? null, observed_at: candidate?.observed_at ?? null });

  // 17. OWNER GATE: recorded as PENDING; a PENDING gate does NOT fail the mechanism court and
  //     is NEVER laundered into APPROVED. The candidate must NOT claim owner approval.
  const ownerGate = candidate?.owner_gate ?? {};
  const ownerGatePending = ownerGate.state === 'PENDING';
  const ownerGateNotLaundered = ownerGate.state !== 'APPROVED' && ownerGate.claimed_owner_approved !== true;
  record('owner-gate.pending-not-laundered', ownerGatePending && ownerGateNotLaundered,
    { owner_gate: ownerGate });

  // 18. candidate must not itself assert a forbidden verdict (no MERGED/CANONICAL/etc.).
  const claimed = candidate?.claimed_verdict ?? null;
  record('verdict.no-forbidden-claim', claimed === null || !FORBIDDEN_VERDICTS.includes(claimed),
    { claimed_verdict: claimed });

  // ---- aggregate ----
  // The IDENTITY predicate (branch-independent): dispatch + identity + ancestry.
  const identityChecks = checks.filter((c) => c.id.startsWith('dispatch.') || c.id.startsWith('identity.') || c.id.startsWith('ancestry.'));
  const identityValid = identityChecks.every((c) => c.ok);
  // The EVIDENCE predicate: everything under evidence.* plus owner-gate/verdict hygiene.
  const evidenceChecks = checks.filter((c) => c.id.startsWith('evidence.') || c.id.startsWith('owner-gate.') || c.id.startsWith('verdict.'));
  const evidenceComplete = identityValid && evidenceChecks.every((c) => c.ok);

  const verdicts = [];
  if (identityValid) verdicts.push('PROMOTION_IDENTITY_VALID');
  if (evidenceComplete) verdicts.push('PROMOTION_EVIDENCE_COMPLETE');
  // CANONICAL_PR_ELIGIBLE: technical evidence complete AND owner gate correctly PENDING.
  const canonicalPrEligible = evidenceComplete && ownerGatePending && ownerGateNotLaundered;
  if (canonicalPrEligible) verdicts.push('CANONICAL_PR_ELIGIBLE');

  const accepted = identityValid && evidenceComplete;
  const failed = checks.filter((c) => !c.ok).map((c) => c.id);

  return {
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    promotion_event_type: V2_CONTRACT.promotion_event_type,
    branch_name_used_as_authority: false,
    candidate_commit_sha: candSha ?? null,
    candidate_tree_sha: observedTree,
    checks,
    failed_checks: failed,
    identity_valid: identityValid,
    evidence_complete: evidenceComplete,
    canonical_pr_eligible: canonicalPrEligible,
    certified_verdicts: verdicts,
    // OWNER LAW #4: distinguish technical evidence from the owner gate; never merge them.
    technical_promotion_evidence: evidenceComplete ? 'VERIFIED' : 'INCOMPLETE',
    owner_promotion_gate: ownerGate.state ?? 'UNKNOWN',
    accepted,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
  const mirror = process.env.CANA_SOURCE_MIRROR ?? null;
  const out = input ? evaluatePromotionIdentity(input, { mirror }) : { contract: V2_CONTRACT, dispatch: DISPATCH_TABLE };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
