import { isEvidenceRevoked } from './evidence-revocation.mjs';
import { marketContractForSourceKey } from './market-contract-registry.mjs';
import { adjudicateExecutionProvenance, MARKET_CLAIM_COURT_VERSION } from './market-claim-court.mjs';

const MAX_CURRENT_CLAIM_HISTORY = 5_000;

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
  name: 'name',
  regulated_address: 'address',
  address: 'address',
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

function bounded(rows, code) {
  if (rows.length > MAX_CURRENT_CLAIM_HISTORY) throw new Error(code);
  return rows;
}

function latestClaimRows(rows) {
  const latest = new Map();
  for (const row of rows) {
    if (typeof row.claimKey !== 'string' || !row.claimKey) {
      throw new Error('CANA_MARKET_TRUTH_CLAIM_KEY_INVALID');
    }
    if (!latest.has(row.claimKey)) latest.set(row.claimKey, row);
  }
  return [...latest.values()];
}

/**
 * Read the bounded append-only evidence graph required to decide current
 * market truth. Every query is tenant and official-source scoped; the pure
 * selector below remains the only component that can admit a claim.
 */
export async function loadCurrentClaimDecisions(prisma, {
  tenant,
  sourceKey,
  asOf = new Date(),
}) {
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) throw new Error('CANA_MARKET_TRUTH_AS_OF_INVALID');
  if (typeof tenant !== 'string' || !tenant || marketContractForSourceKey(sourceKey) === null) {
    throw new Error('CANA_MARKET_TRUTH_READ_SCOPE_INVALID');
  }

  const claimHistory = bounded(await prisma.marketClaim.findMany({
    where: { tenant, snapshot: { is: { sourceKey } } },
    select: {
      id: true,
      tenant: true,
      claimKey: true,
      claimType: true,
      claimValue: true,
      version: true,
      resolutionId: true,
      snapshotId: true,
      observedAt: true,
      freshnessExpiresAt: true,
      confidence: true,
      verification: true,
      decisionEligible: true,
      evidence: { select: { observationId: true } },
    },
    orderBy: [{ claimKey: 'asc' }, { version: 'desc' }, { id: 'asc' }],
    take: MAX_CURRENT_CLAIM_HISTORY + 1,
  }), 'CANA_MARKET_TRUTH_CLAIM_HISTORY_BUDGET_EXCEEDED');
  const claims = latestClaimRows(claimHistory).map(({ evidence, ...claim }) => ({
    ...claim,
    observationIds: evidence.map((entry) => entry.observationId),
  }));
  if (claims.length === 0) return Object.freeze([]);

  const claimIds = claims.map((claim) => claim.id);
  const verificationEvents = bounded(await prisma.marketVerificationEvent.findMany({
    where: { claimId: { in: claimIds }, asOf: { lte: clock } },
    select: {
      id: true,
      claimId: true,
      acquisitionEventId: true,
      decision: true,
      evaluatorVersion: true,
      asOf: true,
      freshnessExpiresAt: true,
    },
    orderBy: [{ claimId: 'asc' }, { asOf: 'desc' }, { id: 'desc' }],
    take: MAX_CURRENT_CLAIM_HISTORY + 1,
  }), 'CANA_MARKET_TRUTH_VERIFICATION_EVENT_BUDGET_EXCEEDED');
  const acquisitionIds = [...new Set(verificationEvents
    .map((event) => event.acquisitionEventId)
    .filter((id) => typeof id === 'string' && id.length > 0))];
  if (acquisitionIds.length === 0) return Object.freeze([]);

  const acquisitionEvents = bounded(await prisma.marketSourceAcquisitionEvent.findMany({
    where: { id: { in: acquisitionIds }, tenant, sourceKey },
    select: {
      id: true,
      tenant: true,
      sourceKey: true,
      state: true,
      outcome: true,
      completeness: true,
      requestDigest: true,
      adapterContractDigest: true,
      snapshotId: true,
      contentArtifactId: true,
      fetchedAt: true,
      revisionState: true,
      repositoryCommitSha: true,
      repositoryTreeSha: true,
      adapterVersion: true,
      parserVersion: true,
      compilerVersion: true,
      entityResolverVersion: true,
      authorityPolicyVersion: true,
      freshnessPolicyVersion: true,
      verificationCourtVersion: true,
    },
    take: MAX_CURRENT_CLAIM_HISTORY + 1,
  }), 'CANA_MARKET_TRUTH_ACQUISITION_BUDGET_EXCEEDED');
  const contentArtifactIds = [...new Set(acquisitionEvents
    .map((event) => event.contentArtifactId)
    .filter((id) => typeof id === 'string' && id.length > 0))];
  const snapshotIds = [...new Set(acquisitionEvents
    .map((event) => event.snapshotId)
    .filter((id) => typeof id === 'string' && id.length > 0))];

  const contentArtifacts = contentArtifactIds.length === 0 ? [] : bounded(
    await prisma.marketSourceContentArtifact.findMany({
      where: { id: { in: contentArtifactIds }, sourceKey },
      select: {
        id: true,
        snapshotId: true,
        sourceKey: true,
        sourceUrl: true,
        requestContractDigest: true,
        contentSha256: true,
        payloadBytes: true,
        recordCount: true,
        schemaVersion: true,
      },
      take: MAX_CURRENT_CLAIM_HISTORY + 1,
    }),
    'CANA_MARKET_TRUTH_CONTENT_ARTIFACT_BUDGET_EXCEEDED',
  );
  const sourceSnapshots = snapshotIds.length === 0 ? [] : bounded(
    await prisma.marketSourceSnapshot.findMany({
      where: { id: { in: snapshotIds }, sourceKey },
      select: {
        id: true,
        sourceKey: true,
        sourceUrl: true,
        payloadSha256: true,
        payloadBytes: true,
        recordCount: true,
        schemaVersion: true,
        completeness: true,
      },
      take: MAX_CURRENT_CLAIM_HISTORY + 1,
    }),
    'CANA_MARKET_TRUTH_SNAPSHOT_BUDGET_EXCEEDED',
  );
  const revocations = bounded(await prisma.marketEvidenceRevocationEvent.findMany({
    where: {
      effectiveAt: { lte: clock },
      OR: [{ tenant }, { tenant: null }],
    },
    select: {
      tenant: true,
      targetKind: true,
      targetId: true,
      decision: true,
      effectiveAt: true,
      contentArtifactId: true,
      acquisitionEventId: true,
      snapshotId: true,
      observationId: true,
      parserVersion: true,
      policyVersion: true,
    },
    orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
    take: MAX_CURRENT_CLAIM_HISTORY + 1,
  }), 'CANA_MARKET_TRUTH_REVOCATION_BUDGET_EXCEEDED');

  return selectCurrentClaimDecisions({
    claims,
    verificationEvents,
    acquisitionEvents,
    contentArtifacts,
    sourceSnapshots,
    revocations,
    asOf: clock,
  });
}

function admittedAcquisition(claim, event, acquisition, artifact, snapshot, eventAsOf) {
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
  // Lineage validation is keyed by the acquisition's source contract. Only
  // contracts admitted in the market-contract registry may bind claims to
  // acquisitions; an unregistered source key rejects exactly as the previous
  // hardcoded ABCA comparison rejected foreign sources.
  const contract = marketContractForSourceKey(field(acquisition, 'sourceKey', 'source_key'));
  return contract !== null
    && typeof claimTenant === 'string'
    && claimTenant.length > 0
    && acquisition?.tenant === claimTenant
    && acquisition?.state === 'COMPLETED'
    && !acquisition?.errorCode
    && !acquisition?.error_code
    && ['SOURCE_CHANGED', 'SOURCE_UNCHANGED'].includes(outcome)
    && acquisition?.completeness === 'COMPLETE'
    && field(acquisition, 'sourceKey', 'source_key') === contract.source_key
    && field(acquisition, 'requestDigest', 'request_digest') === contract.contract_digest
    && field(acquisition, 'adapterContractDigest', 'adapter_contract_digest') === contract.contract_digest
    && typeof claimSnapshotId === 'string'
    && acquisitionSnapshotId === claimSnapshotId
    && typeof contentArtifactId === 'string'
    && contentArtifactId.length > 0
    && artifact?.id === contentArtifactId
    && field(artifact, 'snapshotId', 'snapshot_id') === claimSnapshotId
    && snapshot?.id === claimSnapshotId
    && field(artifact, 'sourceKey', 'source_key') === contract.source_key
    && field(snapshot, 'sourceKey', 'source_key') === contract.source_key
    && field(artifact, 'sourceUrl', 'source_url') === contract.source_url
    && field(snapshot, 'sourceUrl', 'source_url') === contract.source_url
    && field(artifact, 'requestContractDigest', 'request_contract_digest') === contract.contract_digest
    && field(artifact, 'contentSha256', 'content_sha256') === field(snapshot, 'payloadSha256', 'payload_sha256')
    && field(artifact, 'payloadBytes', 'payload_bytes') === field(snapshot, 'payloadBytes', 'payload_bytes')
    && field(artifact, 'recordCount', 'record_count') === field(snapshot, 'recordCount', 'record_count')
    && field(artifact, 'schemaVersion', 'schema_version') === field(snapshot, 'schemaVersion', 'schema_version')
    && field(snapshot, 'completeness', 'completeness') === 'COMPLETE'
    && /^[a-f0-9]{64}$/.test(field(snapshot, 'payloadSha256', 'payload_sha256') ?? '')
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
  sourceSnapshots = [],
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
  const duplicateSnapshotIds = new Set();
  const snapshotById = new Map();
  for (const snapshot of sourceSnapshots) {
    if (snapshotById.has(snapshot.id)) duplicateSnapshotIds.add(snapshot.id);
    else snapshotById.set(snapshot.id, snapshot);
  }
  const current = [];
  for (const claim of claims) {
    const event = latestByClaim.get(claim.id);
    const acquisitionEventId = event?.acquisitionEventId ?? event?.acquisition_event_id;
    const acquisition = acquisitionById.get(acquisitionEventId);
    const contentArtifactId = field(acquisition, 'contentArtifactId', 'content_artifact_id');
    const artifact = artifactById.get(contentArtifactId);
    const snapshotId = field(acquisition, 'snapshotId', 'snapshot_id');
    const snapshot = snapshotById.get(snapshotId);
    const eventAsOf = new Date(event?.asOf ?? event?.as_of);
    const expiry = new Date(event?.freshnessExpiresAt ?? event?.freshness_expires_at);
    if (!acquisition
      || duplicateAcquisitionIds.has(acquisitionEventId)
      || duplicateArtifactIds.has(contentArtifactId)
      || duplicateSnapshotIds.has(snapshotId)
      || !admittedAcquisition(claim, event, acquisition, artifact, snapshot, eventAsOf)) continue;
    if (event.decision !== 'ALLOW'
      || !Number.isFinite(eventAsOf.getTime())
      || eventAsOf > clock
      || !Number.isFinite(expiry.getTime())
      || expiry <= clock) continue;
    if (isEvidenceRevoked({
      claimId: claim.id,
      acquisitionEventId,
      contentArtifactId,
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
      tenant: claim.tenant,
      subject_ref: field(claim, 'subjectRef', 'subject_ref')
        ?? field(claim, 'entityIdentity', 'entity_identity')
        ?? field(claim, 'subjectId', 'subject_id')
        ?? field(claim, 'resolutionId', 'resolution_id')
        ?? null,
      predicate: claim.claimType ?? claim.predicate,
      value: claim.claimValue ?? claim.value,
      market_id: marketContractForSourceKey(field(acquisition, 'sourceKey', 'source_key'))?.market_id ?? null,
      contract_digest: field(acquisition, 'requestDigest', 'request_digest'),
      source_id: field(acquisition, 'sourceKey', 'source_key'),
      source_url: field(snapshot, 'sourceUrl', 'source_url'),
      retrieved_at: new Date(field(acquisition, 'fetchedAt', 'fetched_at')).toISOString(),
      observed_at: new Date(claim.observedAt ?? claim.observed_at).toISOString(),
      verified_at: eventAsOf.toISOString(),
      freshness_expires_at: expiry.toISOString(),
      confidence: claim.confidence ?? null,
      verification: 'VERIFIED',
      decision_eligible: true,
      court_version: field(event, 'evaluatorVersion', 'evaluator_version'),
      acquisition_event_id: acquisitionEventId,
      verification_event_id: event.id,
      evidence_ref: `market-claim:${claim.id}`,
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
