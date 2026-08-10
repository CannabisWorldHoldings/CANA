import { createHash } from 'node:crypto';
import { resolveAbcaEntity } from './entity-resolution.mjs';
import { ABCA_LIVE_CONTRACT, ABCA_LIVE_CONTRACT_DIGEST } from './live-abca-adapter.mjs';
import { canonicalDigest, parseEvidencePayload } from './reality-compiler.mjs';

export const MARKET_CLAIM_COURT_VERSION = 'cana-market-claim-court-v1';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function outcome(claim, values) {
  const evidence = {
    claim_id: claim?.claim_id ?? null,
    subject_id: claim?.subject_id ?? null,
    geo_entity_id: claim?.geo_entity_id ?? null,
    predicate: claim?.predicate ?? null,
    value: claim?.value ?? null,
    source_id: claim?.source_id ?? null,
    snapshot_sha256: claim?.snapshot_sha256 ?? null,
    source_record_key: claim?.source_record_key ?? null,
    source_record_sha256: claim?.source_record_sha256 ?? null,
    observation_ids: claim?.observation_ids ?? null,
    contradictory_observation_ids: claim?.contradictory_observation_ids ?? null,
    observed_at: claim?.observed_at ?? null,
    freshness_expires_at: claim?.freshness_expires_at ?? null,
    decision: values.decision,
    verification: values.verification,
    reason: values.reason,
    court_version: MARKET_CLAIM_COURT_VERSION,
  };
  return Object.freeze({
    ...claim,
    ...values,
    court_version: MARKET_CLAIM_COURT_VERSION,
    evidence_digest: canonicalDigest(evidence),
  });
}

function deny(claim, verification, reason, decision = 'DENY') {
  return outcome(claim, { decision, verification, decision_eligible: false, reason });
}

function acquisitionDecision(values) {
  return Object.freeze({
    decision: 'DENY',
    decision_eligible: false,
    ...values,
  });
}

export function adjudicateAcquisitionEvidence({ event, artifact, snapshot, tenant, purpose, asOf }) {
  if (!event || !artifact || !snapshot) return acquisitionDecision({ reason: 'ACQUISITION_EVIDENCE_INCOMPLETE' });
  if (!['COMPILE', 'REVALIDATE'].includes(purpose)) return acquisitionDecision({ reason: 'ACQUISITION_PURPOSE_INVALID' });
  if (event.state !== 'COMPLETED' || event.errorCode) return acquisitionDecision({ reason: 'ACQUISITION_NOT_SUCCESSFUL' });
  if (event.tenant !== tenant) return acquisitionDecision({ reason: 'ACQUISITION_TENANT_MISMATCH' });
  if (event.sourceKey !== ABCA_LIVE_CONTRACT.sourceKey
    || artifact.sourceKey !== ABCA_LIVE_CONTRACT.sourceKey
    || snapshot.sourceKey !== ABCA_LIVE_CONTRACT.sourceKey
    || artifact.sourceUrl !== ABCA_LIVE_CONTRACT.layerUrl
    || snapshot.sourceUrl !== ABCA_LIVE_CONTRACT.layerUrl) {
    return acquisitionDecision({ reason: 'ACQUISITION_SOURCE_MISMATCH' });
  }
  const allowedOutcomes = purpose === 'COMPILE' ? ['SOURCE_CHANGED'] : ['SOURCE_CHANGED', 'SOURCE_UNCHANGED'];
  if (!allowedOutcomes.includes(event.outcome)) {
    return acquisitionDecision({ reason: purpose === 'COMPILE'
      ? 'ACQUISITION_OUTCOME_NOT_COMPILABLE'
      : 'ACQUISITION_OUTCOME_NOT_REVALIDATABLE' });
  }
  if (event.completeness !== 'COMPLETE' || snapshot.completeness !== 'COMPLETE') {
    return acquisitionDecision({ reason: 'ACQUISITION_NOT_COMPLETE' });
  }
  if (event.requestDigest !== ABCA_LIVE_CONTRACT_DIGEST
    || event.adapterContractDigest !== ABCA_LIVE_CONTRACT_DIGEST
    || artifact.requestContractDigest !== ABCA_LIVE_CONTRACT_DIGEST) {
    return acquisitionDecision({ reason: 'ACQUISITION_REQUEST_CONTRACT_MISMATCH' });
  }
  if (event.contentArtifactId !== artifact.id
    || event.snapshotId !== snapshot.id
    || artifact.snapshotId !== snapshot.id
    || artifact.contentSha256 !== snapshot.payloadSha256
    || artifact.payloadBytes !== snapshot.payloadBytes
    || artifact.recordCount !== snapshot.recordCount
    || artifact.schemaVersion !== snapshot.schemaVersion) {
    return acquisitionDecision({ reason: 'CONTENT_IDENTITY_MISMATCH' });
  }
  const preRevision = event.preSourceRevision;
  const postRevision = event.postSourceRevision;
  if ((preRevision ?? 'UNKNOWN') !== (postRevision ?? 'UNKNOWN')) {
    return acquisitionDecision({ reason: 'ACQUISITION_REVISION_DRIFT' });
  }
  if (!Number.isInteger(event.preObservedRecordCount)
    || !Number.isInteger(event.postObservedRecordCount)
    || event.preObservedRecordCount !== event.postObservedRecordCount) {
    return acquisitionDecision({ reason: 'ACQUISITION_COUNT_DRIFT' });
  }
  if (event.observedRecordCount !== event.preObservedRecordCount
    || snapshot.recordCount !== event.preObservedRecordCount) {
    return acquisitionDecision({ reason: 'ACQUISITION_RECORD_COUNT_MISMATCH' });
  }
  const acquiredAt = new Date(event.fetchedAt);
  const completedAt = new Date(event.completedAt);
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (![acquiredAt, completedAt, clock].every((date) => Number.isFinite(date.getTime())) || completedAt < acquiredAt) {
    return acquisitionDecision({ reason: 'ACQUISITION_TIME_INVALID' });
  }
  if (clock < acquiredAt) return acquisitionDecision({ reason: 'ACQUISITION_FROM_FUTURE' });
  return acquisitionDecision({
    decision: 'ALLOW',
    decision_eligible: false,
    reason: 'ACQUISITION_EVIDENCE_COURT_PASSED',
    acquisition_id: event.id,
    content_artifact_id: artifact.id,
    snapshot_id: snapshot.id,
    content_sha256: artifact.contentSha256,
    acquired_at: acquiredAt.toISOString(),
    zero_change: event.outcome === 'SOURCE_UNCHANGED',
  });
}

export function adjudicateZeroChangeReattestation({
  acquisition,
  predicate,
  sourcePolicy,
  licenseExpiration = null,
  asOf,
}) {
  const denied = (reason, verification = 'UNKNOWN', decision = 'DENY') => Object.freeze({
    decision,
    verification,
    decision_eligible: false,
    freshness_expires_at: null,
    reason,
  });
  if (acquisition?.decision !== 'ALLOW' || acquisition.zero_change !== true) {
    return denied('ZERO_CHANGE_ACQUISITION_NOT_ADMITTED');
  }
  if (!Array.isArray(sourcePolicy?.authoritative_predicates)
    || !sourcePolicy.authoritative_predicates.includes(predicate)) {
    return denied('PREDICATE_OUTSIDE_SOURCE_AUTHORITY');
  }
  if (!Number.isFinite(sourcePolicy.max_age_ms) || sourcePolicy.max_age_ms <= 0) {
    return denied('FRESHNESS_POLICY_INVALID', 'REFUTED');
  }
  const acquiredAt = new Date(acquisition.acquired_at);
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(acquiredAt.getTime()) || !Number.isFinite(clock.getTime()) || clock < acquiredAt) {
    return denied('REVALIDATION_TIME_INVALID', 'REFUTED');
  }
  let expiryMs = acquiredAt.getTime() + sourcePolicy.max_age_ms;
  if (licenseExpiration !== null) {
    const licenseExpiry = new Date(licenseExpiration);
    if (!Number.isFinite(licenseExpiry.getTime())) return denied('LICENSE_EXPIRATION_INVALID', 'REFUTED');
    expiryMs = Math.min(expiryMs, licenseExpiry.getTime());
  }
  const freshnessExpiresAt = new Date(expiryMs);
  if (clock >= freshnessExpiresAt) {
    return denied('REATTESTED_FRESHNESS_EXPIRED', 'STALE', 'MARK_STALE');
  }
  return Object.freeze({
    decision: 'ALLOW',
    verification: 'VERIFIED',
    decision_eligible: true,
    freshness_expires_at: freshnessExpiresAt.toISOString(),
    reason: 'ZERO_CHANGE_REATTESTATION_PASSED',
  });
}

function recordDigest(feature) {
  return canonicalDigest({ attributes: feature.attributes, geometry: feature.geometry ?? null });
}

function normalizedStatus(value) {
  return typeof value === 'string' && value.trim() === 'Active' ? 'ACTIVE' : String(value ?? '').trim().toUpperCase() || 'UNKNOWN';
}

function expectedValue(predicate, feature) {
  const record = feature.attributes;
  if (predicate === 'license_number') return String(record.ABCA_NUMBER ?? '').normalize('NFKC').trim().toUpperCase();
  if (predicate === 'license_type') return String(record.LICENSE_TYPE ?? '').trim() || 'UNKNOWN';
  if (predicate === 'license_status' || predicate === 'operating_status') return normalizedStatus(record.STATUS);
  if (predicate === 'license_expiration') {
    if (typeof record.EXPIRATION_DATE !== 'number' || !Number.isFinite(record.EXPIRATION_DATE)) return null;
    const date = new Date(record.EXPIRATION_DATE);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (predicate === 'regulated_address') return String(record.ADDRESS ?? '').trim() || null;
  if (predicate === 'facility_name') return String(record.FACILITY_NAME ?? record.TRADE_NAME ?? '').trim() || null;
  if (predicate === 'located_at') {
    const lat = Number(record.LATITUDE);
    const lng = Number(record.LONGITDUE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 38.7 || lat > 39.1 || lng < -77.2 || lng > -76.8) return null;
    if (feature.geometry) {
      const geoLat = Number(feature.geometry.y);
      const geoLng = Number(feature.geometry.x);
      if (!Number.isFinite(geoLat) || !Number.isFinite(geoLng)
        || Math.abs(geoLat - lat) > 0.0001
        || Math.abs(geoLng - lng) > 0.0001) return null;
    }
    return JSON.stringify({ lat, lng });
  }
  return undefined;
}

function expectedFreshness(snapshot, sourcePolicy, feature) {
  const fetchedAt = new Date(snapshot.fetched_at);
  if (!Number.isFinite(fetchedAt.getTime())
    || !Number.isFinite(sourcePolicy.max_age_ms)
    || sourcePolicy.max_age_ms <= 0) return null;
  let expiresAt = fetchedAt.getTime() + sourcePolicy.max_age_ms;
  const rawExpiration = feature.attributes.EXPIRATION_DATE;
  if (typeof rawExpiration === 'number' && Number.isFinite(rawExpiration)) {
    expiresAt = Math.min(expiresAt, rawExpiration);
  }
  const expected = new Date(expiresAt);
  return Number.isFinite(expected.getTime()) ? expected.toISOString() : null;
}

function observationSupportsClaim(claim, observation) {
  return observation?.observation_id === claim.observation_ids[0]
    && observation.source_id === claim.source_id
    && observation.snapshot_sha256 === claim.snapshot_sha256
    && observation.source_record_key === claim.source_record_key
    && observation.source_record_sha256 === claim.source_record_sha256
    && observation.predicate === claim.predicate
    && observation.value === claim.value
    && observation.observed_at === claim.observed_at;
}

export function adjudicateMarketClaim({ claim, snapshot, sourcePolicy, identityContext, asOf = new Date() }) {
  if (!claim || !snapshot || !sourcePolicy) return deny(claim, 'REFUTED', 'COURT_INPUT_INCOMPLETE');
  if (!Buffer.isBuffer(snapshot.payload_bytes) || snapshot.sha256 !== digest(snapshot.payload_bytes) || snapshot.byte_length !== snapshot.payload_bytes.length) {
    return deny(claim, 'REFUTED', 'SNAPSHOT_DIGEST_MISMATCH');
  }
  if (snapshot.source_id !== sourcePolicy.source_id || claim.source_id !== sourcePolicy.source_id || claim.snapshot_sha256 !== snapshot.sha256) {
    return deny(claim, 'REFUTED', 'SOURCE_BINDING_MISMATCH');
  }
  if (snapshot.completeness !== 'COMPLETE') return deny(claim, 'UNKNOWN', 'SNAPSHOT_NOT_COMPLETE');
  if (!sourcePolicy.authoritative_predicates.includes(claim.predicate)) return deny(claim, 'UNKNOWN', 'PREDICATE_OUTSIDE_SOURCE_AUTHORITY');
  if (!Array.isArray(identityContext?.retailers) || !Array.isArray(identityContext?.aliases)) {
    return deny(claim, 'REFUTED', 'COURT_IDENTITY_CONTEXT_INCOMPLETE');
  }
  if (claim.resolution_status !== 'EXACT_MATCH' || !['EXACT_LICENSE', 'EXACT_ALIAS'].includes(claim.resolution_method)) {
    return deny(claim, 'UNKNOWN', 'IDENTITY_NOT_EXACTLY_RESOLVED');
  }
  if (!Array.isArray(claim.observation_ids)
    || claim.observation_ids.length !== 1
    || !Array.isArray(claim.supporting_observations)
    || claim.supporting_observations.length !== 1
    || !observationSupportsClaim(claim, claim.supporting_observations[0])) {
    return deny(claim, 'REFUTED', 'CLAIM_EVIDENCE_LINK_MISMATCH');
  }
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  const fetchedAt = new Date(snapshot.fetched_at);
  if (!Number.isFinite(clock.getTime()) || !Number.isFinite(fetchedAt.getTime())) {
    return deny(claim, 'REFUTED', 'TEMPORAL_VALUE_INVALID');
  }
  if (clock < fetchedAt) return deny(claim, 'UNKNOWN', 'COURT_CLOCK_PRECEDES_OBSERVATION');
  if (Array.isArray(claim.contradictory_observation_ids) && claim.contradictory_observation_ids.length > 0) {
    return deny(claim, 'CONTRADICTED', 'CURRENT_CONTRADICTION_PRESERVED', 'PRESERVE_CONFLICT');
  }

  let payload;
  try {
    payload = parseEvidencePayload(snapshot);
  } catch {
    return deny(claim, 'REFUTED', 'SNAPSHOT_JSON_INVALID');
  }
  const matches = payload.features?.filter((feature) => String(feature?.attributes?.ABCA_NUMBER ?? '').normalize('NFKC').trim().toUpperCase() === claim.source_record_key) ?? [];
  if (matches.length !== 1) return deny(claim, 'REFUTED', 'SOURCE_RECORD_NOT_UNIQUE');
  const feature = matches[0];
  if (recordDigest(feature) !== claim.source_record_sha256) return deny(claim, 'REFUTED', 'SOURCE_RECORD_DIGEST_MISMATCH');
  const resolution = resolveAbcaEntity({
    record: { ...feature.attributes, geometry: feature.geometry ?? null },
    retailers: identityContext.retailers,
    aliases: identityContext.aliases,
  });
  if (resolution.status !== 'EXACT_MATCH'
    || resolution.method !== claim.resolution_method
    || resolution.retailer_id !== claim.subject_id
    || (resolution.geo_entity_id ?? null) !== (claim.geo_entity_id ?? null)) {
    return deny(claim, 'REFUTED', 'IDENTITY_RESOLUTION_MISMATCH');
  }
  if (claim.observed_at !== fetchedAt.toISOString()) {
    return deny(claim, 'REFUTED', 'OBSERVATION_TIME_BINDING_MISMATCH');
  }
  const expected = expectedValue(claim.predicate, feature);
  if (expected === undefined) return deny(claim, 'UNKNOWN', 'PREDICATE_OUTSIDE_SOURCE_AUTHORITY');
  if (expected === null || expected !== claim.value) return deny(claim, 'REFUTED', 'CLAIM_VALUE_NOT_SUPPORTED_BY_SOURCE');
  const freshness = expectedFreshness(snapshot, sourcePolicy, feature);
  if (!freshness || claim.freshness_expires_at !== freshness) {
    return deny(claim, 'REFUTED', 'FRESHNESS_BINDING_MISMATCH');
  }
  if (claim.predicate === 'license_expiration' && new Date(expected) <= clock) {
    return deny(claim, 'STALE', 'LICENSE_EXPIRED', 'MARK_STALE');
  }
  if (clock >= new Date(freshness)) return deny(claim, 'STALE', 'CLAIM_FRESHNESS_EXPIRED', 'MARK_STALE');
  return outcome(claim, {
    decision: 'ALLOW',
    verification: 'VERIFIED',
    decision_eligible: true,
    reason: 'INDEPENDENT_OFFICIAL_SOURCE_RECOMPUTATION_PASSED',
  });
}
