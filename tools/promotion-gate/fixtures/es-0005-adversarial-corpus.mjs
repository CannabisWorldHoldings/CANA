export const CORPUS = Object.freeze([
  ['C01-wrong-evaluator', 'dispatch.owned-by-v5', (c) => { c.evaluator_id = 'CANA_PROMOTION_IDENTITY_V4'; }],
  ['C02-wrong-schema', 'dispatch.owned-by-v5', (c) => { c.promotion_schema_version = 4; }],
  ['C03-wrong-event', 'dispatch.owned-by-v5', (c) => { c.promotion_event_type = 'execution-scope-succession-v4'; }],
  ['C04-wrong-candidate-commit', 'identity.candidate-commit-exact', (c) => { c.candidate_commit_sha = '0'.repeat(40); }],
  ['C05-wrong-candidate-tree', 'identity.candidate-tree-exact', (c) => { c.candidate_tree_sha = '0'.repeat(40); }],
  ['C06-wrong-authorization-source', 'lineage.authorization-source', (c) => { c.manifest_succession.authorization_source_sha256 = '0'.repeat(64); }],
  ['C07-wrong-assignment', 'lineage.assignment-name', (c) => { c.manifest_succession.assignment_name = 'future-assignment'; }],
  ['C08-wrong-approval-digest', 'lineage.approval-digest', (c) => { c.manifest_succession.approval_sha256 = '0'.repeat(64); }],
  ['C09-wrong-incumbent-commit', 'lineage.incumbent-commit', (c) => { c.manifest_succession.incumbent_commit_sha = '0'.repeat(40); }],
  ['C10-wrong-incumbent-manifest', 'lineage.incumbent-manifest', (c) => { c.manifest_succession.incumbent_manifest_digest = '0'.repeat(64); }],
  ['C11-wrong-new-manifest', 'lineage.new-manifest', (c) => { c.manifest_succession.new_manifest_digest = '0'.repeat(64); }],
  ['C12-wrong-scope-digest', 'lineage.changed-scope-digest', (c) => { c.manifest_succession.changed_scope_digest = '0'.repeat(64); }],
  ['C13-wrong-protected-base-commit', 'lineage.protected-base', (c) => { c.manifest_succession.protected_base.commit = '0'.repeat(40); }],
  ['C14-wrong-protected-base-tree', 'lineage.protected-base', (c) => { c.manifest_succession.protected_base.tree = '0'.repeat(40); }],
  ['C15-wildcard-path', 'lineage.paths-safe', (c) => { c.manifest_succession.paths[0] = 'apps/web/**'; }],
  ['C16-neighbor-path', 'lineage.paths-exact', (c) => { c.manifest_succession.paths[0] += '.neighbor'; }],
  ['C17-path-removed', 'lineage.paths-exact', (c) => { c.manifest_succession.paths.pop(); }],
  ['C18-path-reordered', 'lineage.paths-exact', (c) => { [c.manifest_succession.paths[0], c.manifest_succession.paths[1]] = [c.manifest_succession.paths[1], c.manifest_succession.paths[0]]; }],
  ['C19-court-blob-drift', 'lineage.court-blob', (c) => { c.manifest_succession.court_blob_sha256['apps/web/tests/migration-court.test.mjs'] = '0'.repeat(64); }],
  ['C20-self-promotion-laundered', 'authority.all-false', (c) => { c.manifest_succession.authority_boundaries.self_promotion = true; }],
  ['C21-boundary-removed', 'authority.all-false', (c) => { delete c.manifest_succession.authority_boundaries.production; }],
  ['C22-owner-claim-laundered', 'owner-gate.execution-only', (c) => { c.owner_gate.claimed_owner_approved = true; }],
  ['C23-forbidden-verdict', 'verdict.no-forbidden-claim', (c) => { c.claimed_verdict = 'DEPLOYED'; }],
]);

export const CORPUS_IDS = Object.freeze(CORPUS.map(([id]) => id));

export function materialize(testCase, positive) {
  const candidate = structuredClone(positive);
  testCase[2](candidate);
  return { candidate, expectedCheck: testCase[1] };
}
