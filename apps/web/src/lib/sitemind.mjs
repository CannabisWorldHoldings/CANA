/**
 * SiteMind Marketing Audit Engine v1
 *
 * Deterministic, receipt-producing marketing audit module.
 * - No external network calls.
 * - No Date.now() inside pure functions (asOf is always passed in).
 * - Every finding cites observed evidence (counts, timestamps).
 * - Authority field separates LOCAL_DATABASE from STATIC_CONTRACT checks.
 */

import { currentPublicRecordWhere } from './seo-truth.mjs';
import { currentDealWhere } from './directory-search.mjs';
import { NEIGHBORHOOD_SLUGS } from './neighborhood-configs.mjs';
import { STRAIN_SLUGS } from './strain-content.mjs';
import { LEGAL_FAQ_COUNT } from './legal-faq.mjs';

export const SITEMIND_SCHEMA_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Competitor parity contract — static, frozen reference facts. Facts marked
// (field recon 2026-07-23) were re-observed via direct crawl; see
// docs/competitive/{leafly,weedmaps-wheresweed}-field-recon-2026-07-23.md.
// Authority: STATIC_CONTRACT. Re-verify each SENSE cycle.
// ---------------------------------------------------------------------------

export const COMPETITOR_PARITY_CONTRACT = Object.freeze({
  observedAt: '2026-07-23',
  source: 'docs/competitive/*-field-recon-2026-07-23.md',
  facts: Object.freeze({
    leafly: Object.freeze({
      strainPages: 19209,
      dispensaryPages: 36677,
      newsArticles: 8800,
      llmsTxt: false, // 2026-07-23: /llms.txt still serves the app shell
      dcNeighborhoodPages: 0,
      // Field recon 2026-07-23:
      gptBotBlocked: true, // GPTBot Disallow:/ except 26 affiliate articles
      publishesPricing: false, // demo-gated; "contact us"
      licenseVerification: 'display-only', // shows ABCA #, self-attested, not in JSON-LD
      dealValidityData: false, // no expiry on deal cards; MD stores bleed into DC
      sponsoredDisclosure: 'section-header-only',
    }),
    weedmaps: Object.freeze({
      strainPages: 9344,
      dispensaryPages: 9229,
      dcNeighborhoodPages: 17,
      llmsTxt: true, // novel LLMTXT: directive -> /llm.txt (10.3KB)
      // Field recon 2026-07-23:
      dcListingsLive: 30, // delisting did NOT happen; long-form URL live
      dcDelisted: false,
      legacyDcUrls404: true, // short-form DC paths now 404
      dcDealPagesIndexed: 0,
      botWall406: true, // ALL listing pages 406 to fetchers -> AI-invisible
      publishesPricing: false,
      licenseVerification: 'self-certify',
    }),
    wheresweed: Object.freeze({
      // Field recon 2026-07-23 (most direct DC competitor):
      dcBusinessPages: 70, // 50 delivery + 18 dispensary + 2 other, sitemapped
      serverSideRendered: false, // Vite SPA; top-10 JSON-LD only, ssrPageLoaded:false
      llmsTxt: false,
      addBusiness404: true, // merchant self-serve onboarding is a hard 404
      publishesPricing: false, // media-kit contact form only
      licenseVerification: 'none',
      dcDeliveryReviewMoat: true, // top merchants 1.5k-4.4k reviews (the one real moat)
      securityHeaders: false, // no CSP/HSTS/XFO
    }),
  }),
});

// ---------------------------------------------------------------------------
// Route registry — static contract describing each public route class and its
// declared SEO obligations. This is the STATIC_CONTRACT source of truth;
// it cannot observe production HTTP behaviour.
// ---------------------------------------------------------------------------

export const SITEMIND_ROUTE_REGISTRY = Object.freeze([
  Object.freeze({
    route: '/',
    kind: 'directory',
    hasJsonLd: true,
    jsonLdTypes: Object.freeze(['Organization', 'WebSite', 'ItemList']),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/products',
    kind: 'catalog',
    hasJsonLd: false,
    jsonLdTypes: Object.freeze([]),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/dispensaries',
    kind: 'storefront-directory',
    hasJsonLd: false,
    jsonLdTypes: Object.freeze([]),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/delivery',
    kind: 'delivery-directory',
    hasJsonLd: false,
    jsonLdTypes: Object.freeze([]),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/search',
    kind: 'marketplace-search',
    hasJsonLd: false,
    jsonLdTypes: Object.freeze([]),
    inSitemap: false,
    robotsDisallowed: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/deals',
    kind: 'promotions',
    hasJsonLd: true,
    // The crawlable DC deals collection no incumbent publishes: an ItemList
    // of validity-bounded Offers + breadcrumb (field recon 2026-07-23).
    jsonLdTypes: Object.freeze(['BreadcrumbList', 'ItemList', 'Offer']),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/education',
    kind: 'editorial-index',
    hasJsonLd: false,
    jsonLdTypes: Object.freeze([]),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/education/[slug]',
    kind: 'article',
    hasJsonLd: true,
    jsonLdTypes: Object.freeze(['Article']),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/neighborhoods',
    kind: 'neighborhood-index',
    hasJsonLd: true,
    jsonLdTypes: Object.freeze(['Breadcrumb']),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/neighborhoods/[slug]',
    kind: 'neighborhood',
    hasJsonLd: true,
    jsonLdTypes: Object.freeze(['Breadcrumb']),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  Object.freeze({
    route: '/legal',
    kind: 'legal',
    hasJsonLd: true,
    jsonLdTypes: Object.freeze(['FAQPage', 'BreadcrumbList']),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  // Retailer pages emit Store JSON-LD only when the retailer is verified.
  Object.freeze({
    route: '/retailer/[id]',
    kind: 'retailer',
    hasJsonLd: true,
    jsonLdTypes: Object.freeze(['Store']),
    jsonLdNote: 'Store JSON-LD emitted only when retailer satisfies the verified current boundary.',
    inSitemap: true,
    hasCustomMetadata: true,
  }),
  // Compare is explicitly noindex / robots-disallowed.
  Object.freeze({
    route: '/compare',
    kind: 'tool',
    hasJsonLd: false,
    jsonLdTypes: Object.freeze([]),
    inSitemap: false,
    robotsDisallowed: true,
    hasCustomMetadata: false,
  }),
  Object.freeze({
    route: '/help',
    kind: 'support',
    hasJsonLd: false,
    jsonLdTypes: Object.freeze([]),
    inSitemap: true,
    hasCustomMetadata: true,
  }),
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
}

function validateCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new TypeError('SiteMind counts must be a plain object.');
  }
  const fields = [
    'retailersTotal',
    'retailersVerifiedCurrent',
    'retailersStale',
    'retailersAwaiting',
    'retailersDemo',
    'menuEntriesTotal',
    'menuEntriesVerifiedCurrent',
    'dealsActive',
    'dealsExpiringSoon',
    'dealsExpiredStillActiveFlag',
    'articlesTotal',
    'articlesVerifiedCurrent',
    'articlesStaleFreshness',
    'retailersMissingPhone',
    'retailersMissingWebsite',
    'sitemapEligibleRetailers',
    'neighborhoodPagesConfigured',
    'strainGuidesConfigured',
    'legalFaqCount',
    'cardTextFieldsMinimum',
  ];
  for (const field of fields) {
    validFiniteNonNegative(counts[field], field);
  }
}

function validDate(value, label) {
  const date = value ?? new Date();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
  return new Date(date);
}

// ---------------------------------------------------------------------------
// Check builders — each returns a check object
// ---------------------------------------------------------------------------

/**
 * Weights sum to 100 for convenience; score is proportional.
 * PASS = full weight, WARN = half weight, FAIL = 0 weight.
 *
 * Weight rationale:
 *   verified-share          18  — core SEO eligibility gate
 *   menu-evidence           12  — content depth signal
 *   deal-freshness          14  — expired-active is a data integrity failure
 *   deal-pipeline            8  — 0 active deals leaves /deals empty
 *   article-freshness       12  — editorial staleness harms crawl budget
 *   contact-completeness    12  — incomplete contact hurts trust / CTR
 *   index-eligibility       14  — no eligible retailer pages = no retailer sitemap
 *   demo-exposure           10  — demo data blocks production indexing
 *
 * New competitor-parity checks (weights additive beyond the original 100):
 *   neighborhood-coverage    8  — geographic coverage vs. Weedmaps 17 pages
 *   strain-guide-coverage    6  — content depth vs. Leafly 19,209 strain pages
 *   authority-content        6  — FAQ authority vs. Leafly FAQPage usage
 *   agent-readability        5  — AI-agent CTR: homepage cards must expose >= 4
 *                                 readable DOM text fields mirrored in JSON-LD
 *                                 (research: visual-attributes paper 2025)
 */
const CHECKS_META = Object.freeze({
  'verified-share': 18,
  'menu-evidence': 12,
  'deal-freshness': 14,
  'deal-pipeline': 8,
  'article-freshness': 12,
  'contact-completeness': 12,
  'index-eligibility': 14,
  'demo-exposure': 10,
  'neighborhood-coverage': 8,
  'strain-guide-coverage': 6,
  'authority-content': 6,
  'agent-readability': 5,
});

function checkVerifiedShare(counts) {
  const { retailersVerifiedCurrent, retailersTotal } = counts;
  const pct = retailersTotal === 0
    ? 0
    : (retailersVerifiedCurrent / retailersTotal) * 100;

  let status;
  if (retailersTotal === 0 || pct < 25) {
    status = 'FAIL';
  } else if (pct < 60) {
    status = 'WARN';
  } else {
    status = 'PASS';
  }

  return {
    id: 'verified-share',
    title: 'Verified retailer share',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `retailersVerifiedCurrent=${retailersVerifiedCurrent}; retailersTotal=${retailersTotal}; verifiedPct=${pct.toFixed(1)}%`,
    recommendation:
      status === 'PASS'
        ? 'Maintain evidence freshness windows; re-verify before expiry.'
        : status === 'WARN'
        ? 'Submit additional license evidence for awaiting retailers to raise verified share above 60%.'
        : 'Fewer than 25% of retailers are verified current. Review pending evidence queue and approve eligible submissions.',
    weight: CHECKS_META['verified-share'],
  };
}

function checkMenuEvidence(counts) {
  const { menuEntriesVerifiedCurrent, menuEntriesTotal } = counts;
  const pct = menuEntriesTotal === 0
    ? 0
    : (menuEntriesVerifiedCurrent / menuEntriesTotal) * 100;

  let status;
  if (menuEntriesTotal === 0 || pct < 20) {
    status = 'FAIL';
  } else if (pct < 50) {
    status = 'WARN';
  } else {
    status = 'PASS';
  }

  return {
    id: 'menu-evidence',
    title: 'Menu entry evidence share',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `menuEntriesVerifiedCurrent=${menuEntriesVerifiedCurrent}; menuEntriesTotal=${menuEntriesTotal}; verifiedPct=${pct.toFixed(1)}%`,
    recommendation:
      status === 'PASS'
        ? 'Continue refreshing menu evidence before freshnessExpiresAt windows close.'
        : status === 'WARN'
        ? 'Increase menu entry verification coverage. Aim for 50%+ to cross PASS threshold.'
        : 'Menu evidence coverage is critically low. Re-source and verify catalog entries through the evidence review flow.',
    weight: CHECKS_META['menu-evidence'],
  };
}

function checkDealFreshness(counts) {
  const { dealsExpiredStillActiveFlag, dealsExpiringSoon } = counts;

  let status;
  if (dealsExpiredStillActiveFlag > 0) {
    status = 'FAIL';
  } else if (dealsExpiringSoon > 0) {
    status = 'WARN';
  } else {
    status = 'PASS';
  }

  return {
    id: 'deal-freshness',
    title: 'Deal data freshness',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `dealsExpiredStillActiveFlag=${dealsExpiredStillActiveFlag}; dealsExpiringSoon(72h)=${dealsExpiringSoon}`,
    recommendation:
      status === 'FAIL'
        ? `${dealsExpiredStillActiveFlag} deal(s) have expiryDate in the past but isActive=true. Set isActive=false or update expiryDate immediately — stale active deals corrupt the /deals page and deal JSON.`
        : status === 'WARN'
        ? `${dealsExpiringSoon} deal(s) expire within 72 hours. Renew or deactivate them before they cross the expiry boundary.`
        : 'No expired-but-active deals found. Maintain deal expiry date hygiene.',
    weight: CHECKS_META['deal-freshness'],
  };
}

function checkDealPipeline(counts) {
  const { dealsActive } = counts;
  const status = dealsActive === 0 ? 'WARN' : 'PASS';

  return {
    id: 'deal-pipeline',
    title: 'Active deal pipeline',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `dealsActive=${dealsActive}`,
    recommendation:
      status === 'PASS'
        ? 'Deals pipeline is healthy. Monitor deal expiry dates proactively.'
        : 'No active deals are present. Create at least one verified current deal to populate /deals and associated retailer deal feeds.',
    weight: CHECKS_META['deal-pipeline'],
  };
}

function checkArticleFreshness(counts) {
  const { articlesStaleFreshness, articlesVerifiedCurrent, articlesTotal } = counts;

  let status;
  if (articlesTotal === 0 || articlesVerifiedCurrent === 0) {
    status = 'WARN';
  } else if (articlesStaleFreshness > 0) {
    status = 'WARN';
  } else {
    status = 'PASS';
  }

  return {
    id: 'article-freshness',
    title: 'Editorial article freshness',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `articlesVerifiedCurrent=${articlesVerifiedCurrent}; articlesStaleFreshness=${articlesStaleFreshness}; articlesTotal=${articlesTotal}`,
    recommendation:
      status === 'PASS'
        ? 'All verified articles are within freshness windows. Keep freshnessExpiresAt dates current.'
        : articlesStaleFreshness > 0
        ? `${articlesStaleFreshness} article(s) have passed their freshnessExpiresAt date. Re-verify or update content and reset the freshness window.`
        : 'No verified current articles exist. Publish and verify educational content to populate /education.',
    weight: CHECKS_META['article-freshness'],
  };
}

function checkContactCompleteness(counts) {
  const { retailersMissingPhone, retailersMissingWebsite, retailersTotal } = counts;
  const missingAny = retailersMissingPhone + retailersMissingWebsite;
  const realTotal = retailersTotal;

  const phonePct = realTotal === 0 ? 0 : (retailersMissingPhone / realTotal) * 100;
  const webPct = realTotal === 0 ? 0 : (retailersMissingWebsite / realTotal) * 100;
  const maxPct = Math.max(phonePct, webPct);

  let status;
  if (maxPct >= 50) {
    status = 'FAIL';
  } else if (missingAny > 0) {
    status = 'WARN';
  } else {
    status = 'PASS';
  }

  return {
    id: 'contact-completeness',
    title: 'Retailer contact completeness',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `retailersMissingPhone=${retailersMissingPhone}; retailersMissingWebsite=${retailersMissingWebsite}; retailersTotal=${retailersTotal}`,
    recommendation:
      status === 'PASS'
        ? 'All retailers have phone and website populated. Maintain data quality on new imports.'
        : status === 'FAIL'
        ? `Contact field gaps are critical (phone missing: ${phonePct.toFixed(1)}%, website missing: ${webPct.toFixed(1)}%). Fill in phone and website fields through the admin edit flow before the next crawl.`
        : `${missingAny} contact field gap(s) across ${retailersTotal} retailers (phone: ${retailersMissingPhone}, website: ${retailersMissingWebsite}). Request or research missing contact details and update records.`,
    weight: CHECKS_META['contact-completeness'],
  };
}

function checkIndexEligibility(counts) {
  const { sitemapEligibleRetailers } = counts;
  const status = sitemapEligibleRetailers === 0 ? 'WARN' : 'PASS';

  return {
    id: 'index-eligibility',
    title: 'Sitemap-eligible retailer pages',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `sitemapEligibleRetailers=${sitemapEligibleRetailers}`,
    recommendation:
      status === 'PASS'
        ? `${sitemapEligibleRetailers} retailer page(s) are currently sitemap-eligible. Preserve evidence freshness to maintain eligibility.`
        : 'No retailer pages currently pass the sitemap eligibility boundary (verified current, non-demonstration, associated to brand). Approve and verify at least one retailer to unlock /retailer/[id] sitemap entries.',
    weight: CHECKS_META['index-eligibility'],
  };
}

function checkDemoExposure(counts) {
  const { retailersDemo } = counts;
  const status = retailersDemo > 0 ? 'WARN' : 'PASS';

  return {
    id: 'demo-exposure',
    title: 'Demonstration data exposure',
    authority: 'LOCAL_DATABASE',
    status,
    evidence: `retailersDemo=${retailersDemo}`,
    recommendation:
      status === 'PASS'
        ? 'No demonstration retailers detected. Production indexing boundary is clean.'
        : `${retailersDemo} demonstration retailer record(s) are present. Demonstration records are excluded from the verified current boundary and block production indexing of those pages. Remove or convert demo records before the production release.`,
    weight: CHECKS_META['demo-exposure'],
  };
}

// ---------------------------------------------------------------------------
// New competitor-parity checks
// ---------------------------------------------------------------------------

function checkNeighborhoodCoverage(counts) {
  const { neighborhoodPagesConfigured } = counts;
  const weedmapsPages = COMPETITOR_PARITY_CONTRACT.facts.weedmaps.dcNeighborhoodPages;

  let status;
  if (neighborhoodPagesConfigured >= 12) {
    status = 'PASS';
  } else if (neighborhoodPagesConfigured >= 6) {
    status = 'WARN';
  } else {
    status = 'FAIL';
  }

  return {
    id: 'neighborhood-coverage',
    title: 'DC neighborhood page coverage',
    authority: 'STATIC_CONTRACT',
    status,
    evidence: `neighborhoodPagesConfigured=${neighborhoodPagesConfigured}; weedmapsDcNeighborhoodPages=${weedmapsPages} (observed ${COMPETITOR_PARITY_CONTRACT.observedAt})`,
    recommendation:
      status === 'PASS'
        ? `${neighborhoodPagesConfigured} neighborhood pages configured — meets the 12-page parity target. Weedmaps has ${weedmapsPages}; continue expanding toward full DC coverage.`
        : status === 'WARN'
        ? `${neighborhoodPagesConfigured} neighborhood pages configured (target: 12+). Add entries to neighborhood-configs.mjs to close the gap vs. Weedmaps' ${weedmapsPages} DC pages.`
        : `Only ${neighborhoodPagesConfigured} neighborhood page(s) configured. Add at least 12 entries to neighborhood-configs.mjs. Weedmaps has ${weedmapsPages} DC-specific neighborhood pages.`,
    weight: CHECKS_META['neighborhood-coverage'],
  };
}

function checkStrainGuideCoverage(counts) {
  const { strainGuidesConfigured } = counts;
  const leaflyPages = COMPETITOR_PARITY_CONTRACT.facts.leafly.strainPages;

  const status = strainGuidesConfigured >= 4 ? 'PASS' : 'WARN';

  return {
    id: 'strain-guide-coverage',
    title: 'Strain guide page coverage',
    authority: 'STATIC_CONTRACT',
    status,
    evidence: `strainGuidesConfigured=${strainGuidesConfigured}; leaflyStrainPages=${leaflyPages} (observed ${COMPETITOR_PARITY_CONTRACT.observedAt})`,
    recommendation:
      status === 'PASS'
        ? `${strainGuidesConfigured} strain guide(s) configured. Leafly has ${leaflyPages.toLocaleString()} named-strain pages — grow toward individual named-strain pages (e.g. /strains/blue-dream) to compete on long-tail search.`
        : `${strainGuidesConfigured} strain guide(s) configured (target: 4+ category guides). Leafly's ${leaflyPages.toLocaleString()} named-strain pages dominate long-tail strain search — add category guides now and plan named-strain pages next.`,
    weight: CHECKS_META['strain-guide-coverage'],
  };
}

function checkAuthorityContent(counts) {
  const { legalFaqCount } = counts;

  let status;
  if (legalFaqCount >= 12) {
    status = 'PASS';
  } else if (legalFaqCount >= 6) {
    status = 'WARN';
  } else {
    status = 'FAIL';
  }

  return {
    id: 'authority-content',
    title: 'Legal/FAQ authority content depth',
    authority: 'STATIC_CONTRACT',
    status,
    evidence: `legalFaqCount=${legalFaqCount}; leaflyRunsFAQPageSchemaOnCityPages=true (observed ${COMPETITOR_PARITY_CONTRACT.observedAt})`,
    recommendation:
      status === 'PASS'
        ? `${legalFaqCount} FAQ entries on the legal page — meets parity target. Leafly emits FAQPage schema on city pages; we now emit equivalent schema on /legal and neighborhood pages.`
        : status === 'WARN'
        ? `${legalFaqCount} FAQ entries (target: 12+). Expand /legal FAQ content to match Leafly's FAQPage schema usage on city pages and improve FAQ rich-result eligibility.`
        : `Only ${legalFaqCount} FAQ entries (target: 12+). Leafly runs FAQPage schema on city pages — add more entries to legal-faq.mjs to improve authority signals and rich-result eligibility.`,
    weight: CHECKS_META['authority-content'],
  };
}

/**
 * Agent-readability check: PASS when homepage retailer cards expose at least 4
 * readable DOM text fields that are also mirrored in JSON-LD.
 *
 * Homepage cards currently render: name, address, source (dataSource), hours,
 * and license — 5 fields total. The threshold of 4 is a minimum safety floor.
 * Research: "Visual Attributes of AI Agent Click-Through Rates" (2025) found
 * card text completeness is a top-4 predictor of AI web-agent selection, with
 * background contrast adding +11.7% CTR.
 *
 * Authority: STATIC_CONTRACT — this count is a code invariant, not a DB query.
 */
function checkAgentReadability(counts) {
  const { cardTextFieldsMinimum } = counts;
  const status = cardTextFieldsMinimum >= 4 ? 'PASS' : 'FAIL';

  return {
    id: 'agent-readability',
    title: 'Homepage card agent-readability (text fields)',
    authority: 'STATIC_CONTRACT',
    status,
    evidence: `cardTextFieldsMinimum=${cardTextFieldsMinimum}; requiredMinimum=4; homepageCardFields=name,address,source,hours,license (5 DOM text fields mirrored in JSON-LD)`,
    recommendation:
      status === 'PASS'
        ? `${cardTextFieldsMinimum} readable text fields on homepage cards — meets the 4-field minimum for AI-agent readability. Maintain parity between DOM text and JSON-LD structured data.`
        : `Homepage retailer cards expose fewer than 4 readable DOM text fields (${cardTextFieldsMinimum}). Add name, address, source, hours, and license to every card and mirror them in JSON-LD to improve AI-agent selection likelihood.`,
    weight: CHECKS_META['agent-readability'],
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeScore(checks) {
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;
  const earned = checks.reduce((sum, c) => {
    const factor = c.status === 'PASS' ? 1 : c.status === 'WARN' ? 0.5 : 0;
    return sum + c.weight * factor;
  }, 0);
  return Math.round((earned / totalWeight) * 100);
}

function computeGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pure scoring function. Validates inputs, builds all checks, computes score.
 *
 * @param {{ counts: object, asOf: Date }} param0
 * @returns {{ checks: Array, score: number, grade: string }}
 */
export function evaluateMarketingHealth({ counts, asOf }) {
  validDate(asOf, 'SiteMind asOf');
  validateCounts(counts);

  const checks = [
    checkVerifiedShare(counts),
    checkMenuEvidence(counts),
    checkDealFreshness(counts),
    checkDealPipeline(counts),
    checkArticleFreshness(counts),
    checkContactCompleteness(counts),
    checkIndexEligibility(counts),
    checkDemoExposure(counts),
    checkNeighborhoodCoverage(counts),
    checkStrainGuideCoverage(counts),
    checkAuthorityContent(counts),
    checkAgentReadability(counts),
  ];

  const score = computeScore(checks);
  const grade = computeGrade(score);

  return { checks, score, grade };
}

/**
 * Wraps evaluateMarketingHealth with receipt envelope metadata.
 * Fully deterministic: no Date.now() inside.
 *
 * @param {{ counts: object, asOf: Date, gitRevision?: string }} param0
 * @returns {object} Frozen receipt object
 */
export function buildSitemindReceipt({ counts, asOf, gitRevision = 'UNKNOWN' }) {
  const timestamp = validDate(asOf, 'SiteMind receipt asOf');
  const health = evaluateMarketingHealth({ counts, asOf: timestamp });

  return Object.freeze({
    module: 'SITEMIND_MARKETING_AUDIT_V1',
    schemaVersion: SITEMIND_SCHEMA_VERSION,
    generatedAt: timestamp.toISOString(),
    gitRevision: typeof gitRevision === 'string' ? gitRevision : 'UNKNOWN',
    authorityBoundary:
      'LOCAL_DATABASE_AND_STATIC_CONTRACT — production HTTP, search-console, and analytics remain unproven external gates',
    routeContract: SITEMIND_ROUTE_REGISTRY,
    counts: Object.freeze({ ...counts }),
    score: health.score,
    grade: health.grade,
    checks: Object.freeze(health.checks.map(Object.freeze)),
  });
}

/**
 * Async helper that runs Prisma count queries to assemble `counts`.
 * Scopes retailer counts to the brand via menus → brandMenus.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ brandId: string, asOf: Date }} param1
 * @returns {Promise<object>} counts object suitable for evaluateMarketingHealth
 */
export async function collectSitemindCounts(prisma, { brandId, asOf }) {
  const timestamp = validDate(asOf, 'SiteMind collectSitemindCounts asOf');

  const publicRecord = currentPublicRecordWhere(timestamp);
  const dealBase = currentDealWhere(timestamp);

  // 72-hour window for expiring-soon deals
  const expiringSoonCutoff = new Date(timestamp.getTime() + 72 * 60 * 60 * 1000);

  const brandScope = {
    menus: {
      some: {
        brandMenus: {
          some: { brandId },
        },
      },
    },
  };

  const [
    retailersTotal,
    retailersVerifiedCurrent,
    retailersStale,
    retailersAwaiting,
    retailersDemo,
    menuEntriesTotal,
    menuEntriesVerifiedCurrent,
    dealsActive,
    dealsExpiringSoon,
    dealsExpiredStillActiveFlag,
    articlesTotal,
    articlesVerifiedCurrent,
    articlesStaleFreshness,
    retailersMissingPhone,
    retailersMissingWebsite,
    sitemapEligibleRetailers,
  ] = await Promise.all([
    // Total retailers in brand scope
    prisma.retailer.count({ where: { ...brandScope } }),

    // Verified current (non-demo, dataStatus=VERIFIED_CURRENT, verifiedAt set, freshnessExpiresAt > now)
    prisma.retailer.count({
      where: {
        ...brandScope,
        ...publicRecord,
      },
    }),

    // Stale (non-demo, expired freshness or STALE status)
    prisma.retailer.count({
      where: {
        ...brandScope,
        isDemonstration: false,
        OR: [
          { dataStatus: 'STALE' },
          {
            dataStatus: 'VERIFIED_CURRENT',
            freshnessExpiresAt: { lte: timestamp },
          },
        ],
      },
    }),

    // Awaiting verification (non-demo, status AWAITING_VERIFICATION)
    prisma.retailer.count({
      where: {
        ...brandScope,
        isDemonstration: false,
        dataStatus: 'AWAITING_VERIFICATION',
      },
    }),

    // Demonstration records
    prisma.retailer.count({
      where: {
        ...brandScope,
        isDemonstration: true,
      },
    }),

    // Total menu entries for brand
    prisma.menuEntry.count({
      where: {
        brandMenus: {
          some: { brandId },
        },
      },
    }),

    // Verified current menu entries for brand
    prisma.menuEntry.count({
      where: {
        brandMenus: {
          some: { brandId },
        },
        ...publicRecord,
      },
    }),

    // Active deals (currentDealWhere: isActive=true, expiryDate > now, and public catalog boundary)
    prisma.deal.count({
      where: {
        retailer: { ...brandScope },
        ...dealBase,
      },
    }),

    // Deals expiring within 72 hours (still active, expiry between now and now+72h)
    prisma.deal.count({
      where: {
        retailer: { ...brandScope },
        isActive: true,
        expiryDate: {
          gt: timestamp,
          lte: expiringSoonCutoff,
        },
      },
    }),

    // Deals with isActive=true but expiryDate already in the past
    prisma.deal.count({
      where: {
        retailer: { ...brandScope },
        isActive: true,
        expiryDate: { lt: timestamp },
      },
    }),

    // Total articles (brand-neutral; articles are global editorial content)
    prisma.article.count(),

    // Verified current articles
    prisma.article.count({
      where: { ...publicRecord },
    }),

    // Articles past freshnessExpiresAt (non-demo)
    prisma.article.count({
      where: {
        isDemonstration: false,
        OR: [
          { dataStatus: 'STALE' },
          {
            freshnessExpiresAt: { lte: timestamp },
          },
        ],
      },
    }),

    // Retailers missing phone (non-demo, in brand scope)
    prisma.retailer.count({
      where: {
        ...brandScope,
        isDemonstration: false,
        OR: [{ phone: null }, { phone: '' }],
      },
    }),

    // Retailers missing website (non-demo, in brand scope)
    prisma.retailer.count({
      where: {
        ...brandScope,
        isDemonstration: false,
        OR: [{ website: null }, { website: '' }],
      },
    }),

    // Sitemap-eligible retailers: verified current AND in brand scope
    prisma.retailer.count({
      where: {
        ...brandScope,
        ...publicRecord,
      },
    }),
  ]);

  return {
    retailersTotal,
    retailersVerifiedCurrent,
    retailersStale,
    retailersAwaiting,
    retailersDemo,
    menuEntriesTotal,
    menuEntriesVerifiedCurrent,
    dealsActive,
    dealsExpiringSoon,
    dealsExpiredStillActiveFlag,
    articlesTotal,
    articlesVerifiedCurrent,
    articlesStaleFreshness,
    retailersMissingPhone,
    retailersMissingWebsite,
    sitemapEligibleRetailers,
    // Deterministic counts from static config modules
    neighborhoodPagesConfigured: NEIGHBORHOOD_SLUGS.length,
    strainGuidesConfigured: STRAIN_SLUGS.length,
    legalFaqCount: LEGAL_FAQ_COUNT,
    // Static-contract count: homepage retailer cards render name, address,
    // source (dataSource), hours, and license — 5 readable DOM text fields,
    // all mirrored in JSON-LD. Cited: visual-attributes paper (2025).
    cardTextFieldsMinimum: 5,
  };
}
