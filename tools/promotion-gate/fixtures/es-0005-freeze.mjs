/** ES-0005 pre-candidate public criteria and fixture freeze. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORPUS_IDS } from './es-0005-adversarial-corpus.mjs';

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
  evaluator_id: 'CANA_PROMOTION_IDENTITY_V5',
  promotion_schema_version: 5,
  promotion_event_type: 'execution-scope-succession-v5',
  branch_name_used_as_authority: false,
});

export const PROMOTION_CRITERIA = Object.freeze([
  'P1_REPLAY_SEALED_ES0004_PUBLIC_AND_HOLDOUT_COURTS_AT_PRE_ZENITH_ARCHIVE',
  'P2_ACCEPT_ONLY_CANDIDATE_COMMIT_3D98FB3_AND_TREE_BE736E4',
  'P3_REQUIRE_21B9BD6_TO_BE_THE_EXACT_PARENT_AND_ANCESTOR',
  'P4_REQUIRE_PROTECTED_BASE_75A0102_AND_TREE_FD6DCB2_TO_BE_ANCESTRAL',
  'P5_BIND_THE_705465_TO_EE91C8_MANIFEST_TRANSITION',
  'P6_BIND_THE_AUTHORIZATION_SOURCE_DIGEST_CAC0851',
  'P7_BIND_THE_OWNER_APPROVAL_DIGEST_B77BB18',
  'P8_BIND_CHANGED_SCOPE_DIGEST_6B2293A',
  'P9_REQUIRE_THE_53_EXACT_ZENITH_PATHS_IN_ORDER',
  'P10_REJECT_WILDCARD_DIRECTORY_NEIGHBOR_AND_REORDERED_PATHS',
  'P11_BIND_THE_EXACT_MIGRATION_COURT_BLOB',
  'P12_REQUIRE_ALL_AUTHORITY_BOUNDARIES_FALSE_INCLUDING_SELF_PROMOTION',
  'P13_REQUIRE_LIVE_MANIFEST_VALIDATION_TO_PASS',
  'P14_REQUIRE_CANDIDATE_MANIFEST_BLOB_TO_EQUAL_THE_LIVE_MANIFEST',
  'P15_REQUIRE_ES0004_TO_REFUSE_ONLY_THE_THREE_EXPECTED_CURRENT_SUCCESSION_CHECKS',
  'P16_BRANCH_NAMES_ARE_EVIDENCE_ONLY',
  'P17_NEVER_CERTIFY_MERGED_CANONICAL_DEPLOYED_PRODUCTION_OR_OWNER_APPROVED',
  'P18_FAIL_CLOSED_ON_UNKNOWN_FUTURE_SUCCESSIONS',
]);

export const EVIDENCE_SCHEMA = Object.freeze([
  'dispatch.owned-by-v5',
  'identity.evaluator-id',
  'identity.candidate-commit-exact',
  'identity.candidate-tree-exact',
  'identity.branch-is-evidence-only',
  'ancestry.incumbent-is-parent',
  'ancestry.incumbent-is-ancestor',
  'ancestry.protected-base-is-ancestor',
  'lineage.authorization-source',
  'lineage.assignment-name',
  'lineage.approval-digest',
  'lineage.incumbent-commit',
  'lineage.protected-base',
  'lineage.incumbent-manifest',
  'lineage.new-manifest',
  'lineage.changed-scope-digest',
  'lineage.paths-exact',
  'lineage.paths-safe',
  'lineage.court-blob',
  'authority.all-false',
  'lineage.manifest-valid',
  'lineage.candidate-manifest-exact',
  'bridge.v4-refuses-only-current-succession',
  'owner-gate.execution-only',
  'verdict.no-forbidden-claim',
]);

export function computePreCandidateFreeze() {
  const components = {
    'bridge:es-0004-frozen-replay.mjs': sha256File(path.join(GATE, 'es-0004-frozen-replay.mjs')),
    'court:es-0005.court.test.mjs': sha256File(path.join(GATE, 'es-0005.court.test.mjs')),
    'positive:es-0005-positive.json': sha256File(path.join(HERE, 'es-0005-positive.json')),
    'corpus:es-0005-adversarial-corpus.mjs': sha256File(path.join(HERE, 'es-0005-adversarial-corpus.mjs')),
  };
  const contract = canonicalJson({
    event_schema: EVENT_SCHEMA,
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
  'dabfc97d07c91504d272823442e533878394e3026b20285b1a93fd9a411e4794';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(computePreCandidateFreeze(), null, 2)}\n`);
}
