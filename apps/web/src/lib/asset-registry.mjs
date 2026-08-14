// P0.5 asset registry — every renderable content image on a consumer surface
// must be a registered record (visual-court law A14). The registry is seeded
// from the approved IMAGE_ASSET_MASTER_MANIFEST and reflects ONLY files that
// actually exist in apps/web/public today. Rights and subject truth are part
// of the record: an image that does not depict a specific real business may
// never be presented as if it does.

export const ASSET_KINDS = Object.freeze([
  'TIER1_BRAND',        // our own brand lockups
  'TIER1_BUSINESS',     // real merchant/product photography (rights-attested)
  'TIER2_LOCATION',     // real D.C. location/editorial photography (licensed)
  'TIER3_INFORMATIONAL',// UI renders, data visualizations
  'TIER4_PLATFORM_ART', // platform-owned illustration/campaign art
]);

export const SUBJECT_TRUTH = Object.freeze([
  'REAL_SUBJECT',        // depicts the specific real thing it claims to depict
  'GENERIC_ILLUSTRATIVE',// generic/staged imagery — must NEVER stand in for a specific merchant/product
  'BRAND_MARK',          // our own identity assets
]);

const RECORDS = Object.freeze([
  // --- Brand lockups (platform-owned, cleared) ---
  { id: 'brand.wordmark.light', path: '/brand/orderweeddc-on-light.png', kind: 'TIER1_BRAND', subject: 'BRAND_MARK', rights: 'OWNED', aspect: [900, 187], altGuidance: 'ORDERWEEDDC wordmark', contexts: ['chrome', 'footer', 'og'] },
  { id: 'brand.wordmark.dark', path: '/brand/orderweeddc-on-dark.png', kind: 'TIER1_BRAND', subject: 'BRAND_MARK', rights: 'OWNED', aspect: [900, 187], altGuidance: 'ORDERWEEDDC wordmark', contexts: ['chrome', 'footer', 'og'] },
  { id: 'brand.icon.256', path: '/brand/orderweeddc-icon-256.png', kind: 'TIER1_BRAND', subject: 'BRAND_MARK', rights: 'OWNED', aspect: [1, 1], altGuidance: 'ORDERWEEDDC monogram', contexts: ['chrome', 'og'] },
  { id: 'brand.ribbon.primary', path: '/brand/orderweeddc-ribbon-primary.png', kind: 'TIER1_BRAND', subject: 'BRAND_MARK', rights: 'OWNED', aspect: [1, 1], altGuidance: 'ORDERWEEDDC ribbon mark', contexts: ['campaign', 'og'] },
  { id: 'brand.ribbon.inverse', path: '/brand/orderweeddc-ribbon-inverse.png', kind: 'TIER1_BRAND', subject: 'BRAND_MARK', rights: 'OWNED', aspect: [1, 1], altGuidance: 'ORDERWEEDDC ribbon mark, inverse', contexts: ['campaign', 'og'] },
  { id: 'brand.og.default', path: '/og-default.jpg', kind: 'TIER1_BRAND', subject: 'BRAND_MARK', rights: 'OWNED', aspect: [1.91, 1], altGuidance: 'ORDERWEEDDC — Washington, D.C. cannabis discovery', contexts: ['og'] },

  // --- Existing marketplace imagery (HONEST provenance: these files predate
  //     the asset program and do not depict specific verified merchants or
  //     products. They may illustrate DEMONSTRATION/styleguide/hero-ambience
  //     contexts, and must NEVER be attached to a named real merchant or a
  //     specific product record. Replacement path: the commissioned Tier-1
  //     program in VISUAL_ASSET_PRODUCTION_PLAN.) ---
  { id: 'marketplace.hero.v2', path: '/marketplace/hero-marketplace-v2.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [16, 9], altGuidance: 'Ambient marketplace scene (illustrative, not a specific business)', contexts: ['hero-ambience', 'demonstration', 'styleguide'] },
  { id: 'marketplace.retailer.0', path: '/marketplace/retailer-0.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [4, 5], altGuidance: 'Illustrative retail scene (not a specific business)', contexts: ['demonstration', 'styleguide'] },
  { id: 'marketplace.retailer.1', path: '/marketplace/retailer-1.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [4, 5], altGuidance: 'Illustrative retail scene (not a specific business)', contexts: ['hero-ambience', 'demonstration', 'styleguide'] },
  { id: 'marketplace.retailer.2', path: '/marketplace/retailer-2.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [4, 5], altGuidance: 'Illustrative retail scene (not a specific business)', contexts: ['demonstration', 'styleguide'] },
  { id: 'marketplace.retailer.3', path: '/marketplace/retailer-3.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [4, 5], altGuidance: 'Illustrative retail scene (not a specific business)', contexts: ['demonstration', 'styleguide'] },
  { id: 'marketplace.product.0', path: '/marketplace/product-0.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Illustrative product still (not a specific product)', contexts: ['demonstration', 'styleguide'] },
  { id: 'marketplace.product.1', path: '/marketplace/product-1.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Illustrative product still (not a specific product)', contexts: ['demonstration', 'styleguide'] },
  { id: 'marketplace.product.2', path: '/marketplace/product-2.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Illustrative product still (not a specific product)', contexts: ['demonstration', 'styleguide'] },
  { id: 'marketplace.product.3', path: '/marketplace/product-3.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Illustrative product still (not a specific product)', contexts: ['demonstration', 'styleguide'] },

  // --- Platform-owned customer-home art. These records are category/location
  //     atmosphere only and must never be attached to a named merchant or SKU. ---
  { id: 'home.category.flower', path: '/art/cat-flower.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Flower category illustration', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.category.edibles', path: '/art/cat-edibles.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Edibles category illustration', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.category.vapes', path: '/art/cat-vapes.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Vapes category illustration', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.category.concentrates', path: '/art/cat-concentrates.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Concentrates category illustration', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.category.pre-rolls', path: '/art/cat-pre-rolls.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Pre-rolls category illustration', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.category.topicals', path: '/art/cat-topicals.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Topicals category illustration', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.category.accessories', path: '/art/cat-accessories.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [1, 1], altGuidance: 'Accessories category illustration', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.delivery', path: '/art/retailer-delivery.jpg', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [3, 2], altGuidance: 'Illustrative delivery scene (not a delivery promise)', contexts: ['hero-ambience', 'styleguide'] },
  { id: 'home.dc', path: '/art/hero-dc.webp', kind: 'TIER4_PLATFORM_ART', subject: 'GENERIC_ILLUSTRATIVE', rights: 'OWNED_PROVENANCE_REVIEW_PENDING', aspect: [7, 3], altGuidance: 'Washington, D.C. atmosphere', contexts: ['hero-ambience', 'styleguide'] },
]);

const BY_ID = new Map(RECORDS.map((record) => [record.id, record]));
const BY_PATH = new Map(RECORDS.map((record) => [record.path, record]));

export function listAssets() {
  return RECORDS;
}

export function getAsset(id) {
  return BY_ID.get(id) ?? null;
}

export function getAssetByPath(path) {
  return BY_PATH.get(path) ?? null;
}

/**
 * Court law A14: a consumer-surface image must be registered.
 * Merchant-supplied imagery arrives through its own attested pipeline
 * (T5 media intake) and is exempted via the explicit prefix contract.
 */
const ATTESTED_PREFIXES = Object.freeze(['/uploads/attested/']);

export function assertRegisteredImage(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('image path is required');
  }
  if (BY_PATH.has(path)) return true;
  if (ATTESTED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  throw new Error(`unregistered image on a consumer surface: ${path}`);
}

/** May this asset stand in for a specific real merchant/product? Never, unless REAL_SUBJECT. */
export function mayRepresentRealEntity(id) {
  const record = BY_ID.get(id);
  return record ? record.subject === 'REAL_SUBJECT' : false;
}
