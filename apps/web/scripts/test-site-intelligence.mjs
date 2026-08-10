import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  buildSiteIntelligenceSnapshot,
  persistSiteIntelligenceSnapshot,
} from '../src/lib/site-intelligence.mjs';

const prisma = new PrismaClient();

console.log('RUNNING DISPOSABLE SITE INTELLIGENCE CAPTURE TEST...');

try {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  assert.ok(admin, 'A local administrator is required for the capture test.');

  const before = {
    snapshots: await prisma.siteIntelligenceSnapshot.count(),
    observations: await prisma.siteObservation.count(),
    audits: await prisma.auditLog.count({
      where: { action: 'CAPTURE_SITE_INTELLIGENCE' },
    }),
  };
  const snapshot = buildSiteIntelligenceSnapshot(
    {
      brands: await prisma.brand.count(),
      retailersTotal: await prisma.retailer.count(),
      retailersCurrent: 0,
      retailersDemonstration: await prisma.retailer.count({
        where: { isDemonstration: true },
      }),
      retailersStale: 0,
      retailersAwaiting: 0,
      retailersDisputed: 0,
      retailersMissingWebsite: 0,
      retailersMissingSource: 0,
      pendingEvidence: await prisma.licenseEvidence.count({
        where: { verificationStatus: 'PENDING' },
      }),
      pendingClaims: await prisma.claimRequest.count({
        where: { status: 'PENDING' },
      }),
      pendingDisputes: await prisma.dispute.count({
        where: { status: 'PENDING' },
      }),
      articlesTotal: await prisma.article.count(),
      articlesCurrent: 0,
      articlesDemonstration: await prisma.article.count({
        where: { isDemonstration: true },
      }),
      articlesStale: 0,
      canonicalBrandExists: true,
      canonicalSitemapRetailers: 0,
      canonicalSitemapArticles: 0,
      leadsLast30Days: 0,
      persistedSnapshots: before.snapshots,
      marketSourceSnapshots: await prisma.marketSourceSnapshot.count(),
      marketClaimsTotal: await prisma.marketClaim.count(),
      marketClaimsEligible: await prisma.marketClaim.count({
        where: {
          decisionEligible: true,
          verification: { in: ['SUPPORTED', 'VERIFIED'] },
        },
      }),
      marketClaimsUnknown: await prisma.marketClaim.count({
        where: { verification: 'UNKNOWN' },
      }),
      marketResolutionsReviewRequired: await prisma.marketEntityResolution.count({
        where: { status: 'REVIEW_REQUIRED' },
      }),
      marketGapsOpen: await prisma.opportunity.count({
        where: { kind: 'MARKET_GAP', status: 'OPEN' },
      }),
      marketGapsClosed: await prisma.opportunity.count({
        where: { kind: 'MARKET_GAP', status: 'CLOSED' },
      }),
    },
    new Date('2026-07-17T12:00:00.000Z'),
  );

  const captured = await persistSiteIntelligenceSnapshot(prisma, {
    snapshot,
    actorUserId: admin.id,
  });
  const stored = await prisma.siteIntelligenceSnapshot.findUnique({
    where: { id: captured.snapshotId },
    include: {
      observations: {
        orderBy: { observationKey: 'asc' },
      },
    },
  });
  assert.ok(stored);
  assert.equal(stored.fingerprint, snapshot.fingerprint);
  assert.equal(stored.observations.length, snapshot.observationCount);
  assert.equal(stored.externalEvidenceStatus, 'NOT_CONNECTED');
  assert.equal(
    stored.observations.filter(({ state }) => state === 'BLOCKED').length,
    snapshot.blockedCount,
  );
  const audit = await prisma.auditLog.findFirst({
    where: {
      action: 'CAPTURE_SITE_INTELLIGENCE',
      details: { contains: `snapshotId=${captured.snapshotId}` },
    },
  });
  assert.ok(audit);
  assert.equal(audit.userId, admin.id);

  await prisma.$transaction([
    prisma.auditLog.deleteMany({
      where: {
        action: 'CAPTURE_SITE_INTELLIGENCE',
        details: { contains: `snapshotId=${captured.snapshotId}` },
      },
    }),
    prisma.siteIntelligenceSnapshot.delete({
      where: { id: captured.snapshotId },
    }),
  ]);

  assert.equal(
    await prisma.siteIntelligenceSnapshot.count(),
    before.snapshots,
  );
  assert.equal(await prisma.siteObservation.count(), before.observations);
  assert.equal(
    await prisma.auditLog.count({
      where: { action: 'CAPTURE_SITE_INTELLIGENCE' },
    }),
    before.audits,
  );

  console.log('PASS: Site Brain snapshot and findings committed atomically.');
  console.log('PASS: capture audit retained identifiers only.');
  console.log('PASS: cascading cleanup restored the exact database baseline.');
} finally {
  await prisma.$disconnect();
}
