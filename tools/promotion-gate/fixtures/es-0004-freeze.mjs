/** ES-0004 pre-candidate public criteria and fixture freeze. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORPUS_IDS } from './es-0004-adversarial-corpus.mjs';

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

export const EVENT_SCHEMA = Object.freeze({
  evaluator_id: 'CANA_PROMOTION_IDENTITY_V4',
  promotion_schema_version: 4,
  promotion_event_type: 'execution-scope-succession-v4',
  branch_name_used_as_authority: false,
});

export const EXECUTION_SCOPE_PAYLOAD_SHA256 =
  '452ab52765c74984d104c134d5e3b2a0ae8aa879d8e66452e72de3095d6da409';

export const PROMOTION_CRITERIA = Object.freeze([
  'P1_REPLAY_SEALED_ES0003_PUBLIC_AND_HOLDOUT_COURTS_IN_THEIR_EXACT_ARCHIVE',
  'P2_ACCEPT_ONLY_CANDIDATE_COMMIT_50130A2_AND_TREE_F76AA42',
  'P3_REQUIRE_99EFAA9_TO_BE_THE_EXACT_PARENT_AND_ANCESTOR',
  'P4_BIND_THE_592C19_TO_705465_MANIFEST_TRANSITION',
  'P5_BIND_THE_EXECUTION_AUTHORIZATION_SOURCE_DIGEST_14A355',
  'P6_BIND_PR59_ASSIGNMENT_DIGEST_5CFDC9',
  'P7_BIND_CHANGED_SCOPE_DIGEST_F90DD4',
  'P8_REQUIRE_THE_EIGHT_EXACT_CUSTODY_PATHS_IN_ORDER',
  'P9_REJECT_WILDCARD_DIRECTORY_NEIGHBOR_AND_REORDERED_PATHS',
  'P10_REQUIRE_LIVE_MANIFEST_VALIDATION_TO_PASS',
  'P11_REQUIRE_CANDIDATE_MANIFEST_BLOB_TO_EQUAL_THE_LIVE_MANIFEST',
  'P12_REQUIRE_ES0003_TO_REFUSE_THE_NEW_MANIFEST_ONLY_AT_ITS_EXPECTED_LINEAGE_PIN',
  'P13_BRANCH_NAMES_ARE_EVIDENCE_ONLY',
  'P14_NEVER_CERTIFY_MERGED_CANONICAL_DEPLOYED_OR_OWNER_APPROVED',
  'P15_FAIL_CLOSED_ON_UNKNOWN_FUTURE_SUCCESSIONS',
]);

export const EVIDENCE_SCHEMA = Object.freeze([
  'dispatch.owned-by-v4',
  'identity.evaluator-id',
  'identity.candidate-commit-exact',
  'identity.candidate-tree-exact',
  'identity.branch-is-evidence-only',
  'ancestry.incumbent-is-parent',
  'ancestry.incumbent-is-ancestor',
  'lineage.execution-scope-payload',
  'lineage.authorization-source',
  'lineage.assignment-name',
  'lineage.assignment-digest',
  'lineage.incumbent-commit',
  'lineage.incumbent-manifest',
  'lineage.new-manifest',
  'lineage.changed-scope-digest',
  'lineage.paths-exact',
  'lineage.paths-safe',
  'lineage.manifest-valid',
  'lineage.candidate-manifest-exact',
  'bridge.v3-refuses-only-new-manifest',
  'owner-gate.execution-only',
  'verdict.no-forbidden-claim',
]);

export function computePreCandidateFreeze() {
  const components = {
    'bridge:es-0003-frozen-replay.mjs': sha256File(path.join(GATE, 'es-0003-frozen-replay.mjs')),
    'court:es-0004.court.test.mjs': sha256File(path.join(GATE, 'es-0004.court.test.mjs')),
    'positive:es-0004-positive.json': sha256File(path.join(HERE, 'es-0004-positive.json')),
    'corpus:es-0004-adversarial-corpus.mjs': sha256File(path.join(HERE, 'es-0004-adversarial-corpus.mjs')),
  };
  const contract = canonicalJson({
    event_schema: EVENT_SCHEMA,
    execution_scope_payload_sha256: EXECUTION_SCOPE_PAYLOAD_SHA256,
    promotion_criteria: PROMOTION_CRITERIA,
    evidence_schema: EVIDENCE_SCHEMA,
    corpus_ids: CORPUS_IDS,
  });
  const componentLines = Object.keys(components).sort()
    .map((key) => `${components[key]}  ${key}\n`).join('');
  return {
    components,
    contract_projection_sha256: sha256(contract),
    freeze_sha256: sha256(`${componentLines}CONTRACT ${sha256(contract)}\n`),
    corpus_ids: CORPUS_IDS,
  };
}

export const RECORDED_PRE_CANDIDATE_FREEZE_SHA =
  '593b728512c940b4173a7d30d2a6db88a5e0c719e2b06e42f40cd43f59a3490d';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(computePreCandidateFreeze(), null, 2)}\n`);
}
