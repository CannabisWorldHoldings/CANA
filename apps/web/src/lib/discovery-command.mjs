/**
 * TRANSPLANT T4 (THE BETTER SEARCH): from the forge @ ba5a43a (27/27 there).
 *
 * Universal Discovery Command — natural-language intent compiled into the
 * structured, editable controls of the focused discovery launcher.
 *
 * Owner-approved mechanism (FOCUSED_DISCOVERY_MODE_APPROVED): one command
 * layer with category / business-type / location / radius / time / price as
 * visible chips. This compiler EXCEEDS the reference by filling the chips
 * from plain language — deterministically, LEVEL 0, zero model calls.
 *
 * Laws:
 * 1. NEVER HALLUCINATE: unrecognized words remain free-text query. No
 *    constraint is invented; every inference is listed in `assumptions`.
 * 2. CHIPS STAY EDITABLE: the compiler proposes, the customer disposes —
 *    every chip carries editable: true for the UI contract.
 * 3. VERIFIED TRUTH IS THE DEFAULT LENS: verified_only = true, surfaced as
 *    an explicit assumption, never a hidden filter.
 * 4. TIME IS REAL: "tonight"/"open now" resolve against the provided clock
 *    to concrete windows; no vague freshness.
 * 5. REMOVAL IS HONEST (owner-courted, MM-004 repair): every chip compiled
 *    from the customer's words carries `removal_sources` — the exact token
 *    patterns that put it there — so dismissing a chip edits the customer's
 *    own words and recompiles, instead of mutating hidden state. Chips that
 *    represent DEFAULTS (market-default location) carry removal_sources:
 *    null — a default is not the customer's constraint; nothing to remove.
 *    Owner pixels O1/O3/O8 (dev-v4 launcher): constraint chips live in the
 *    bar, icon-carrying, stateful. We match the mechanism and exceed it:
 *    theirs are hand-picked; ours are language-compiled AND removable.
 */

export const DISCOVERY_CATEGORIES = Object.freeze([
  'flower', 'edibles', 'vapes', 'concentrates', 'prerolls',
  'tinctures', 'clones', 'seeds', 'merchandise',
]);

const CATEGORY_SYNONYMS = Object.freeze({
  flower: ['flower', 'bud', 'eighth', 'eighths'],
  edibles: ['edibles', 'edible', 'gummies', 'gummy', 'chocolates'],
  vapes: ['vapes', 'vape', 'cart', 'carts', 'cartridge', 'cartridges'],
  concentrates: ['concentrates', 'concentrate', 'badder', 'rosin', 'wax', 'dabs'],
  prerolls: ['prerolls', 'preroll', 'pre-rolls', 'pre-roll', 'joints', 'joint'],
  tinctures: ['tinctures', 'tincture'],
  clones: ['clones', 'clone'],
  seeds: ['seeds', 'seed'],
  merchandise: ['merchandise', 'merch'],
});

const BUSINESS_TYPES = Object.freeze({
  delivery: ['delivery', 'delivered', 'deliver', 'delivering'],
  dispensary: ['dispensary', 'dispensaries', 'storefront', 'storefronts', 'store', 'stores', 'shop', 'shops'],
});

// Real D.C. neighborhoods (subset of the market graph; extend from data, never invent)
const NEIGHBORHOODS = Object.freeze({
  'navy yard': 'Navy Yard',
  'dupont': 'Dupont Circle',
  'dupont circle': 'Dupont Circle',
  'georgetown': 'Georgetown',
  'adams morgan': 'Adams Morgan',
  'shaw': 'Shaw',
  'capitol hill': 'Capitol Hill',
  'anacostia': 'Anacostia',
  'petworth': 'Petworth',
  'columbia heights': 'Columbia Heights',
  'u street': 'U Street',
  'h street': 'H Street',
  'eckington': 'Eckington',
  'park view': 'Park View',
  'brightwood': 'Brightwood',
  'mount pleasant': 'Mount Pleasant',
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findCategory(lower) {
  for (const [category, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
    for (const s of synonyms) {
      if (new RegExp(`\\b${s}\\b`).test(lower)) return { category, matched: s };
    }
  }
  return null;
}

function findBusinessType(lower) {
  for (const [type, synonyms] of Object.entries(BUSINESS_TYPES)) {
    for (const s of synonyms) {
      if (new RegExp(`\\b${s}\\b`).test(lower)) return { type, matched: s };
    }
  }
  return null;
}

function findNeighborhood(lower) {
  // longest-name-first so "dupont circle" wins over "dupont"
  const keys = Object.keys(NEIGHBORHOODS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return { name: NEIGHBORHOODS[key], matched: key };
  }
  return null;
}

function endOfTonight(now) {
  const d = new Date(now);
  const end = new Date(d);
  end.setHours(28, 0, 0, 0); // 4am next day, local-to-clock semantics
  return end.toISOString();
}

export function compileDiscoveryCommand(text, { now }) {
  if (typeof text !== 'string') throw new TypeError('command text required');
  if (!now || Number.isNaN(Date.parse(now))) throw new TypeError('now clock required');

  const assumptions = [];
  let remaining = ` ${text.toLowerCase().trim()} `;
  const consume = (matched) => {
    remaining = remaining.replace(new RegExp(`\\b${matched}\\b`, 'g'), ' ');
  };

  // category
  const cat = findCategory(remaining);
  if (cat) { consume(cat.matched); }

  // business type
  const biz = findBusinessType(remaining);
  if (biz) { consume(biz.matched); }

  // deals intent
  let wantsDeals = false;
  if (/\bdeals?\b/.test(remaining)) {
    wantsDeals = true;
    remaining = remaining.replace(/\bdeals?\b/g, ' ');
    remaining = remaining.replace(/\b(best|current)\b/g, ' ');
  }

  // price cap: "under $50" / "under 50"
  let priceCap = null;
  const price = remaining.match(/\bunder\s*\$?\s*(\d{1,4})\b/);
  if (price) {
    priceCap = Number(price[1]);
    remaining = remaining.replace(price[0], ' ');
    assumptions.push(`price cap $${priceCap} applies to listed prices, checked against verified records`);
  }

  // radius: "within 10 miles"
  let radiusMiles = null;
  const radius = remaining.match(/\bwithin\s+(\d{1,3})\s*(?:miles|mile|mi)\b/);
  if (radius) {
    radiusMiles = Number(radius[1]);
    remaining = remaining.replace(radius[0], ' ');
  }

  // location
  let location = { kind: 'MARKET_DEFAULT', name: 'Washington, D.C.' };
  let locationSrc = null; // null = default, not the customer's constraint (law 5)
  if (/\bnear\s+me\b|\bnearby\b|\baround\s+me\b/.test(remaining)) {
    location = { kind: 'CURRENT_LOCATION', name: 'your location' };
    locationSrc = ['\\bnear\\s+me\\b', '\\bnearby\\b', '\\baround\\s+me\\b'];
    remaining = remaining.replace(/\bnear\s+me\b|\bnearby\b|\baround\s+me\b/g, ' ');
    assumptions.push('current location used only with your permission at query time');
  } else {
    const hood = findNeighborhood(remaining);
    if (hood) {
      location = { kind: 'NEIGHBORHOOD', name: hood.name };
      locationSrc = [
        `\\b(near|around|in|of|by)\\s+${escapeRegex(hood.matched)}\\b`,
        escapeRegex(hood.matched),
      ];
      remaining = remaining.replace(new RegExp(hood.matched, 'g'), ' ');
      remaining = remaining.replace(/\b(near|around|in|of|by)\b/g, ' ');
      assumptions.push(`"${hood.matched}" resolved to the ${hood.name} neighborhood graph`);
    }
  }

  // time
  let time = { kind: 'ANYTIME' };
  if (/\btonight\b/.test(remaining)) {
    time = { kind: 'TONIGHT', until: endOfTonight(now) };
    remaining = remaining.replace(/\btonight\b/g, ' ');
    assumptions.push('tonight resolves to open/delivering before 4am against verified hours');
  } else if (/\bopen\s+now\b|\bopen\b|\bnow\b/.test(remaining)) {
    time = { kind: 'OPEN_NOW', at: new Date(now).toISOString() };
    remaining = remaining.replace(/\bopen\s+now\b|\bopen\b|\bnow\b/g, ' ');
    assumptions.push('open-now checked against verified hours, never assumed');
  }

  // stopwords out; what's left is honest free text
  remaining = remaining.replace(/\b(show|me|find|get|the|a|an|for|with|to|please)\b/g, ' ');
  const queryText = remaining.replace(/\s+/g, ' ').trim();
  if (queryText.length > 0) {
    assumptions.push(`"${queryText}" kept as free-text search — no constraint invented for unrecognized terms`);
  }

  assumptions.push('results limited to licensed merchants with verified records (verified_only default)');

  const chips = [];
  if (cat) chips.push({ kind: 'CATEGORY', label: cat.category, editable: true, removal_sources: [`\\b${escapeRegex(cat.matched)}\\b`] });
  if (biz) chips.push({ kind: 'BUSINESS_TYPE', label: biz.type, editable: true, removal_sources: [`\\b${escapeRegex(biz.matched)}\\b`] });
  if (wantsDeals) chips.push({ kind: 'DEALS', label: 'deals', editable: true, removal_sources: ['\\bdeals?\\b', '\\b(best|current)\\b'] });
  chips.push({ kind: 'LOCATION', label: location.name, editable: true, removal_sources: locationSrc });
  if (radiusMiles) chips.push({ kind: 'RADIUS', label: `${radiusMiles} mi`, editable: true, removal_sources: [escapeRegex(radius[0].trim())] });
  if (time.kind !== 'ANYTIME') chips.push({ kind: 'TIME', label: time.kind === 'TONIGHT' ? 'tonight' : 'open now', editable: true, removal_sources: time.kind === 'TONIGHT' ? ['\\btonight\\b'] : ['\\bopen\\s+now\\b', '\\bopen\\b', '\\bnow\\b'] });
  if (priceCap) chips.push({ kind: 'PRICE', label: `under $${priceCap}`, editable: true, removal_sources: [escapeRegex(price[0].trim())] });
  if (queryText.length > 0) chips.push({ kind: 'QUERY', label: queryText, editable: true, removal_sources: queryText.split(' ').map((w) => `\\b${escapeRegex(w)}\\b`) });

  return Object.freeze({
    category: cat ? cat.category : null,
    business_type: biz ? biz.type : null,
    wants_deals: wantsDeals,
    location,
    radius_miles: radiusMiles,
    time,
    price_cap: priceCap,
    verified_only: true,
    query_text: queryText,
    chips,
    assumptions,
  });
}

/**
 * Dismissing a chip edits the customer's own words — law 5. Applies the
 * chip's removal_sources (case-insensitive) to the raw command text and
 * collapses whitespace; the caller recompiles the result. Deterministic,
 * pure, LEVEL 0. Chips with removal_sources: null represent defaults, not
 * customer constraints — the text is returned unchanged.
 */
export function removeChipFromCommand(text, chip) {
  if (typeof text !== 'string') throw new TypeError('command text required');
  if (!chip || !Array.isArray(chip.removal_sources)) return text;
  let out = ` ${text} `;
  for (const src of chip.removal_sources) {
    out = out.replace(new RegExp(src, 'gi'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}
