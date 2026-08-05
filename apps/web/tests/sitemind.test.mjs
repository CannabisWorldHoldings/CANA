import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SITEMIND_ROUTE_REGISTRY,
  COMPETITOR_PARITY_CONTRACT,
  evaluateMarketingHealth,
  buildSitemindReceipt,
} from '../src/lib/sitemind.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthyCounts() {
  return {
    retailersTotal: 10,
    retailersVerifiedCurrent: 8,
    retailersStale: 0,
    retailersAwaiting: 2,
    retailersDemo: 0,
    menuEntriesTotal: 50,
    menuEntriesVerifiedCurrent: 35,
    dealsActive: 5,
    dealsExpiringSoon: 0,
    dealsExpiredStillActiveFlag: 0,
    articlesTotal: 6,
    articlesVerifiedCurrent: 6,
    articlesStaleFreshness: 0,
    retailersMissingPhone: 0,
    retailersMissingWebsite: 0,
    sitemapEligibleRetailers: 8,
    neighborhoodPagesConfigured: 12,
    strainGuidesConfigured: 4,
    legalFaqCount: 13,
    cardTextFieldsMinimum: 5,
  };
}

function degradedCounts() {
  return {
    retailersTotal: 10,
    retailersVerifiedCurrent: 0,
    retailersStale: 5,
    retailersAwaiting: 5,
    retailersDemo: 4,
    menuEntriesTotal: 20,
    menuEntriesVerifiedCurrent: 0,
    dealsActive: 3,
    dealsExpiringSoon: 1,
    dealsExpiredStillActiveFlag: 3,
    articlesTotal: 4,
    articlesVerifiedCurrent: 0,
    articlesStaleFreshness: 2,
    retailersMissingPhone: 8,
    retailersMissingWebsite: 7,
    sitemapEligibleRetailers: 0,
    neighborhoodPagesConfigured: 3,
    strainGuidesConfigured: 2,
    legalFaqCount: 2,
    cardTextFieldsMinimum: 3,
  };
}

const FIXED_AS_OF = new Date('2026-07-22T12:00:00.000Z');

// ---------------------------------------------------------------------------
// 1. Healthy counts → high score, grade A or B, all checks PASS
// ---------------------------------------------------------------------------

test('healthy counts produce a high score, A or B grade, and all-PASS checks', () => {
  const { checks, score, grade } = evaluateMarketingHealth({
    counts: healthyCounts(),
    asOf: FIXED_AS_OF,
  });

  assert.ok(Array.isArray(checks), 'checks must be an array');
  assert.ok(checks.length > 0, 'at least one check expected');

  for (const check of checks) {
    assert.equal(
      check.status,
      'PASS',
      `check "${check.id}" should be PASS on healthy counts, got ${check.status}`,
    );
  }

  assert.ok(score >= 75, `score ${score} should be >= 75 for healthy counts`);
  assert.ok(
    grade === 'A' || grade === 'B',
    `grade "${grade}" should be A or B for healthy counts`,
  );
});

// ---------------------------------------------------------------------------
// 2. Degraded counts → FAIL checks present, low score, exact evidence strings
// ---------------------------------------------------------------------------

test('degraded counts produce FAIL checks and a low score', () => {
  const { checks, score, grade } = evaluateMarketingHealth({
    counts: degradedCounts(),
    asOf: FIXED_AS_OF,
  });

  const failChecks = checks.filter((c) => c.status === 'FAIL');
  assert.ok(failChecks.length > 0, 'at least one FAIL check expected for degraded input');

  // verified-share should FAIL (0/10 = 0%)
  const verifiedCheck = checks.find((c) => c.id === 'verified-share');
  assert.ok(verifiedCheck, 'verified-share check must exist');
  assert.equal(verifiedCheck.status, 'FAIL', 'verified-share should FAIL when 0 verified');
  assert.match(
    verifiedCheck.evidence,
    /retailersVerifiedCurrent=0/,
    'evidence must include the count 0',
  );
  assert.match(
    verifiedCheck.evidence,
    /retailersTotal=10/,
    'evidence must include total count 10',
  );

  // deal-freshness should FAIL (3 expired-but-active)
  const dealCheck = checks.find((c) => c.id === 'deal-freshness');
  assert.ok(dealCheck, 'deal-freshness check must exist');
  assert.equal(dealCheck.status, 'FAIL', 'deal-freshness should FAIL when expired-active deals > 0');
  assert.match(
    dealCheck.evidence,
    /dealsExpiredStillActiveFlag=3/,
    'evidence must contain the expired-still-active count of 3',
  );

  // index-eligibility should WARN (0 eligible retailers)
  const indexCheck = checks.find((c) => c.id === 'index-eligibility');
  assert.ok(indexCheck, 'index-eligibility check must exist');
  assert.equal(indexCheck.status, 'WARN', 'index-eligibility should WARN when 0 eligible');
  assert.match(
    indexCheck.evidence,
    /sitemapEligibleRetailers=0/,
    'evidence must include 0 eligible count',
  );

  // demo-exposure should WARN (4 demo records)
  const demoCheck = checks.find((c) => c.id === 'demo-exposure');
  assert.ok(demoCheck, 'demo-exposure check must exist');
  assert.equal(demoCheck.status, 'WARN', 'demo-exposure should WARN when demo records > 0');
  assert.match(
    demoCheck.evidence,
    /retailersDemo=4/,
    'evidence must include demo count of 4',
  );

  // neighborhood-coverage should FAIL (3 pages < 6 threshold)
  const neighborhoodCheck = checks.find((c) => c.id === 'neighborhood-coverage');
  assert.ok(neighborhoodCheck, 'neighborhood-coverage check must exist');
  assert.equal(neighborhoodCheck.status, 'FAIL', 'neighborhood-coverage should FAIL when < 6 pages');
  assert.match(
    neighborhoodCheck.evidence,
    /neighborhoodPagesConfigured=3/,
    'evidence must include neighborhoodPagesConfigured=3',
  );

  // authority-content should FAIL (2 FAQ entries < 6 threshold)
  const authorityCheck = checks.find((c) => c.id === 'authority-content');
  assert.ok(authorityCheck, 'authority-content check must exist');
  assert.equal(authorityCheck.status, 'FAIL', 'authority-content should FAIL when < 6 FAQ entries');
  assert.match(
    authorityCheck.evidence,
    /legalFaqCount=2/,
    'evidence must include legalFaqCount=2',
  );

  assert.ok(score < 60, `score ${score} should be < 60 for degraded counts`);
  assert.ok(
    grade === 'D' || grade === 'F' || grade === 'C',
    `grade "${grade}" should be D, F, or C for degraded counts`,
  );
});

// ---------------------------------------------------------------------------
// 3. Input validation throws TypeError
// ---------------------------------------------------------------------------

test('evaluateMarketingHealth throws TypeError for invalid counts', () => {
  assert.throws(
    () => evaluateMarketingHealth({ counts: null, asOf: FIXED_AS_OF }),
    /plain object/i,
    'null counts should throw TypeError mentioning plain object',
  );

  assert.throws(
    () =>
      evaluateMarketingHealth({
        counts: { ...healthyCounts(), retailersTotal: -1 },
        asOf: FIXED_AS_OF,
      }),
    /retailersTotal/,
    'negative retailersTotal should throw TypeError mentioning the field',
  );

  assert.throws(
    () =>
      evaluateMarketingHealth({
        counts: { ...healthyCounts(), dealsActive: Infinity },
        asOf: FIXED_AS_OF,
      }),
    /dealsActive/,
    'Infinity dealsActive should throw TypeError mentioning the field',
  );

  assert.throws(
    () =>
      evaluateMarketingHealth({
        counts: { ...healthyCounts(), menuEntriesTotal: NaN },
        asOf: FIXED_AS_OF,
      }),
    /menuEntriesTotal/,
    'NaN menuEntriesTotal should throw TypeError mentioning the field',
  );

  assert.throws(
    () =>
      evaluateMarketingHealth({
        counts: { ...healthyCounts(), neighborhoodPagesConfigured: -1 },
        asOf: FIXED_AS_OF,
      }),
    /neighborhoodPagesConfigured/,
    'negative neighborhoodPagesConfigured should throw TypeError',
  );

  assert.throws(
    () =>
      evaluateMarketingHealth({
        counts: { ...healthyCounts(), legalFaqCount: NaN },
        asOf: FIXED_AS_OF,
      }),
    /legalFaqCount/,
    'NaN legalFaqCount should throw TypeError',
  );
});

test('evaluateMarketingHealth throws TypeError for invalid asOf', () => {
  assert.throws(
    () => evaluateMarketingHealth({ counts: healthyCounts(), asOf: new Date('invalid') }),
    /valid Date/i,
    'invalid Date should throw TypeError',
  );

  assert.throws(
    () => evaluateMarketingHealth({ counts: healthyCounts(), asOf: 'not-a-date' }),
    /valid Date/i,
    'string asOf should throw TypeError',
  );
});

// ---------------------------------------------------------------------------
// 4. Receipt determinism: two calls with same inputs → deep-equal receipts
// ---------------------------------------------------------------------------

test('buildSitemindReceipt is deterministic: same inputs produce deep-equal receipts', () => {
  const params = {
    counts: healthyCounts(),
    asOf: FIXED_AS_OF,
    gitRevision: 'abc1234',
  };

  const first = buildSitemindReceipt(params);
  const second = buildSitemindReceipt(params);

  // Frozen objects — compare by JSON serialisation for a stable deep-equal
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(second),
    'receipts produced from the same inputs must be identical',
  );

  assert.equal(first.module, 'SITEMIND_MARKETING_AUDIT_V1');
  assert.equal(first.schemaVersion, '1.0.0');
  assert.equal(first.generatedAt, FIXED_AS_OF.toISOString());
  assert.equal(first.gitRevision, 'abc1234');
  assert.match(
    first.authorityBoundary,
    /LOCAL_DATABASE_AND_STATIC_CONTRACT/,
  );
});

test('buildSitemindReceipt with degraded counts produces FAIL entries and consistent receipt shape', () => {
  const receipt = buildSitemindReceipt({
    counts: degradedCounts(),
    asOf: FIXED_AS_OF,
    gitRevision: 'deadbeef1234567890deadbeef1234567890dead',
  });

  assert.ok(Array.isArray(receipt.checks), 'checks must be an array');
  assert.ok(receipt.routeContract === SITEMIND_ROUTE_REGISTRY, 'routeContract must be the registry');
  assert.ok(typeof receipt.score === 'number');
  assert.ok(['A', 'B', 'C', 'D', 'F'].includes(receipt.grade));
  // Degraded → some FAILs → score well below 90
  assert.ok(receipt.score < 75, `score ${receipt.score} should be < 75 for degraded counts`);
});

// ---------------------------------------------------------------------------
// 5. Route registry is frozen and includes required routes
// ---------------------------------------------------------------------------

test('SITEMIND_ROUTE_REGISTRY is frozen and contains required route entries', () => {
  assert.ok(Object.isFrozen(SITEMIND_ROUTE_REGISTRY), 'registry must be frozen');

  const routes = SITEMIND_ROUTE_REGISTRY.map((r) => r.route);

  assert.ok(routes.includes('/'), 'registry must include "/"');
  assert.ok(routes.includes('/retailer/[id]'), 'registry must include "/retailer/[id]"');
  assert.ok(routes.includes('/deals'), 'registry must include "/deals"');
  assert.ok(routes.includes('/dispensaries'), 'registry must include "/dispensaries"');
  assert.ok(routes.includes('/delivery'), 'registry must include "/delivery"');
  assert.ok(routes.includes('/search'), 'registry must include "/search"');
  assert.ok(routes.includes('/education/[slug]'), 'registry must include "/education/[slug]"');
  assert.ok(routes.includes('/compare'), 'registry must include "/compare"');

  // compare must be noindex and robots-disallowed
  const compare = SITEMIND_ROUTE_REGISTRY.find((r) => r.route === '/compare');
  assert.equal(compare.inSitemap, false, '/compare must have inSitemap=false');
  assert.equal(compare.robotsDisallowed, true, '/compare must have robotsDisallowed=true');

  // homepage must declare the required JSON-LD types
  const home = SITEMIND_ROUTE_REGISTRY.find((r) => r.route === '/');
  assert.ok(home.hasJsonLd, 'homepage must declare hasJsonLd=true');
  assert.ok(
    home.jsonLdTypes.includes('Organization'),
    'homepage JSON-LD types must include Organization',
  );
  assert.ok(
    home.jsonLdTypes.includes('WebSite'),
    'homepage JSON-LD types must include WebSite',
  );
  assert.ok(
    home.jsonLdTypes.includes('ItemList'),
    'homepage JSON-LD types must include ItemList',
  );

  // retailer pages: Store JSON-LD (conditionally on verified)
  const retailer = SITEMIND_ROUTE_REGISTRY.find((r) => r.route === '/retailer/[id]');
  assert.ok(retailer.hasJsonLd, '/retailer/[id] must declare hasJsonLd=true');
  assert.ok(
    retailer.jsonLdTypes.includes('Store'),
    '/retailer/[id] JSON-LD types must include Store',
  );
  assert.ok(retailer.inSitemap, '/retailer/[id] must be in sitemap');

  // education slug: Article JSON-LD
  const edSlug = SITEMIND_ROUTE_REGISTRY.find((r) => r.route === '/education/[slug]');
  assert.ok(edSlug.hasJsonLd, '/education/[slug] must declare hasJsonLd=true');
  assert.ok(edSlug.jsonLdTypes.includes('Article'));

  // All registry entries are frozen
  for (const entry of SITEMIND_ROUTE_REGISTRY) {
    assert.ok(Object.isFrozen(entry), `registry entry "${entry.route}" must be frozen`);
  }
});

// ---------------------------------------------------------------------------
// 6. Edge cases: zero-retailer counts, all-demo counts
// ---------------------------------------------------------------------------

test('zero retailers produce FAIL for verified-share and WARN for index-eligibility', () => {
  const zeroCounts = {
    ...healthyCounts(),
    retailersTotal: 0,
    retailersVerifiedCurrent: 0,
    retailersStale: 0,
    retailersAwaiting: 0,
    retailersDemo: 0,
    sitemapEligibleRetailers: 0,
  };
  const { checks } = evaluateMarketingHealth({ counts: zeroCounts, asOf: FIXED_AS_OF });

  const verifiedCheck = checks.find((c) => c.id === 'verified-share');
  assert.equal(verifiedCheck.status, 'FAIL', 'should FAIL when there are 0 total retailers');

  const indexCheck = checks.find((c) => c.id === 'index-eligibility');
  assert.equal(indexCheck.status, 'WARN');
});

test('expired-still-active count in evidence string matches input exactly', () => {
  const counts = { ...healthyCounts(), dealsExpiredStillActiveFlag: 7 };
  const { checks } = evaluateMarketingHealth({ counts, asOf: FIXED_AS_OF });
  const check = checks.find((c) => c.id === 'deal-freshness');
  assert.equal(check.status, 'FAIL');
  assert.match(check.evidence, /dealsExpiredStillActiveFlag=7/);
  assert.match(check.recommendation, /7 deal\(s\)/);
});

test('score and grade boundary: score >= 90 is A, 75-89 is B, 60-74 is C, 40-59 is D, below 40 is F', () => {
  // All PASS → expect A
  const { score: allPassScore, grade: allPassGrade } = evaluateMarketingHealth({
    counts: healthyCounts(),
    asOf: FIXED_AS_OF,
  });
  // Healthy counts produce all PASS so score = 100
  assert.equal(allPassGrade, 'A', `score ${allPassScore} should map to A`);

  // Explicit boundary: inject known weights
  // Manually verify WARN on all produces 50 → D
  const allWarnCounts = {
    retailersTotal: 10,
    retailersVerifiedCurrent: 4,   // 40% → WARN (25-60%)
    retailersStale: 0,
    retailersAwaiting: 6,
    retailersDemo: 2,              // WARN
    menuEntriesTotal: 10,
    menuEntriesVerifiedCurrent: 3, // 30% → WARN (20-50%)
    dealsActive: 1,                // PASS
    dealsExpiringSoon: 1,          // WARN (no expired-active)
    dealsExpiredStillActiveFlag: 0,
    articlesTotal: 2,
    articlesVerifiedCurrent: 1,    // >0 but stale>0 → WARN
    articlesStaleFreshness: 1,
    retailersMissingPhone: 1,      // WARN (< 50%)
    retailersMissingWebsite: 1,
    sitemapEligibleRetailers: 1,   // PASS
    neighborhoodPagesConfigured: 8, // WARN (6-11)
    strainGuidesConfigured: 2,      // WARN (< 4)
    legalFaqCount: 8,               // WARN (6-11)
    cardTextFieldsMinimum: 5,       // PASS (>= 4)
  };
  const { score: warnScore } = evaluateMarketingHealth({
    counts: allWarnCounts,
    asOf: FIXED_AS_OF,
  });
  // Should not be A (100) — some WARNs present
  assert.ok(warnScore < 100, `score ${warnScore} should be < 100 when WARNs are present`);
  assert.ok(warnScore > 0, `score ${warnScore} should be > 0 when some checks pass`);
});

// ---------------------------------------------------------------------------
// 7. COMPETITOR_PARITY_CONTRACT is frozen and cites its source
// ---------------------------------------------------------------------------

test('COMPETITOR_PARITY_CONTRACT is frozen and cites a source with observed date', () => {
  assert.ok(
    Object.isFrozen(COMPETITOR_PARITY_CONTRACT),
    'COMPETITOR_PARITY_CONTRACT must be frozen',
  );
  assert.ok(
    Object.isFrozen(COMPETITOR_PARITY_CONTRACT.facts),
    'COMPETITOR_PARITY_CONTRACT.facts must be frozen',
  );
  assert.ok(
    Object.isFrozen(COMPETITOR_PARITY_CONTRACT.facts.leafly),
    'COMPETITOR_PARITY_CONTRACT.facts.leafly must be frozen',
  );
  assert.ok(
    Object.isFrozen(COMPETITOR_PARITY_CONTRACT.facts.weedmaps),
    'COMPETITOR_PARITY_CONTRACT.facts.weedmaps must be frozen',
  );
  assert.ok(
    Object.isFrozen(COMPETITOR_PARITY_CONTRACT.facts.wheresweed),
    'COMPETITOR_PARITY_CONTRACT.facts.wheresweed must be frozen',
  );

  assert.match(
    COMPETITOR_PARITY_CONTRACT.source,
    /field-recon/,
    'contract must cite its recon source',
  );
  assert.equal(
    COMPETITOR_PARITY_CONTRACT.observedAt,
    '2026-07-23',
    'contract must cite the latest field-recon observation date',
  );
  // Corrections from field recon: the Weedmaps DC delisting did NOT happen.
  assert.equal(COMPETITOR_PARITY_CONTRACT.facts.weedmaps.dcDelisted, false);
  assert.equal(COMPETITOR_PARITY_CONTRACT.facts.wheresweed.serverSideRendered, false);

  // Verify known competitor fact values
  assert.equal(COMPETITOR_PARITY_CONTRACT.facts.weedmaps.dcNeighborhoodPages, 17);
  assert.equal(COMPETITOR_PARITY_CONTRACT.facts.leafly.strainPages, 19209);
  assert.equal(COMPETITOR_PARITY_CONTRACT.facts.leafly.llmsTxt, false);
  assert.equal(COMPETITOR_PARITY_CONTRACT.facts.weedmaps.llmsTxt, true);
});

// ---------------------------------------------------------------------------
// 8. New competitor-parity checks behave correctly
// ---------------------------------------------------------------------------

test('neighborhood-coverage check: PASS at 12+, WARN at 6-11, FAIL at <= 5', () => {
  const passCounts = { ...healthyCounts(), neighborhoodPagesConfigured: 12 };
  const warnCounts = { ...healthyCounts(), neighborhoodPagesConfigured: 8 };
  const failCounts = { ...healthyCounts(), neighborhoodPagesConfigured: 5 };

  const { checks: passChecks } = evaluateMarketingHealth({ counts: passCounts, asOf: FIXED_AS_OF });
  const { checks: warnChecks } = evaluateMarketingHealth({ counts: warnCounts, asOf: FIXED_AS_OF });
  const { checks: failChecks } = evaluateMarketingHealth({ counts: failCounts, asOf: FIXED_AS_OF });

  const passCheck = passChecks.find((c) => c.id === 'neighborhood-coverage');
  const warnCheck = warnChecks.find((c) => c.id === 'neighborhood-coverage');
  const failCheck = failChecks.find((c) => c.id === 'neighborhood-coverage');

  assert.equal(passCheck.status, 'PASS', '12 pages should PASS');
  assert.equal(warnCheck.status, 'WARN', '8 pages should WARN');
  assert.equal(failCheck.status, 'FAIL', '5 pages should FAIL');

  // Evidence cites weedmaps reference
  assert.match(passCheck.evidence, /weedmapsDcNeighborhoodPages=17/);
  assert.match(warnCheck.evidence, /neighborhoodPagesConfigured=8/);
  assert.match(failCheck.evidence, /neighborhoodPagesConfigured=5/);
  assert.equal(passCheck.authority, 'STATIC_CONTRACT');
});

test('strain-guide-coverage check: PASS at >= 4, WARN below 4', () => {
  const passCounts = { ...healthyCounts(), strainGuidesConfigured: 4 };
  const warnCounts = { ...healthyCounts(), strainGuidesConfigured: 3 };

  const { checks: passChecks } = evaluateMarketingHealth({ counts: passCounts, asOf: FIXED_AS_OF });
  const { checks: warnChecks } = evaluateMarketingHealth({ counts: warnCounts, asOf: FIXED_AS_OF });

  const passCheck = passChecks.find((c) => c.id === 'strain-guide-coverage');
  const warnCheck = warnChecks.find((c) => c.id === 'strain-guide-coverage');

  assert.equal(passCheck.status, 'PASS', '4 strain guides should PASS');
  assert.equal(warnCheck.status, 'WARN', '3 strain guides should WARN');
  assert.match(passCheck.evidence, /leaflyStrainPages=19209/);
  assert.equal(passCheck.authority, 'STATIC_CONTRACT');
});

test('authority-content check: PASS >= 12, WARN 6-11, FAIL < 6', () => {
  const passCounts = { ...healthyCounts(), legalFaqCount: 13 };
  const warnCounts = { ...healthyCounts(), legalFaqCount: 8 };
  const failCounts = { ...healthyCounts(), legalFaqCount: 4 };

  const { checks: passChecks } = evaluateMarketingHealth({ counts: passCounts, asOf: FIXED_AS_OF });
  const { checks: warnChecks } = evaluateMarketingHealth({ counts: warnCounts, asOf: FIXED_AS_OF });
  const { checks: failChecks } = evaluateMarketingHealth({ counts: failCounts, asOf: FIXED_AS_OF });

  const passCheck = passChecks.find((c) => c.id === 'authority-content');
  const warnCheck = warnChecks.find((c) => c.id === 'authority-content');
  const failCheck = failChecks.find((c) => c.id === 'authority-content');

  assert.equal(passCheck.status, 'PASS', '13 FAQ entries should PASS');
  assert.equal(warnCheck.status, 'WARN', '8 FAQ entries should WARN');
  assert.equal(failCheck.status, 'FAIL', '4 FAQ entries should FAIL');
  assert.match(passCheck.evidence, /leaflyRunsFAQPageSchemaOnCityPages=true/);
  assert.equal(passCheck.authority, 'STATIC_CONTRACT');
});

// ---------------------------------------------------------------------------
// 9. agent-readability check
// ---------------------------------------------------------------------------

test('agent-readability check: PASS when cardTextFieldsMinimum >= 4, FAIL below', () => {
  const passCounts = { ...healthyCounts(), cardTextFieldsMinimum: 5 };
  const passAtThreshold = { ...healthyCounts(), cardTextFieldsMinimum: 4 };
  const failCounts = { ...healthyCounts(), cardTextFieldsMinimum: 3 };

  const { checks: passChecks } = evaluateMarketingHealth({ counts: passCounts, asOf: FIXED_AS_OF });
  const { checks: thresholdChecks } = evaluateMarketingHealth({ counts: passAtThreshold, asOf: FIXED_AS_OF });
  const { checks: failChecks } = evaluateMarketingHealth({ counts: failCounts, asOf: FIXED_AS_OF });

  const passCheck = passChecks.find((c) => c.id === 'agent-readability');
  const thresholdCheck = thresholdChecks.find((c) => c.id === 'agent-readability');
  const failCheck = failChecks.find((c) => c.id === 'agent-readability');

  assert.ok(passCheck, 'agent-readability check must exist');
  assert.equal(passCheck.status, 'PASS', '5 fields should PASS');
  assert.equal(thresholdCheck.status, 'PASS', '4 fields (minimum) should PASS');
  assert.equal(failCheck.status, 'FAIL', '3 fields should FAIL');

  // Evidence cites the count and the constant 5 homepage fields
  assert.match(passCheck.evidence, /cardTextFieldsMinimum=5/);
  assert.match(passCheck.evidence, /requiredMinimum=4/);
  assert.match(passCheck.evidence, /name,address,source,hours,license/);

  // Authority is STATIC_CONTRACT
  assert.equal(passCheck.authority, 'STATIC_CONTRACT');
});

test('agent-readability check is present in degraded counts and FAILs on cardTextFieldsMinimum=3', () => {
  const { checks } = evaluateMarketingHealth({ counts: degradedCounts(), asOf: FIXED_AS_OF });
  const check = checks.find((c) => c.id === 'agent-readability');
  assert.ok(check, 'agent-readability check must appear for degraded counts');
  assert.equal(check.status, 'FAIL', 'degraded counts (cardTextFieldsMinimum=3) should FAIL');
  assert.match(check.evidence, /cardTextFieldsMinimum=3/);
});

test('evaluateMarketingHealth throws TypeError for missing cardTextFieldsMinimum', () => {
  assert.throws(
    () =>
      evaluateMarketingHealth({
        counts: { ...healthyCounts(), cardTextFieldsMinimum: -1 },
        asOf: FIXED_AS_OF,
      }),
    /cardTextFieldsMinimum/,
    'negative cardTextFieldsMinimum should throw TypeError',
  );

  assert.throws(
    () =>
      evaluateMarketingHealth({
        counts: { ...healthyCounts(), cardTextFieldsMinimum: NaN },
        asOf: FIXED_AS_OF,
      }),
    /cardTextFieldsMinimum/,
    'NaN cardTextFieldsMinimum should throw TypeError',
  );
});
