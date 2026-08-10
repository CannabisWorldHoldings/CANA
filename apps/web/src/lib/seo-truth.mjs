function validIndexTime(asOf) {
  const value = asOf ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('SEO index time must be a valid date.');
  }
  return new Date(value);
}

export function currentPublicRecordWhere(asOf = new Date()) {
  const timestamp = validIndexTime(asOf);
  return {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: timestamp },
    freshnessExpiresAt: { gt: timestamp },
  };
}

export function serializeStructuredData(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}
