/**
 * PublicMapProjection — the ONLY shape the customer map is allowed to render.
 *
 * Required flow (mission §13, Slice 2):
 *
 *   GeoEntity -> GeoClaim -> Evidence/Freshness/Confidence
 *      -> Policy/Eligibility Gate -> PublicMapProjection -> MapLibre
 *
 * Laws enforced here:
 *  1. A marker never means "row exists therefore fact is true". Every field
 *     beyond bare location carries an explicit evidence state.
 *  2. Absence of an eligible claim renders as UNKNOWN — never as a guess,
 *     never as a default like "Open now".
 *  3. The rendering layer receives finished data. No Prisma, no SQL, no
 *     policy decisions inside React components.
 *
 * The projection is deliberately a plain-JSON shape so it can be serialized
 * to client components, cached, and diffed in tests.
 */

import { isPubliclyVerified } from '../data-status.mjs';

/** Claim types the public surface is allowed to consume (allowlist). */
export const PUBLIC_CLAIM_TYPES = Object.freeze([
  'operating_status',
  'hours',
  'deal_available',
  'partner_status',
  'service_area',
]);

/** Evidence states an eligible public claim may carry. */
const RENDERABLE_VERIFICATIONS = new Set(['VERIFIED', 'SUPPORTED']);

/**
 * Decide what a single claim contributes to the public projection.
 * Returns null when the claim must not be rendered (wrong type, not
 * decision-eligible, unverified, or stale) — the caller then leaves the
 * corresponding field in its UNKNOWN state.
 */
export function projectClaim(claim, asOf = new Date()) {
  if (!claim || !PUBLIC_CLAIM_TYPES.includes(claim.claimType)) return null;
  if (claim.decisionEligible !== true) return null;
  if (!RENDERABLE_VERIFICATIONS.has(claim.verification)) return null;
  if (claim.freshnessExpiresAt && new Date(claim.freshnessExpiresAt) <= asOf) return null;
  return {
    type: claim.claimType,
    value: claim.claimValue,
    verification: claim.verification,
    observedAt: claim.observedAt ?? null,
    source: claim.source,
    confidence: typeof claim.confidence === 'number' ? claim.confidence : null,
  };
}

/**
 * Build the projection for one retailer + its geo entity + its claims.
 *
 * `retailer` must already have passed the directory truth constraints
 * (directoryRetailerWhere) — this function adds the geographic and
 * claim-level gates on top, it does not replace the retailer-level ones.
 */
export function projectRetailerMarker({ retailer, geoEntity = null, claims = [], asOf = new Date() }) {
  if (!retailer) throw new Error('retailer is required');

  // Coordinates: prefer the canonical geo entity; fall back to the legacy
  // retailer floats during the transition window. Track which one was used
  // so observability can measure canonicalization progress.
  // Once a canonical geo entity exists, it owns the coordinate truth. Invalid
  // or missing canonical coordinates must make the entity unmappable rather
  // than silently falling back to legacy retailer floats while claiming the
  // canonical source.
  const lat = geoEntity ? geoEntity.lat : retailer.lat;
  const lng = geoEntity ? geoEntity.lng : retailer.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return null; // unmappable — the entity is simply absent from the map
  }

  const projectedClaims =
    /** @type {Record<string, NonNullable<ReturnType<typeof projectClaim>>>} */ ({});
  for (const claim of claims) {
    const projected = projectClaim(claim, asOf);
    if (!projected) continue;
    // First eligible claim per type wins; callers pass claims ordered
    // strongest-first (findEligibleClaims orders VERIFIED before SUPPORTED).
    if (!projectedClaims[projected.type]) projectedClaims[projected.type] = projected;
  }

  return {
    // Canonical CANA identity when it exists; retailer id as the join key.
    canaLocationId: geoEntity?.id ?? null,
    retailerId: retailer.id,
    name: retailer.name,
    type: retailer.type,
    lat,
    lng,
    h3R9: geoEntity?.h3R9 ?? null,
    coordinateSource: geoEntity
      ? /** @type {const} */ ('geo_entity')
      : /** @type {const} */ ('legacy_retailer'),
    coordinateVerification: geoEntity?.verification ?? 'UNKNOWN',

    // Retailer-level truth badge, derived from the existing Ω⁶-style fields.
    publiclyVerified: isPubliclyVerified(retailer, asOf),
    dataStatus: retailer.dataStatus,

    // Claim-backed facts. A missing key means UNKNOWN — the UI must render
    // an explicit unknown state, never a fabricated default.
    claims: projectedClaims,
  };
}

/**
 * Project a full result set. Unmappable retailers are dropped and counted,
 * never silently coerced onto the map.
 */
export function projectMarkers({ retailers, geoEntitiesByRetailerId = new Map(), claimsByGeoEntityId = new Map(), asOf = new Date() }) {
  const markers = [];
  let unmappable = 0;
  for (const retailer of retailers) {
    const geoEntity = geoEntitiesByRetailerId.get(retailer.id) ?? null;
    const claims = geoEntity ? (claimsByGeoEntityId.get(geoEntity.id) ?? []) : [];
    const marker = projectRetailerMarker({ retailer, geoEntity, claims, asOf });
    if (marker) markers.push(marker);
    else unmappable += 1;
  }
  return {
    markers,
    stats: {
      total: retailers.length,
      mapped: markers.length,
      unmappable,
      canonicalCoordinates: markers.filter((m) => m.coordinateSource === 'geo_entity').length,
    },
    generatedAt: asOf.toISOString(),
  };
}
