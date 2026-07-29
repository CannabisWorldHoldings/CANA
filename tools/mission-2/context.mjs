import { compile } from '../../skills-src/sitemind-context-compiler.mjs';
import {
  assertMission,
  canonicalize,
  deepFreeze,
  hashCanonical,
  normalizeExactPath,
  requireSha,
  requireSha256,
  requireText,
} from './canonical.mjs';
import { CONTEXT_COMPILER_VERSION } from './contracts.mjs';

export function compileMinimalContext({ mission, facts, now }) {
  requireText(mission.tenant_id, 'mission.tenant_id');
  requireText(mission.workspace_id, 'mission.workspace_id');
  requireSha(mission.source_commit, 'mission.source_commit');
  requireSha(mission.source_tree, 'mission.source_tree');
  assertMission(Array.isArray(mission.permitted_files) && mission.permitted_files.length > 0, 'PERMITTED_FILES_REQUIRED', 'Mission must name exact permitted files');
  assertMission(Array.isArray(facts) && facts.length > 0, 'CONTEXT_FACTS_REQUIRED', 'Context requires evidence-backed facts');
  const permitted = new Set(mission.permitted_files.map(normalizeExactPath));
  const seenEvidence = new Set();
  const selected = facts.map((fact) => {
    assertMission(fact.tenant_id === mission.tenant_id, 'CROSS_TENANT_EVIDENCE', 'Context fact tenant mismatch');
    assertMission(fact.workspace_id === mission.workspace_id, 'CROSS_WORKSPACE_EVIDENCE', 'Context fact workspace mismatch');
    assertMission(fact.source_commit === mission.source_commit, 'WRONG_SOURCE_COMMIT', 'Context fact source commit mismatch');
    assertMission(fact.source_tree === mission.source_tree, 'WRONG_SOURCE_TREE', 'Context fact source tree mismatch');
    requireSha256(fact.evidence_sha256, 'fact.evidence_sha256');
    assertMission(!seenEvidence.has(fact.evidence_sha256), 'DUPLICATE_EVIDENCE', 'Duplicate evidence is not admitted');
    seenEvidence.add(fact.evidence_sha256);
    assertMission(Array.isArray(fact.target_files) && fact.target_files.length > 0, 'FACT_TARGET_REQUIRED', 'Context fact must name target files');
    const targets = fact.target_files.map(normalizeExactPath);
    assertMission(targets.every((target) => permitted.has(target)), 'UNAUTHORIZED_CONTEXT_FILE', 'Context fact references an unauthorized file', { targets });
    assertMission(fact.provenance_status === 'CURRENT_VERIFIED', 'STALE_EVIDENCE', 'Only current verified evidence may compile');
    return {
      id: fact.id,
      claim: fact.claim,
      authority: fact.authority,
      truth_status: fact.truth_status,
      source: `${fact.source}@${fact.source_commit}:${fact.evidence_sha256}`,
      observed_at: fact.observed_at,
      valid_for_days: fact.valid_for_days,
      tags: [...(fact.tags ?? []), ...targets.map((target) => `target:${target}`)],
    };
  });
  const result = compile({
    objective: mission.objective,
    facts: selected,
    now,
    maxFacts: selected.length,
    requireActionable: true,
  });
  assertMission(result.valid, 'CONTEXT_COMPILATION_DENIED', result.errors?.join('; ') ?? 'Context compilation failed');
  assertMission(result.packet.contradictions.length === 0, 'CONTRADICTORY_CANONICAL_INPUTS', 'Contradictory canonical inputs require an owner decision');
  assertMission(
    result.packet.counts.actionable === selected.length && result.packet.counts.reference === 0 && result.packet.excluded.length === 0,
    'NON_MINIMAL_CONTEXT',
    'Every admitted fact must be relevant, actionable, and within the exact context budget',
  );
  const body = {
    schema_version: 'cana.context-packet/2.0.0',
    compiler_version: CONTEXT_COMPILER_VERSION,
    tenant_id: mission.tenant_id,
    workspace_id: mission.workspace_id,
    source_repository: mission.source_repository,
    source_commit: mission.source_commit,
    source_tree: mission.source_tree,
    permitted_files: [...permitted].sort(),
    evidence_sha256: [...seenEvidence].sort(),
    compiled_context: result.packet,
  };
  return deepFreeze({
    ...body,
    canonical_bytes: canonicalize(body),
    packet_hash: hashCanonical(body),
  });
}
