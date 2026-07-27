import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSiteIntelligenceSnapshot,
  MAX_SITE_INTELLIGENCE_SNAPSHOTS,
  persistSiteIntelligenceSnapshot,
  SITE_ROUTE_INVENTORY,
} from '../src/lib/site-intelligence.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const actorUserId = '11111111-1111-4111-8111-111111111111';

function baseMetrics(overrides = {}) {
  return {
    brands: 10,
    retailersTotal: 5,
    retailersCurrent: 0,
    retailersDemonstration: 5,
    retailersStale: 0,
    retailersAwaiting: 0,
    retailersDisputed: 0,
    retailersMissingWebsite: 0,
    retailersMissingSource: 0,
    pendingEvidence: 0,
    pendingClaims: 0,
    pendingDisputes: 0,
    articlesTotal: 3,
    articlesCurrent: 0,
    articlesDemonstration: 3,
    articlesStale: 0,
    canonicalBrandExists: true,
    canonicalSitemapRetailers: 0,
    canonicalSitemapArticles: 0,
    leadsLast30Days: 0,
    persistedSnapshots: 0,
    ...overrides,
  };
}

test('Site Brain produces deterministic local findings with explicit external gates', () => {
  const first = buildSiteIntelligenceSnapshot(
    baseMetrics(),
    new Date('2026-07-17T12:00:00.000Z'),
  );
  const second = buildSiteIntelligenceSnapshot(
    baseMetrics(),
    new Date('2026-07-18T12:00:00.000Z'),
  );

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.localEvidenceStatus, 'AVAILABLE');
  assert.equal(first.externalEvidenceStatus, 'NOT_CONNECTED');
  assert.equal(first.blockedCount, 3);
  assert.equal(first.observationCount, first.observations.length);
  assert.deepEqual(
    first.observations
      .filter(({ state }) => state === 'BLOCKED')
      .map(({ key }) => key),
    ['SEARCH_CONSOLE_GATE', 'ANALYTICS_GATE', 'PUBLIC_HTTPS_GATE'],
  );
  assert.match(
    first.observations.find(({ key }) => key === 'SEARCH_CONSOLE_GATE')
      .uncertainty,
    /unknown, not zero/i,
  );
  assert.equal(
    first.observations.find(({ key }) => key === 'DEPLOYMENT_AUTHORITY')
      .authority,
    'PREPARE_ONLY',
  );
});

test('truth, evidence, freshness, and source debt change only their bounded findings', () => {
  const snapshot = buildSiteIntelligenceSnapshot(
    baseMetrics({
      retailersCurrent: 2,
      retailersStale: 1,
      retailersMissingWebsite: 2,
      retailersMissingSource: 1,
      pendingEvidence: 2,
      pendingClaims: 1,
      pendingDisputes: 1,
      articlesCurrent: 1,
      canonicalSitemapRetailers: 2,
      canonicalSitemapArticles: 1,
      leadsLast30Days: 4,
    }),
    new Date('2026-07-17T12:00:00.000Z'),
  );
  const byKey = Object.fromEntries(
    snapshot.observations.map((item) => [item.key, item]),
  );

  assert.equal(byKey.PUBLIC_TRUTH_COVERAGE.state, 'HEALTHY');
  assert.equal(byKey.FRESHNESS_DEBT.state, 'ATTENTION');
  assert.equal(byKey.SOURCE_COMPLETENESS.quantity, 3);
  assert.equal(byKey.EVIDENCE_REVIEW_QUEUE.quantity, 4);
  assert.match(
    byKey.EVIDENCE_REVIEW_QUEUE.summary,
    /2 evidence items, 1 claim, and 1 correction await review/,
  );
  assert.equal(byKey.EDITORIAL_INDEXABILITY.state, 'HEALTHY');
  assert.equal(byKey.CANONICAL_SITEMAP.quantity, 5);
  assert.equal(byKey.LOCAL_HANDOFF_OUTCOMES.quantity, 4);
  assert.match(
    byKey.LOCAL_HANDOFF_OUTCOMES.uncertainty,
    /does not prove purchase or revenue/i,
  );
});

test('Site Brain rejects malformed metrics and timestamps', () => {
  assert.throws(
    () =>
      buildSiteIntelligenceSnapshot({
        ...baseMetrics(),
        pendingEvidence: -1,
      }),
    /pendingEvidence/,
  );
  assert.throws(
    () =>
      buildSiteIntelligenceSnapshot({
        ...baseMetrics(),
        canonicalBrandExists: 'yes',
      }),
    /canonicalBrandExists/,
  );
  assert.throws(
    () => buildSiteIntelligenceSnapshot(baseMetrics(), new Date('invalid')),
    /valid date/,
  );
});

test('the versioned route inventory points to real source and keeps private surfaces excluded', () => {
  for (const route of SITE_ROUTE_INVENTORY) {
    assert.equal(
      fs.existsSync(path.join(webRoot, route.source)),
      true,
      `${route.source} must exist`,
    );
  }
  const privateRoutes = SITE_ROUTE_INVENTORY.filter(({ id }) =>
    ['claim', 'site-intelligence'].includes(id),
  );
  assert.equal(privateRoutes.every(({ indexable }) => !indexable), true);
});

test('capturing a snapshot stores observations, audit evidence, and bounded retention atomically', async () => {
  const snapshot = buildSiteIntelligenceSnapshot(
    baseMetrics(),
    new Date('2026-07-17T12:00:00.000Z'),
  );
  const calls = [];
  const expiredIds = ['old-1', 'old-2'];
  const transaction = {
    siteIntelligenceSnapshot: {
      async create(input) {
        calls.push(['capture', input]);
        return {
          id: 'snapshot-1',
          capturedAt: new Date('2026-07-17T12:01:00.000Z'),
        };
      },
      async findMany(input) {
        calls.push(['retention', input]);
        return expiredIds.map((id) => ({ id }));
      },
      async deleteMany(input) {
        calls.push(['prune', input]);
        return { count: expiredIds.length };
      },
    },
    auditLog: {
      async create(input) {
        calls.push(['audit', input]);
        return { id: 'audit-1' };
      },
    },
  };
  const db = {
    async $transaction(callback) {
      calls.push(['transaction']);
      return callback(transaction);
    },
  };

  const result = await persistSiteIntelligenceSnapshot(db, {
    snapshot,
    actorUserId,
  });

  assert.equal(result.outcome, 'CAPTURED');
  assert.equal(result.prunedSnapshots, 2);
  assert.equal(calls[0][0], 'transaction');
  assert.equal(
    calls.find(([name]) => name === 'capture')[1].data.observations.create
      .length,
    snapshot.observationCount,
  );
  assert.equal(
    calls.find(([name]) => name === 'retention')[1].skip,
    MAX_SITE_INTELLIGENCE_SNAPSHOTS,
  );
  assert.deepEqual(
    calls.find(([name]) => name === 'prune')[1].where.id.in,
    expiredIds,
  );
  const audit = calls.find(([name]) => name === 'audit')[1].data;
  assert.equal(audit.userId, actorUserId);
  assert.match(audit.details, /^snapshotId=snapshot-1 observations=\d+$/);
});

test('capture rejects untrusted actors and propagates audit failure through the transaction', async () => {
  const snapshot = buildSiteIntelligenceSnapshot(baseMetrics());
  await assert.rejects(
    () =>
      persistSiteIntelligenceSnapshot(
        { $transaction: async () => assert.fail('must not transact') },
        { snapshot, actorUserId: 'not-a-user-id' },
      ),
    /UUID/,
  );
  await assert.rejects(
    () =>
      persistSiteIntelligenceSnapshot(
        { $transaction: async () => assert.fail('must not transact') },
        {
          snapshot: {
            ...snapshot,
            metrics: {
              ...snapshot.metrics,
              pendingClaims: snapshot.metrics.pendingClaims + 1,
            },
          },
          actorUserId,
        },
      ),
    /integrity check failed/,
  );

  const transaction = {
    siteIntelligenceSnapshot: {
      create: async () => ({
        id: 'snapshot-2',
        capturedAt: new Date(),
      }),
    },
    auditLog: {
      create: async () => {
        throw new Error('audit unavailable');
      },
    },
  };
  await assert.rejects(
    () =>
      persistSiteIntelligenceSnapshot(
        { $transaction: async (callback) => callback(transaction) },
        { snapshot, actorUserId },
      ),
    /audit unavailable/,
  );
});

test('the Site Brain route is administrator-only and has no external execution path', () => {
  const pageSource = fs.readFileSync(
    path.join(webRoot, 'src/app/admin/site-intelligence/page.tsx'),
    'utf8',
  );
  const collectorSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/site-intelligence.server.ts'),
    'utf8',
  );
  const adminLayoutSource = fs.readFileSync(
    path.join(webRoot, 'src/app/admin/layout.tsx'),
    'utf8',
  );
  const schemaSource = fs.readFileSync(
    path.join(webRoot, 'prisma/schema.prisma'),
    'utf8',
  );

  assert.match(pageSource, /await requireAdmin\(\)/);
  assert.match(pageSource, /await assertAdmin\(\)/);
  assert.match(
    pageSource,
    /from ['"]@\/lib\/site-intelligence\.server['"]/,
    'The database-backed collector must not share a resolver stem with site-intelligence.mjs.',
  );
  assert.match(pageSource, /persistSiteIntelligenceSnapshot/);
  assert.match(
    pageSource,
    /min-w-0 rounded-xl border border-brand-border/,
    'The route-memory grid item must allow its table to scroll internally on mobile.',
  );
  assert.doesNotMatch(pageSource, /\bfetch\s*\(/);
  assert.doesNotMatch(collectorSource, /\bfetch\s*\(/);
  assert.match(adminLayoutSource, /index:\s*false/);
  assert.match(adminLayoutSource, /follow:\s*false/);
  assert.match(adminLayoutSource, /nocache:\s*true/);
  assert.match(schemaSource, /model SiteIntelligenceSnapshot/);
  assert.match(schemaSource, /model SiteObservation/);
  assert.match(schemaSource, /@@unique\(\[snapshotId, observationKey\]\)/);
  assert.match(schemaSource, /onDelete: Cascade/);
});
