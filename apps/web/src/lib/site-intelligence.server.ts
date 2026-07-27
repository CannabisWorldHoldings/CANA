import 'server-only';

import { prisma } from '@/lib/prisma';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';
import { CANONICAL_TENANT_DOMAIN } from '@/lib/tenant-host.mjs';
import { buildSiteIntelligenceSnapshot } from '@/lib/site-intelligence.mjs';

export type SiteIntelligenceSnapshot = {
  schemaVersion: number;
  asOf: Date;
  fingerprint: string;
  routeInventoryHash: string;
  localEvidenceStatus: string;
  externalEvidenceStatus: string;
  metrics: {
    persistedSnapshots: number;
    [key: string]: number | boolean;
  };
  planes: ReadonlyArray<{
    name: string;
    status: string;
    proof: string;
  }>;
  observations: ReadonlyArray<{
    key: string;
    plane: string;
    state: string;
    severity: string;
    title: string;
    summary: string;
    evidence: string;
    uncertainty: string;
    preparedAction: string;
    authority: string;
    quantity: number | null;
  }>;
  observationCount: number;
  attentionCount: number;
  blockedCount: number;
};

export async function collectSiteIntelligenceSnapshot(
  asOf = new Date(),
): Promise<SiteIntelligenceSnapshot> {
  const currentRecord = currentPublicRecordWhere(asOf);
  const thirtyDaysAgo = new Date(asOf);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  const canonicalBrandPromise = prisma.brand.findUnique({
    where: { domain: CANONICAL_TENANT_DOMAIN },
    select: { id: true },
  });

  const [
    canonicalBrand,
    brands,
    retailersTotal,
    retailersCurrent,
    retailersDemonstration,
    retailersStale,
    retailersAwaiting,
    retailersDisputed,
    retailersMissingWebsite,
    retailersMissingSource,
    pendingEvidence,
    pendingClaims,
    pendingDisputes,
    articlesTotal,
    articlesCurrent,
    articlesDemonstration,
    articlesStale,
    leadsLast30Days,
    persistedSnapshots,
  ] = await Promise.all([
    canonicalBrandPromise,
    prisma.brand.count(),
    prisma.retailer.count(),
    prisma.retailer.count({ where: currentRecord }),
    prisma.retailer.count({ where: { isDemonstration: true } }),
    prisma.retailer.count({
      where: {
        isDemonstration: false,
        OR: [
          { dataStatus: 'STALE' },
          { freshnessExpiresAt: { lte: asOf } },
        ],
      },
    }),
    prisma.retailer.count({
      where: {
        isDemonstration: false,
        dataStatus: 'AWAITING_VERIFICATION',
      },
    }),
    prisma.retailer.count({
      where: { isDemonstration: false, dataStatus: 'DISPUTED' },
    }),
    prisma.retailer.count({
      where: {
        isDemonstration: false,
        OR: [{ website: null }, { website: '' }],
      },
    }),
    prisma.retailer.count({
      where: {
        isDemonstration: false,
        OR: [{ sourceUrl: null }, { sourceUrl: '' }],
      },
    }),
    prisma.licenseEvidence.count({
      where: { verificationStatus: 'PENDING' },
    }),
    prisma.claimRequest.count({ where: { status: 'PENDING' } }),
    prisma.dispute.count({ where: { status: 'PENDING' } }),
    prisma.article.count(),
    prisma.article.count({ where: currentRecord }),
    prisma.article.count({ where: { isDemonstration: true } }),
    prisma.article.count({
      where: {
        isDemonstration: false,
        OR: [
          { dataStatus: 'STALE' },
          { freshnessExpiresAt: { lte: asOf } },
        ],
      },
    }),
    prisma.leadEvent.count({
      where: { createdAt: { gte: thirtyDaysAgo, lte: asOf } },
    }),
    prisma.siteIntelligenceSnapshot.count(),
  ]);

  const canonicalSitemapRetailers = canonicalBrand
    ? await prisma.retailer.count({
        where: {
          ...currentRecord,
          menus: {
            some: {
              brandMenus: {
                some: { brandId: canonicalBrand.id },
              },
            },
          },
        },
      })
    : 0;
  const canonicalSitemapArticles = articlesCurrent;

  return buildSiteIntelligenceSnapshot(
    {
      brands,
      retailersTotal,
      retailersCurrent,
      retailersDemonstration,
      retailersStale,
      retailersAwaiting,
      retailersDisputed,
      retailersMissingWebsite,
      retailersMissingSource,
      pendingEvidence,
      pendingClaims,
      pendingDisputes,
      articlesTotal,
      articlesCurrent,
      articlesDemonstration,
      articlesStale,
      canonicalBrandExists: canonicalBrand !== null,
      canonicalSitemapRetailers,
      canonicalSitemapArticles,
      leadsLast30Days,
      persistedSnapshots,
    },
    asOf,
  ) as unknown as SiteIntelligenceSnapshot;
}
