/**
 * TRANSPLANT T5 (MERCHANT FOLD): from the forge merchant-intake.mjs @ 3853361
 * (14/14 there). FOLDED, not copied: registerBusiness is intentionally NOT
 * transplanted — CANA's merchant-mutations/merchant-validation own
 * registration and profile mutation. What lands is what CANA lacks: the
 * rights-bound media pipeline and the clean-creative deal composer.
 *
 * Merchant Media Intake + Deal Composer — the business side's contracts.
 * (Owner directive 2026-08-09: the business console's spine, coordinated
 * with pricing, feeding the market window.)
 *
 * Laws:
 * 1. LICENSE FIRST (enforced at the HOST's registration seam —
 *    merchant-mutations/merchant-validation): nothing publishes before the
 *    platform verifies the license (the MM-008 auditable datum is born there).
 * 2. CLEAN_CREATIVE_LAW (owner, from operating experience): deal/offer
 *    language NEVER lives inside imagery — no prices, discounts, percent-off,
 *    promo codes, or urgency text baked into pixels. Offer terms live in the
 *    deal's STRUCTURED FIELDS. Creative flagged with baked deal text is
 *    REJECTED with the named reason BAKED_DEAL_TEXT. Detection is a COURT
 *    verdict recorded on the asset (image_text_court) — this module enforces
 *    the verdict deterministically; it never guesses at pixels itself.
 * 3. MEDIA IS RIGHTS-BOUND: every upload carries asset class, rights
 *    attestation, sha256, and provenance; review states are explicit
 *    (PENDING_REVIEW → APPROVED / REJECTED(reason)). Approved media closes
 *    the merchant's MERCHANT_MEDIA_MISSING gap per class.
 * 4. DEALS ARE STRUCTURED OFFERS: title + product/category + price + validity
 *    + terms text. A deal may attach ONLY approved, clean creative belonging
 *    to the same merchant. Deal prices coordinate with pricing guardrails
 *    (floor_price from the merchant's own pricing lane when supplied) —
 *    a deal below its floor is refused as PRICING_LANE_VIOLATION, never
 *    silently published.
 * 5. NOTHING AUTO-PUBLISHES: composer output is a SUBMISSION for the courts
 *    (creative court, pricing court) — states are explicit, provenance is
 *    complete, and every rejection carries a machine-readable reason.
 *
 * Deterministic, LEVEL 0, injected clock throughout.
 */

export const ASSET_CLASSES = Object.freeze([
  'LOGO', 'WORDMARK', 'BRAND_IMAGE', 'STOREFRONT_PHOTO',
  'PRODUCT_IMAGE', 'CAMPAIGN_CREATIVE',
]);

// per-class intake requirements — floors set at or above the researched
// platform standards (business_side_research.md 2026-08-09: Weedmaps logo
// 800x800, product 1:1 up to 1200; Leafly menu 1:1 1024-1600, deal creative
// 1920x1080; Dutchie product 1600x1600) so ORDERWEEDDC media clears every
// incumbent's bar on arrival.
export const ASSET_REQUIREMENTS = Object.freeze({
  LOGO: { min_w: 800, min_h: 800, alpha_preferred: true },          // Weedmaps-grade
  WORDMARK: { min_w: 600, min_h: 120, alpha_preferred: true },
  BRAND_IMAGE: { min_w: 1200, min_h: 800 },
  STOREFRONT_PHOTO: { min_w: 1200, min_h: 800 },
  PRODUCT_IMAGE: { min_w: 1024, min_h: 1024 },                      // Leafly-grade 1:1
  CAMPAIGN_CREATIVE: { min_w: 1920, min_h: 1080 },                  // Leafly deal-creative grade
});

export const REVIEW_STATES = Object.freeze(['PENDING_REVIEW', 'APPROVED', 'REJECTED']);

const isIso = (t) => typeof t === 'string' && !Number.isNaN(Date.parse(t));

/**
 * Law 2+3 — media upload intake. `upload`:
 * { asset_id, merchant_id, asset_class, sha256, width, height,
 *   rights_attestation: { holder, granted_at, scope },
 *   image_text_court?: { verdict: 'CLEAN'|'BAKED_DEAL_TEXT'|'TEXT_PRESENT_NON_OFFER', evidence, decided_at } }
 * The image-text court verdict is produced by the creative court pipeline
 * (OCR + human), recorded on the asset; intake ENFORCES it, never invents it.
 */
export function reviewMediaUpload(upload, { now }) {
  if (!now || !isIso(now)) throw new TypeError('now clock required');
  const reasons = [];
  if (!ASSET_CLASSES.includes(upload?.asset_class)) reasons.push(`UNKNOWN_ASSET_CLASS:${upload?.asset_class}`);
  if (!upload?.sha256 || !/^[a-f0-9]{16,64}$/i.test(upload.sha256)) reasons.push('MISSING_CONTENT_HASH');
  if (!upload?.rights_attestation?.holder || !isIso(upload?.rights_attestation?.granted_at)) reasons.push('MISSING_RIGHTS_ATTESTATION');
  const req = ASSET_REQUIREMENTS[upload?.asset_class];
  if (req && (upload.width < req.min_w || upload.height < req.min_h)) {
    reasons.push(`BELOW_MINIMUM_DIMENSIONS:${upload.width}x${upload.height}<${req.min_w}x${req.min_h}`);
  }
  if (reasons.length) return Object.freeze({ asset_id: upload?.asset_id, state: 'REJECTED', reasons: Object.freeze(reasons) });

  // law 2: the clean-creative gate on classes that carry product/offer surfaces
  const court = upload.image_text_court;
  const offerSurface = ['PRODUCT_IMAGE', 'CAMPAIGN_CREATIVE', 'BRAND_IMAGE'].includes(upload.asset_class);
  if (offerSurface) {
    if (!court || !court.verdict || !isIso(court.decided_at)) {
      return Object.freeze({
        asset_id: upload.asset_id, state: 'PENDING_REVIEW',
        reasons: Object.freeze(['AWAITING_IMAGE_TEXT_COURT — clean-creative law requires a court verdict before approval (never guessed)']),
      });
    }
    if (court.verdict === 'BAKED_DEAL_TEXT') {
      return Object.freeze({
        asset_id: upload.asset_id, state: 'REJECTED',
        reasons: Object.freeze(['BAKED_DEAL_TEXT — deal/offer language never lives inside imagery (owner CLEAN_CREATIVE_LAW); put terms in the deal\'s structured fields']),
        guidance: 'resubmit the image without prices/discounts/codes/urgency text; the deal composer carries your offer terms',
      });
    }
  }
  return Object.freeze({
    asset_id: upload.asset_id, state: 'APPROVED', approved_at: now,
    closes_media_gap: upload.asset_class,
    reasons: Object.freeze([]),
  });
}

/**
 * Law 4+5 — the deal composer. `draft`:
 * { merchant_id, title, category|product_ref, price_usd, validity:{start,end},
 *   terms_text, creative_asset? , floor_price_usd? (from the merchant's pricing lane) }
 * `assets`: the merchant's reviewed asset records (by asset_id).
 */
export function composeDeal(draft, assets, { now }) {
  if (!now || !isIso(now)) throw new TypeError('now clock required');
  const reasons = [];
  for (const f of ['merchant_id', 'title', 'price_usd', 'validity', 'terms_text']) {
    if (draft?.[f] === undefined || draft?.[f] === null || draft?.[f] === '') reasons.push(`MISSING_FIELD:${f}`);
  }
  if (!draft?.category && !draft?.product_ref) reasons.push('MISSING_FIELD:category|product_ref');
  if (draft?.validity && (!isIso(draft.validity.start) || !isIso(draft.validity.end) || Date.parse(draft.validity.end) <= Date.parse(draft.validity.start))) {
    reasons.push('INVALID_VALIDITY_WINDOW');
  }
  if (typeof draft?.price_usd === 'number' && draft.price_usd <= 0) reasons.push('INVALID_PRICE');

  // law 2 enforcement inside the composer: offer language belongs HERE, so a
  // creative attachment must be an APPROVED asset of this merchant with a
  // CLEAN court verdict — anything else is refused by name.
  if (draft?.creative_asset) {
    const a = (assets ?? []).find((x) => x.asset_id === draft.creative_asset);
    if (!a) reasons.push('CREATIVE_NOT_FOUND');
    else {
      if (a.merchant_id !== draft.merchant_id) reasons.push('CREATIVE_NOT_OWNED_BY_MERCHANT');
      if (a.state !== 'APPROVED') reasons.push(`CREATIVE_NOT_APPROVED:${a.state}`);
      if (a.image_text_court?.verdict === 'BAKED_DEAL_TEXT') reasons.push('BAKED_DEAL_TEXT');
    }
  }

  // law 4: pricing-lane coordination — a deal never undercuts the merchant's
  // own floor silently. (floor comes from the pricing engine when wired;
  // absent floor = no check, honestly noted.)
  const notes = [];
  // below-cost guardrail (Dutchie precedent: no below-cost discounts) —
  // cost basis supplied by the merchant's own books/pricing engine when known
  if (typeof draft?.cost_basis_usd === 'number' && typeof draft?.price_usd === 'number' && draft.price_usd < draft.cost_basis_usd) {
    reasons.push(`PRICING_LANE_VIOLATION:price ${draft.price_usd} below cost basis ${draft.cost_basis_usd} (below-cost deals refused)`);
  }
  if (typeof draft?.floor_price_usd === 'number') {
    if (typeof draft.price_usd === 'number' && draft.price_usd < draft.floor_price_usd) {
      reasons.push(`PRICING_LANE_VIOLATION:price ${draft.price_usd} below floor ${draft.floor_price_usd}`);
    } else {
      notes.push(`pricing lane respected: ${draft.price_usd} >= floor ${draft.floor_price_usd}`);
    }
  } else {
    notes.push('no pricing-lane floor supplied — lane check skipped, noted honestly (wire the pricing engine to enforce)');
  }

  if (reasons.length) return Object.freeze({ status: 'REFUSED', reasons: Object.freeze(reasons) });

  return Object.freeze({
    status: 'SUBMITTED_FOR_COURTS',
    deal: Object.freeze({
      id: `deal-${draft.merchant_id}-${Date.parse(draft.validity.start)}`,
      merchant_id: draft.merchant_id,
      title: draft.title,
      category: draft.category ?? null,
      product_ref: draft.product_ref ?? null,
      price_usd: draft.price_usd,
      validity: draft.validity,
      terms_text: draft.terms_text, // ← the ONLY home for offer language (law 2)
      creative_asset: draft.creative_asset ?? null,
      submitted_at: now,
    }),
    next: Object.freeze(['CREATIVE_COURT (if creative attached)', 'PRICING_COURT', 'then eligible for the market window\'s urgency-ranked deals + campaign compiler placements']),
    notes: Object.freeze(notes),
  });
}
