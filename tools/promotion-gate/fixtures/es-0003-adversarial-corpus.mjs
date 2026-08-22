/**
 * ES-0003 pre-candidate adversarial corpus.
 *
 * The corpus mutates either the presented event or the independently observed repository
 * evidence. It is frozen before the candidate exists. The court runs the real V3 policy over
 * every mutation and requires the named check to refuse it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'es-0003-positive.json'), 'utf8'));
const ZERO40 = '0'.repeat(40);
const ZERO64 = '0'.repeat(64);
const FUTURE64 = 'f'.repeat(64);

export const clonePositive = () => structuredClone(POSITIVE);

function candidate(id, expectRejectCheck, mutate) {
  return Object.freeze({ id, surface: 'candidate', expect_reject_check: expectRejectCheck, mutate });
}

function observation(id, expectRejectCheck, mutate) {
  return Object.freeze({ id, surface: 'observation', expect_reject_check: expectRejectCheck, mutate });
}

function entry(candidateValue, index = 0) {
  return candidateValue.manifest_succession.entries[index];
}

export const ADVERSARIAL_CORPUS = Object.freeze([
  candidate('C01-wrong-evaluator-id', 'identity.evaluator-id', (c) => { c.evaluator_id = 'CANA_PROMOTION_IDENTITY_V2'; }),
  candidate('C02-wrong-schema-version', 'dispatch.owned-by-v3', (c) => { c.promotion_schema_version = 2; }),
  candidate('C03-foreign-event-type', 'dispatch.owned-by-v3', (c) => { c.promotion_event_type = 'successor-lane-promotion-v2'; }),
  candidate('C04-wrong-candidate-tree', 'identity.candidate-tree-matches', (c) => { c.candidate_tree_sha = ZERO40; }),
  candidate('C05-prior-scope-digest-drift', 'lineage.prior-owner-approved-scope-digest', (c) => { c.manifest_succession.prior_owner_approved_reconciliation_sha256 = ZERO64; }),
  candidate('C06-incumbent-manifest-digest-drift', 'lineage.incumbent-manifest-digest', (c) => { c.manifest_succession.incumbent_manifest_digest = ZERO64; }),
  candidate('C07-future-manifest-digest', 'lineage.new-manifest-digest', (c) => { c.manifest_succession.new_manifest_digest = FUTURE64; }),
  candidate('C08-successor-approval-digest-drift', 'lineage.succession-payload-digest', (c) => { c.manifest_succession.approved_succession_payload_sha256 = ZERO64; }),
  candidate('C09-canonical-main-claim-drift', 'lineage.canonical-main-sha', (c) => { c.manifest_succession.canonical_main_sha = ZERO40; }),
  candidate('C10-reality-candidate-claim-drift', 'lineage.reality-candidate-sha', (c) => { c.manifest_succession.reality_closure_candidate_sha = ZERO40; }),
  candidate('C11-one-approved-path-removed', 'lineage.exact-24-path-count', (c) => { c.manifest_succession.entries.pop(); c.manifest_succession.entry_count = 23; }),
  candidate('C12-additional-twenty-fifth-path', 'lineage.exact-24-path-count', (c) => { c.manifest_succession.entries.push({ ...entry(c), path: 'tools/authority/future.mjs' }); c.manifest_succession.entry_count = 25; }),
  candidate('C13-candidate-path-injection', 'lineage.entry-paths-exact', (c) => { entry(c).path = 'apps/web/src/lib/customer-world.mjs'; }),
  candidate('C14-neighboring-path', 'lineage.entry-paths-exact', (c) => { entry(c).path = 'tools/authority/authority-neighbor.mjs'; }),
  candidate('C15-wildcard-path', 'lineage.entry-paths-safe', (c) => { entry(c).path = 'tools/authority/**'; }),
  candidate('C16-git-mode-drift', 'lineage.git-modes-exact', (c) => { entry(c).git_mode = '100755'; }),
  candidate('C17-git-blob-drift', 'lineage.git-blobs-exact', (c) => { entry(c).git_blob_sha = ZERO40; }),
  candidate('C18-content-sha256-drift', 'lineage.content-sha256-exact', (c) => { entry(c).content_sha256 = ZERO64; }),
  candidate('C19-duplicate-conflicting-entry', 'lineage.entry-paths-exact', (c) => { c.manifest_succession.entries[1].path = entry(c).path; }),
  candidate('C20-owner-gate-laundering', 'owner-gate.pending-not-laundered', (c) => { c.owner_gate = { state: 'APPROVED', claimed_owner_approved: true }; }),
  candidate('C21-forbidden-verdict-claim', 'verdict.no-forbidden-claim', (c) => { c.claimed_verdict = 'DEPLOYED'; }),
  candidate('C22-assignment-name-drift', 'lineage.assignment-name', (c) => { c.manifest_succession.assignment_name = 'future_reconciliation'; }),
  observation('O23-historical-manifest-observation-drift', 'lineage.incumbent-manifest-digest', (o) => { o.incumbent_manifest_digest = ZERO64; }),
  observation('O24-current-manifest-observation-drift', 'lineage.new-manifest-digest', (o) => { o.new_manifest_digest = FUTURE64; }),
  observation('O25-assignment-schema-invalid', 'lineage.assignment-schema-valid', (o) => { o.assignment_schema_valid = false; }),
  observation('O26-canonical-main-ancestry-failure', 'ancestry.canonical-main-is-ancestor', (o) => { o.canonical_main_ancestor = false; }),
  observation('O27-reality-candidate-ancestry-failure', 'ancestry.reality-candidate-is-ancestor', (o) => { o.reality_candidate_ancestor = false; }),
  observation('O28-observed-path-count-drift', 'lineage.exact-24-path-count', (o) => { o.expected_entries.pop(); }),
  observation('O29-observed-mode-drift', 'lineage.git-modes-exact', (o) => { o.expected_entries[0].git_mode = '100755'; }),
  observation('O30-v2-regression-beyond-manifest-shift', 'bridge.v2-only-manifest-shift', (o) => { o.v2_result.failed_checks.push('ancestry.POST38_HEAD-is-ancestor'); }),
  observation('O31-branch-used-as-authority', 'identity.branch-is-evidence-only', (o) => { o.branch_name_used_as_authority = true; }),
  observation('O32-unknown-future-succession', 'lineage.new-manifest-digest', (o, c) => { o.new_manifest_digest = FUTURE64; c.manifest_succession.new_manifest_digest = FUTURE64; }),
]);

export const CORPUS_IDS = Object.freeze(ADVERSARIAL_CORPUS.map((testCase) => testCase.id));

export function materializeCase(testCase, positive, observed) {
  const candidateValue = structuredClone(positive);
  const observedValue = structuredClone(observed);
  if (testCase.surface === 'candidate') testCase.mutate(candidateValue, observedValue);
  else testCase.mutate(observedValue, candidateValue);
  return { candidate: candidateValue, observed: observedValue };
}
