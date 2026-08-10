import { isEvidenceRevoked } from './evidence-revocation.mjs';
import { ABCA_LIVE_CONTRACT, ABCA_LIVE_CONTRACT_DIGEST } from './live-abca-adapter.mjs';
import { adjudicateExecutionProvenance, MARKET_CLAIM_COURT_VERSION } from './market-claim-court.mjs';

const PUBLIC_FIELDS = Object.freeze([
  'license',
  'name',
  'address',
  'location',
  'is_open',
  'hours',
  'phone',
  'website',
  'service_area',
  'delivery',
  'menu',
  'price',
  'availability',
  'deals',
]);

const PREDICATE_FIELD = Object.freeze({
  license_number: 'license',
  license_status: 'license',
  license_type: 'license',
  license_expiration: 'license',
  facility_name: 'name',
  regulated_address: 'address',
  located_at: 'location',
  operating_status: 'is_open',
  hours: 'hours',
  phone: 'phone',
  website: 'website',
  service_area: 'service_area',
  delivery: 'delivery',
  menu: 'menu',
  price: 'price',
  availability: 'availability',
  deals: 'deals',
});

function unknown(reason = 'NO_DECISION_ELIGIBLE_CLAIM') {
  return Object.freeze({ state: 'UNKNOWN', reason });
}

function eligible(decision, asOf) {
  if (!decision?.decision_eligible || !['VERIFIED', 'SUPPORTED'].includes(decision.verification)) return false;
  const observed = new Date(decision.observed_at);
  const expires = new Date(decision.freshness_expires_at);
  return Number.isFinite(observed.getTime()) && Number.isFinite(expires.getTime()) && observed <= asOf && expires > asOf;
}

function known(decisions) {
  const newestByPredicate = [];
  const predicates = new Set();
  for (const decision of decisions) {
    if (predicates.has(decision.predicate)) continue;
    predicates.add(decision.predicate);
    newestByPredicate.push(decision);
  }
  const values = Object.fromEntries(newestByPredicate.map((decision) => [decision.predicate, decision.value]));
  return Object.freeze({
    state: 'KNOWN',
    value: newestByPredicate.length === 1 ? newestByPredicate[0].value : Object.freeze(values),
    provenance: Object.freeze(newestByPredicate.map((decision) => Object.freeze({
      source_id: decision.source_id,
      observed_at: decision.observed_at,
      freshness_expires_at: decision.freshness_expires_at,
      confidence: decision.confidence ?? null,
      court_version: decision.court_version ?? null,
    }))),
  });
}

function field(row, camel, snake) {
  return row?.[camel] ?? row?.[snake];
}

function admittedAcquisition(claim, event, acquisition, artifact, eventAsOf) {
  const claimTenant = claim.tenant;
  const claimSnapshotId = field(claim, 'snapshotId', 'snapshot_id');
  const acquisitionSnapshotId = field(acquisition, 'snapshotId', 'snapshot_id');
  const contentArtifactId = field(acquisition, 'contentArtifactId', 'content_artifact_id');
  const fetchedAt = new Date(field(acquisition, 'fetchedAt', 'fetched_at'));
  const evaluatorVersion = field(event, 'evaluatorVersion', 'evaluator_version');
  const courtVersion = field(acquisition, 'verificationCourtVersion', 'verification_court_version');
  const outcome = acquisition?.outcome;
  const revisionState = field(acquisition, 'revisionState', 'revision_state');
  const lineageVersions = [
    field(acquisition, 'adapterVersion', 'adapter_version'),
    field(acquisition, 'parserVersion', 'parser_version'),
    field(acquisition, 'compilerVersion', 'compiler_version'),
    field(acquisition, 'entityResolverVersion', 'entity_resolver_version'),
    field(acquisition, 'authorityPolicyVersion', 'authority_policy_version'),
    field(acquisition, 'freshnessPolicyVersion', 'freshness_policy_version'),
    courtVersion,
  ];
  return typeof claimTenant === 'string'
    && claimTenant.length > 0
    && acquisition?.tenant === claimTenant
    && acquisition?.state === 'COMPLETED'
    && ['SOURCE_CHANGED', 'SOURCE_UNCHANGED'].includes(outcome)
    && acquisition?.completeness === 'COMPLETE'
    && field(acquisition, 'sourceKey', 'source_key') === ABCA_LIVE_CONTRACT.sourceKey
    && field(acquisition, 'requestDigest', 'request_digest') === ABCA_LIVE_CONTRACT_DIGEST
    && field(acquisition, 'adapterContractDigest', 'adapter_contract_digest') === ABCA_LIVE_CONTRACT_DIGEST
    && typeof claimSnapshotId === 'string'
    && acquisitionSnapshotId === claimSnapshotId
    && typeof contentArtifactId === 'string'
    && contentArtifactId.length > 0
    && artifact?.id === contentArtifactId
    && field(artifact, 'snapshotId', 'snapshot_id') === claimSnapshotId
    && field(artifact, 'sourceKey', 'source_key') === ABCA_LIVE_CONTRACT.sourceKey
    && field(artifact, 'sourceUrl', 'source_url') === ABCA_LIVE_CONTRACT.layerUrl
    && field(artifact, 'requestContractDigest', 'request_contract_digest') === ABCA_LIVE_CONTRACT_DIGEST
    && /^[a-f0-9]{64}$/.test(field(artifact, 'contentSha256', 'content_sha256') ?? '')
    && Number.isFinite(fetchedAt.getTime())
    && fetchedAt <= eventAsOf
    && /^[a-f0-9]{40}$/.test(field(acquisition, 'repositoryCommitSha', 'repository_commit_sha') ?? '')
    && /^[a-f0-9]{40}$/.test(field(acquisition, 'repositoryTreeSha', 'repository_tree_sha') ?? '')
    && lineageVersions.every((value) => typeof value === 'string' && value.length > 0)
    && courtVersion === MARKET_CLAIM_COURT_VERSION
    && evaluatorVersion === courtVersion
    && adjudicateExecutionProvenance(acquisition).decision === 'ALLOW'
    && ['OBSERVED', 'UNKNOWN'].includes(revisionState)
    && (outcome !== 'SOURCE_UNCHANGED' || revisionState === 'OBSERVED');
}

export function selectCurrentClaimDecisions({
  claims = [],
  verificationEvents = [],
  acquisitionEvents = [],
  contentArtifacts = [],
  revocations = [],
  asOf = new Date(),
}) {
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) throw new Error('CANA_MARKET_TRUTH_AS_OF_INVALID');
  const latestByClaim = new Map();
  for (const event of [...verificationEvents].sort((left, right) => {
    const leftTime = new Date(left.asOf ?? left.as_of).getTime();
    const rightTime = new Date(right.asOf ?? right.as_of).getTime();
    return rightTime - leftTime || String(right.id).localeCompare(String(left.id));
  })) {
    if (!latestByClaim.has(event.claimId ?? event.claim_id)) {
      latestByClaim.set(event.claimId ?? event.claim_id, event);
    }
  }
  const duplicateAcquisitionIds = new Set();
  const acquisitionById = new Map();
  for (const acquisition of acquisitionEvents) {
    if (acquisitionById.has(acquisition.id)) duplicateAcquisitionIds.add(acquisition.id);
    else acquisitionById.set(acquisition.id, acquisition);
  }
  const duplicateArtifactIds = new Set();
  const artifactById = new Map();
  for (const artifact of contentArtifacts) {
    if (artifactById.has(artifact.id)) duplicateArtifactIds.add(artifact.id);
    else artifactById.set(artifact.id, artifact);
  }
  const current = [];
  for (const claim of claims) {
    const event = latestByClaim.get(claim.id);
    const acquisitionEventId = event?.acquisitionEventId ?? event?.acquisition_event_id;
    const acquisition = acquisitionById.get(acquisitionEventId);
    const contentArtifactId = field(acquisition, 'contentArtifactId', 'content_artifact_id');
    const artifact = artifactById.get(contentArtifactId);
    const eventAsOf = new Date(event?.asOf ?? event?.as_of);
    const expiry = new Date(event?.freshnessExpiresAt ?? event?.freshness_expires_at);
    if (!acquisition
      || duplicateAcquisitionIds.has(acquisitionEventId)
      || duplicateArtifactIds.has(contentArtifactId)
      || !admittedAcquisition(claim, event, acquisition, artifact, eventAsOf)) continue;
    if (event.decision !== 'ALLOW'
      || !Number.isFinite(eventAsOf.getTime())
      || eventAsOf > clock
      || !Number.isFinite(expiry.getTime())
      || expiry <= clock) continue;
    if (isEvidenceRevoked({
      claimId: claim.id,
      acquisitionEventId,
      snapshotId: claim.snapshotId ?? claim.snapshot_id,
      observationIds: claim.observationIds ?? claim.observation_ids ?? [],
      parserVersion: field(acquisition, 'parserVersion', 'parser_version'),
      policyVersions: [
        field(acquisition, 'authorityPolicyVersion', 'authority_policy_version'),
        field(acquisition, 'freshnessPolicyVersion', 'freshness_policy_version'),
        field(acquisition, 'verificationCourtVersion', 'verification_court_version'),
        field(event, 'evaluatorVersion', 'evaluator_version'),
      ].filter(Boolean),
      revocations,
      asOf: clock,
    })) continue;
    current.push(Object.freeze({
      claim_id: claim.id,
      predicate: claim.claimType ?? claim.predicate,
      value: claim.claimValue ?? claim.value,
      source_id: field(acquisition, 'sourceKey', 'source_key'),
      observed_at: new Date(claim.observedAt ?? claim.observed_at).toISOString(),
      freshness_expires_at: expiry.toISOString(),
      verification: 'VERIFIED',
      decision_eligible: true,
      court_version: field(event, 'evaluatorVersion', 'evaluator_version'),
      acquisition_event_id: acquisitionEventId,
      verification_event_id: event.id,
    }));
  }
  return Object.freeze(current.sort((left, right) => left.claim_id.localeCompare(right.claim_id)));
}

export function compileRetailerTruth({ retailer, claimDecisions = [], asOf = new Date() }) {
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) throw new Error('CANA_MARKET_TRUTH_AS_OF_INVALID');
  const projection = { retailer_id: retailer?.id ?? null };
  for (const field of PUBLIC_FIELDS) projection[field] = unknown();
  const byField = new Map();
  for (const decision of claimDecisions) {
    const field = PREDICATE_FIELD[decision?.predicate];
    if (!field || !eligible(decision, clock)) continue;
    const entries = byField.get(field) ?? [];
    entries.push(decision);
    byField.set(field, entries);
  }
  for (const [field, decisions] of byField) {
    decisions.sort((left, right) => String(right.observed_at).localeCompare(String(left.observed_at)) || Number(right.confidence ?? 0) - Number(left.confidence ?? 0));
    projection[field] = known(decisions);
  }
  return Object.freeze(projection);
}

export function compileAbsenceClaim({ predicate, completeness, sourceAllowsAbsenceInference }) {
  if (completeness !== 'COMPLETE') return unknown('SNAPSHOT_NOT_COMPLETE');
  if (!sourceAllowsAbsenceInference) return unknown('SOURCE_DOES_NOT_AUTHORIZE_ABSENCE_INFERENCE');
  return Object.freeze({
    state: 'KNOWN',
    predicate,
    value: 'ABSENT_FROM_COMPLETE_AUTHORIZED_COHORT',
  });
}
