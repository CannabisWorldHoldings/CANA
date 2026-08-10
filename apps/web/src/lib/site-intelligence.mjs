import { createHash } from 'node:crypto';

export const SITE_INTELLIGENCE_SCHEMA_VERSION = 2;
export const MAX_SITE_INTELLIGENCE_SNAPSHOTS = 100;

export const SITE_ROUTE_INVENTORY = Object.freeze([
  Object.freeze({
    id: 'directory',
    pathPattern: '/',
    source: 'src/app/[domain]/page.tsx',
    indexable: true,
  }),
  Object.freeze({
    id: 'retailer',
    pathPattern: '/retailer/[id]',
    source: 'src/app/[domain]/retailer/[id]/page.tsx',
    indexable: true,
  }),
  Object.freeze({
    id: 'products',
    pathPattern: '/products',
    source: 'src/app/[domain]/products/page.tsx',
    indexable: true,
  }),
  Object.freeze({
    id: 'education-index',
    pathPattern: '/education',
    source: 'src/app/[domain]/education/page.tsx',
    indexable: true,
  }),
  Object.freeze({
    id: 'education-article',
    pathPattern: '/education/[slug]',
    source: 'src/app/[domain]/education/[slug]/page.tsx',
    indexable: true,
  }),
  Object.freeze({
    id: 'neighborhood',
    pathPattern: '/neighborhoods/[slug]',
    source: 'src/app/[domain]/neighborhoods/[slug]/page.tsx',
    indexable: false,
  }),
  Object.freeze({
    id: 'compare',
    pathPattern: '/compare',
    source: 'src/app/[domain]/compare/page.tsx',
    indexable: false,
  }),
  Object.freeze({
    id: 'claim',
    pathPattern: '/business/claim',
    source: 'src/app/business/claim/page.tsx',
    indexable: false,
  }),
  Object.freeze({
    id: 'site-intelligence',
    pathPattern: '/admin/site-intelligence',
    source: 'src/app/admin/site-intelligence/page.tsx',
    indexable: false,
  }),
]);

const INTEGER_METRICS = Object.freeze([
  'brands',
  'retailersTotal',
  'retailersCurrent',
  'retailersDemonstration',
  'retailersStale',
  'retailersAwaiting',
  'retailersDisputed',
  'retailersMissingWebsite',
  'retailersMissingSource',
  'pendingEvidence',
  'pendingClaims',
  'pendingDisputes',
  'articlesTotal',
  'articlesCurrent',
  'articlesDemonstration',
  'articlesStale',
  'canonicalSitemapRetailers',
  'canonicalSitemapArticles',
  'leadsLast30Days',
  'persistedSnapshots',
  'marketSourceSnapshots',
  'marketClaimsTotal',
  'marketClaimsEligible',
  'marketClaimsUnknown',
  'marketResolutionsReviewRequired',
  'marketGapsOpen',
  'marketGapsClosed',
]);

function validDate(value, label) {
  const date = value ?? new Date();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid date.`);
  }
  return new Date(date);
}

function normalizedMetrics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Site intelligence metrics must be an object.');
  }

  const metrics = {};
  for (const key of INTEGER_METRICS) {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${key} must be a non-negative safe integer.`);
    }
    metrics[key] = value;
  }
  if (typeof input.canonicalBrandExists !== 'boolean') {
    throw new TypeError('canonicalBrandExists must be a boolean.');
  }
  metrics.canonicalBrandExists = input.canonicalBrandExists;
  return metrics;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function siteRouteInventoryHash() {
  return hashJson(SITE_ROUTE_INVENTORY);
}

function observation({
  key,
  plane,
  state,
  severity,
  title,
  summary,
  evidence,
  uncertainty,
  preparedAction,
  authority,
  quantity = null,
}) {
  return Object.freeze({
    key,
    plane,
    state,
    severity,
    title,
    summary,
    evidence,
    uncertainty,
    preparedAction,
    authority,
    quantity,
  });
}

function countPhrase(quantity, singular, plural = `${singular}s`) {
  return `${quantity} ${quantity === 1 ? singular : plural}`;
}

function buildObservations(metrics) {
  const reviewQueue =
    metrics.pendingEvidence + metrics.pendingClaims + metrics.pendingDisputes;
  const sourceGaps =
    metrics.retailersMissingWebsite + metrics.retailersMissingSource;
  const sitemapEntries =
    2 +
    metrics.canonicalSitemapRetailers +
    metrics.canonicalSitemapArticles;

  return Object.freeze([
    observation({
      key: 'PUBLIC_TRUTH_COVERAGE',
      plane: 'OBSERVATION',
      state: metrics.retailersCurrent > 0 ? 'HEALTHY' : 'ATTENTION',
      severity: metrics.retailersCurrent > 0 ? 'INFO' : 'HIGH',
      title: 'Evidence-backed retailer coverage',
      summary:
        metrics.retailersCurrent > 0
          ? `${metrics.retailersCurrent} non-demonstration retailer records currently satisfy the public truth boundary.`
          : 'No non-demonstration retailer record currently satisfies the public truth boundary.',
      evidence: `database: retailersCurrent=${metrics.retailersCurrent}; retailersTotal=${metrics.retailersTotal}`,
      uncertainty:
        'This measures local approved evidence only; it does not establish search visibility or real-world business status.',
      preparedAction:
        metrics.retailersCurrent > 0
          ? 'Keep evidence freshness windows under review.'
          : 'Review submitted license evidence; publish nothing until approval and freshness checks pass.',
      authority: 'ADMIN_REVIEW_REQUIRED',
      quantity: metrics.retailersCurrent,
    }),
    observation({
      key: 'DEMONSTRATION_BOUNDARY',
      plane: 'MEMORY_PROOF',
      state: 'GUARDED',
      severity: 'INFO',
      title: 'Demonstration records remain separated',
      summary: `${metrics.retailersDemonstration} retailer records are explicitly labeled as demonstration data.`,
      evidence: `database: retailersDemonstration=${metrics.retailersDemonstration}`,
      uncertainty:
        'A label is not independent proof; demonstration records remain ineligible for verified indexing.',
      preparedAction:
        'Preserve the demonstration flag and shared public-discovery policy.',
      authority: 'READ_ONLY',
      quantity: metrics.retailersDemonstration,
    }),
    observation({
      key: 'EVIDENCE_REVIEW_QUEUE',
      plane: 'ACTION',
      state: reviewQueue > 0 ? 'ATTENTION' : 'HEALTHY',
      severity: reviewQueue > 0 ? 'HIGH' : 'INFO',
      title: 'Human evidence review queue',
      summary: `${countPhrase(metrics.pendingEvidence, 'evidence item')}, ${countPhrase(metrics.pendingClaims, 'claim')}, and ${countPhrase(metrics.pendingDisputes, 'correction')} await review.`,
      evidence: `database: pendingEvidence=${metrics.pendingEvidence}; pendingClaims=${metrics.pendingClaims}; pendingDisputes=${metrics.pendingDisputes}`,
      uncertainty:
        'Queue presence says nothing about whether a submission is authentic or approvable.',
      preparedAction:
        reviewQueue > 0
          ? 'Inspect source evidence and use the existing atomic administrator review controls.'
          : 'Continue monitoring for new evidence-backed submissions.',
      authority: 'ADMIN_REVIEW_REQUIRED',
      quantity: reviewQueue,
    }),
    observation({
      key: 'FRESHNESS_DEBT',
      plane: 'OBSERVATION',
      state: metrics.retailersStale > 0 ? 'ATTENTION' : 'HEALTHY',
      severity: metrics.retailersStale > 0 ? 'HIGH' : 'INFO',
      title: 'Retailer freshness debt',
      summary: `${metrics.retailersStale} non-demonstration retailer records are stale or past their evidence window.`,
      evidence: `database: retailersStale=${metrics.retailersStale}`,
      uncertainty:
        'A stale local record may still describe a real business, but it is not eligible to claim current verification.',
      preparedAction:
        metrics.retailersStale > 0
          ? 'Re-check the cited source before refreshing any record.'
          : 'No freshness repair is currently prepared.',
      authority: 'ADMIN_REVIEW_REQUIRED',
      quantity: metrics.retailersStale,
    }),
    observation({
      key: 'SOURCE_COMPLETENESS',
      plane: 'INTELLIGENCE',
      state: sourceGaps > 0 ? 'ATTENTION' : 'HEALTHY',
      severity: sourceGaps > 0 ? 'MEDIUM' : 'INFO',
      title: 'Source and destination completeness',
      summary: `${metrics.retailersMissingWebsite} real retailer records lack a website and ${metrics.retailersMissingSource} lack a source reference.`,
      evidence: `database: missingWebsite=${metrics.retailersMissingWebsite}; missingSource=${metrics.retailersMissingSource}`,
      uncertainty:
        'A missing field is a local completeness signal, not proof that no public source exists.',
      preparedAction:
        sourceGaps > 0
          ? 'Request or research a public HTTPS source, then submit it through the evidence review boundary.'
          : 'No source-completeness repair is currently prepared.',
      authority: 'PREPARE_ONLY',
      quantity: sourceGaps,
    }),
    observation({
      key: 'EDITORIAL_INDEXABILITY',
      plane: 'INTELLIGENCE',
      state: metrics.articlesCurrent > 0 ? 'HEALTHY' : 'ATTENTION',
      severity: metrics.articlesCurrent > 0 ? 'INFO' : 'MEDIUM',
      title: 'Evidence-backed editorial inventory',
      summary: `${metrics.articlesCurrent} of ${metrics.articlesTotal} articles are current, non-demonstration, and sitemap eligible.`,
      evidence: `database: articlesCurrent=${metrics.articlesCurrent}; articlesDemonstration=${metrics.articlesDemonstration}; articlesStale=${metrics.articlesStale}`,
      uncertainty:
        'Eligibility does not prove indexing, ranking, traffic, or usefulness.',
      preparedAction:
        metrics.articlesCurrent > 0
          ? 'Measure external discovery only after Search Console is connected.'
          : 'Prepare source-backed editorial material; do not publish unsupported claims.',
      authority: 'PREPARE_ONLY',
      quantity: metrics.articlesCurrent,
    }),
    observation({
      key: 'CANONICAL_SITEMAP',
      plane: 'OBSERVATION',
      state: metrics.canonicalBrandExists ? 'HEALTHY' : 'ATTENTION',
      severity: metrics.canonicalBrandExists ? 'INFO' : 'HIGH',
      title: 'Canonical sitemap inventory',
      summary: metrics.canonicalBrandExists
        ? `${sitemapEntries} canonical sitemap entries are derivable from the current truth boundary.`
        : 'The canonical tenant record is missing, so retailer sitemap inventory cannot be derived.',
      evidence: `routes: base=2; retailers=${metrics.canonicalSitemapRetailers}; articles=${metrics.canonicalSitemapArticles}`,
      uncertainty:
        'Local sitemap generation does not prove that a public crawler can reach or index the URLs.',
      preparedAction: metrics.canonicalBrandExists
        ? 'Preserve canonical host and truth predicates.'
        : 'Restore the canonical brand configuration before any release.',
      authority: metrics.canonicalBrandExists
        ? 'READ_ONLY'
        : 'ADMIN_REVIEW_REQUIRED',
      quantity: sitemapEntries,
    }),
    observation({
      key: 'LOCAL_HANDOFF_OUTCOMES',
      plane: 'COMMERCIAL_REALITY',
      state: 'GUARDED',
      severity: 'INFO',
      title: 'Local handoff outcome evidence',
      summary: `${metrics.leadsLast30Days} verified handoff events were recorded during the last 30 days.`,
      evidence: `database: leadsLast30Days=${metrics.leadsLast30Days}`,
      uncertainty:
        'A handoff event proves only that orderweeddc recorded an eligible outbound action; it does not prove purchase or revenue.',
      preparedAction:
        'Use the local count for operational attribution only; do not label it conversion or revenue.',
      authority: 'READ_ONLY',
      quantity: metrics.leadsLast30Days,
    }),
    observation({
      key: 'REALITY_COMPILER_COVERAGE',
      plane: 'OBSERVATION',
      state: metrics.marketClaimsEligible > 0 ? 'HEALTHY' : 'ATTENTION',
      severity: metrics.marketClaimsEligible > 0 ? 'INFO' : 'HIGH',
      title: 'Verification Court market coverage',
      summary: `${metrics.marketClaimsEligible} of ${metrics.marketClaimsTotal} compiled market claims are decision eligible; ${metrics.marketClaimsUnknown} remain UNKNOWN and ${metrics.marketResolutionsReviewRequired} identity resolutions require review.`,
      evidence: `database: sourceSnapshots=${metrics.marketSourceSnapshots}; claimsTotal=${metrics.marketClaimsTotal}; claimsEligible=${metrics.marketClaimsEligible}; claimsUnknown=${metrics.marketClaimsUnknown}; resolutionsReviewRequired=${metrics.marketResolutionsReviewRequired}`,
      uncertainty:
        'Coverage measures only persisted court decisions from admitted snapshots; it does not prove whole-market completeness.',
      preparedAction:
        metrics.marketResolutionsReviewRequired > 0
          ? 'Review exact-identifier conflicts without using names or addresses as automatic identity.'
          : 'Keep snapshot freshness and court decisions under review.',
      authority: 'ADMIN_REVIEW_REQUIRED',
      quantity: metrics.marketClaimsEligible,
    }),
    observation({
      key: 'MARKET_GAP_FEEDBACK_LOOP',
      plane: 'INTELLIGENCE',
      state: metrics.marketGapsOpen > 0 ? 'ATTENTION' : 'HEALTHY',
      severity: metrics.marketGapsOpen > 0 ? 'MEDIUM' : 'INFO',
      title: 'ASK market-gap feedback loop',
      summary: `${metrics.marketGapsOpen} MARKET_GAP opportunities remain open and ${metrics.marketGapsClosed} have closed after a verified-candidate recheck.`,
      evidence: `database: marketGapsOpen=${metrics.marketGapsOpen}; marketGapsClosed=${metrics.marketGapsClosed}`,
      uncertainty:
        'A closed evidence gap proves answerability improved; it does not prove demand, conversion, or commercial value.',
      preparedAction:
        metrics.marketGapsOpen > 0
          ? 'Continue bounded OBSERVE_ONLY rechecks until evidence improves or recurrence expires.'
          : 'No market-gap recheck action is currently prepared.',
      authority: 'READ_ONLY',
      quantity: metrics.marketGapsOpen,
    }),
    observation({
      key: 'SEARCH_CONSOLE_GATE',
      plane: 'COMMERCIAL_REALITY',
      state: 'BLOCKED',
      severity: 'HIGH',
      title: 'Search Console evidence is not connected',
      summary:
        'orderweeddc has no accepted Google Search Console evidence for indexing, impressions, queries, or ranking.',
      evidence: 'external-gate: search-console=NOT_CONNECTED',
      uncertainty:
        'Search performance is unknown, not zero.',
      preparedAction:
        'Connect a separately authorized, read-only Search Console integration and record its provenance.',
      authority: 'EXTERNAL_CONNECTION_REQUIRED',
    }),
    observation({
      key: 'ANALYTICS_GATE',
      plane: 'COMMERCIAL_REALITY',
      state: 'BLOCKED',
      severity: 'HIGH',
      title: 'Analytics outcome evidence is not connected',
      summary:
        'orderweeddc has no accepted external analytics source for sessions, engagement, conversions, or revenue.',
      evidence: 'external-gate: analytics=NOT_CONNECTED',
      uncertainty:
        'Traffic and commercial outcomes are unknown.',
      preparedAction:
        'Connect a separately authorized analytics source with explicit metric definitions and retention limits.',
      authority: 'EXTERNAL_CONNECTION_REQUIRED',
    }),
    observation({
      key: 'PUBLIC_HTTPS_GATE',
      plane: 'COMMERCIAL_REALITY',
      state: 'BLOCKED',
      severity: 'HIGH',
      title: 'Public HTTPS crawl is not proven',
      summary:
        'The local release has not supplied external evidence that the canonical host is publicly reachable over HTTPS.',
      evidence: 'external-gate: public-https-crawl=NOT_VERIFIED',
      uncertainty:
        'Local production-server success cannot establish public DNS, TLS, caching, or crawler reachability.',
      preparedAction:
        'After separately authorized deployment, run an external crawl and preserve exact response evidence.',
      authority: 'EXTERNAL_CONNECTION_REQUIRED',
    }),
    observation({
      key: 'DEPLOYMENT_AUTHORITY',
      plane: 'ACTION',
      state: 'GUARDED',
      severity: 'INFO',
      title: 'Production mutation authority is closed',
      summary:
        'Site Brain observations can be captured, but they cannot publish content, change routes, or deploy the application.',
      evidence: 'policy: site-intelligence=READ_AND_CAPTURE_ONLY',
      uncertainty:
        'Prepared actions still require implementation, deterministic verification, and explicit release authority.',
      preparedAction:
        'Keep every proposed change reviewable and independently verifiable before release.',
      authority: 'PREPARE_ONLY',
    }),
  ]);
}

export function buildSiteIntelligenceSnapshot(
  inputMetrics,
  asOf = new Date(),
) {
  const metrics = Object.freeze(normalizedMetrics(inputMetrics));
  const capturedAt = validDate(asOf, 'Site intelligence time');
  const routeInventoryHash = siteRouteInventoryHash();
  const observations = buildObservations(metrics);
  const attentionCount = observations.filter(
    ({ state }) => state === 'ATTENTION',
  ).length;
  const blockedCount = observations.filter(
    ({ state }) => state === 'BLOCKED',
  ).length;
  const fingerprint = hashJson({
    schemaVersion: SITE_INTELLIGENCE_SCHEMA_VERSION,
    routeInventoryHash,
    metrics,
    observations,
  });

  return Object.freeze({
    schemaVersion: SITE_INTELLIGENCE_SCHEMA_VERSION,
    asOf: capturedAt,
    fingerprint,
    routeInventoryHash,
    localEvidenceStatus: 'AVAILABLE',
    externalEvidenceStatus: 'NOT_CONNECTED',
    metrics,
    planes: Object.freeze([
      Object.freeze({
        name: 'Observation',
        status: 'READY',
        proof: 'Canonical routes and local database truth state',
      }),
      Object.freeze({
        name: 'Intelligence',
        status: 'READY',
        proof: 'Deterministic, versioned observation rules',
      }),
      Object.freeze({
        name: 'Memory & proof',
        status: 'READY',
        proof: 'Bounded immutable database snapshots',
      }),
      Object.freeze({
        name: 'Action',
        status: 'GUARDED',
        proof: 'Prepared guidance only; administrator review required',
      }),
      Object.freeze({
        name: 'Commercial reality',
        status: 'BLOCKED',
        proof: 'External search, analytics, and HTTPS evidence not connected',
      }),
    ]),
    observations,
    observationCount: observations.length,
    attentionCount,
    blockedCount,
  });
}

export async function persistSiteIntelligenceSnapshot(
  db,
  { snapshot, actorUserId },
) {
  if (!snapshot || snapshot.schemaVersion !== SITE_INTELLIGENCE_SCHEMA_VERSION) {
    throw new TypeError('Unsupported site intelligence snapshot.');
  }
  const canonicalSnapshot = buildSiteIntelligenceSnapshot(
    snapshot.metrics,
    snapshot.asOf,
  );
  if (snapshot.fingerprint !== canonicalSnapshot.fingerprint) {
    throw new TypeError('Site intelligence snapshot integrity check failed.');
  }
  if (
    typeof actorUserId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      actorUserId,
    )
  ) {
    throw new TypeError('Actor user ID must be a UUID.');
  }

  return db.$transaction(async (transaction) => {
    const captured = await transaction.siteIntelligenceSnapshot.create({
      data: {
        fingerprint: canonicalSnapshot.fingerprint,
        schemaVersion: canonicalSnapshot.schemaVersion,
        capturedById: actorUserId,
        asOf: canonicalSnapshot.asOf,
        routeInventoryHash: canonicalSnapshot.routeInventoryHash,
        localEvidenceStatus: canonicalSnapshot.localEvidenceStatus,
        externalEvidenceStatus: canonicalSnapshot.externalEvidenceStatus,
        observationCount: canonicalSnapshot.observationCount,
        attentionCount: canonicalSnapshot.attentionCount,
        blockedCount: canonicalSnapshot.blockedCount,
        observations: {
          create: canonicalSnapshot.observations.map((item) => ({
            observationKey: item.key,
            plane: item.plane,
            state: item.state,
            severity: item.severity,
            title: item.title,
            summary: item.summary,
            evidence: item.evidence,
            uncertainty: item.uncertainty,
            preparedAction: item.preparedAction,
            authority: item.authority,
            quantity: item.quantity,
          })),
        },
      },
      select: { id: true, capturedAt: true },
    });

    await transaction.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'CAPTURE_SITE_INTELLIGENCE',
        details: `snapshotId=${captured.id} observations=${canonicalSnapshot.observationCount}`,
      },
    });

    const expiredSnapshots = await transaction.siteIntelligenceSnapshot.findMany(
      {
        select: { id: true },
        orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
        skip: MAX_SITE_INTELLIGENCE_SNAPSHOTS,
      },
    );
    if (expiredSnapshots.length > 0) {
      await transaction.siteIntelligenceSnapshot.deleteMany({
        where: {
          id: { in: expiredSnapshots.map(({ id }) => id) },
        },
      });
    }

    return {
      outcome: 'CAPTURED',
      snapshotId: captured.id,
      capturedAt: captured.capturedAt,
      prunedSnapshots: expiredSnapshots.length,
    };
  });
}
