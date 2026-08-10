const TARGET_KINDS = Object.freeze([
  'SOURCE_ACQUISITION',
  'CONTENT_ARTIFACT',
  'SNAPSHOT',
  'OBSERVATION',
  'PARSER_VERSION',
  'POLICY_VERSION',
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].sort();
}

function claimMatches(claim, targetKind, targetId, graph) {
  if (targetKind === 'PARSER_VERSION') return claim.parser_version === targetId;
  if (targetKind === 'POLICY_VERSION') return claim.policy_version === targetId;
  if (targetKind === 'OBSERVATION') return claim.observation_ids?.includes(targetId) === true;
  if (targetKind === 'SNAPSHOT') return claim.snapshot_id === targetId;
  if (targetKind === 'CONTENT_ARTIFACT') return claim.content_artifact_id === targetId;
  if (targetKind === 'SOURCE_ACQUISITION') {
    if (claim.acquisition_event_id === targetId) return true;
    return graph.verification_events?.some((event) => event.claim_id === claim.id && event.acquisition_event_id === targetId) === true;
  }
  return false;
}

export function deriveEvidenceBlastRadius({ targetKind, targetId, graph }) {
  if (!TARGET_KINDS.includes(targetKind) || typeof targetId !== 'string' || targetId.length === 0) {
    fail('CANA_EVIDENCE_REVOCATION_TARGET_INVALID');
  }
  if (!graph || !Array.isArray(graph.claims)) fail('CANA_EVIDENCE_BLAST_GRAPH_INVALID');
  const claims = graph.claims.filter((claim) => claimMatches(claim, targetKind, targetId, graph));
  const claimIds = unique(claims.map((claim) => claim.id));
  const claimSet = new Set(claimIds);
  const observationIds = unique(claims.flatMap((claim) => claim.observation_ids ?? []));
  const verificationEventIds = unique((graph.verification_events ?? [])
    .filter((event) => claimSet.has(event.claim_id))
    .map((event) => event.id));
  const projectionIds = unique((graph.projections ?? [])
    .filter((projection) => claimSet.has(projection.claim_id))
    .map((projection) => projection.id));
  const gapIds = unique((graph.gaps ?? [])
    .filter((gap) => (gap.claim_ids ?? []).some((claimId) => claimSet.has(claimId)))
    .map((gap) => gap.id));
  return Object.freeze({
    schema_version: 'cana-evidence-blast-radius/v1',
    target_kind: targetKind,
    target_id: targetId,
    observation_ids: Object.freeze(observationIds),
    claim_ids: Object.freeze(claimIds),
    verification_event_ids: Object.freeze(verificationEventIds),
    projection_ids: Object.freeze(projectionIds),
    gap_ids: Object.freeze(gapIds),
    replacement_truth_created: 0,
  });
}

export function applyRevocationCourt({ decisions, blastRadius, revocationEventId }) {
  if (!Array.isArray(decisions) || !blastRadius || typeof revocationEventId !== 'string' || !revocationEventId) {
    fail('CANA_EVIDENCE_REVOCATION_INPUT_INVALID');
  }
  const affected = new Set(blastRadius.verification_event_ids ?? []);
  return Object.freeze(decisions.map((decision) => {
    if (!affected.has(decision.id)) return Object.freeze({ ...decision });
    return Object.freeze({
      ...decision,
      decision: 'DENY',
      verification: 'REFUTED',
      decision_eligible: false,
      reason: 'EVIDENCE_REVOKED_REQUIRES_RECONSIDERATION',
      evidence_revocation_id: revocationEventId,
    });
  }));
}

export function isEvidenceRevoked({
  claimId,
  acquisitionEventId,
  snapshotId,
  observationIds = [],
  parserVersion,
  policyVersions = [],
  revocations,
  asOf,
}) {
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime()) || !Array.isArray(revocations)) return true;
  const applicable = revocations
    .filter((event) => new Date(event.effectiveAt ?? event.effective_at) <= clock)
    .filter((event) => {
      const kind = event.targetKind ?? event.target_kind;
      const target = event.targetId ?? event.target_id;
      return kind === 'CLAIM' && target === claimId
        || kind === 'SOURCE_ACQUISITION' && target === acquisitionEventId
        || kind === 'SNAPSHOT' && target === snapshotId
        || kind === 'OBSERVATION' && observationIds.includes(target)
        || kind === 'PARSER_VERSION' && target === parserVersion
        || kind === 'POLICY_VERSION' && policyVersions.includes(target)
        || typeof acquisitionEventId === 'string' && acquisitionEventId.length > 0
          && event.acquisitionEventId === acquisitionEventId
        || typeof snapshotId === 'string' && snapshotId.length > 0
          && event.snapshotId === snapshotId;
    })
    .sort((left, right) => new Date(right.effectiveAt ?? right.effective_at) - new Date(left.effectiveAt ?? left.effective_at));
  if (applicable.length === 0) return false;
  return (applicable[0].decision ?? '') !== 'EVIDENCE_RESTORED';
}
