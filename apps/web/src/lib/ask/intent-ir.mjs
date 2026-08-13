/**
 * ASK ORDERWEEDDC — Intent IR compiler (Track A, Slice 1).
 *
 * Compiles raw customer language into a typed, supportable Intent IR. The
 * compiler is DETERMINISTIC — token/pattern matching only, no model call —
 * so the same query always produces the same IR and the IR can be tested by
 * falsification. A model-backed compiler can later compete as a challenger
 * behind the same output contract.
 *
 * TRUTH LAW: every dimension is either KNOWN (with the matched evidence
 * token) or UNKNOWN. The compiler NEVER guesses. "weed near me" does not
 * invent a neighborhood; "cheap" does not invent a number. Unknown stays
 * unknown, and the answering layer must render unknowns honestly.
 *
 * The lexicons below are tokenization vocabulary, NOT market truth: matching
 * a neighborhood token only means "the customer said these words". Whether
 * verified supply exists there is decided downstream against the evidence-
 * gated store (currentPublicRecordWhere + isPubliclyVerified), never here.
 */

export const IR_VERSION = 1;

export function persistenceSafeIntent(intent) {
  const source = intent && typeof intent === 'object' ? intent : {};
  return {
    ir_version: Number.isInteger(source.ir_version) ? source.ir_version : null,
    compiler: typeof source.compiler === 'string' ? source.compiler : null,
    dimensions:
      source.dimensions && typeof source.dimensions === 'object'
        ? source.dimensions
        : {},
    unknown_dimensions: Array.isArray(source.unknown_dimensions)
      ? source.unknown_dimensions
      : [],
  };
}

/** D.C. area tokens customers actually type. Tokenization only — see header. */
const LOCATION_LEXICON = [
  'adams morgan', 'anacostia', 'brookland', 'capitol hill', 'columbia heights',
  'dupont circle', 'dupont', 'foggy bottom', 'georgetown', 'h street', 'logan circle',
  'navy yard', 'noma', 'petworth', 'shaw', 'takoma', 'u street', 'woodley park',
  'downtown', 'chinatown', 'ivy city', 'mount pleasant', 'brightwood', 'deanwood',
];

// Market-specific tokens are still customer-language vocabulary, not market
// truth. They are bounded to cities published in the canonical official
// registry fixtures for the admitted Maryland and Virginia contracts.
const MARKET_LOCATION_ALIASES = Object.freeze({
  'US-MD': Object.freeze({
    abdereen: 'aberdeen',
    'capital heights': 'capitol heights',
  }),
});

const MARKET_LOCATION_LEXICONS = Object.freeze({
  'US-DC': Object.freeze(LOCATION_LEXICON),
  'US-MD': Object.freeze([
    'aberdeen', 'abdereen', 'abingdon', 'annapolis', 'baltimore', 'bethesda', 'bowie',
    'brandywine', 'burtonsville', 'cambridge', 'camp springs', 'capitol heights', 'capital heights',
    'centreville', 'chevy chase', 'clinton', 'cockeysville', 'columbia', 'crofton',
    'cumberland', 'curtis bay', 'edgewater', 'elkton', 'ellicott city', 'frederick',
    'gaithersburg', 'gambrills', 'germantown', 'greenbelt', 'hagerstown',
    'halethorpe', 'hyattsville', 'joppa', 'laurel', 'linthicum', 'lutherville',
    'mechanicsville', 'middle river', 'new market', 'nottingham', 'ocean city',
    'olney', 'parkville', 'pasadena', 'perryville', 'pikesville', 'reisterstown',
    'rockville', 'salisbury', 'silver spring', 'timonium', 'towson',
    'upper marlboro', 'waldorf', 'westminster', 'white plains', 'windsor mill',
  ]),
  'US-VA': Object.freeze([
    'abingdon', 'alexandria', 'arlington', 'bristol', 'christiansburg',
    'colonial heights', 'danville', 'fairfax', 'glen allen', 'hampton', 'henrico',
    'lynchburg', 'manassas', 'norfolk', 'portsmouth', 'richmond', 'roanoke',
    'sterling', 'suffolk', 'virginia beach', 'williamsburg', 'woodbridge',
  ]),
});

export function canonicalMarketLocation(value, marketId) {
  return MARKET_LOCATION_ALIASES[marketId]?.[value] ?? value;
}

const CATEGORY_LEXICON = [
  { value: 'flower', tokens: ['flower', 'bud', 'eighth', '8th', 'ounce', 'oz'] },
  { value: 'preroll', tokens: ['preroll', 'pre-roll', 'prerolls', 'pre-rolls', 'joint', 'joints', 'blunt', 'blunts'] },
  { value: 'edible', tokens: ['edible', 'edibles', 'gummies', 'gummy', 'chocolate', 'chocolates'] },
  { value: 'vape', tokens: ['vape', 'vapes', 'cart', 'carts', 'cartridge', 'cartridges', 'disposable', 'disposables'] },
  { value: 'concentrate', tokens: ['concentrate', 'concentrates', 'wax', 'dab', 'dabs', 'rosin', 'shatter'] },
  { value: 'cbd', tokens: ['cbd'] },
];

const FULFILLMENT_LEXICON = [
  { value: 'delivery', tokens: ['delivery', 'deliver', 'delivered'] },
  { value: 'pickup', tokens: ['pickup', 'pick up', 'pick-up', 'in store', 'in-store'] },
];

function known(value, matchedToken) {
  return { status: 'KNOWN', value, matched_token: matchedToken };
}

const UNKNOWN = Object.freeze({ status: 'UNKNOWN', value: null, matched_token: null });

/** Word-boundary containment so "shaw" matches "in shaw" but not "rickshaw". */
function findToken(haystack, token) {
  const pattern = new RegExp(`(?:^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i');
  return pattern.test(haystack);
}

/**
 * Compile a raw query into the Intent IR.
 * @param {string} rawQuery
 * @param {{ now?: Date, marketId?: string }} [options]
 */
export function compileIntent(rawQuery, { now = new Date(), marketId = null } = {}) {
  const raw = typeof rawQuery === 'string' ? rawQuery : '';
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);

  // location — longest matching token wins (so "dupont circle" beats "dupont").
  let location = UNKNOWN;
  const locationLexicon = marketId === null
    ? MARKET_LOCATION_LEXICONS['US-DC']
    : MARKET_LOCATION_LEXICONS[marketId] ?? [];
  for (const token of [...locationLexicon].sort((a, b) => b.length - a.length)) {
    if (findToken(normalized, token)) {
      const normalizedToken = token === 'dupont' ? 'dupont circle' : token;
      location = known(canonicalMarketLocation(normalizedToken, marketId), token);
      break;
    }
  }

  let category = UNKNOWN;
  outer: for (const entry of CATEGORY_LEXICON) {
    for (const token of entry.tokens) {
      if (findToken(normalized, token)) {
        category = known(entry.value, token);
        break outer;
      }
    }
  }

  // price ceiling — only when the customer states a NUMBER. "cheap" stays UNKNOWN.
  let priceMaxUsd = UNKNOWN;
  const priceMatch = normalized.match(/(?:under|below|less than|max|up to)\s*\$?\s*(\d{1,4})\b|\$\s*(\d{1,4})\s*(?:or less|max|budget)\b/);
  if (priceMatch) {
    const amount = Number(priceMatch[1] ?? priceMatch[2]);
    if (Number.isFinite(amount) && amount > 0) priceMaxUsd = known(amount, priceMatch[0].trim());
  }

  let fulfillment = UNKNOWN;
  outer: for (const entry of FULFILLMENT_LEXICON) {
    for (const token of entry.tokens) {
      if (findToken(normalized, token)) {
        fulfillment = known(entry.value, token);
        break outer;
      }
    }
  }

  const openNowToken = findToken(normalized, 'open now')
    ? 'open now'
    : findToken(normalized, 'open right now')
      ? 'open right now'
      : null;
  const openNow = openNowToken ? known(true, openNowToken) : UNKNOWN;

  const dimensions = { location, category, price_max_usd: priceMaxUsd, fulfillment, open_now: openNow };
  const unknownDimensions = Object.entries(dimensions)
    .filter(([, dim]) => dim.status === 'UNKNOWN')
    .map(([name]) => name);

  return {
    ir_version: IR_VERSION,
    raw_query: raw.slice(0, 500),
    compiled_at: now.toISOString(),
    compiler: 'deterministic-lexicon-v1',
    dimensions,
    unknown_dimensions: unknownDimensions,
  };
}
