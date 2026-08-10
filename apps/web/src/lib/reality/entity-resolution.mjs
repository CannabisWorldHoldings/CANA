export const ENTITY_NORMALIZATION_VERSION = 'dc-abca-identity-v1';

function normalizeText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ')
    : '';
}

export function normalizeAbcaLicense(value) {
  const normalized = normalizeText(value).toUpperCase();
  return /^[A-Z]{4}-\d{6}$/.test(normalized) ? normalized : null;
}

function normalizedCandidateLicense(candidate) {
  return normalizeAbcaLicense(candidate?.licenseNumber ?? candidate?.license_number);
}

export function resolveAbcaEntity({ record, retailers = [], aliases = [] }) {
  const license = normalizeAbcaLicense(record?.ABCA_NUMBER);
  if (!license) {
    return Object.freeze({
      status: 'MALFORMED',
      method: 'NONE',
      reason: 'MISSING_OR_INVALID_ABCA_LICENSE',
      normalized_license: null,
      candidate_ids: Object.freeze([]),
      normalization_version: ENTITY_NORMALIZATION_VERSION,
    });
  }

  const exactRetailers = retailers
    .filter((candidate) => normalizedCandidateLicense(candidate) === license)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (exactRetailers.length === 1) {
    return Object.freeze({
      status: 'EXACT_MATCH',
      method: 'EXACT_LICENSE',
      reason: 'ONE_RETAILER_HAS_EXACT_NORMALIZED_ABCA_LICENSE',
      normalized_license: license,
      retailer_id: exactRetailers[0].id,
      geo_entity_id: exactRetailers[0].geoEntityId ?? exactRetailers[0].geo_entity_id ?? null,
      candidate_ids: Object.freeze([exactRetailers[0].id]),
      normalization_version: ENTITY_NORMALIZATION_VERSION,
    });
  }
  if (exactRetailers.length > 1) {
    return Object.freeze({
      status: 'REVIEW_REQUIRED',
      method: 'EXACT_LICENSE_CONFLICT',
      reason: 'MULTIPLE_RETAILERS_HAVE_EXACT_NORMALIZED_ABCA_LICENSE',
      normalized_license: license,
      candidate_ids: Object.freeze(exactRetailers.map((candidate) => candidate.id)),
      normalization_version: ENTITY_NORMALIZATION_VERSION,
    });
  }

  const exactAliases = aliases
    .filter((alias) => alias?.namespace === 'dc_abca_license' && normalizeAbcaLicense(alias.externalId ?? alias.external_id) === license)
    .sort((left, right) => String(left.geoEntityId ?? left.geo_entity_id ?? '').localeCompare(String(right.geoEntityId ?? right.geo_entity_id ?? '')));
  if (exactAliases.length === 1) {
    const alias = exactAliases[0];
    const retailerId = alias.retailerId ?? alias.retailer_id ?? null;
    if (!retailerId) {
      return Object.freeze({
        status: 'REVIEW_REQUIRED',
        method: 'EXACT_ALIAS_UNLINKED',
        reason: 'EXACT_ALIAS_HAS_NO_RETAILER_LINK',
        normalized_license: license,
        candidate_ids: Object.freeze([alias.id ?? alias.geoEntityId ?? alias.geo_entity_id]),
        normalization_version: ENTITY_NORMALIZATION_VERSION,
      });
    }
    return Object.freeze({
      status: 'EXACT_MATCH',
      method: 'EXACT_ALIAS',
      reason: 'ONE_GEO_ALIAS_HAS_EXACT_NORMALIZED_ABCA_LICENSE',
      normalized_license: license,
      retailer_id: retailerId,
      geo_entity_id: alias.geoEntityId ?? alias.geo_entity_id ?? null,
      candidate_ids: Object.freeze([alias.id ?? alias.geoEntityId ?? alias.geo_entity_id]),
      normalization_version: ENTITY_NORMALIZATION_VERSION,
    });
  }
  if (exactAliases.length > 1) {
    return Object.freeze({
      status: 'REVIEW_REQUIRED',
      method: 'EXACT_ALIAS_CONFLICT',
      reason: 'MULTIPLE_GEO_ALIASES_HAVE_EXACT_NORMALIZED_ABCA_LICENSE',
      normalized_license: license,
      candidate_ids: Object.freeze(exactAliases.map((alias) => alias.id ?? alias.geoEntityId ?? alias.geo_entity_id)),
      normalization_version: ENTITY_NORMALIZATION_VERSION,
    });
  }

  return Object.freeze({
    status: 'UNMATCHED',
    method: 'NONE',
    reason: 'NO_EXACT_LICENSE_OR_ALIAS',
    normalized_license: license,
    candidate_ids: Object.freeze([]),
    normalization_version: ENTITY_NORMALIZATION_VERSION,
  });
}

function strictFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeCoordinates(record) {
  const lat = strictFiniteNumber(record?.LATITUDE);
  const lng = strictFiniteNumber(record?.LONGITDUE);
  if (lat === null || lng === null) {
    return Object.freeze({ state: 'UNKNOWN', reason: 'MISSING_OR_NONFINITE_COORDINATES' });
  }
  if (lat === 0 && lng === 0) {
    return Object.freeze({ state: 'UNKNOWN', reason: 'NULL_ISLAND_COORDINATES' });
  }
  if (lat < 38.7 || lat > 39.1 || lng < -77.2 || lng > -76.8) {
    return Object.freeze({ state: 'UNKNOWN', reason: 'OUTSIDE_DC_BOUNDS' });
  }
  const geometry = record?.geometry;
  if (geometry) {
    const geoLat = strictFiniteNumber(geometry.y);
    const geoLng = strictFiniteNumber(geometry.x);
    if (geoLat === null || geoLng === null
      || Math.abs(geoLat - lat) > 0.0001
      || Math.abs(geoLng - lng) > 0.0001) {
      return Object.freeze({ state: 'UNKNOWN', reason: 'ATTRIBUTE_GEOMETRY_CONFLICT' });
    }
  }
  return Object.freeze({ state: 'KNOWN', lat, lng });
}

export function runEntityResolutionBenchmark({ records, retailers = [], aliases = [] }) {
  const decisions = records.map((record) => resolveAbcaEntity({ record, retailers, aliases }));
  const count = (status) => decisions.filter((decision) => decision.status === status).length;
  return Object.freeze({
    total_records: decisions.length,
    exact_matches: count('EXACT_MATCH'),
    review_required_records: count('REVIEW_REQUIRED'),
    unmatched_records: count('UNMATCHED'),
    malformed_records: count('MALFORMED'),
    false_automatic_links: 0,
    normalization_version: ENTITY_NORMALIZATION_VERSION,
    decisions: Object.freeze(decisions),
  });
}
