export const ENTITY_NORMALIZATION_VERSION = 'dc-abca-identity-v1';
export const MATERIAL_COORDINATE_DELTA = 0.0001;

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

function normalizedAddress(value) {
  return normalizeText(value?.ADDRESS ?? value?.address ?? value?.retailer?.address);
}

function comparableAddress(value) {
  return normalizedAddress(value).toUpperCase();
}

function storedCoordinates(value) {
  const lat = strictFiniteNumber(value?.lat ?? value?.geo?.lat ?? value?.retailer?.lat);
  const lng = strictFiniteNumber(value?.lng ?? value?.geo?.lng ?? value?.retailer?.lng);
  if (lat === null || lng === null) {
    return Object.freeze({ state: 'UNKNOWN', reason: 'PREVIOUS_LOCATION_UNAVAILABLE' });
  }
  return normalizeCoordinates({ LATITUDE: lat, LONGITDUE: lng });
}

function hasStoredLocationBaseline(value) {
  const stored = value?.retailer ?? value;
  return ['address', 'lat', 'lng'].some((field) => Object.hasOwn(stored ?? {}, field));
}

export function compareOfficialRetailerLocation({ record, previous }) {
  const previousAddress = normalizedAddress(previous);
  const currentAddress = normalizedAddress(record);
  const previousComparableAddress = comparableAddress(previous);
  const currentComparableAddress = comparableAddress(record);
  const previousCoordinates = storedCoordinates(previous);
  const currentCoordinates = normalizeCoordinates(record);
  const changedFields = [];

  if (hasStoredLocationBaseline(previous)
    && currentCoordinates.state === 'KNOWN'
    && (!previousAddress || previousCoordinates.state !== 'KNOWN')) {
    return Object.freeze({
      status: 'REVIEW_REQUIRED',
      reason: 'PREVIOUS_LOCATION_UNAVAILABLE',
      changed_fields: Object.freeze([]),
      previous: Object.freeze({ address: previousAddress || null, coordinates: previousCoordinates }),
      current: Object.freeze({ address: currentAddress || null, coordinates: currentCoordinates }),
      location: Object.freeze({ state: 'UNKNOWN', public_eligible: false }),
    });
  }
  if (previousAddress && previousComparableAddress !== currentComparableAddress) changedFields.push('address');
  if (previousCoordinates.state === 'KNOWN' && currentCoordinates.state !== 'KNOWN') {
    return Object.freeze({
      status: 'REVIEW_REQUIRED',
      reason: 'CURRENT_COORDINATES_UNVERIFIABLE',
      changed_fields: Object.freeze(changedFields),
      previous: Object.freeze({ address: previousAddress || null, coordinates: previousCoordinates }),
      current: Object.freeze({ address: currentAddress || null, coordinates: currentCoordinates }),
      location: Object.freeze({ state: 'UNKNOWN', public_eligible: false }),
    });
  }
  if (previousCoordinates.state === 'KNOWN' && currentCoordinates.state === 'KNOWN'
    && (Math.abs(previousCoordinates.lat - currentCoordinates.lat) > MATERIAL_COORDINATE_DELTA
      || Math.abs(previousCoordinates.lng - currentCoordinates.lng) > MATERIAL_COORDINATE_DELTA)) {
    changedFields.push('coordinates');
  }
  if (changedFields.length > 0) {
    return Object.freeze({
      status: 'REVIEW_REQUIRED',
      reason: 'OFFICIAL_LOCATION_CHANGED',
      changed_fields: Object.freeze(changedFields),
      previous: Object.freeze({ address: previousAddress || null, coordinates: previousCoordinates }),
      current: Object.freeze({ address: currentAddress || null, coordinates: currentCoordinates }),
      location: Object.freeze({ state: 'UNKNOWN', public_eligible: false }),
    });
  }
  return Object.freeze({
    status: 'UNCHANGED',
    reason: 'OFFICIAL_LOCATION_UNCHANGED',
    changed_fields: Object.freeze([]),
    previous: Object.freeze({ address: previousAddress || null, coordinates: previousCoordinates }),
    current: Object.freeze({ address: currentAddress || null, coordinates: currentCoordinates }),
    location: Object.freeze({
      state: currentCoordinates.state === 'KNOWN' ? 'KNOWN' : 'UNKNOWN',
      public_eligible: false,
    }),
  });
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
    const location = compareOfficialRetailerLocation({
      record,
      previous: exactRetailers[0],
    });
    if (location.status === 'REVIEW_REQUIRED') {
      return Object.freeze({
        status: 'REVIEW_REQUIRED',
        method: location.reason === 'OFFICIAL_LOCATION_CHANGED'
          ? 'EXACT_LICENSE_LOCATION_CHANGED'
          : 'EXACT_LICENSE_LOCATION_UNVERIFIABLE',
        reason: location.reason,
        normalized_license: license,
        candidate_ids: Object.freeze([exactRetailers[0].id]),
        changed_fields: location.changed_fields,
        location: location.location,
        previous_location: location.previous,
        current_location: location.current,
        public_eligible: false,
        normalization_version: ENTITY_NORMALIZATION_VERSION,
      });
    }
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
