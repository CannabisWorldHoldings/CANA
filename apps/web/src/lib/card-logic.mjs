// P0.3 card honesty logic — pure, engine-portable, node:test-covered.
// Every card species delegates its truth decisions here so the laws are
// testable without a DOM: one fact chip per merchant card, prices only when
// sourced, deal states never lie about time, zero counts stay honest.

/**
 * Exactly ONE fact chip per merchant card (approved card contract).
 * Priority is truth-first: an explicit evidence state outranks marketing;
 * a verified active deal outranks distance; distance is the quiet default.
 * Returns null when nothing truthful is available — the card renders no chip.
 */
export function selectMerchantFactChip({ evidenceState, activeDealTitle, distanceLabel } = {}) {
  const knownEvidence = typeof evidenceState === 'string' && evidenceState.trim() !== '';
  if (knownEvidence) {
    return { kind: 'evidence', value: evidenceState.trim() };
  }
  if (typeof activeDealTitle === 'string' && activeDealTitle.trim() !== '') {
    return { kind: 'deal', value: activeDealTitle.trim() };
  }
  if (typeof distanceLabel === 'string' && distanceLabel.trim() !== '') {
    return { kind: 'distance', value: distanceLabel.trim() };
  }
  return null;
}

/**
 * Price gate (approved data-dependency law): a product card may show a price
 * ONLY when the price exists, its source retailer is verified, and the menu
 * freshness window is still open. Anything else renders no price — never a
 * placeholder, never a guess.
 */
export function gateProductPrice({ priceCents, sourceVerified, freshnessExpiresAt, now = Date.now() } = {}) {
  const numeric = Number.isFinite(priceCents) && priceCents > 0;
  if (!numeric) return { show: false, reason: 'NO_SOURCED_PRICE' };
  if (sourceVerified !== true) return { show: false, reason: 'SOURCE_UNVERIFIED' };
  const expiry = freshnessExpiresAt ? new Date(freshnessExpiresAt).getTime() : NaN;
  if (!Number.isFinite(expiry) || expiry <= now) {
    return { show: false, reason: 'FRESHNESS_EXPIRED' };
  }
  const dollars = Math.floor(priceCents / 100);
  const cents = String(priceCents % 100).padStart(2, '0');
  return { show: true, label: cents === '00' ? `$${dollars}` : `$${dollars}.${cents}` };
}

/**
 * Deal temporal truth: ACTIVE / EXPIRING_SOON (≤48h) / EXPIRED / INACTIVE.
 * An expired or inactive deal must never render as live inventory, and a
 * countdown can never be negative.
 */
export function dealTemporalState({ isActive, expiresAt, now = Date.now() } = {}) {
  if (isActive !== true) return { state: 'INACTIVE' };
  const expiry = expiresAt ? new Date(expiresAt).getTime() : NaN;
  if (!Number.isFinite(expiry)) return { state: 'ACTIVE', hoursLeft: null };
  const msLeft = expiry - now;
  if (msLeft <= 0) return { state: 'EXPIRED' };
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  if (msLeft <= 48 * 3_600_000) return { state: 'EXPIRING_SOON', hoursLeft };
  return { state: 'ACTIVE', hoursLeft };
}

/**
 * Neighborhood verified-count line — real numbers only. Zero is stated as
 * work in progress, never hidden and never inflated.
 */
export function neighborhoodCountsLine({ verifiedCount } = {}) {
  const count = Number.isInteger(verifiedCount) && verifiedCount >= 0 ? verifiedCount : 0;
  if (count === 0) return 'Verification in progress';
  if (count === 1) return '1 verified option';
  return `${count} verified options`;
}

/**
 * Rail render plan (approved rail contract): a rail below its minimum item
 * count does not render — the page degrades honestly instead of padding
 * itself with filler.
 */
export function railDisplayPlan({ itemCount, minItems = 4 } = {}) {
  const count = Number.isInteger(itemCount) && itemCount >= 0 ? itemCount : 0;
  const min = Number.isInteger(minItems) && minItems > 0 ? minItems : 1;
  if (count >= min) return { render: true, reason: 'AT_OR_ABOVE_MINIMUM' };
  return { render: false, reason: count === 0 ? 'EMPTY' : 'BELOW_MINIMUM' };
}
