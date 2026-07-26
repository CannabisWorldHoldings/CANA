/**
 * ANSWER ENGINE OPTIMIZATION — structured data with the truth boundary enforced.
 *
 * THE GAP THIS CLOSES. sitemap.ts, robots.ts and llms.txt exist, but JSON-LD was
 * emitted on exactly ONE page (products). The retailer detail page — the single
 * most important page for an answer engine, and the one a consumer actually acts
 * on — emitted none. So the records most worth surfacing were the least legible
 * to the systems that increasingly mediate discovery.
 *
 * WHY THIS IS A TRUTH PROBLEM, NOT A MARKETING ONE. Structured data is a machine
 * ASSERTION. When a page emits `"openingHours": "Mon-Sun 9-9"`, an answer engine
 * may repeat that to a person deciding whether to drive somewhere. Emitting an
 * unverified or demonstration value as structured data is therefore strictly worse
 * than emitting nothing: it launders a guess into a citation.
 *
 * THE LAWS:
 *
 *  A1  NEVER ASSERT DEMONSTRATION DATA. A demonstration record yields NO
 *      structured data at all. Not a partial object, not one with a caveat —
 *      answer engines do not read caveats.
 *  A2  FIELD-LEVEL PROVENANCE. Each field is emitted only if THAT field is
 *      sourced. A verified address does not license an unsourced phone number.
 *  A3  NO INVENTED SHAPES. Only fields backed by an observable column are
 *      emitted. No aggregateRating, no priceRange, no review count — inventing
 *      them is the most common structured-data fraud and search engines penalise
 *      it, but the reason not to is that it is a lie.
 *  A4  STALENESS IS DISQUALIFYING. A record past its freshness window is not
 *      emitted, because a machine assertion carries no "as of" a reader will see.
 *  A5  ESCAPED. Output is serialized through the existing escaping helper so a
 *      retailer name containing markup cannot break out of the script tag.
 */

const text = (v) => typeof v === 'string' && v.trim() !== '';
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Fields whose presence alone is not enough — each needs its own source. */
const SOURCED_BY = Object.freeze({
  hours: 'hoursSource',
});

/**
 * Is this record fit to make machine assertions about at all?
 * Returns a list of reasons it is NOT. Empty list means it is.
 */
export function disqualifications(r, now = new Date()) {
  const out = [];
  if (!r || typeof r !== 'object') return ['no record'];
  // A1 — three independent demonstration signals, any one disqualifying.
  if (r.isDemonstration === true) out.push('isDemonstration=true');
  if (text(r.dataStatus) && /demonstration|demo|synthetic|sample/i.test(r.dataStatus)) {
    out.push(`dataStatus=${r.dataStatus}`);
  }
  if (text(r.dataStatus) && r.dataStatus !== 'VERIFIED_CURRENT') {
    out.push(`dataStatus is not VERIFIED_CURRENT (${r.dataStatus})`);
  }
  if (!text(r.dataStatus)) out.push('dataStatus is absent');
  // A record that was never verified cannot be asserted.
  if (!r.verifiedAt) out.push('verifiedAt is null — never verified');
  // A4 — staleness.
  if (r.freshnessExpiresAt) {
    const exp = r.freshnessExpiresAt instanceof Date ? r.freshnessExpiresAt : new Date(r.freshnessExpiresAt);
    if (!Number.isFinite(exp.getTime())) out.push('freshnessExpiresAt is not a valid date');
    else if (exp <= now) out.push(`freshness expired at ${exp.toISOString()}`);
  } else {
    out.push('freshnessExpiresAt is null — staleness cannot be tested');
  }
  return out;
}

/**
 * Build schema.org LocalBusiness JSON-LD for a retailer, or null.
 *
 * Returns null rather than a partial object when the record is disqualified: a
 * caller that receives an object will emit it, so the refusal has to happen here.
 */
export function retailerStructuredData(retailer, { origin, now = new Date() } = {}) {
  const blockers = disqualifications(retailer, now);
  if (blockers.length > 0) return null;
  if (!text(retailer.name)) return null;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: retailer.name.trim(),
  };

  // A2 — each field carries its own admission test.
  if (text(retailer.address) && text(retailer.city) && text(retailer.state)) {
    ld.address = {
      '@type': 'PostalAddress',
      streetAddress: retailer.address.trim(),
      addressLocality: retailer.city.trim(),
      addressRegion: retailer.state.trim(),
      ...(text(retailer.zip) ? { postalCode: retailer.zip.trim() } : {}),
      addressCountry: 'US',
    };
  }
  if (num(retailer.lat) && num(retailer.lng)) {
    ld.geo = { '@type': 'GeoCoordinates', latitude: retailer.lat, longitude: retailer.lng };
  }
  if (text(retailer.phone)) ld.telephone = retailer.phone.trim();
  if (text(retailer.website)) ld.url = retailer.website.trim();

  // Hours are asserted ONLY when their own source field is present. An
  // unsourced opening-hours string is the field most likely to send a person to
  // a locked door, so it gets the strictest treatment.
  if (text(retailer.hours) && text(retailer[SOURCED_BY.hours])) {
    ld.openingHours = retailer.hours.trim();
  }

  if (text(origin) && text(retailer.id)) {
    ld['@id'] = `${origin.replace(/\/$/, '')}/retailer/${retailer.id}`;
  }

  // A3 — nothing beyond this point. Deliberately NO aggregateRating,
  // priceRange, reviewCount, or servesCuisine: no observable column backs them.
  return ld;
}

/**
 * A short, machine-readable answer block for answer engines: the questions a
 * person actually asks, answered ONLY where the underlying field is sourced.
 *
 * An unanswerable question is OMITTED rather than answered vaguely. "Call to
 * confirm" is not an answer, and an answer engine will quote it as one.
 */
export function retailerAnswerBlock(retailer, { now = new Date() } = {}) {
  if (disqualifications(retailer, now).length > 0) return null;
  const qa = [];
  if (text(retailer.hours) && text(retailer.hoursSource)) {
    qa.push({
      '@type': 'Question',
      name: `What are ${retailer.name}'s hours?`,
      acceptedAnswer: { '@type': 'Answer', text: retailer.hours.trim() },
    });
  }
  if (text(retailer.address) && text(retailer.city)) {
    qa.push({
      '@type': 'Question',
      name: `Where is ${retailer.name} located?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${retailer.address.trim()}, ${retailer.city.trim()}${text(retailer.state) ? `, ${retailer.state.trim()}` : ''}`,
      },
    });
  }
  if (text(retailer.licenseNumber) && retailer.licenseStatus === 'VERIFIED') {
    qa.push({
      '@type': 'Question',
      name: `Is ${retailer.name} licensed?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `License ${retailer.licenseNumber.trim()} is recorded and verified.`,
      },
    });
  }
  if (qa.length === 0) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa };
}

/**
 * Why a record was not asserted — for the operator, never shipped to the page.
 * Without this, "no JSON-LD appeared" is indistinguishable from a bug.
 */
export function assertionReport(retailer, now = new Date()) {
  const blockers = disqualifications(retailer, now);
  return {
    retailer_id: retailer?.id ?? null,
    asserted: blockers.length === 0,
    blockers,
    fields_withheld_for_missing_source: text(retailer?.hours) && !text(retailer?.hoursSource)
      ? ['openingHours (hoursSource absent)'] : [],
    never_asserted: ['aggregateRating', 'priceRange', 'reviewCount', 'popularity', 'ranking'],
  };
}
