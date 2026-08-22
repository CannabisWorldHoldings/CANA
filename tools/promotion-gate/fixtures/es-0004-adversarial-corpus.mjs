export const CORPUS = Object.freeze([
  ['C01-wrong-evaluator', 'dispatch.owned-by-v4', (c) => { c.evaluator_id = 'CANA_PROMOTION_IDENTITY_V3'; }],
  ['C02-wrong-schema', 'dispatch.owned-by-v4', (c) => { c.promotion_schema_version = 3; }],
  ['C03-wrong-event', 'dispatch.owned-by-v4', (c) => { c.promotion_event_type = 'manifest-succession-promotion-v3'; }],
  ['C04-wrong-candidate-commit', 'identity.candidate-commit-exact', (c) => { c.candidate_commit_sha = '0'.repeat(40); }],
  ['C05-wrong-candidate-tree', 'identity.candidate-tree-exact', (c) => { c.candidate_tree_sha = '0'.repeat(40); }],
  ['C06-wrong-payload-digest', 'lineage.execution-scope-payload', (c) => { c.manifest_succession.execution_scope_payload_sha256 = '0'.repeat(64); }],
  ['C07-wrong-authorization-source', 'lineage.authorization-source', (c) => { c.manifest_succession.authorization_source_sha256 = '0'.repeat(64); }],
  ['C08-wrong-assignment', 'lineage.assignment-name', (c) => { c.manifest_succession.assignment_name = 'future-assignment'; }],
  ['C09-wrong-assignment-digest', 'lineage.assignment-digest', (c) => { c.manifest_succession.assignment_sha256 = '0'.repeat(64); }],
  ['C10-wrong-incumbent-commit', 'lineage.incumbent-commit', (c) => { c.manifest_succession.incumbent_commit_sha = '0'.repeat(40); }],
  ['C11-wrong-incumbent-manifest', 'lineage.incumbent-manifest', (c) => { c.manifest_succession.incumbent_manifest_digest = '0'.repeat(64); }],
  ['C12-wrong-new-manifest', 'lineage.new-manifest', (c) => { c.manifest_succession.new_manifest_digest = '0'.repeat(64); }],
  ['C13-wrong-scope-digest', 'lineage.changed-scope-digest', (c) => { c.manifest_succession.changed_scope_digest = '0'.repeat(64); }],
  ['C14-wildcard-path', 'lineage.paths-safe', (c) => { c.manifest_succession.paths[0] = 'tools/visual-court/**'; }],
  ['C15-neighbor-path', 'lineage.paths-exact', (c) => { c.manifest_succession.paths[0] += '.neighbor'; }],
  ['C16-path-removed', 'lineage.paths-exact', (c) => { c.manifest_succession.paths.pop(); }],
  ['C17-path-reordered', 'lineage.paths-exact', (c) => { [c.manifest_succession.paths[0], c.manifest_succession.paths[1]] = [c.manifest_succession.paths[1], c.manifest_succession.paths[0]]; }],
  ['C18-owner-claim-laundered', 'owner-gate.execution-only', (c) => { c.owner_gate.claimed_owner_approved = true; }],
  ['C19-forbidden-verdict', 'verdict.no-forbidden-claim', (c) => { c.claimed_verdict = 'DEPLOYED'; }],
]);

export const CORPUS_IDS = Object.freeze(CORPUS.map(([id]) => id));

export function materialize(testCase, positive) {
  const candidate = structuredClone(positive);
  testCase[2](candidate);
  return { candidate, expectedCheck: testCase[1] };
}
