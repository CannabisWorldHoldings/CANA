import { createHash } from 'node:crypto';

import { normalizeAbcaLicense, normalizeCoordinates, resolveAbcaEntity } from './entity-resolution.mjs';
import { ABCA_FIELDS, ABCA_LAYER_URL, ABCA_SOURCE_ID } from './official-source-snapshot.mjs';

export const OFFICIAL_MARKET_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REALITY_COMPILER_VERSION = 'cana-reality-compiler-v1';
export const DC_ABCA_SOURCE = Object.freeze({
  source_id: ABCA_SOURCE_ID,
  source_url: ABCA_LAYER_URL,
  authority_class: 'DC_ABCA_LICENSED_RETAILER_OPERATIONAL_LIST',
  source_catalog_modified_date: '2026-06-05',
  max_age_ms: OFFICIAL_MARKET_TTL_MS,
  authoritative_predicates: Object.freeze([
    'license_number',
    'license_status',
    'regulated_address',
    'operating_status',
  ]),
});

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalDigest(value) {
  return digest(Buffer.from(JSON.stringify(value)));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validInstant(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`CANA_REALITY_INVALID_${label}`);
  return date.toISOString();
}

export function createEvidenceSnapshot({ sourceId, payloadBytes, payloadPages, fetchedAt, completeness = 'UNKNOWN' }) {
  if (sourceId !== ABCA_SOURCE_ID) throw new Error('CANA_REALITY_SOURCE_NOT_AUTHORIZED');
  if (payloadPages !== undefined) {
    if (!Array.isArray(payloadPages) || payloadPages.length === 0) throw new Error('CANA_REALITY_PAYLOAD_REQUIRED');
    let previousOffset = -1;
    const pages = payloadPages.map((part, index) => {
      if (!Number.isInteger(part?.offset) || part.offset <= previousOffset || !Buffer.isBuffer(part?.bytes) || part.bytes.length === 0) {
        throw new Error(`CANA_REALITY_PAGE_ENVELOPE_INVALID:${index}`);
      }
      previousOffset = part.offset;
      return {
        offset: part.offset,
        byte_length: part.bytes.length,
        sha256: digest(part.bytes),
        response_base64: part.bytes.toString('base64'),
      };
    });
    payloadBytes = Buffer.from(canonicalJson({ schema_version: 'cana-reality-page-envelope-v1', pages }));
  }
  if (!Buffer.isBuffer(payloadBytes) || payloadBytes.length === 0) throw new Error('CANA_REALITY_PAYLOAD_REQUIRED');
  if (!['COMPLETE', 'PARTIAL', 'UNKNOWN', 'SOURCE_OUTAGE', 'PARSER_FAILED'].includes(completeness)) {
    throw new Error('CANA_REALITY_COMPLETENESS_INVALID');
  }
  const bytes = Buffer.from(payloadBytes);
  return Object.freeze({
    source_id: sourceId,
    source_url: ABCA_LAYER_URL,
    fetched_at: validInstant(fetchedAt, 'FETCHED_AT'),
    completeness,
    sha256: digest(bytes),
    byte_length: bytes.length,
    payload_bytes: bytes,
    schema_version: REALITY_COMPILER_VERSION,
  });
}

export function parseEvidencePayload(snapshot) {
  if (!snapshot || !Buffer.isBuffer(snapshot.payload_bytes)) throw new Error('CANA_REALITY_SNAPSHOT_INVALID');
  if (snapshot.byte_length !== snapshot.payload_bytes.length || snapshot.sha256 !== digest(snapshot.payload_bytes)) {
    throw new Error('CANA_REALITY_SNAPSHOT_DIGEST_MISMATCH');
  }
  let payload;
  try {
    payload = JSON.parse(snapshot.payload_bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`CANA_REALITY_PAYLOAD_INVALID: ${error.message}`);
  }
  if (payload?.schema_version === 'cana-reality-page-envelope-v1') {
    if (!Array.isArray(payload.pages) || payload.pages.length === 0) throw new Error('CANA_REALITY_PAGE_ENVELOPE_INVALID');
    const features = [];
    let previousOffset = -1;
    for (const [index, part] of payload.pages.entries()) {
      if (!Number.isInteger(part?.offset) || part.offset <= previousOffset || typeof part.response_base64 !== 'string') {
        throw new Error(`CANA_REALITY_PAGE_ENVELOPE_INVALID:${index}`);
      }
      previousOffset = part.offset;
      const bytes = Buffer.from(part.response_base64, 'base64');
      if (bytes.length !== part.byte_length || digest(bytes) !== part.sha256) throw new Error(`CANA_REALITY_PAGE_DIGEST_MISMATCH:${index}`);
      let page;
      try { page = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`CANA_REALITY_ARCGIS_PAYLOAD_INVALID:${index}`); }
      if (page.error || !Array.isArray(page.features)) throw new Error(`CANA_REALITY_ARCGIS_PAYLOAD_INVALID:${index}`);
      if (index < payload.pages.length - 1 && page.exceededTransferLimit !== true) throw new Error(`CANA_REALITY_PAGE_ENVELOPE_INVALID:${index}`);
      if (index === payload.pages.length - 1 && page.exceededTransferLimit === true) throw new Error('CANA_REALITY_PAGE_ENVELOPE_INCOMPLETE');
      features.push(...page.features);
    }
    return { features };
  }
  if (payload.error || !Array.isArray(payload.features)) throw new Error('CANA_REALITY_ARCGIS_PAYLOAD_INVALID');
  return payload;
}

function normalizedStatus(value) {
  return typeof value === 'string' && value.trim() === 'Active' ? 'ACTIVE' : String(value ?? '').trim().toUpperCase() || 'UNKNOWN';
}

function expiration(value) {
  const number = Number(value);
  const date = new Date(number);
  return Number.isFinite(number) && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function observation({ snapshot, recordKey, recordHash, predicate, rawValue, value }) {
  const identity = { snapshot: snapshot.sha256, recordKey, predicate, value };
  return Object.freeze({
    observation_id: canonicalDigest(identity),
    source_id: snapshot.source_id,
    snapshot_sha256: snapshot.sha256,
    source_record_key: recordKey,
    source_record_sha256: recordHash,
    predicate,
    raw_value: rawValue ?? null,
    value,
    observed_at: snapshot.fetched_at,
    verification: 'UNKNOWN',
    decision_eligible: false,
    parser_version: REALITY_COMPILER_VERSION,
  });
}

export function parseAbcaSnapshot(snapshot) {
  const payload = parseEvidencePayload(snapshot);
  const observations = [];
  const invalidObservations = [];
  const records = [];
  for (const feature of payload.features) {
    const attributes = feature?.attributes;
    if (!attributes || ABCA_FIELDS.some((field) => !Object.hasOwn(attributes, field))) {
      invalidObservations.push(Object.freeze({ reason: 'MISSING_REQUIRED_FIELD', object_id: attributes?.OBJECTID ?? null }));
      continue;
    }
    const license = normalizeAbcaLicense(attributes.ABCA_NUMBER);
    if (!license) {
      invalidObservations.push(Object.freeze({ reason: 'MISSING_OR_INVALID_ABCA_LICENSE', object_id: attributes.OBJECTID ?? null }));
      continue;
    }
    const record = Object.freeze({ ...attributes, geometry: feature.geometry ?? null });
    const recordHash = canonicalDigest({ attributes, geometry: feature.geometry ?? null });
    const coordinates = normalizeCoordinates(record);
    const values = [
      ['license_number', attributes.ABCA_NUMBER, license],
      ['license_type', attributes.LICENSE_TYPE, String(attributes.LICENSE_TYPE ?? '').trim() || 'UNKNOWN'],
      ['license_status', attributes.STATUS, normalizedStatus(attributes.STATUS)],
      ['license_expiration', attributes.EXPIRATION_DATE, expiration(attributes.EXPIRATION_DATE)],
      ['regulated_address', attributes.ADDRESS, String(attributes.ADDRESS ?? '').trim() || null],
      ['facility_name', attributes.FACILITY_NAME ?? attributes.TRADE_NAME, String(attributes.FACILITY_NAME ?? attributes.TRADE_NAME ?? '').trim() || null],
      ['operating_status', attributes.STATUS, normalizedStatus(attributes.STATUS)],
    ];
    if (coordinates.state === 'KNOWN') values.push(['located_at', { lat: attributes.LATITUDE, lng: attributes.LONGITDUE }, JSON.stringify({ lat: coordinates.lat, lng: coordinates.lng })]);
    else invalidObservations.push(Object.freeze({ reason: coordinates.reason, object_id: attributes.OBJECTID, predicate: 'located_at' }));
    for (const [predicate, rawValue, value] of values) {
      if (value === null) {
        invalidObservations.push(Object.freeze({ reason: 'VALUE_UNKNOWN', object_id: attributes.OBJECTID, predicate }));
        continue;
      }
      observations.push(observation({ snapshot, recordKey: license, recordHash, predicate, rawValue, value }));
    }
    records.push(Object.freeze({ record, record_hash: recordHash, normalized_license: license, coordinates }));
  }
  return Object.freeze({
    observations: Object.freeze(observations),
    invalid_observations: Object.freeze(invalidObservations),
    records: Object.freeze(records),
    compiler_version: REALITY_COMPILER_VERSION,
  });
}

function claimFreshness(snapshot, record) {
  const ttl = new Date(new Date(snapshot.fetched_at).getTime() + OFFICIAL_MARKET_TTL_MS);
  const expires = expiration(record.EXPIRATION_DATE);
  if (!expires) return ttl.toISOString();
  return new Date(Math.min(ttl.getTime(), new Date(expires).getTime())).toISOString();
}

export function compileRealitySnapshot({ snapshot, tenant = 'orderweeddc.localhost', retailers = [], aliases = [] }) {
  const parsed = parseAbcaSnapshot(snapshot);
  const claims = [];
  const resolutions = [];
  for (const parsedRecord of parsed.records) {
    const resolution = resolveAbcaEntity({ record: parsedRecord.record, retailers, aliases });
    resolutions.push(Object.freeze({ ...resolution, source_record_sha256: parsedRecord.record_hash }));
    if (resolution.status !== 'EXACT_MATCH') continue;
    const recordObservations = parsed.observations.filter((entry) => entry.source_record_key === parsedRecord.normalized_license);
    const freshnessExpiresAt = claimFreshness(snapshot, parsedRecord.record);
    for (const evidence of recordObservations) {
      const identity = {
        source: snapshot.source_id,
        subject: resolution.retailer_id ?? resolution.geo_entity_id,
        predicate: evidence.predicate,
        value: evidence.value,
        snapshot: snapshot.sha256,
      };
      claims.push(Object.freeze({
        claim_id: canonicalDigest(identity),
        tenant,
        subject_id: resolution.retailer_id ?? resolution.geo_entity_id,
        predicate: evidence.predicate,
        value: evidence.value,
        source_id: snapshot.source_id,
        source_url: snapshot.source_url,
        snapshot_sha256: snapshot.sha256,
        source_record_key: evidence.source_record_key,
        source_record_sha256: evidence.source_record_sha256,
        observation_ids: Object.freeze([evidence.observation_id]),
        observed_at: snapshot.fetched_at,
        freshness_expires_at: freshnessExpiresAt,
        confidence: 1,
        uncertainty: null,
        resolution_status: resolution.status,
        resolution_method: resolution.method,
        verification: 'UNKNOWN',
        decision_eligible: false,
        compiler_version: REALITY_COMPILER_VERSION,
      }));
    }
  }
  return Object.freeze({
    snapshot_sha256: snapshot.sha256,
    observations: parsed.observations,
    invalid_observations: parsed.invalid_observations,
    resolutions: Object.freeze(resolutions),
    claims: Object.freeze(claims),
    compiler_version: REALITY_COMPILER_VERSION,
  });
}

export function contradictoryObservationIds(claim, priorClaims = []) {
  return Object.freeze([...new Set(priorClaims
    .filter((prior) => prior?.claimKey === claim?.claimKey && prior.claimValue !== claim?.claimValue)
    .flatMap((prior) => prior.observationIds ?? prior.observation_ids ?? []))].sort());
}

function intentCoverage(requiredPredicates, claims) {
  const subjects = new Map();
  for (const claim of claims) {
    if (!claim?.decision_eligible || typeof claim.subject_ref !== 'string') continue;
    const predicates = subjects.get(claim.subject_ref) ?? new Set();
    predicates.add(claim.predicate);
    subjects.set(claim.subject_ref, predicates);
  }
  const covered = Math.max(0, ...[...subjects.values()].map((predicates) => requiredPredicates.filter((predicate) => predicates.has(predicate)).length));
  return Object.freeze({
    answerable: requiredPredicates.length > 0 && covered === requiredPredicates.length,
    covered_predicates: covered,
    blocking_predicates: Object.freeze(requiredPredicates.filter((predicate) => ![...subjects.values()].some((predicates) => predicates.has(predicate)))),
  });
}

export function runOrganismLoopScenario({
  tenant,
  intent,
  demandSignals,
  verifiedClaimsBefore = [],
  verifiedClaimsAfter = [],
}) {
  if (typeof tenant !== 'string' || !tenant || !Number.isInteger(demandSignals) || demandSignals < 1) {
    throw new Error('CANA_REALITY_ORGANISM_SCENARIO_INVALID');
  }
  const required = [...new Set(intent?.required_predicates ?? [])].sort();
  const before = intentCoverage(required, verifiedClaimsBefore);
  const after = intentCoverage(required, verifiedClaimsAfter);
  const workRequired = !before.answerable;
  return Object.freeze({
    tenant,
    demand_signals: demandSignals,
    before,
    verification_opportunities: workRequired ? 1 : 0,
    continuation_missions: workRequired ? 1 : 0,
    after,
    gap_closed: workRequired && after.answerable,
    site_intelligence_coverage_delta: Math.max(0, after.covered_predicates - before.covered_predicates),
    effects: Object.freeze({
      network_live_source_calls: 0,
      provider_calls: 0,
      paid_calls: 0,
      spend_cents: 0,
      production_mutations: 0,
      deployments: 0,
      cognitive_promotions: 0,
    }),
  });
}

export function reflectVerificationEpisode(episode) {
  if (episode?.promote === true) throw new Error('COGNITIVE_PROMOTION_REQUIRES_COMPARABLE_PROOF');
  if (
    typeof episode?.episode_id !== 'string' ||
    !/^[a-f0-9]{64}$/.test(episode?.source_snapshot_sha256 ?? '') ||
    typeof episode?.belief_before !== 'string' ||
    !episode?.observed_result ||
    typeof episode?.bottleneck !== 'string' ||
    typeof episode?.causal_mechanism !== 'string'
  ) {
    throw new Error('CANA_COGNITIVE_REFLECTION_EPISODE_INVALID');
  }
  const body = {
    schema_version: 'cana-cognitive-reflection-v1',
    episode_id: episode.episode_id,
    source_snapshot_sha256: episode.source_snapshot_sha256,
    belief_before: episode.belief_before,
    observed_result: episode.observed_result,
    bottleneck: episode.bottleneck,
    causal_mechanism: episode.causal_mechanism,
    state: 'REFLECTION_ONLY',
    value_state: 'VALUE_NOT_ESTABLISHED',
    cognitive_mutations_promoted: 0,
    next_action: 'OWNER_REVIEW',
    promotion_evidence_required: [
      'FROZEN_PARENT',
      'HIDDEN_HOLDOUT',
      'ADVERSARIAL_COURT',
      'NEGATIVE_TRANSFER',
      'INDEPENDENT_VERIFICATION',
      'LATER_RETRIEVAL',
    ],
  };
  return Object.freeze({
    ...body,
    promotion_evidence_required: Object.freeze(body.promotion_evidence_required),
    receipt_sha256: digest(Buffer.from(canonicalJson(body))),
  });
}
