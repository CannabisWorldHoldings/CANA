// MARKET-PARAMETRIC CLAIM FORMATION — extracted at fork ×2 (VA + MD).
//
// LAWS (unchanged from both forks):
//   - Claims default UNKNOWN and are NOT decision-eligible; only the
//     verification court promotes.
//   - Identity is versioned per market: name + street + zip; a statement
//     without sufficient identity forms NO claims (never invented).
//   - License facts the source does not publish stay explicit UNKNOWN with a
//     market-specific reason.
// Behavior equivalence with the pre-extraction VA/MD modules is proven by
// re-running their UNCHANGED test suites against this core.

import { createHash } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a market's identity normalizer + claim former.
 * @param {object} input
 *   marketId               e.g. 'US-VA'
 *   schemaVersion          claim schema version literal
 *   normalizationVersion   identity version literal
 *   identityPrefix         e.g. 'va-cca'
 *   licenseAbsenceReason   explicit UNKNOWN reason for unpublished licenses
 *   predicatesFor          (statement) => [ [predicate, value], ... ]
 *   formerName             function name used in refusal messages
 */
export function createMarketClaimFormer({
  marketId,
  schemaVersion,
  normalizationVersion,
  identityPrefix,
  licenseAbsenceReason,
  predicatesFor,
  formerName = 'formMarketClaims',
}) {
  if (!marketId || !schemaVersion || !normalizationVersion || !identityPrefix || !licenseAbsenceReason) {
    throw new Error('createMarketClaimFormer: all market parameters are required');
  }
  if (typeof predicatesFor !== 'function') {
    throw new Error('createMarketClaimFormer: predicatesFor function is required');
  }

  function normalizeIdentity(record) {
    const name = normalizeText(record?.name);
    const street = normalizeText(record?.address?.street);
    const zip = String(record?.address?.zip ?? '').trim();
    if (!name || !street || !/^\d{5}$/.test(zip)) {
      return Object.freeze({
        status: 'MALFORMED',
        normalization_version: normalizationVersion,
      });
    }
    return Object.freeze({
      status: 'NORMALIZED',
      identity_key: `${identityPrefix}:${sha256(`${name}|${street}|${zip}`).slice(0, 24)}`,
      normalization_version: normalizationVersion,
      license: Object.freeze({
        state: 'UNKNOWN',
        reason: licenseAbsenceReason,
      }),
    });
  }

  function formClaims({ statements, sourceId, observedAt } = {}) {
    if (!Array.isArray(statements) || statements.length === 0) {
      throw new Error(`${formerName}: statements must be a nonempty array`);
    }
    if (typeof sourceId !== 'string' || sourceId.length === 0) {
      throw new Error(`${formerName}: sourceId is required`);
    }
    const at = observedAt instanceof Date ? observedAt : new Date(observedAt);
    if (Number.isNaN(at.getTime())) {
      throw new Error(`${formerName}: observedAt must be a valid time`);
    }
    const claims = [];
    for (const statement of statements) {
      const identity = normalizeIdentity(statement);
      if (identity.status !== 'NORMALIZED') continue;
      const base = {
        schema_version: schemaVersion,
        market_id: marketId,
        entity_identity: identity.identity_key,
        normalization_version: identity.normalization_version,
        source_id: sourceId,
        observed_at: at.toISOString(),
        verification: 'UNKNOWN',
        decision_eligible: false,
        statement_provenance: statement.provenance ?? null,
      };
      for (const [predicate, value] of predicatesFor(statement)) {
        if (value === undefined || value === null || value === '') continue;
        claims.push(Object.freeze({
          ...base,
          claim_id: `${identity.identity_key}:${predicate}:${sha256(String(value)).slice(0, 12)}`,
          predicate,
          value,
        }));
      }
    }
    return Object.freeze(claims.sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)));
  }

  return Object.freeze({ normalizeIdentity, formClaims });
}
