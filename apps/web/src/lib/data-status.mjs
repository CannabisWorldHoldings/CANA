export const DATA_STATUS = Object.freeze({
  DEMONSTRATION_ONLY: 'DEMONSTRATION_ONLY',
  AWAITING_VERIFICATION: 'AWAITING_VERIFICATION',
  VERIFIED_CURRENT: 'VERIFIED_CURRENT',
  STALE: 'STALE',
  DISPUTED: 'DISPUTED',
});

const PRESENTATIONS = Object.freeze({
  DEMONSTRATION_ONLY: {
    label: 'Demonstration only',
    description: 'Synthetic local-development data. It is not a verified business, license, menu, price, or offer.',
    tone: 'demo',
  },
  AWAITING_VERIFICATION: {
    label: 'Awaiting verification',
    description: 'Submitted data has not completed independent review.',
    tone: 'pending',
  },
  VERIFIED_CURRENT: {
    label: 'Verified current',
    description: 'Evidence was reviewed and remains inside its stated freshness window.',
    tone: 'verified',
  },
  STALE: {
    label: 'Stale',
    description: 'The last verification window has expired. Confirm with the primary source.',
    tone: 'stale',
  },
  DISPUTED: {
    label: 'Disputed',
    description: 'A correction or contradiction is awaiting resolution.',
    tone: 'disputed',
  },
});

/**
 * Resolves the public truth state for a record. Demonstration data always wins,
 * even when a legacy field claims that the record is verified.
 *
 * @param {{
 *   dataStatus?: string | null;
 *   isDemonstration?: boolean | null;
 *   verifiedAt?: Date | string | null;
 *   freshnessExpiresAt?: Date | string | null;
 * }} record
 * @param {Date} [asOf]
 */
export function resolveDataStatus(record, asOf = new Date()) {
  if (record.isDemonstration) {
    return DATA_STATUS.DEMONSTRATION_ONLY;
  }

  if (record.dataStatus === DATA_STATUS.DISPUTED) {
    return DATA_STATUS.DISPUTED;
  }

  if (record.dataStatus === DATA_STATUS.VERIFIED_CURRENT) {
    if (!record.verifiedAt || !record.freshnessExpiresAt) {
      return DATA_STATUS.AWAITING_VERIFICATION;
    }

    const verifiedAt = new Date(record.verifiedAt);
    if (Number.isNaN(verifiedAt.getTime()) || verifiedAt > asOf) {
      return DATA_STATUS.AWAITING_VERIFICATION;
    }

    const expiry = new Date(record.freshnessExpiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry <= asOf) {
      return DATA_STATUS.STALE;
    }

    return DATA_STATUS.VERIFIED_CURRENT;
  }

  if (record.dataStatus === DATA_STATUS.STALE) {
    return DATA_STATUS.STALE;
  }

  return DATA_STATUS.AWAITING_VERIFICATION;
}

/**
 * @param {Parameters<typeof resolveDataStatus>[0]} record
 * @param {Date} [asOf]
 */
export function getDataStatusPresentation(record, asOf = new Date()) {
  const status = resolveDataStatus(record, asOf);
  return {
    status,
    ...PRESENTATIONS[status],
  };
}

/**
 * @param {Parameters<typeof resolveDataStatus>[0]} record
 * @param {Date} [asOf]
 */
export function isPubliclyVerified(record, asOf = new Date()) {
  return resolveDataStatus(record, asOf) === DATA_STATUS.VERIFIED_CURRENT;
}
