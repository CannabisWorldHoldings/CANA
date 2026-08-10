import { createHash } from 'node:crypto';
import { parseEvidencePayload } from './reality-compiler.mjs';

export const MARKET_CLAIM_COURT_VERSION = 'cana-market-claim-court-v1';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function outcome(claim, values) {
  const evidence = {
    claim_id: claim?.claim_id ?? null,
    predicate: claim?.predicate ?? null,
    decision: values.decision,
    verification: values.verification,
    reason: values.reason,
    court_version: MARKET_CLAIM_COURT_VERSION,
  };
  return Object.freeze({
    ...claim,
    ...values,
    court_version: MARKET_CLAIM_COURT_VERSION,
    evidence_digest: digest(Buffer.from(JSON.stringify(evidence))),
  });
}

function deny(claim, verification, reason, decision = 'DENY') {
  return outcome(claim, { decision, verification, decision_eligible: false, reason });
}

function recordDigest(feature) {
  return digest(Buffer.from(JSON.stringify({ attributes: feature.attributes, geometry: feature.geometry ?? null })));
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
    const date = new Date(Number(record.EXPIRATION_DATE));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (predicate === 'regulated_address') return String(record.ADDRESS ?? '').trim() || null;
  if (predicate === 'facility_name') return String(record.FACILITY_NAME ?? record.TRADE_NAME ?? '').trim() || null;
  if (predicate === 'located_at') {
    const lat = Number(record.LATITUDE);
    const lng = Number(record.LONGITDUE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 38.7 || lat > 39.1 || lng < -77.2 || lng > -76.8) return null;
    if (feature.geometry && (Math.abs(Number(feature.geometry.y) - lat) > 0.0001 || Math.abs(Number(feature.geometry.x) - lng) > 0.0001)) return null;
    return JSON.stringify({ lat, lng });
  }
  return undefined;
}

export function adjudicateMarketClaim({ claim, snapshot, sourcePolicy, asOf = new Date() }) {
  if (!claim || !snapshot || !sourcePolicy) return deny(claim, 'REFUTED', 'COURT_INPUT_INCOMPLETE');
  if (!Buffer.isBuffer(snapshot.payload_bytes) || snapshot.sha256 !== digest(snapshot.payload_bytes) || snapshot.byte_length !== snapshot.payload_bytes.length) {
    return deny(claim, 'REFUTED', 'SNAPSHOT_DIGEST_MISMATCH');
  }
  if (snapshot.source_id !== sourcePolicy.source_id || claim.source_id !== sourcePolicy.source_id || claim.snapshot_sha256 !== snapshot.sha256) {
    return deny(claim, 'REFUTED', 'SOURCE_BINDING_MISMATCH');
  }
  if (snapshot.completeness !== 'COMPLETE') return deny(claim, 'UNKNOWN', 'SNAPSHOT_NOT_COMPLETE');
  if (!sourcePolicy.authoritative_predicates.includes(claim.predicate)) return deny(claim, 'UNKNOWN', 'PREDICATE_OUTSIDE_SOURCE_AUTHORITY');
  if (claim.resolution_status !== 'EXACT_MATCH' || !['EXACT_LICENSE', 'EXACT_ALIAS'].includes(claim.resolution_method)) {
    return deny(claim, 'UNKNOWN', 'IDENTITY_NOT_EXACTLY_RESOLVED');
  }
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  const fetchedAt = new Date(snapshot.fetched_at);
  const expiresAt = new Date(claim.freshness_expires_at);
  if (!Number.isFinite(clock.getTime()) || !Number.isFinite(fetchedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    return deny(claim, 'REFUTED', 'TEMPORAL_VALUE_INVALID');
  }
  if (clock < fetchedAt) return deny(claim, 'UNKNOWN', 'COURT_CLOCK_PRECEDES_OBSERVATION');
  if (clock >= expiresAt) return deny(claim, 'STALE', 'CLAIM_FRESHNESS_EXPIRED', 'MARK_STALE');
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
  const expected = expectedValue(claim.predicate, feature);
  if (expected === undefined) return deny(claim, 'UNKNOWN', 'PREDICATE_OUTSIDE_SOURCE_AUTHORITY');
  if (expected === null || expected !== claim.value) return deny(claim, 'REFUTED', 'CLAIM_VALUE_NOT_SUPPORTED_BY_SOURCE');
  if (claim.predicate === 'license_expiration' && new Date(expected) <= clock) {
    return deny(claim, 'STALE', 'LICENSE_EXPIRED', 'MARK_STALE');
  }
  return outcome(claim, {
    decision: 'ALLOW',
    verification: 'VERIFIED',
    decision_eligible: true,
    reason: 'INDEPENDENT_OFFICIAL_SOURCE_RECOMPUTATION_PASSED',
  });
}
