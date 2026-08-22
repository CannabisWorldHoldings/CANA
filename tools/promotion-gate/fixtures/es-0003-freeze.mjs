/**
 * ES-0003 PRE-CANDIDATE FREEZE.
 *
 * This freeze deliberately excludes the future candidate source and the independently authored
 * hidden holdout. It binds the owner-approved criteria, public event contract, positive fixture,
 * adversarial corpus, mutation plan and court source before CANA_PROMOTION_IDENTITY_V3 exists.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORPUS_IDS } from './es-0003-adversarial-corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(HERE, '..');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = (file) => sha256(fs.readFileSync(file));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const APPROVED_SUCCESSION_PAYLOAD_SHA256 =
  '9650b9555d573a046540b56d06b6d2f362ec4384692092b474bfc94a489df23e';

export const EVENT_SCHEMA = Object.freeze({
  evaluator_id: 'CANA_PROMOTION_IDENTITY_V3',
  promotion_schema_version: 3,
  promotion_event_type: 'manifest-succession-promotion-v3',
  branch_name_used_as_authority: false,
});

export const PROMOTION_CRITERIA = Object.freeze([
  'P1_REPRODUCE_EVERY_APPLICABLE_ES0002_HISTORICAL_VERDICT',
  'P2_ACCEPT_ONLY_THE_EXACT_6474BCEC_TO_592C19AE_MANIFEST_SUCCESSION_PROVEN_THROUGH_OWNER_APPROVED_SCOPE_545DCAE7',
  'P3_REJECT_NEW_DIGEST_CLAIMS_WITHOUT_THE_COMPLETE_APPROVED_TRANSITION',
  'P4_INTRODUCE_NO_WILDCARD_DIRECTORY_OR_PATH_PATTERN_OWNERSHIP',
  'P5_REJECT_FUTURE_OR_REPLACEMENT_BLOBS_FOR_THE_24_RECONCILED_PATHS',
  'P6_REJECT_CANDIDATE_PATH_LAUNDERING',
  'P7_REJECT_NEIGHBORING_PATHS',
  'P8_REJECT_GIT_MODE_DRIFT',
  'P9_REJECT_GIT_BLOB_DRIFT',
  'P10_REJECT_CONTENT_SHA256_DRIFT',
  'P11_REJECT_CANONICAL_MAIN_ANCESTRY_FAILURE',
  'P12_REJECT_REALITY_CLOSURE_CANDIDATE_ANCESTRY_FAILURE',
  'P13_REJECT_OWNER_APPROVED_SCOPE_DIGEST_TAMPERING',
  'P14_REJECT_ANY_NEW_MANIFEST_DIGEST_WITHOUT_A_NEW_OWNER_APPROVED_SUCCESSION',
  'P15_BRANCH_AND_REF_NAMES_ARE_EVIDENCE_ONLY_NEVER_AUTHORITY',
  'P16_NEVER_CERTIFY_MERGED_CANONICAL_DEPLOYED_OR_OWNER_APPROVED',
  'P17_KEEP_TECHNICAL_PROMOTION_EVIDENCE_DISTINCT_FROM_OWNER_PROMOTION_APPROVAL',
  'P18_PRESERVE_EXISTING_V1_HISTORICAL_REPLAY_BYTE_IDENTICALLY',
  'P19_PRESERVE_ES0002_SOURCE_CONTRACT_FIXTURES_CORPUS_FREEZE_AND_REPLAY_BYTE_IDENTICALLY',
  'P20_FAIL_CLOSED_ON_UNKNOWN_FUTURE_MANIFEST_SUCCESSIONS',
]);

export const MUTATION_IDS = Object.freeze([
  'M01_REMOVE_MANIFEST_LINEAGE_VALIDATION',
  'M02_ACCEPT_DIGEST_ONLY_EQUALITY',
  'M03_SKIP_CANDIDATE_ANCESTRY',
  'M04_SKIP_CANONICAL_ANCESTRY',
  'M05_IGNORE_PATH_COUNT',
  'M06_IGNORE_GIT_MODE',
  'M07_IGNORE_GIT_BLOB',
  'M08_IGNORE_CONTENT_SHA256',
  'M09_ALLOW_WILDCARD',
  'M10_ALLOW_BRANCH_AS_AUTHORITY',
  'M11_ALLOW_OWNER_PENDING_TO_OWNER_APPROVED',
  'M12_ALLOW_UNKNOWN_MANIFEST_SUCCESSION',
]);

export const EVIDENCE_SCHEMA = Object.freeze([
  'dispatch.owned-by-v3',
  'identity.evaluator-id',
  'identity.candidate-commit-resolves',
  'identity.candidate-tree-matches',
  'identity.branch-is-evidence-only',
  'ancestry.canonical-main-is-ancestor',
  'ancestry.reality-candidate-is-ancestor',
  'lineage.assignment-name',
  'lineage.succession-payload-digest',
  'lineage.canonical-main-sha',
  'lineage.reality-candidate-sha',
  'lineage.prior-owner-approved-scope-digest',
  'lineage.incumbent-manifest-digest',
  'lineage.new-manifest-digest',
  'lineage.assignment-schema-valid',
  'lineage.exact-24-path-count',
  'lineage.entry-paths-exact',
  'lineage.entry-paths-safe',
  'lineage.git-modes-exact',
  'lineage.git-blobs-exact',
  'lineage.content-sha256-exact',
  'bridge.v2-only-manifest-shift',
  'owner-gate.pending-not-laundered',
  'verdict.no-forbidden-claim',
]);

export const PASS_FAIL_CONDITIONS = Object.freeze({
  positive: 'the exact PR57 lineage is accepted with technical evidence VERIFIED and owner gate PENDING',
  negative: 'all 32 fixed adversarial cases are refused at their declared check',
  incumbent_bridge: 'ES0002 archive court passes 8/8 and its adversarial corpus passes 22/22',
  historical_bridge: 'V1 historical replay passes 5/5 with zero skips',
  mutations: 'all twelve fixed security mutations change an expected verdict and therefore make the frozen court red',
  holdout: 'the post-seal independent holdout must pass 18/18 before succession may be SUCCEED',
  verdicts: 'MERGED CANONICAL DEPLOYED OWNER_APPROVED are impossible; owner promotion remains PENDING',
});

export function computePreCandidateFreeze() {
  const components = {
    'court:es-0003.court.test.mjs': sha256File(path.join(GATE, 'es-0003.court.test.mjs')),
    'positive:es-0003-positive.json': sha256File(path.join(HERE, 'es-0003-positive.json')),
    'corpus:es-0003-adversarial-corpus.mjs': sha256File(path.join(HERE, 'es-0003-adversarial-corpus.mjs')),
  };
  const contract = canonicalJson({
    approved_succession_payload_sha256: APPROVED_SUCCESSION_PAYLOAD_SHA256,
    event_schema: EVENT_SCHEMA,
    promotion_criteria: PROMOTION_CRITERIA,
    evidence_schema: EVIDENCE_SCHEMA,
    pass_fail_conditions: PASS_FAIL_CONDITIONS,
    mutation_ids: MUTATION_IDS,
    corpus_ids: CORPUS_IDS,
  });
  const componentLines = Object.keys(components).sort().map((key) => `${components[key]}  ${key}\n`).join('');
  return {
    components,
    contract_projection_sha256: sha256(contract),
    freeze_sha256: sha256(`${componentLines}CONTRACT ${sha256(contract)}\n`),
    promotion_criteria: PROMOTION_CRITERIA,
    evidence_schema: EVIDENCE_SCHEMA,
    mutation_ids: MUTATION_IDS,
    corpus_ids: CORPUS_IDS,
  };
}

export const RECORDED_PRE_CANDIDATE_FREEZE_SHA =
  'ebdaaa30cedb351ca1ed406b55cb03e2eb0aa7dbbd9109a9dcf1913b543b6c43';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(computePreCandidateFreeze(), null, 2)}\n`);
}
