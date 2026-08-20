/**
 * ES-0002 FREEZE (OWNER LAW #5: FREEZE BEFORE CONTEST).
 * =====================================================
 *
 * This module computes the FREEZE MANIFEST — the digests of everything the court commits to
 * BEFORE the candidate is judged: the evaluation contract, the positive fixture, the negative
 * corpus, the judge source hash, the evidence schema, and the pass/fail conditions. The
 * frozen hash is a single sha256 over the sorted (name -> sha256) component list plus a
 * canonical projection of the contract and the pass/fail conditions.
 *
 * The court (es-0002.court.test.mjs) recomputes this at run time and asserts it equals the
 * RECORDED_FREEZE_SHA below. If any frozen artifact changed, the freeze breaks and the court
 * refuses — there are no post-hoc corpus or judge edits.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { V2_CONTRACT, EVALUATOR_ID, PROMOTION_SCHEMA_VERSION, CERTIFIABLE_VERDICTS, FORBIDDEN_VERDICTS } from '../es-0002.mjs';
import { CORPUS_IDS } from './es-0002-adversarial-corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(HERE, '..');

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** The pass/fail conditions the court commits to, frozen as explicit prose+data. */
export const PASS_FAIL_CONDITIONS = Object.freeze({
  positive: 'the single positive fixture is ACCEPTED (accepted===true) with certified verdicts '
    + 'PROMOTION_IDENTITY_VALID + PROMOTION_EVIDENCE_COMPLETE + CANONICAL_PR_ELIGIBLE, '
    + 'technical_promotion_evidence===VERIFIED, owner_promotion_gate===PENDING, '
    + 'branch_name_used_as_authority===false',
  negative: 'EVERY adversarial corpus case is REJECTED (accepted===false) AND its declared '
    + 'expect_reject_check appears in failed_checks',
  corpus_size_min: 22,
  forbidden_verdicts_never_certified: FORBIDDEN_VERDICTS,
  owner_gate_never_laundered: 'a PENDING owner gate must never be reported as APPROVED and must '
    + 'not fail the mechanism court',
});

/** The evidence schema the court commits to (the check ids ES-0002 emits). */
export const EVIDENCE_SCHEMA = Object.freeze([
  'dispatch.owned-by-v2',
  'identity.candidate-commit-resolves', 'identity.candidate-tree-matches', 'identity.branch-is-evidence-only',
  'ancestry.CANONICAL_BASE-is-ancestor', 'ancestry.POST38_HEAD-is-ancestor', 'ancestry.FEDERATION_HEAD-is-ancestor',
  'ancestry.sibling-merge-is-ancestor', 'ancestry.sibling-merge-parents-exact',
  'evidence.ownership-manifest-digest', 'evidence.capability-conservation-35-35', 'evidence.authority-court-green',
  'evidence.single-authorize-seat', 'evidence.hermes-boundary', 'evidence.capability-census',
  'evidence.sovereign-ci-workflow-identity', 'evidence.sovereign-ci-run-receipt-bound',
  'evidence.required-stages-verified', 'evidence.evaluator-version', 'evidence.judge-corpus-hashes',
  'evidence.promotion-target-scope', 'evidence.timestamps',
  'owner-gate.pending-not-laundered', 'verdict.no-forbidden-claim',
]);

export function computeFreeze() {
  const components = {
    'judge:es-0002.mjs': sha256File(path.join(GATE, 'es-0002.mjs')),
    'positive:es-0002-positive.json': sha256File(path.join(GATE, 'fixtures', 'es-0002-positive.json')),
    'corpus:es-0002-adversarial-corpus.mjs': sha256File(path.join(GATE, 'fixtures', 'es-0002-adversarial-corpus.mjs')),
    'v1-historical:promotion-receipt.v1.replay.mjs': sha256File(path.join(GATE, 'historical', 'promotion-receipt.v1.replay.mjs')),
    'v1-harness:replay-v1.mjs': sha256File(path.join(GATE, 'historical', 'replay-v1.mjs')),
  };
  const contractProjection = canonicalJson({
    evaluator_id: EVALUATOR_ID,
    promotion_schema_version: PROMOTION_SCHEMA_VERSION,
    contract: V2_CONTRACT,
    certifiable_verdicts: CERTIFIABLE_VERDICTS,
    forbidden_verdicts: FORBIDDEN_VERDICTS,
    evidence_schema: EVIDENCE_SCHEMA,
    pass_fail_conditions: PASS_FAIL_CONDITIONS,
    corpus_ids: CORPUS_IDS,
  });
  const componentLine = Object.keys(components).sort().map((k) => `${components[k]}  ${k}\n`).join('');
  const freezeSha = sha256(`${componentLine}CONTRACT ${sha256(contractProjection)}\n`);
  return {
    components,
    contract_projection_sha256: sha256(contractProjection),
    freeze_sha256: freezeSha,
    evidence_schema: EVIDENCE_SCHEMA,
    pass_fail_conditions: PASS_FAIL_CONDITIONS,
    corpus_ids: CORPUS_IDS,
  };
}

// The freeze recorded BEFORE the candidate was contested. The court asserts equality.
export const RECORDED_FREEZE_SHA = '4c6c2a5693d7bc7d99b1fedaa7f51493328f2165edd140428e9def89e74c5894';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(computeFreeze(), null, 2)}\n`);
}
