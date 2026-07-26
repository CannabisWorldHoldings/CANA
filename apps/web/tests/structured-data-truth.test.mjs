import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retailerJsonLd, retailerAnswerJsonLd, structuredDataAssertionReport }
  from '../src/lib/structured-data.mjs';
import { isPubliclyVerified } from '../src/lib/data-status.mjs';
import { serializeStructuredData } from '../src/lib/seo-truth.mjs';

/**
 * CONSOLIDATION NOTE. I first wrote a separate aeo-structured-data.mjs, then found
 * the codebase already had a mature structured-data.mjs whose retailerJsonLd is
 * gated on isPubliclyVerified — my grep for 'ld+json' had missed it because the
 * page emits through a jsonLdScriptProps helper. Shipping a second, competing
 * structured-data path would have been the real defect: two modules asserting
 * about the same records, only one wired to the page, drifting apart silently.
 *
 * So the three things the existing module genuinely LACKED were folded into it —
 * sourced-hours gating, an answer block, and an operator assertion report — and
 * the duplicate was deleted. These tests now attack the real, wired module.
 */

const ORIGIN = 'https://orderweeddc.com';
// Adapters so the attacks below read against the module's real signatures.
const retailerStructuredData = (r, { now } = {}) =>
  isPubliclyVerified(r, now ?? new Date()) ? retailerJsonLd({ retailer: r, origin: ORIGIN }) : null;
const retailerAnswerBlock = (r, { now } = {}) => retailerAnswerJsonLd({ retailer: r, asOf: now });
const assertionReport = (r, now) => structuredDataAssertionReport(r, now);
const disqualifications = (r, now) => structuredDataAssertionReport(r, now).blockers;

/**
 * AEO STRUCTURED DATA — attacks on machine assertions.
 *
 * Structured data is repeated by answer engines to people making real decisions.
 * Emitting an unverified value here is worse than emitting nothing, because it
 * launders a guess into a citation. These tests try to make the module assert
 * something it should not.
 */

const now = new Date('2026-07-26T12:00:00Z');
const future = new Date(now.getTime() + 86400_000);
const past = new Date(now.getTime() - 86400_000);

const R = (o = {}) => ({
  id: 'r1', name: 'Verified Dispensary',
  address: '1 Main St', city: 'Washington', state: 'DC', zip: '20001',
  lat: 38.9072, lng: -77.0369,
  phone: '202-555-0100', website: 'https://example.com',
  hours: 'Mon-Sun 9-9', hoursSource: 'merchant-confirmed',
  licenseStatus: 'VERIFIED', licenseNumber: 'DC-1',
  dataStatus: 'VERIFIED_CURRENT', verifiedAt: past, freshnessExpiresAt: future,
  isDemonstration: false, ...o,
});

// -------------------------------------------------------- A1 demonstration
test('A1: a fully verified record IS asserted', () => {
  const ld = retailerStructuredData(R(), { origin: 'https://orderweeddc.com', now });
  assert.ok(ld !== null);
  // The wired module emits schema.org Store, which is a narrower and more
  // accurate type than LocalBusiness for a retail dispensary.
  assert.equal(ld['@type'], 'Store');
  assert.equal(ld.name, 'Verified Dispensary');
  assert.equal(ld.telephone, '202-555-0100');
});

test('A1: DEMONSTRATION data yields NO structured data at all', () => {
  // Not a partial object, not one with a caveat — answer engines do not read caveats.
  assert.equal(retailerStructuredData(R({ isDemonstration: true }), { now }), null);
  for (const ds of ['DEMONSTRATION_ONLY', 'DEMO', 'synthetic-seed', 'SAMPLE_DATA']) {
    assert.equal(retailerStructuredData(R({ dataStatus: ds }), { now }), null,
      `dataStatus ${ds} must not be asserted`);
  }
});

test('A1: a non-VERIFIED_CURRENT status is never asserted', () => {
  for (const ds of ['AWAITING_VERIFICATION', 'UNVERIFIED', 'STALE', 'VERIFIED', '', 'verified_current']) {
    assert.equal(retailerStructuredData(R({ dataStatus: ds }), { now }), null,
      `dataStatus ${JSON.stringify(ds)} must not be asserted`);
  }
});

test('A1: a record that was never verified is not asserted', () => {
  assert.equal(retailerStructuredData(R({ verifiedAt: null }), { now }), null);
});

// ------------------------------------------------------------- A4 staleness
test('A4: an EXPIRED record is not asserted', () => {
  assert.equal(retailerStructuredData(R({ freshnessExpiresAt: past }), { now }), null);
});

test('A4: a record with no freshness window is not asserted', () => {
  // Staleness cannot be tested, so the assertion cannot be justified.
  assert.equal(retailerStructuredData(R({ freshnessExpiresAt: null }), { now }), null);
});

test('A4: a malformed freshness date is not asserted', () => {
  for (const bad of ['not-a-date', '2026-13-45', NaN]) {
    assert.equal(retailerStructuredData(R({ freshnessExpiresAt: bad }), { now }), null,
      `freshnessExpiresAt ${JSON.stringify(bad)} must not be asserted`);
  }
});

test('A4: expiring exactly now is treated as expired, not current', () => {
  assert.equal(retailerStructuredData(R({ freshnessExpiresAt: now }), { now }), null);
});

// ------------------------------------------------- A2 field-level provenance
test('A2: UNSOURCED hours are withheld even on a verified record', () => {
  // The field most likely to send a person to a locked door.
  const ld = retailerStructuredData(R({ hoursSource: null }), { now });
  assert.ok(ld !== null, 'the record itself is still assertable');
  assert.equal(ld.openingHours, undefined, 'but unsourced hours must not be asserted');
});

test('A2: sourced hours ARE asserted', () => {
  const ld = retailerStructuredData(R(), { now });
  assert.equal(ld.openingHours, 'Mon-Sun 9-9');
});

test('A2: a blank street address does not FABRICATE a location', () => {
  // The defect this caught: with no street address, city and state fell back to
  // 'Washington' / 'DC', so the payload asserted a real place for a retailer whose
  // address nobody recorded. A partial address is worse than none — it looks
  // complete to a machine.
  for (const missing of [{ address: '' }, { address: '   ' }, { address: null }]) {
    const ld = retailerStructuredData(R(missing), { now });
    assert.equal(ld.address, undefined,
      `address must be omitted entirely when street is ${JSON.stringify(missing.address)}`);
  }
  // City/state defaults ARE legitimate once a real street exists: this is a
  // DC-only marketplace, so the locality is a known fact, not a guess.
  const withStreet = retailerStructuredData(R({ city: '', state: '' }), { now });
  assert.equal(withStreet.address.streetAddress, '1 Main St');
  assert.equal(withStreet.address.addressLocality, 'Washington');
});

test('A2: geo is omitted unless BOTH coordinates are real numbers', () => {
  for (const bad of [{ lat: null }, { lng: null }, { lat: '38.9' }, { lng: NaN }, { lat: Infinity }]) {
    const ld = retailerStructuredData(R(bad), { now });
    assert.equal(ld.geo, undefined, `geo must be omitted for ${JSON.stringify(bad)}`);
  }
});

test('A2: a whitespace-only phone is not emitted as a contact', () => {
  // `if (retailer.phone)` treated '   ' as truthy and emitted telephone: '   '.
  const ld = retailerStructuredData(R({ phone: '   ' }), { now });
  assert.equal(ld.telephone, undefined, 'an empty contact field is not a contact');
  assert.equal(retailerStructuredData(R(), { now }).telephone, '202-555-0100');
});

// ----------------------------------------------------------- A3 no invention
test('A3: no rating, price range, or review count is EVER emitted', () => {
  const ld = retailerStructuredData(R(), { now });
  const raw = JSON.stringify(ld);
  for (const forbidden of ['aggregateRating', 'ratingValue', 'reviewCount', 'priceRange',
                           'review', 'bestRating', 'servesCuisine']) {
    assert.ok(!raw.includes(forbidden), `${forbidden} must never be asserted`);
  }
});

test('A3: a rating supplied on the INPUT is not passed through', () => {
  // Defence against a future caller widening the record shape.
  const ld = retailerStructuredData(
    R({ aggregateRating: 5, reviewCount: 900, priceRange: '$$' }), { now });
  const raw = JSON.stringify(ld);
  assert.ok(!/aggregateRating|reviewCount|priceRange/.test(raw),
    'input fields must not leak into the assertion');
});

// ------------------------------------------------------------- answer block
test('answers are omitted entirely for a demonstration record', () => {
  assert.equal(retailerAnswerBlock(R({ isDemonstration: true }), { now }), null);
});

test('an unanswerable question is OMITTED, not answered vaguely', () => {
  // "Call to confirm" is not an answer, and an engine will quote it as one.
  const block = retailerAnswerBlock(R({ hours: null, hoursSource: null }), { now });
  const names = block.mainEntity.map((q) => q.name);
  assert.ok(!names.some((n) => /hours/i.test(n)), 'no hours question without sourced hours');
  assert.ok(names.some((n) => /located/i.test(n)), 'but location is still answered');
});

test('the license answer requires VERIFIED status, not merely a number', () => {
  const notVerified = retailerAnswerBlock(R({ licenseStatus: 'ACTIVE' }), { now });
  assert.ok(!notVerified.mainEntity.some((q) => /licensed/i.test(q.name)),
    'ACTIVE is not verification');
  const verified = retailerAnswerBlock(R(), { now });
  assert.ok(verified.mainEntity.some((q) => /licensed/i.test(q.name)));
});

test('a record with nothing answerable yields null, not an empty FAQPage', () => {
  const block = retailerAnswerBlock(
    R({ hours: null, hoursSource: null, address: '', city: '', licenseNumber: null }), { now });
  assert.equal(block, null, 'an empty FAQPage is itself a false assertion of completeness');
});

// ------------------------------------------------------------------ A5 escaping
test('A5: markup in a retailer name cannot break out of the script tag', () => {
  const ld = retailerStructuredData(R({ name: 'Evil</script><script>alert(1)</script>' }), { now });
  const out = serializeStructuredData(ld);
  assert.ok(!out.includes('</script>'), 'a closing script tag must not survive serialization');
  assert.ok(!out.includes('<script'), 'nor an opening one');
  assert.ok(out.includes('\\u003c'), 'angle brackets must be escaped');
});

test('A5: the serialized payload is still valid JSON after escaping', () => {
  const ld = retailerStructuredData(R({ name: 'A & B <Co>' }), { now });
  const parsed = JSON.parse(serializeStructuredData(ld));
  assert.equal(parsed.name, 'A & B <Co>', 'escaping must be reversible, not lossy');
});

// ------------------------------------------------------------ operator report
test('the assertion report explains WHY a record was withheld', () => {
  // Without this, "no JSON-LD appeared" is indistinguishable from a bug.
  const rep = assertionReport(R({ isDemonstration: true, dataStatus: 'DEMONSTRATION_ONLY' }), now);
  assert.equal(rep.asserted, false);
  assert.ok(rep.blockers.some((b) => /isDemonstration=true/.test(b)));
  assert.ok(rep.blockers.some((b) => /DEMONSTRATION_ONLY/.test(b)));
});

test('the report names fields withheld for a missing source', () => {
  const rep = assertionReport(R({ hoursSource: null }), now);
  assert.equal(rep.asserted, true, 'the record is assertable');
  assert.ok(rep.fields_withheld_for_missing_source.some((f) => /openingHours/.test(f)));
});

test('the report lists what is never asserted at all', () => {
  const rep = assertionReport(R(), now);
  for (const k of ['aggregateRating', 'priceRange', 'reviewCount', 'ranking']) {
    assert.ok(rep.never_asserted.includes(k), `must record that ${k} is never asserted`);
  }
});

test('disqualifications is directly attackable and cites every reason', () => {
  const d = disqualifications(R({ isDemonstration: true, verifiedAt: null, freshnessExpiresAt: past }), now);
  assert.ok(d.length >= 3, 'every independent reason must be cited, not just the first');
  assert.equal(disqualifications(R(), now).length, 0);
  assert.deepEqual(disqualifications(null, now), ['no record']);
});
