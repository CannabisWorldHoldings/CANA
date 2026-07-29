import {
  assertMission,
  canonicalize,
  deepFreeze,
  deterministicId,
  hashCanonical,
  requireSha256,
  requireText,
  uniqueSorted,
} from '../../mission-2/canonical.mjs';

export const CLAIM_GRAPH_VERSION = '0.3.0-shadow';
export const PACKAGE_003_SHA256 = '173e97573e43f97a1efcfd59b8c33edfb44de4d7afc11735c688c240cbd392fc';
export const M001_HANDOFF_HASH = 'baf1492a1aaa3290886b8f3cd77e68515fe15775618dc5fc173ed235a02b9cd3';
export const M001_TENANT = 'tenant_cana';
export const M001_WORKSPACE = 'workspace_orderweeddc_growth_foundry';

export const ENTITY_TYPES = Object.freeze([
  'PLATFORM',
  'OWNING_ORGANIZATION',
  'OPERATOR',
  'BUSINESS_LOCATION',
  'LISTING',
  'SERVICE',
  'SERVICE_AREA',
  'OFFER',
  'PRODUCT',
]);

export const CLAIM_CLASS_RULES = deepFreeze({
  LICENSE_OR_REGULATORY_STATUS: {
    required_source: 'OFFICIAL',
    ttl_hours: 24,
    on_expiry: 'WITHHOLD_AFFIRMATIVE_CLAIM',
  },
  OPERATING_STATUS: {
    required_source: 'OFFICIAL_OR_AUTHORIZED_MERCHANT_PLUS_CORROBORATION',
    ttl_hours: 24,
    on_expiry: 'UNKNOWN_VERIFY_DIRECTLY',
  },
  DELIVERY_OR_PICKUP_ELIGIBILITY: {
    required_source: 'OFFICIAL_AND_OPERATOR_SPECIFIC',
    ttl_hours: 24,
    on_expiry: 'WITHHOLD_AFFIRMATIVE_CLAIM',
  },
  LOCATION_AND_SERVICE_AREA: {
    required_source: 'OFFICIAL_OR_AUTHORIZED_MERCHANT',
    ttl_hours: 168,
    on_expiry: 'STALE_LABEL_AND_VERIFY',
  },
  HOURS_FEES_MINIMUMS: {
    required_source: 'AUTHORIZED_MERCHANT_OR_FIRST_PARTY',
    ttl_hours: 24,
    on_expiry: 'UNKNOWN_VERIFY_DIRECTLY',
  },
  PRICE_INVENTORY_OFFER: {
    required_source: 'TIMESTAMPED_FIRST_PARTY_FEED',
    ttl_hours: 1,
    on_expiry: 'DO_NOT_PRESENT_AS_CURRENT',
  },
  GENERAL_ELIGIBILITY_RULE: {
    required_source: 'OFFICIAL',
    ttl_hours: 168,
    on_expiry: 'STALE_LABEL_AND_REVIEW',
  },
});

export const SOURCE_AUTHORITIES = Object.freeze([
  'OFFICIAL',
  'AUTHORIZED_MERCHANT',
  'OPERATOR_SPECIFIC',
  'FIRST_PARTY',
  'TIMESTAMPED_FIRST_PARTY_FEED',
  'CORROBORATION',
]);

export const UNCERTAINTY_STATES = Object.freeze([
  'SUPPORTED_CURRENT',
  'SUPPORTED_BUT_AGING',
  'STALE',
  'CONFLICTED',
  'DISPUTED',
  'UNKNOWN',
  'RETIRED',
]);

const CLAIM_STATUSES = new Set(['ACTIVE', 'SUPERSEDED', 'RETIRED']);
const VERIFICATION_DECISIONS = new Set(['APPROVE', 'REJECT', 'PRESERVE_CONFLICT']);
const SAFE_FALLBACK = 'VERIFY DIRECTLY';
const GRAPH_FIELDS = [
  'schema_version',
  'graph_version',
  'package_003_sha256',
  'handoff_hash',
  'tenant_id',
  'workspace_id',
  'entities',
  'sources',
  'observations',
  'claims',
  'verification_events',
  'corrections',
  'sponsorships',
];

function requireObject(value, field) {
  assertMission(value && typeof value === 'object' && !Array.isArray(value), 'M001_OBJECT_REQUIRED', `${field} must be an object`, { field });
  return value;
}

function requireExactFields(value, fields, code, field) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  assertMission(
    JSON.stringify(actual) === JSON.stringify(expected),
    code,
    `${field} fields differ from the exact M001 schema`,
    { field, expected, actual },
  );
}

function requireArray(value, field) {
  assertMission(Array.isArray(value), 'M001_ARRAY_REQUIRED', `${field} must be an array`, { field });
  return value;
}

function requireBoolean(value, field) {
  assertMission(typeof value === 'boolean', 'M001_BOOLEAN_REQUIRED', `${field} must be boolean`, { field });
  return value;
}

function requireScoped(record, graph, field) {
  assertMission(record.tenant_id === graph.tenant_id, 'M001_CROSS_TENANT_DENIED', `${field} tenant differs`, { field });
  assertMission(record.workspace_id === graph.workspace_id, 'M001_CROSS_WORKSPACE_DENIED', `${field} workspace differs`, { field });
}

function requireTimestamp(value, field) {
  requireText(value, field);
  const parsed = new Date(value);
  assertMission(
    !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value,
    'M001_TIMESTAMP_INVALID',
    `${field} must be an exact ISO-8601 UTC timestamp`,
    { field, value },
  );
  return parsed;
}

function requireConfidence(value, field) {
  assertMission(
    Number.isFinite(value) && value >= 0 && value <= 1,
    'M001_CONFIDENCE_INVALID',
    `${field} must be between 0 and 1`,
    { field, value },
  );
}

function requireUniqueIds(collections) {
  const seen = new Map();
  for (const [collection, records, idField] of collections) {
    for (const record of records) {
      requireText(record[idField], `${collection}.${idField}`);
      const prior = seen.get(record[idField]);
      assertMission(
        !prior,
        'M001_DUPLICATE_IDENTITY',
        `Identity ${record[idField]} is duplicated`,
        { identity: record[idField], first_collection: prior, second_collection: collection },
      );
      seen.set(record[idField], collection);
    }
  }
}

function requireReference(map, id, code, message) {
  const value = map.get(id);
  assertMission(value, code, message, { id });
  return value;
}

function authoritySatisfied(requiredSource, sources) {
  const authorities = new Set(sources.flatMap((source) => source.authority_classes));
  if (requiredSource === 'OFFICIAL') return authorities.has('OFFICIAL');
  if (requiredSource === 'OFFICIAL_OR_AUTHORIZED_MERCHANT_PLUS_CORROBORATION') {
    return authorities.has('OFFICIAL')
      || (authorities.has('AUTHORIZED_MERCHANT') && authorities.has('CORROBORATION'));
  }
  if (requiredSource === 'OFFICIAL_AND_OPERATOR_SPECIFIC') {
    return authorities.has('OFFICIAL') && authorities.has('OPERATOR_SPECIFIC');
  }
  if (requiredSource === 'OFFICIAL_OR_AUTHORIZED_MERCHANT') {
    return authorities.has('OFFICIAL') || authorities.has('AUTHORIZED_MERCHANT');
  }
  if (requiredSource === 'AUTHORIZED_MERCHANT_OR_FIRST_PARTY') {
    return authorities.has('AUTHORIZED_MERCHANT') || authorities.has('FIRST_PARTY');
  }
  if (requiredSource === 'TIMESTAMPED_FIRST_PARTY_FEED') {
    return authorities.has('TIMESTAMPED_FIRST_PARTY_FEED');
  }
  return false;
}

export function claimRecordId({
  claimId,
  version,
  tenantId = M001_TENANT,
  workspaceId = M001_WORKSPACE,
}) {
  requireText(claimId, 'claimId');
  assertMission(Number.isInteger(version) && version > 0, 'M001_CLAIM_VERSION_INVALID', 'Claim version must be a positive integer');
  return deterministicId('m001_claim', {
    claim_id: claimId,
    version,
    tenant_id: tenantId,
    workspace_id: workspaceId,
  });
}

export function validateClaimGraph(input) {
  requireObject(input, 'graph');
  requireExactFields(
    input,
    Object.hasOwn(input, 'graph_hash') ? [...GRAPH_FIELDS, 'graph_hash'] : GRAPH_FIELDS,
    'M001_GRAPH_SCHEMA_DENIED',
    'graph',
  );
  assertMission(input.schema_version === 'cana.growth-foundry-m001-claim-graph/1.0.0', 'M001_GRAPH_SCHEMA_DENIED', 'Claim graph schema version differs');
  assertMission(input.graph_version === CLAIM_GRAPH_VERSION, 'M001_GRAPH_VERSION_DENIED', 'Claim graph version differs');
  assertMission(input.package_003_sha256 === PACKAGE_003_SHA256, 'M001_PACKAGE_REPLAY_DENIED', 'Package 003 identity differs');
  assertMission(input.handoff_hash === M001_HANDOFF_HASH, 'M001_HANDOFF_REPLAY_DENIED', 'Canonical handoff identity differs');
  assertMission(input.tenant_id === M001_TENANT, 'M001_CROSS_TENANT_DENIED', 'Graph tenant differs');
  assertMission(input.workspace_id === M001_WORKSPACE, 'M001_CROSS_WORKSPACE_DENIED', 'Graph workspace differs');

  const graph = {
    ...structuredClone(input),
    entities: structuredClone(requireArray(input.entities, 'entities')),
    sources: structuredClone(requireArray(input.sources, 'sources')),
    observations: structuredClone(requireArray(input.observations, 'observations')),
    claims: structuredClone(requireArray(input.claims, 'claims')),
    verification_events: structuredClone(requireArray(input.verification_events, 'verification_events')),
    corrections: structuredClone(requireArray(input.corrections, 'corrections')),
    sponsorships: structuredClone(requireArray(input.sponsorships, 'sponsorships')),
  };
  requireUniqueIds([
    ['entities', graph.entities, 'entity_id'],
    ['sources', graph.sources, 'source_id'],
    ['observations', graph.observations, 'observation_id'],
    ['claims', graph.claims, 'claim_record_id'],
    ['verification_events', graph.verification_events, 'verification_event_id'],
    ['corrections', graph.corrections, 'correction_id'],
    ['sponsorships', graph.sponsorships, 'sponsorship_id'],
  ]);

  const entityById = new Map(graph.entities.map((record) => [record.entity_id, record]));
  const entityTypes = new Set();
  for (const entity of graph.entities) {
    requireExactFields(
      entity,
      ['entity_id', 'entity_type', 'tenant_id', 'workspace_id', 'name', 'parent_entity_id'],
      'M001_ENTITY_SCHEMA_DENIED',
      'entity',
    );
    requireScoped(entity, graph, 'entity');
    assertMission(ENTITY_TYPES.includes(entity.entity_type), 'M001_ENTITY_TYPE_DENIED', 'Entity type differs from the admitted set');
    requireText(entity.name, 'entity.name');
    assertMission(entity.parent_entity_id === null || typeof entity.parent_entity_id === 'string', 'M001_ENTITY_PARENT_INVALID', 'Entity parent must be null or an identity');
    entityTypes.add(entity.entity_type);
  }
  assertMission(
    entityTypes.size === ENTITY_TYPES.length && ENTITY_TYPES.every((type) => entityTypes.has(type)),
    'M001_ENTITY_CLASS_MISSING',
    'The synthetic graph must keep every admitted entity class distinct',
  );
  for (const entity of graph.entities) {
    if (entity.parent_entity_id !== null) {
      requireReference(entityById, entity.parent_entity_id, 'M001_ENTITY_PARENT_MISSING', 'Entity parent is missing');
      assertMission(entity.parent_entity_id !== entity.entity_id, 'M001_ENTITY_SELF_PARENT', 'Entity cannot parent itself');
    }
  }

  const sourceById = new Map(graph.sources.map((record) => [record.source_id, record]));
  for (const source of graph.sources) {
    requireExactFields(
      source,
      ['source_id', 'tenant_id', 'workspace_id', 'authority_classes', 'source_hash', 'provenance'],
      'M001_SOURCE_SCHEMA_DENIED',
      'source',
    );
    requireScoped(source, graph, 'source');
    source.authority_classes = uniqueSorted(source.authority_classes, 'source.authority_classes');
    assertMission(
      source.authority_classes.every((authority) => SOURCE_AUTHORITIES.includes(authority)),
      'M001_SOURCE_AUTHORITY_DENIED',
      'Source authority differs from the admitted set',
    );
    requireSha256(source.source_hash, 'source.source_hash');
    requireText(source.provenance, 'source.provenance');
  }

  const observationById = new Map(graph.observations.map((record) => [record.observation_id, record]));
  for (const observation of graph.observations) {
    requireExactFields(
      observation,
      ['observation_id', 'tenant_id', 'workspace_id', 'entity_id', 'claim_class', 'value', 'source_id', 'source_hash', 'observed_at', 'expires_at', 'confidence', 'uncertainty'],
      'M001_OBSERVATION_SCHEMA_DENIED',
      'observation',
    );
    requireScoped(observation, graph, 'observation');
    requireReference(entityById, observation.entity_id, 'M001_ENTITY_MISSING', 'Observation entity is missing');
    const rule = CLAIM_CLASS_RULES[observation.claim_class];
    assertMission(rule, 'M001_CLAIM_CLASS_DENIED', 'Observation claim class differs from Package 003');
    assertMission(['string', 'number', 'boolean'].includes(typeof observation.value), 'M001_OBSERVATION_VALUE_DENIED', 'Observation value must be scalar');
    const source = requireReference(sourceById, observation.source_id, 'M001_SOURCE_MISSING', 'Observation source is missing');
    assertMission(observation.source_hash === source.source_hash, 'M001_SOURCE_HASH_MISMATCH', 'Observation source hash differs');
    const observedAt = requireTimestamp(observation.observed_at, 'observation.observed_at');
    const expiresAt = requireTimestamp(observation.expires_at, 'observation.expires_at');
    assertMission(expiresAt > observedAt, 'M001_EXPIRY_ORDER_INVALID', 'Observation expiry must follow observation time');
    assertMission(
      expiresAt.getTime() <= observedAt.getTime() + rule.ttl_hours * 60 * 60 * 1000,
      'M001_TTL_BROADENING_DENIED',
      'Observation expiry exceeds the admitted claim-class TTL',
    );
    requireConfidence(observation.confidence, 'observation.confidence');
    assertMission(UNCERTAINTY_STATES.includes(observation.uncertainty), 'M001_UNCERTAINTY_DENIED', 'Observation uncertainty differs');
  }

  const claimByRecordId = new Map(graph.claims.map((record) => [record.claim_record_id, record]));
  const claimGroups = new Map();
  for (const claim of graph.claims) {
    requireExactFields(
      claim,
      ['claim_id', 'claim_record_id', 'tenant_id', 'workspace_id', 'entity_id', 'claim_class', 'version', 'observation_ids', 'status', 'supersedes_claim_record_id'],
      'M001_CLAIM_SCHEMA_DENIED',
      'claim',
    );
    requireScoped(claim, graph, 'claim');
    requireText(claim.claim_id, 'claim.claim_id');
    requireReference(entityById, claim.entity_id, 'M001_ENTITY_MISSING', 'Claim entity is missing');
    assertMission(CLAIM_CLASS_RULES[claim.claim_class], 'M001_CLAIM_CLASS_DENIED', 'Claim class differs from Package 003');
    assertMission(CLAIM_STATUSES.has(claim.status), 'M001_CLAIM_STATUS_DENIED', 'Claim status differs');
    const expectedRecordId = claimRecordId({
      claimId: claim.claim_id,
      version: claim.version,
      tenantId: claim.tenant_id,
      workspaceId: claim.workspace_id,
    });
    assertMission(claim.claim_record_id === expectedRecordId, 'M001_CLAIM_ID_UNSTABLE', 'Claim record identity does not recompute');
    const observationIds = uniqueSorted(claim.observation_ids, 'claim.observation_ids');
    assertMission(observationIds.length > 0, 'M001_CLAIM_EVIDENCE_REQUIRED', 'Claim requires observations');
    for (const observationId of observationIds) {
      const observation = requireReference(observationById, observationId, 'M001_OBSERVATION_MISSING', 'Claim observation is missing');
      assertMission(observation.entity_id === claim.entity_id && observation.claim_class === claim.claim_class, 'M001_CLAIM_EVIDENCE_MISMATCH', 'Claim observation differs in subject or class');
    }
    assertMission(
      claim.supersedes_claim_record_id === null || typeof claim.supersedes_claim_record_id === 'string',
      'M001_SUPERSESSION_INVALID',
      'Claim supersession must be null or a prior claim identity',
    );
    const group = claimGroups.get(claim.claim_id) ?? [];
    group.push(claim);
    claimGroups.set(claim.claim_id, group);
  }

  for (const versions of claimGroups.values()) {
    versions.sort((left, right) => left.version - right.version);
    versions.forEach((claim, index) => {
      assertMission(claim.version === index + 1, 'M001_CLAIM_VERSION_GAP', 'Claim versions must be contiguous');
      if (index === 0) {
        assertMission(claim.supersedes_claim_record_id === null, 'M001_SUPERSESSION_INVALID', 'First claim version cannot supersede another');
      } else {
        const prior = versions[index - 1];
        assertMission(claim.supersedes_claim_record_id === prior.claim_record_id, 'M001_SUPERSESSION_INVALID', 'Claim version must supersede the immediate prior version');
        assertMission(prior.status === 'SUPERSEDED', 'M001_HISTORY_DELETION_DENIED', 'Prior claim version must remain as superseded history');
      }
    });
    assertMission(versions.filter((claim) => claim.status === 'ACTIVE').length <= 1, 'M001_MULTIPLE_ACTIVE_VERSIONS', 'Only one claim version may be active');
  }

  const eventsByClaim = new Map();
  for (const event of graph.verification_events) {
    requireExactFields(
      event,
      ['verification_event_id', 'tenant_id', 'workspace_id', 'claim_record_id', 'observation_ids', 'verified_at', 'verifier_identity', 'decision'],
      'M001_VERIFICATION_SCHEMA_DENIED',
      'verification_event',
    );
    requireScoped(event, graph, 'verification_event');
    const claim = requireReference(claimByRecordId, event.claim_record_id, 'M001_CLAIM_MISSING', 'Verification claim is missing');
    const observationIds = uniqueSorted(event.observation_ids, 'verification_event.observation_ids');
    assertMission(
      observationIds.length > 0 && observationIds.every((id) => claim.observation_ids.includes(id)),
      'M001_VERIFICATION_EVIDENCE_MISMATCH',
      'Verification evidence must be a non-empty subset of claim evidence',
    );
    requireTimestamp(event.verified_at, 'verification_event.verified_at');
    requireText(event.verifier_identity, 'verification_event.verifier_identity');
    assertMission(VERIFICATION_DECISIONS.has(event.decision), 'M001_VERIFICATION_DECISION_DENIED', 'Verification decision differs');
    const claimEvents = eventsByClaim.get(event.claim_record_id) ?? [];
    claimEvents.push(event);
    eventsByClaim.set(event.claim_record_id, claimEvents);
  }

  for (const correction of graph.corrections) {
    requireExactFields(
      correction,
      ['correction_id', 'tenant_id', 'workspace_id', 'prior_claim_record_id', 'new_claim_record_id', 'prior_observation_ids', 'replacement_observation_ids', 'created_at', 'reason'],
      'M001_CORRECTION_SCHEMA_DENIED',
      'correction',
    );
    requireScoped(correction, graph, 'correction');
    const prior = requireReference(claimByRecordId, correction.prior_claim_record_id, 'M001_CORRECTION_PRIOR_MISSING', 'Correction prior claim is missing');
    const next = requireReference(claimByRecordId, correction.new_claim_record_id, 'M001_CORRECTION_NEXT_MISSING', 'Correction new claim is missing');
    assertMission(
      next.claim_id === prior.claim_id
        && next.version === prior.version + 1
        && next.supersedes_claim_record_id === prior.claim_record_id
        && prior.status === 'SUPERSEDED',
      'M001_CORRECTION_HISTORY_INVALID',
      'Correction must create the immediate new version without deleting its predecessor',
    );
    assertMission(
      JSON.stringify(uniqueSorted(correction.prior_observation_ids, 'correction.prior_observation_ids'))
        === JSON.stringify(uniqueSorted(prior.observation_ids, 'prior.observation_ids')),
      'M001_CORRECTION_HISTORY_INVALID',
      'Correction must preserve the exact prior observation identities',
    );
    assertMission(
      uniqueSorted(correction.replacement_observation_ids, 'correction.replacement_observation_ids')
        .every((id) => next.observation_ids.includes(id)),
      'M001_CORRECTION_EVIDENCE_INVALID',
      'Correction replacement observations must belong to the new claim version',
    );
    requireTimestamp(correction.created_at, 'correction.created_at');
    requireText(correction.reason, 'correction.reason');
  }

  for (const sponsorship of graph.sponsorships) {
    requireExactFields(
      sponsorship,
      ['sponsorship_id', 'tenant_id', 'workspace_id', 'listing_entity_id', 'label', 'active', 'affects_verification', 'affects_confidence', 'affects_contradiction_visibility', 'affects_truth', 'affects_organic_relevance'],
      'M001_SPONSORSHIP_SCHEMA_DENIED',
      'sponsorship',
    );
    requireScoped(sponsorship, graph, 'sponsorship');
    const listing = requireReference(entityById, sponsorship.listing_entity_id, 'M001_SPONSORSHIP_LISTING_MISSING', 'Sponsorship listing is missing');
    assertMission(listing.entity_type === 'LISTING', 'M001_SPONSORSHIP_LISTING_INVALID', 'Sponsorship may bind only to a listing');
    requireText(sponsorship.label, 'sponsorship.label');
    requireBoolean(sponsorship.active, 'sponsorship.active');
    for (const field of [
      'affects_verification',
      'affects_confidence',
      'affects_contradiction_visibility',
      'affects_truth',
      'affects_organic_relevance',
    ]) {
      requireBoolean(sponsorship[field], `sponsorship.${field}`);
      assertMission(sponsorship[field] === false, 'M001_SPONSORSHIP_INTERFERENCE_DENIED', `Sponsorship cannot change ${field}`);
    }
  }

  const { graph_hash: ignored, ...body } = graph;
  const graphHash = hashCanonical(body);
  if (input.graph_hash !== undefined) {
    requireSha256(input.graph_hash, 'graph_hash');
    assertMission(input.graph_hash === graphHash, 'M001_GRAPH_TAMPERED', 'Claim graph hash does not recompute');
  }
  return deepFreeze({ ...body, graph_hash: graphHash });
}

export function createClaimGraph(fields) {
  return validateClaimGraph({
    schema_version: 'cana.growth-foundry-m001-claim-graph/1.0.0',
    graph_version: CLAIM_GRAPH_VERSION,
    package_003_sha256: PACKAGE_003_SHA256,
    handoff_hash: M001_HANDOFF_HASH,
    tenant_id: M001_TENANT,
    workspace_id: M001_WORKSPACE,
    ...fields,
  });
}

function newestVerification(events) {
  return [...events].sort((left, right) => (
    left.verified_at.localeCompare(right.verified_at)
    || left.verification_event_id.localeCompare(right.verification_event_id)
  )).at(-1) ?? null;
}

export function evaluateClaim(graphInput, claimId, asOfInput) {
  const graph = validateClaimGraph(graphInput);
  requireText(claimId, 'claimId');
  const asOf = requireTimestamp(asOfInput, 'asOf');
  const claims = graph.claims
    .filter((claim) => claim.claim_id === claimId)
    .sort((left, right) => left.version - right.version);
  assertMission(claims.length > 0, 'M001_CLAIM_MISSING', 'Claim identity is missing');
  const claim = claims.at(-1);
  const observations = claim.observation_ids.map((id) => graph.observations.find((item) => item.observation_id === id));
  const provenance = observations.map((observation) => ({
    observation_id: observation.observation_id,
    source_id: observation.source_id,
    source_hash: observation.source_hash,
    observed_at: observation.observed_at,
    expires_at: observation.expires_at,
  }));
  const base = {
    claim_id: claim.claim_id,
    claim_record_id: claim.claim_record_id,
    version: claim.version,
    entity_id: claim.entity_id,
    claim_class: claim.claim_class,
    evaluated_at: asOf.toISOString(),
    provenance,
    uncertainty: [...new Set(observations.map((observation) => observation.uncertainty))].sort(),
    confidence: Math.min(...observations.map((observation) => observation.confidence)),
    contradiction_observation_ids: [],
    display_value: null,
    fallback: SAFE_FALLBACK,
    organic_relevance_basis: `${claim.entity_id}:${claim.claim_class}`,
  };
  if (claim.status === 'RETIRED') {
    return deepFreeze({ ...base, state: 'RETIRED' });
  }
  const current = observations.filter((observation) => new Date(observation.expires_at) > asOf);
  if (current.length === 0) {
    return deepFreeze({ ...base, state: 'UNKNOWN', reason: 'EXPIRED' });
  }
  const currentSources = current.map((observation) => (
    graph.sources.find((source) => source.source_id === observation.source_id)
  ));
  if (!authoritySatisfied(CLAIM_CLASS_RULES[claim.claim_class].required_source, currentSources)) {
    return deepFreeze({ ...base, state: 'UNKNOWN', reason: 'UNSUPPORTED_SOURCE_AUTHORITY' });
  }
  const values = new Map(current.map((observation) => [canonicalize(observation.value), observation.value]));
  if (values.size > 1) {
    return deepFreeze({
      ...base,
      state: 'CONFLICTED',
      reason: 'CONTRADICTORY_OBSERVATIONS',
      contradiction_observation_ids: current.map((observation) => observation.observation_id).sort(),
    });
  }
  const event = newestVerification(
    graph.verification_events.filter((candidate) => candidate.claim_record_id === claim.claim_record_id),
  );
  if (!event || event.decision !== 'APPROVE') {
    return deepFreeze({ ...base, state: 'UNKNOWN', reason: 'INDEPENDENT_VERIFICATION_REQUIRED' });
  }
  return deepFreeze({
    ...base,
    state: 'SUPPORTED_CURRENT',
    reason: 'EXACT_PROVENANCE_AND_AUTHORITY_VERIFIED',
    display_value: [...values.values()][0],
    fallback: null,
  });
}

export function evaluateClaimGraph(graphInput, asOf) {
  const graph = validateClaimGraph(graphInput);
  const claimIds = [...new Set(graph.claims.map((claim) => claim.claim_id))].sort();
  const evaluations = claimIds.map((claimId) => evaluateClaim(graph, claimId, asOf));
  const body = {
    schema_version: 'cana.growth-foundry-m001-evaluation/1.0.0',
    graph_hash: graph.graph_hash,
    tenant_id: graph.tenant_id,
    workspace_id: graph.workspace_id,
    evaluated_at: requireTimestamp(asOf, 'asOf').toISOString(),
    evaluations,
  };
  return deepFreeze({ ...body, evaluation_hash: hashCanonical(body) });
}

export function applyCorrection(graphInput, {
  correction,
  observations,
  claim,
  verificationEvent,
}) {
  const graph = validateClaimGraph(graphInput);
  const body = structuredClone(graph);
  delete body.graph_hash;
  const prior = body.claims.find((candidate) => candidate.claim_record_id === correction.prior_claim_record_id);
  assertMission(prior, 'M001_CORRECTION_PRIOR_MISSING', 'Correction prior claim is missing');
  prior.status = 'SUPERSEDED';
  body.observations.push(...structuredClone(observations));
  body.claims.push(structuredClone(claim));
  body.verification_events.push(structuredClone(verificationEvent));
  body.corrections.push(structuredClone(correction));
  return validateClaimGraph(body);
}
