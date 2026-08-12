// VA MARKET CLAIMS — Virginia Pre-Entry slice 2 (Transfer Test #1).
//
// LAWS (inherited from the D.C. reality doctrine, PRs #35/#36/#37):
//   - Claims default UNKNOWN and are NOT decision-eligible. Promotion to a
//     verified state is the verification court's exclusive work — never this
//     module's. This module FORMS claims from extracted statements; it does
//     not judge them.
//   - Identity is versioned. The CCA registry pages publish NO license
//     numbers, so VA identity v1 is name+locality based and the license
//     field is an explicit UNKNOWN with a reason — never a guessed value.
//   - Delivery is first-class. The model must be able to say: "this operator
//     exists and is licensed, but we do not know whether it may serve this
//     address." UNKNOWN_DELIVERY_ELIGIBILITY is a feature, not a gap.
//
// TRANSFER NOTE (measured, see docs/markets/VIRGINIA_PRE_ENTRY.md): the D.C.
// lane's market-claim-adapter validates lineage against the hardcoded ABCA
// live contract, and entity-resolution is DC-license-format specific. Those
// are generalization boundaries discovered by this transfer test — VA claim
// formation lives here until the core lane grows a market-contract seam.

import { createHash } from 'node:crypto';

export const VA_CLAIMS_SCHEMA_VERSION = 'cana-va-market-claims/v1';
export const VA_ENTITY_NORMALIZATION_VERSION = 'va-cca-identity-v1';

export const VA_MARKET_ACTOR_KINDS = Object.freeze([
  'RETAILER',
  'RETAILER_OPERATED_DELIVERY',
  'LICENSED_INDEPENDENT_DELIVERY_OPERATOR',
  'TRANSPORTER_B2B',
  'MEDICAL_DISPENSARY',
  'PHARMACEUTICAL_PROCESSOR',
]);

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
 * VA identity v1: name + street + zip. The CCA registry pages publish no
 * license identifiers, so the license is an explicit UNKNOWN with a reason.
 */
export function normalizeVaEntityIdentity(record) {
  const name = normalizeText(record?.name);
  const street = normalizeText(record?.address?.street);
  const zip = String(record?.address?.zip ?? '').trim();
  if (!name || !street || !/^\d{5}$/.test(zip)) {
    return Object.freeze({
      status: 'MALFORMED',
      normalization_version: VA_ENTITY_NORMALIZATION_VERSION,
    });
  }
  return Object.freeze({
    status: 'NORMALIZED',
    identity_key: `va-cca:${sha256(`${name}|${street}|${zip}`).slice(0, 24)}`,
    normalization_version: VA_ENTITY_NORMALIZATION_VERSION,
    license: Object.freeze({
      state: 'UNKNOWN',
      reason: 'CCA_REGISTRY_PAGE_PUBLISHES_NO_LICENSE_NUMBER',
    }),
  });
}

/**
 * Form market claims from extracted CCA registry statements.
 * Every claim starts UNKNOWN and decision-ineligible. Verification is the
 * court's work downstream.
 *
 * @param {object} input { statements, sourceId, observedAt }
 * @returns frozen array of claim objects sorted by claim_id.
 */
export function formVaMarketClaims({ statements, sourceId, observedAt } = {}) {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new Error('formVaMarketClaims: statements must be a nonempty array');
  }
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new Error('formVaMarketClaims: sourceId is required');
  }
  const at = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(at.getTime())) {
    throw new Error('formVaMarketClaims: observedAt must be a valid time');
  }

  const claims = [];
  for (const statement of statements) {
    const identity = normalizeVaEntityIdentity(statement);
    if (identity.status !== 'NORMALIZED') continue;

    const actorKind =
      statement.statementType === 'CCA_PROCESSOR_LISTING'
        ? 'PHARMACEUTICAL_PROCESSOR'
        : 'MEDICAL_DISPENSARY';

    const base = {
      schema_version: VA_CLAIMS_SCHEMA_VERSION,
      market_id: 'US-VA',
      entity_identity: identity.identity_key,
      normalization_version: identity.normalization_version,
      source_id: sourceId,
      observed_at: at.toISOString(),
      verification: 'UNKNOWN',
      decision_eligible: false,
      statement_provenance: statement.provenance ?? null,
    };

    const predicates = [
      ['cca_registry_listing_exists', actorKind],
      ['name', statement.name ?? statement.operator?.name],
    ];
    if (statement.address) {
      predicates.push([
        'address',
        `${statement.address.street}, ${statement.address.city}, VA ${statement.address.zip}`,
      ]);
    }
    if (statement.phone) predicates.push(['phone', statement.phone]);
    if (statement.website ?? statement.operator?.website) {
      predicates.push(['website', statement.website ?? statement.operator?.website]);
    }
    if (statement.healthServiceArea) {
      predicates.push(['health_service_area', statement.healthServiceArea]);
    }
    if (statement.statusText) predicates.push(['regulator_status_text', statement.statusText]);

    for (const [predicate, value] of predicates) {
      if (value === undefined || value === null || value === '') continue;
      claims.push(
        Object.freeze({
          ...base,
          claim_id: `${identity.identity_key}:${predicate}:${sha256(String(value)).slice(0, 12)}`,
          predicate,
          value,
        }),
      );
    }
  }
  return Object.freeze(claims.sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)));
}

/**
 * Delivery eligibility — the honesty law made executable.
 *
 * Virginia's Delivery Operator class (§ 4.1-805) exists in statute, but the
 * Board has not yet set radius rules and no service areas are published.
 * Therefore: without service-area evidence this function ALWAYS returns
 * UNKNOWN_DELIVERY_ELIGIBILITY — it never guesses, never defaults to a
 * radius, never infers from proximity.
 */
export function deliveryEligibility({ operator, customerLocation, serviceAreaEvidence } = {}) {
  if (!operator || typeof operator.entity_identity !== 'string') {
    throw new Error('deliveryEligibility: operator with entity_identity is required');
  }
  if (
    !customerLocation ||
    typeof customerLocation.lat !== 'number' ||
    typeof customerLocation.lng !== 'number'
  ) {
    return Object.freeze({
      state: 'UNKNOWN_DELIVERY_ELIGIBILITY',
      reason: 'CUSTOMER_LOCATION_UNRESOLVED',
      operator: operator.entity_identity,
    });
  }
  if (!Array.isArray(serviceAreaEvidence) || serviceAreaEvidence.length === 0) {
    return Object.freeze({
      state: 'UNKNOWN_DELIVERY_ELIGIBILITY',
      reason: 'NO_SERVICE_AREA_EVIDENCE',
      detail:
        'Operator existence/licensure may be known while service eligibility remains unknown. VA delivery-radius rules are pending CCA rulemaking.',
      operator: operator.entity_identity,
    });
  }
  // Service-area evidence exists: eligibility judgment still requires the
  // evidence to be current and verified — stale or unverified evidence
  // cannot produce a KNOWN answer.
  const usable = serviceAreaEvidence.filter(
    (e) => e && e.verification === 'VERIFIED' && e.geometry_ref && !e.stale,
  );
  if (usable.length === 0) {
    return Object.freeze({
      state: 'UNKNOWN_DELIVERY_ELIGIBILITY',
      reason: 'SERVICE_AREA_EVIDENCE_NOT_VERIFIED_OR_STALE',
      operator: operator.entity_identity,
    });
  }
  // Geometry evaluation (point-in-polygon / H3 membership) is the geo
  // kernel's work, injected by the caller as a resolved membership flag.
  const memberships = usable.map((e) => e.contains_customer_location === true);
  if (memberships.every((m) => m === false)) {
    return Object.freeze({
      state: 'NOT_ELIGIBLE',
      reason: 'VERIFIED_SERVICE_AREAS_EXCLUDE_LOCATION',
      operator: operator.entity_identity,
    });
  }
  if (memberships.some((m) => m === true)) {
    return Object.freeze({
      state: 'ELIGIBLE',
      basis: 'VERIFIED_SERVICE_AREA_CONTAINS_LOCATION',
      operator: operator.entity_identity,
    });
  }
  return Object.freeze({
    state: 'UNKNOWN_DELIVERY_ELIGIBILITY',
    reason: 'SERVICE_AREA_MEMBERSHIP_UNEVALUATED',
    operator: operator.entity_identity,
  });
}
