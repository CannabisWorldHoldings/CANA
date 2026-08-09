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

/** D.C. area tokens customers actually type. Tokenization only — see header. */
const LOCATION_LEXICON = [
  'adams morgan', 'anacostia', 'brookland', 'capitol hill', 'columbia heights',
  'dupont circle', 'dupont', 'foggy bottom', 'georgetown', 'h street', 'logan circle',
  'navy yard', 'noma', 'petworth', 'shaw', 'takoma', 'u street', 'woodley park',
  'downtown', 'chinatown', 'ivy city', 'mount pleasant', 'brightwood', 'deanwood',
];

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
 * @param {{ now?: Date }} [options]
 */
export function compileIntent(rawQuery, { now = new Date() } = {}) {
  const raw = typeof rawQuery === 'string' ? rawQuery : '';
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);

  // location — longest matching token wins (so "dupont circle" beats "dupont").
  let location = UNKNOWN;
  for (const token of [...LOCATION_LEXICON].sort((a, b) => b.length - a.length)) {
    if (findToken(normalized, token)) {
      location = known(token === 'dupont' ? 'dupont circle' : token, token);
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
