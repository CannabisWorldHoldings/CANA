import { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';
import { productDiscoveryWhere } from '@/lib/product-discovery.mjs';
import {
  CANONICAL_PUBLIC_HOSTNAME,
  CANONICAL_TENANT_DOMAIN,
} from '@/lib/tenant-host.mjs';
import { NEIGHBORHOOD_SLUGS } from '@/lib/neighborhood-configs.mjs';
import { STRAIN_SLUGS } from '@/lib/strain-content.mjs';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const asOf = new Date();
  const currentPublicRecord = currentPublicRecordWhere(asOf);
  const canonicalBase = `https://${CANONICAL_PUBLIC_HOSTNAME}`;
  const canonicalBrand = await prisma.brand.findUnique({
    where: { domain: CANONICAL_TENANT_DOMAIN },
    select: { id: true },
  });
  const routes: MetadataRoute.Sitemap = [
    {
      url: canonicalBase,
      lastModified: asOf,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${canonicalBase}/education`,
      lastModified: asOf,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${canonicalBase}/dispensaries`,
      lastModified: asOf,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${canonicalBase}/delivery`,
      lastModified: asOf,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${canonicalBase}/deals`,
      lastModified: asOf,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${canonicalBase}/neighborhoods`,
      lastModified: asOf,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${canonicalBase}/legal`,
      lastModified: asOf,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${canonicalBase}/pricing`,
      lastModified: asOf,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${canonicalBase}/strains`,
      lastModified: asOf,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    ...STRAIN_SLUGS.map((slug) => ({
      url: `${canonicalBase}/strains/${slug}`,
      lastModified: asOf,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...NEIGHBORHOOD_SLUGS.map((slug) => ({
      url: `${canonicalBase}/neighborhoods/${slug}`,
      lastModified: asOf,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];

  if (canonicalBrand) {
    const [retailers, verifiedProductCount] = await Promise.all([
      prisma.retailer.findMany({
        where: {
          ...currentPublicRecord,
          menus: {
            some: {
              brandMenus: {
                some: {
                  brandId: canonicalBrand.id,
                },
              },
            },
          },
        },
      }),
      prisma.menuEntry.count({
        where: productDiscoveryWhere({
          brandId: canonicalBrand.id,
          filters: { evidence: 'VERIFIED_CURRENT' },
          asOf,
        }),
      }),
    ]);
    for (const retailer of retailers) {
      routes.push({
        url: `${canonicalBase}/retailer/${retailer.id}`,
        lastModified: retailer.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
    if (verifiedProductCount > 0) {
      routes.push({
        url: `${canonicalBase}/products`,
        lastModified: asOf,
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }
  }

  const articles = await prisma.article.findMany({
    where: currentPublicRecord,
  });
  for (const article of articles) {
    routes.push({
      url: `${canonicalBase}/education/${encodeURIComponent(article.slug)}`,
      lastModified: article.updatedAt,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  return routes;
}
