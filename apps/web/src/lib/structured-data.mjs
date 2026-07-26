import { serializeStructuredData } from './seo-truth.mjs';
import { isPubliclyVerified } from './data-status.mjs';
import {
  PUBLIC_PRODUCT_DESCRIPTION,
  PUBLIC_PRODUCT_NAME,
} from './product-brand.mjs';

/**
 * Truth-aware structured data.
 *
 * Search engines and AI answer engines treat JSON-LD as factual claims made
 * by the site. To honor the platform's evidence boundary, builders in this
 * module refuse to emit machine-readable claims for records that have not
 * passed public verification (demonstration, stale, disputed, or pending
 * records return null). Rendering code simply skips null values, so the
 * boundary is enforced in one place.
 */

export function jsonLdScriptProps(value) {
  return {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: { __html: serializeStructuredData(value) },
  };
}

export function organizationJsonLd({ origin }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${origin}#organization`,
    name: PUBLIC_PRODUCT_NAME,
    url: `${origin}/`,
    description: PUBLIC_PRODUCT_DESCRIPTION,
    logo: {
      '@type': 'ImageObject',
      url: `${origin}/icon-512.png`,
      width: 512,
      height: 512,
    },
    knowsAbout: [
      'Cannabis retailers in Washington, D.C.',
      'D.C. Initiative 71',
      'Medical cannabis dispensaries',
      'Cannabis product verification',
    ],
  };
}

export function webSiteJsonLd({ origin }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}#website`,
    name: PUBLIC_PRODUCT_NAME,
    url: `${origin}/`,
    description: PUBLIC_PRODUCT_DESCRIPTION,
    publisher: { '@id': `${origin}#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}/?query={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbJsonLd(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Emits a schema.org Store for a retailer ONLY when the record passes the
 * public evidence boundary. Demonstration/stale/disputed records return null
 * so no synthetic business facts ever reach search engines.
 */
/**
 * ONE definition of "this licence is verified", shared by every path that asserts
 * it. VERIFIER FINDING C4: the credential block normalized case inline while the
 * answer block required an exact 'VERIFIED', so licenceStatus 'verified' emitted a
 * machine-readable CREDENTIAL but no answer saying the retailer was licensed. Two
 * definitions of "verified" in one module is how one of them eventually drifts into
 * asserting something the other refuses.
 *
 * Normalizing case and surrounding whitespace is deliberate — ' verified ' IS the
 * genuine token. A near-miss like 'VERIFIED-ish' or 'ACTIVE' is still refused,
 * because ACTIVE is a licence STATE, not evidence that anyone checked it.
 */
export function isLicenceVerified(status) {
  return typeof status === 'string' && status.trim().toUpperCase() === 'VERIFIED';
}

export function retailerJsonLd({ retailer, origin }) {
  if (!retailer || !isPubliclyVerified(retailer)) return null;
  const url = `${origin}/retailer/${retailer.id}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': `${url}#store`,
    name: retailer.name,
    url,
  };
  // DEFECT FOUND WHILE CONSOLIDATING: a record with a BLANK street address still
  // emitted a PostalAddress asserting 'Washington, DC', because city and state
  // fell back to defaults. That is a fabricated location — an answer engine could
  // cite "Washington, DC" for a retailer whose address nobody recorded. The
  // defaults are reasonable for a DC-only marketplace ONLY when there is a real
  // street address to attach them to; with no street they invent a place.
  //
  // A partial address is worse than no address: it looks complete to a machine.
  if (typeof retailer.address === 'string' && retailer.address.trim() !== '') {
    jsonLd.address = {
      '@type': 'PostalAddress',
      streetAddress: retailer.address.trim(),
      addressLocality: (retailer.city || 'Washington').trim(),
      addressRegion: (retailer.state || 'DC').trim(),
      ...(retailer.zip ? { postalCode: retailer.zip } : {}),
      addressCountry: 'US',
    };
  }
  if (Number.isFinite(retailer.lat) && Number.isFinite(retailer.lng)) {
    jsonLd.geo = {
      '@type': 'GeoCoordinates',
      latitude: retailer.lat,
      longitude: retailer.lng,
    };
  }
  // A whitespace-only phone is truthy, so `if (retailer.phone)` emitted
  // telephone: '   '. An empty contact field is not a contact.
  if (typeof retailer.phone === 'string' && retailer.phone.trim() !== '') {
    jsonLd.telephone = retailer.phone.trim();
  }
  // FIELD-LEVEL PROVENANCE. isPubliclyVerified() clears the RECORD, but it does
  // not clear every FIELD on it. openingHours is asserted only when hoursSource
  // is present: an answer engine may repeat opening hours to someone deciding
  // whether to drive somewhere, so an unsourced value is the single field most
  // likely to send a real person to a locked door. Record-level verification does
  // not license a field nobody sourced.
  if (typeof retailer.hours === 'string' && retailer.hours.trim() !== ''
      && typeof retailer.hoursSource === 'string' && retailer.hoursSource.trim() !== '') {
    jsonLd.openingHours = retailer.hours.trim();
  }
  // Verification provenance: no major competitor emits machine-readable
  // trust signals. Only reached for records past the evidence boundary, so
  // every property states an observed fact.
  const provenance = [];
  if (retailer.dataSource) {
    provenance.push({
      '@type': 'PropertyValue',
      name: 'verificationSource',
      value: retailer.dataSource,
    });
  }
  if (retailer.verifiedAt?.toISOString) {
    provenance.push({
      '@type': 'PropertyValue',
      name: 'verifiedDate',
      value: retailer.verifiedAt.toISOString(),
    });
  }
  if (retailer.licenseNumber) {
    provenance.push({
      '@type': 'PropertyValue',
      name: 'licenseNumber',
      value: retailer.licenseNumber,
    });
  }
  if (provenance.length > 0) jsonLd.additionalProperty = provenance;

  // hasCredential: the machine-readable license claim. Competitor field recon
  // (2026-07-23) found Leafly DISPLAYS ABCA numbers as page text but emits no
  // license, credential, or provenance property in JSON-LD at all — the number
  // is self-attested at onboarding with no verification process. Emitting a
  // real EducationalOccupationalCredential is therefore uncontested
  // machine-readable ground for answer engines.
  //
  // FAIL-CLOSED: requires BOTH a license number AND an explicit VERIFIED
  // status. A number alone is display-only text and must never become a
  // structured credential claim — that would reproduce the very
  // "verification theater" this mechanism exists to beat.
  const licenseVerified = isLicenceVerified(retailer.licenseStatus);
  if (retailer.licenseNumber && licenseVerified) {
    const credential = {
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: 'Cannabis retailer license',
      identifier: retailer.licenseNumber,
      recognizedBy: {
        '@type': 'GovernmentOrganization',
        name:
          retailer.licenseSource ||
          'District of Columbia Alcoholic Beverage and Cannabis Administration',
      },
    };
    // Only assert a validation date we actually observed.
    const checked =
      retailer.lastLicenseCheck?.toISOString?.() ??
      retailer.verifiedAt?.toISOString?.();
    if (checked) credential.dateCreated = checked;
    jsonLd.hasCredential = credential;
  }
  return jsonLd;
}

export function articleJsonLd({ article, origin }) {
  if (!article || !isPubliclyVerified(article)) return null;
  const url = `${origin}/education/${encodeURIComponent(article.slug)}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: article.title,
    url,
    author: {
      '@type': 'Organization',
      name: article.author || PUBLIC_PRODUCT_NAME,
    },
    publisher: { '@id': `${origin}#organization` },
    datePublished: article.createdAt?.toISOString?.() ?? undefined,
    dateModified: article.updatedAt?.toISOString?.() ?? undefined,
  };
}

export function faqJsonLd(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

/**
 * ItemList of publicly verified retailers for directory surfaces. Records
 * failing the evidence boundary are silently excluded.
 */
export function retailerItemListJsonLd({ retailers, origin }) {
  const eligible = (retailers || []).filter((retailer) =>
    isPubliclyVerified(retailer),
  );
  if (eligible.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: eligible.map((retailer, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: retailer.name,
      url: `${origin}/retailer/${retailer.id}`,
    })),
  };
}

/**
 * Honest Product schema for strain-type guide pages. Emits only observed
 * facts: name, category, description, and a count-backed offer pointer into
 * the evidence-eligible product listing. Deliberately NO aggregateRating —
 * synthetic ratings are forbidden by this platform's truth laws.
 */
export function strainProductJsonLd({ strain, slug, recordCount, origin }) {
  if (!strain || typeof slug !== 'string' || slug.length === 0) return null;
  const url = `${origin}/strains/${encodeURIComponent(slug)}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: `${strain.name} cannabis (category guide)`,
    url,
    description: strain.summary,
    category: 'Cannabis',
  };
  if (Number.isInteger(recordCount) && recordCount > 0) {
    jsonLd.offers = {
      '@type': 'AggregateOffer',
      offerCount: recordCount,
      availability: 'https://schema.org/InStoreOnly',
      url: `${origin}/products?strainType=${encodeURIComponent(slug)}`,
    };
  }
  return jsonLd;
}

/**
 * ItemList of verified, current deals for the DC deals index. This is the
 * machine-readable deal COLLECTION no incumbent publishes: Weedmaps 406-walls
 * its deal pages, Where's Weed hides them in a client-only SPA, and Leafly
 * emits no deal validity data. Only publicly verified deals whose retailer is
 * also publicly verified are included; each element carries validThrough so
 * an AI agent can tell a live deal from an expired one. Returns null when
 * nothing is eligible (no empty ItemList).
 */
export function dealItemListJsonLd({ deals, origin }) {
  const eligible = (deals || []).filter(
    (deal) =>
      isPubliclyVerified(deal) &&
      deal.retailer &&
      isPubliclyVerified(deal.retailer),
  );
  if (eligible.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Washington, D.C. cannabis deals',
    numberOfItems: eligible.length,
    itemListElement: eligible.map((deal, index) => {
      const offer = {
        '@type': 'Offer',
        name: deal.title,
        url: `${origin}/retailer/${deal.retailer.id}`,
        seller: { '@id': `${origin}/retailer/${deal.retailer.id}#store` },
        availability: 'https://schema.org/InStoreOnly',
      };
      if (deal.expiryDate?.toISOString) {
        offer.validThrough = deal.expiryDate.toISOString();
      }
      return {
        '@type': 'ListItem',
        position: index + 1,
        item: offer,
      };
    }),
  };
}

/**
 * Offer schema for a verified, current deal. Demonstration/unverified deals
 * return null. No price is invented: deals carry discount descriptions, so
 * the Offer states name/description/validity/seller only.
 */
export function dealOfferJsonLd({ deal, retailer, origin }) {
  if (!deal || !isPubliclyVerified(deal)) return null;
  if (!retailer || !isPubliclyVerified(retailer)) return null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: deal.title,
    url: `${origin}/retailer/${retailer.id}`,
    seller: { '@id': `${origin}/retailer/${retailer.id}#store` },
    availability: 'https://schema.org/InStoreOnly',
  };
  if (deal.description) jsonLd.description = deal.description;
  if (deal.expiryDate?.toISOString) {
    jsonLd.validThrough = deal.expiryDate.toISOString();
  }
  return jsonLd;
}

/**
 * A machine-readable answer block for answer engines: the questions a person
 * actually asks, answered ONLY where the underlying field is sourced.
 *
 * An unanswerable question is OMITTED rather than answered vaguely. "Call to
 * confirm" is not an answer, and an answer engine will quote it as one. A record
 * with nothing answerable returns null, because an empty FAQPage is itself a
 * false assertion of completeness.
 */
export function retailerAnswerJsonLd({ retailer, asOf = new Date() }) {
  if (!retailer || !isPubliclyVerified(retailer, asOf)) return null;
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  const qa = [];
  if (text(retailer.hours) && text(retailer.hoursSource)) {
    qa.push({
      '@type': 'Question',
      name: `What are ${retailer.name} hours?`,
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
  // 'VERIFIED' specifically. 'ACTIVE' is a licence STATE, not evidence that
  // anyone verified it, and conflating the two is how an unchecked claim becomes
  // a machine-readable assertion.
  // VERIFIER FINDING C4 (LOW). hasCredential uses isVerified() — which normalizes
  // case and whitespace — while this block required an exact 'VERIFIED'. So a
  // retailer with licenseStatus 'verified' emitted a machine-readable CREDENTIAL
  // but no answer saying it was licensed. Both paths assert the same fact about the
  // same record, so they must agree on what counts as verified; two definitions of
  // "verified" in one module is how one of them eventually drifts into asserting
  // something the other refuses.
  if (text(retailer.licenseNumber) && isLicenceVerified(retailer.licenseStatus)) {
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
 * Why a record was or was not asserted — for the operator, never shipped to the
 * page. Without this, "no JSON-LD appeared" is indistinguishable from a bug, and
 * a silently-empty structured-data surface is impossible to debug.
 */
export function structuredDataAssertionReport(retailer, asOf = new Date()) {
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  const asserted = !!retailer && isPubliclyVerified(retailer, asOf);
  const blockers = [];
  if (!retailer) blockers.push('no record');
  else if (!asserted) {
    if (retailer.isDemonstration === true) blockers.push('isDemonstration=true');
    if (text(retailer.dataStatus)) blockers.push(`resolved status is not VERIFIED_CURRENT (dataStatus=${retailer.dataStatus})`);
    if (!retailer.verifiedAt) blockers.push('verifiedAt is null — never verified');
    if (!retailer.freshnessExpiresAt) blockers.push('freshnessExpiresAt is null — staleness cannot be tested');
    if (blockers.length === 0) blockers.push('failed the public verification boundary');
  }
  return {
    retailer_id: retailer?.id ?? null,
    asserted,
    blockers,
    fields_withheld_for_missing_source:
      text(retailer?.hours) && !text(retailer?.hoursSource)
        ? ['openingHours (hoursSource absent)'] : [],
    never_asserted: ['aggregateRating', 'priceRange', 'reviewCount', 'popularity', 'ranking'],
  };
}
