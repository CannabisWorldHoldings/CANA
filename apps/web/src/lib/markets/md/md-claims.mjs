// MD MARKET CLAIMS — Maryland Transfer Test #2.
//
// Same laws as va-claims.mjs (claims default UNKNOWN + decision-ineligible;
// versioned identity; license explicitly UNKNOWN because the MCA registry
// page publishes no license numbers). This is the SECOND market-specific
// claim-formation fork — recorded in transfer telemetry as the evidence
// threshold for generalizing claim formation into a market-parametric module
// in a future courted lane.

import { createHash } from 'node:crypto';

export const MD_CLAIMS_SCHEMA_VERSION = 'cana-md-market-claims/v1';
export const MD_ENTITY_NORMALIZATION_VERSION = 'md-mca-identity-v1';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMdEntityIdentity(record) {
  const name = normalizeText(record?.name);
  const street = normalizeText(record?.address?.street);
  const zip = String(record?.address?.zip ?? '').trim();
  if (!name || !street || !/^\d{5}$/.test(zip)) {
    return Object.freeze({
      status: 'MALFORMED',
      normalization_version: MD_ENTITY_NORMALIZATION_VERSION,
    });
  }
  return Object.freeze({
    status: 'NORMALIZED',
    identity_key: `md-mca:${sha256(`${name}|${street}|${zip}`).slice(0, 24)}`,
    normalization_version: MD_ENTITY_NORMALIZATION_VERSION,
    license: Object.freeze({
      state: 'UNKNOWN',
      reason: 'MCA_REGISTRY_PAGE_PUBLISHES_NO_LICENSE_NUMBER',
    }),
  });
}

export function formMdMarketClaims({ statements, sourceId, observedAt } = {}) {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new Error('formMdMarketClaims: statements must be a nonempty array');
  }
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new Error('formMdMarketClaims: sourceId is required');
  }
  const at = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(at.getTime())) {
    throw new Error('formMdMarketClaims: observedAt must be a valid time');
  }
  const claims = [];
  for (const statement of statements) {
    const identity = normalizeMdEntityIdentity(statement);
    if (identity.status !== 'NORMALIZED') continue; // nameless records stay unclaimed — honest
    const base = {
      schema_version: MD_CLAIMS_SCHEMA_VERSION,
      market_id: 'US-MD',
      entity_identity: identity.identity_key,
      normalization_version: identity.normalization_version,
      source_id: sourceId,
      observed_at: at.toISOString(),
      verification: 'UNKNOWN',
      decision_eligible: false,
      statement_provenance: statement.provenance ?? null,
    };
    const predicates = [
      ['mca_registry_listing_exists', 'DISPENSARY'],
      ['facility_name', statement.name],
      ['regulated_address', `${statement.address.street}, ${statement.address.city}, MD ${statement.address.zip}`],
    ];
    if (statement.phone) predicates.push(['phone', statement.phone]);
    if (statement.website) predicates.push(['website', statement.website]);
    for (const [predicate, value] of predicates) {
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
