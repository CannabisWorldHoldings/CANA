// VA MARKET CLAIMS — Virginia's claim formation, expressed as parameters
// over the market-parametric claim core (extracted at fork ×2). Laws
// unchanged: claims default UNKNOWN + decision-ineligible; identity is
// versioned name+address; license = explicit UNKNOWN (CCA registry pages
// publish no license numbers). The delivery model stays Virginia-specific.
//
// NOTE: the execution-provenance court reads this file's version literals
// at the pinned commit — they stay defined here.

import { createMarketClaimFormer } from '../market-claims.mjs';

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

const former = createMarketClaimFormer({
  marketId: 'US-VA',
  schemaVersion: VA_CLAIMS_SCHEMA_VERSION,
  normalizationVersion: VA_ENTITY_NORMALIZATION_VERSION,
  identityPrefix: 'va-cca',
  licenseAbsenceReason: 'CCA_REGISTRY_PAGE_PUBLISHES_NO_LICENSE_NUMBER',
  formerName: 'formVaMarketClaims',
  predicatesFor(statement) {
    const actorKind =
      statement.statementType === 'CCA_PROCESSOR_LISTING'
        ? 'PHARMACEUTICAL_PROCESSOR'
        : 'MEDICAL_DISPENSARY';
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
    return predicates;
  },
});

export const normalizeVaEntityIdentity = former.normalizeIdentity;
export const formVaMarketClaims = former.formClaims;

/**
 * Delivery eligibility — the honesty law made executable. Virginia-specific:
 * the Delivery Operator class (§ 4.1-805) exists in statute, but the Board
 * has not set radius rules and no service areas are published. Without
 * verified service-area evidence this ALWAYS returns
 * UNKNOWN_DELIVERY_ELIGIBILITY — never a guess, never a proximity default.
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
