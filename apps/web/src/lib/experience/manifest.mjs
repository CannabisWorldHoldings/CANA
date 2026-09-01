// EXPERIENCE MANIFEST — the presentation half of a customer route, expressed as typed
// state the Experience Fabric kernel can mutate, court, and roll back.
//
// WHY THIS EXISTS
// Before this module, a customer route's presentation composition — its copy, its asset
// bindings, its module order — lived as `const` literals inside customer-world-page.tsx.
// Changing which rail came first, or how a journey described itself, meant editing JSX
// and shipping code. There was no court, no content address, and no rollback: the kernel
// that exists to govern exactly that class of change
// (tools/experience-fabric/kernel.mjs) had ZERO consumers in the application.
//
// THE SPLIT THIS FILE ENFORCES
//   CustomerWorld      owns DATA         — merchants, evidence, freshness, map state.
//   ExperienceManifest owns PRESENTATION — copy, assets, module order, density.
// The manifest never restates a fact. It decides how facts are arranged.
//
// KERNEL COMPATIBILITY
// The manifest IS a kernel state object. Its protected blocks (`merchant`, `inventory`,
// `fulfillment`, `contract`, `economics`) exist so the kernel's BRAND, DATA-TRUTH,
// ACCESSIBILITY and ECONOMIC-TRUTH oracles have something real to guard. Only
// `presentation.*` is a legal write surface for a presentation patch; the kernel refuses
// everything else by default-deny, so that guarantee is enforced, not documented.

/** @typedef {'HOME'|'SEARCH'|'DELIVERY'|'DISPENSARIES'} Journey */

/** The write surface a presentation patch may declare. Nothing else is legal. */
export const PRESENTATION_WRITE_SET = Object.freeze(['presentation.*']);

const A11Y_CONTRACT = Object.freeze({
  landmarkOrder: Object.freeze(['banner', 'main', 'contentinfo']),
  headingLevels: Object.freeze({ hero: 1, module: 2, card: 3 }),
  reducedMotionRespected: true,
});

/**
 * Journey copy, lifted verbatim from customer-world-page.tsx. Extracting it UNCHANGED is
 * deliberate: this change moves the seam, it does not restyle the product. Every copy
 * change after this point is a courted mutation with a content address — which is the
 * entire point of moving it.
 */
export const JOURNEY_COPY = Object.freeze({
  HOME: Object.freeze({
    eyebrow: 'Local discovery',
    title: 'Cannabis discovery without the guesswork.',
    description:
      'Find dispensaries, delivery, and current deals — every result backed by a named source, every unknown labeled honestly.',
    action: '/search',
    placeholder: 'City or neighborhood',
  }),
  SEARCH: Object.freeze({
    eyebrow: 'Search',
    title: 'Search verified cannabis businesses.',
    description:
      'Ask in your own words. Results come only from current, verified records — sources and freshness included.',
    action: '/search',
    placeholder: 'City, neighborhood, or what you are looking for',
  }),
  DELIVERY: Object.freeze({
    eyebrow: 'Delivery',
    title: 'See who actually delivers to you.',
    description:
      "A verified business record doesn't prove delivery range, fees, minimums, stock, or timing. We show what's verified and label the rest unknown.",
    action: '/delivery',
    placeholder: 'City or neighborhood for delivery',
  }),
  DISPENSARIES: Object.freeze({
    eyebrow: 'Dispensaries',
    title: 'Find licensed dispensaries near you.',
    description:
      'Every result carries its source and when it was last checked. Hours, stock, and popularity stay unknown until proven.',
    action: '/dispensaries',
    placeholder: 'City or neighborhood for dispensaries',
  }),
});

const CANONICAL_HOME_COPY = Object.freeze({
  eyebrow: 'Ask ORDERWEEDDC',
  title: 'What are you\nlooking for?',
  description:
    "Describe what you need in ordinary words. We check the verified D.C. market and show what's known — and exactly what isn't.",
  action: '/search',
  placeholder: 'Ask ORDERWEEDDC…',
});

/** Asset registry KEYS, not URLs — the asset registry stays the owner of resolution. */
export const DEFAULT_ASSETS = Object.freeze({
  hero: 'marketplace.hero.v2',
  storefront: 'marketplace.retailer.1',
  delivery: 'home.delivery',
  dc: 'home.dc',
});

/**
 * Build the manifest for a journey.
 *
 * Pure: no I/O, no clock, no Prisma. That purity is what makes the content address
 * stable — an address that moved with wall-clock time would make rollback unverifiable,
 * because the same state would hash differently on every render.
 */
export function buildManifest({ tenant, journey }) {
  const copy = journey === 'HOME' && tenant === 'orderweeddc.localhost'
    ? CANONICAL_HOME_COPY
    : JOURNEY_COPY[journey];
  if (!copy) throw new Error(`MANIFEST_UNKNOWN_JOURNEY: no copy registered for "${journey}"`);
  if (typeof tenant !== 'string' || tenant.trim() === '') {
    throw new Error('MANIFEST_TENANT_REQUIRED: presentation state is tenant-scoped');
  }
  return {
    manifestVersion: 1,
    // Tenant lives under `merchant.identity` deliberately. That exact path is in the
    // kernel's PROTECTED_PATHS, so tenant reassignment is refused by the kernel's own
    // path list — not merely by this module's fixed write set. Defence in depth: if a
    // future caller ever widens the write surface, cross-tenant rewriting still fails.
    merchant: { identity: { tenant }, journey },
    inventory: null,
    fulfillment: { verified_availability: null },
    contract: {
      accessibility: {
        landmarkOrder: [...A11Y_CONTRACT.landmarkOrder],
        headingLevels: { ...A11Y_CONTRACT.headingLevels },
        reducedMotionRespected: true,
      },
    },
    economics: { state: 'UNKNOWN' },
    presentation: {
      journey,
      copy: { ...copy },
      assets: { ...DEFAULT_ASSETS },
      moduleOrder: [],
      density: 'comfortable',
    },
  };
}

/**
 * Structural validation.
 *
 * Strict about the one failure that would let this abstraction rot back into hardcoded
 * JSX: a manifest missing its presentation block would make the renderer fall back to
 * defaults, and the seam would quietly stop being load-bearing while still appearing
 * connected. A silent fallback is how a connected architecture becomes decorative.
 */
export function assertManifest(m) {
  const bad = (why) => { throw new Error(`MANIFEST_INVALID: ${why}`); };
  if (!m || typeof m !== 'object') bad('not an object');
  if (m.manifestVersion !== 1) bad('manifestVersion must be 1');
  if (!m.presentation) bad('presentation block absent');
  const p = m.presentation;
  if (!p.copy || typeof p.copy.title !== 'string' || p.copy.title.length === 0) bad('presentation.copy.title absent');
  if (typeof p.copy.eyebrow !== 'string' || typeof p.copy.description !== 'string') bad('presentation.copy incomplete');
  if (!p.assets || typeof p.assets.hero !== 'string') bad('presentation.assets.hero absent');
  if (!Array.isArray(p.moduleOrder)) bad('presentation.moduleOrder must be an array');
  if (p.density !== 'comfortable' && p.density !== 'compact') bad('presentation.density invalid');
  if (!m.contract || !m.contract.accessibility) bad('accessibility contract absent');
  if (!m.economics || m.economics.state !== 'UNKNOWN') bad('economics must remain UNKNOWN until measured');
  if (m.promotion !== undefined && m.promotion !== null) {
    if (typeof m.promotion.receiptDigest !== 'string' || m.promotion.receiptDigest.length === 0) {
      bad('promotion.receiptDigest absent');
    }
    if (typeof m.promotion.candidateDigest !== 'string' || m.promotion.candidateDigest.length === 0) {
      bad('promotion.candidateDigest absent');
    }
    if (typeof m.promotion.manifestAfterDigest !== 'string' || m.promotion.manifestAfterDigest.length === 0) {
      bad('promotion.manifestAfterDigest absent');
    }
    if (typeof m.promotion.evidenceRealm !== 'string' || m.promotion.evidenceRealm.length === 0) {
      bad('promotion.evidenceRealm absent');
    }
  }
  return true;
}

/**
 * Apply a manifest's module order to whatever the data layer produced.
 *
 * Modules the order does not mention keep their original relative position AFTER the
 * ordered ones, so an incomplete order degrades to a partial reordering rather than
 * dropping content. Silently losing a module would be a truth failure wearing a layout
 * costume — the customer would simply never learn that something existed.
 */
export function applyModuleOrder(modules, order) {
  const list = Array.isArray(modules) ? [...modules] : [];
  if (!Array.isArray(order) || order.length === 0) return list;
  const rank = new Map(order.map((k, i) => [k, i]));
  const ranked = [];
  const rest = [];
  for (const m of list) (rank.has(m && m.kind) ? ranked : rest).push(m);
  ranked.sort((a, b) => rank.get(a.kind) - rank.get(b.kind));
  return [...ranked, ...rest];
}

/**
 * Resolve the presentation a component should render.
 *
 * Callers pass the manifest when they have one and omit it otherwise. The fallback is
 * an explicitly built manifest rather than a scattering of `??` defaults, so there is
 * exactly one place presentation can come from even during incremental adoption.
 */
export function presentationFor(manifest, { tenant, journey }) {
  if (manifest) {
    assertManifest(manifest);
    if (manifest.merchant?.identity?.tenant !== tenant) {
      throw new Error('MANIFEST_TENANT_MISMATCH');
    }
    if (manifest.merchant?.journey !== journey || manifest.presentation?.journey !== journey) {
      throw new Error('MANIFEST_JOURNEY_MISMATCH');
    }
    return manifest.presentation;
  }
  return buildManifest({ tenant, journey }).presentation;
}
