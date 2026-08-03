import { prisma } from '@/lib/prisma';
import {
  DIRECTORY_PAGE_SIZE,
  currentDealWhere,
  directoryRetailerOrderBy,
  directoryRetailerWhere,
  isPublicCatalogRecord,
  labelCustomerDealRecord,
  labelCustomerProductRecord,
  parseDirectorySearch,
  publicCatalogRecordWhere,
} from '@/lib/directory-search.mjs';
import { NEIGHBORHOOD_CONFIGS } from '@/lib/neighborhood-configs.mjs';
import { publicRetailerWhere } from '@/lib/public-retailer.mjs';
import { PUBLIC_DEAL_PREVIEW_LIMIT } from '@/lib/retailer-detail-search.mjs';

const QUERY_LIMIT = 80;

export function normalizeCustomerQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim().slice(0, QUERY_LIMIT) : '';
}

async function brandForDomain(domain: string) {
  return prisma.brand.findUnique({
    where: { domain },
    select: { id: true, name: true },
  });
}

function brandRetailerScope(brandId: string, asOf: Date) {
  return {
    ...publicRetailerWhere(asOf),
    menus: {
      some: {
        brandMenus: {
          some: { brandId },
        },
      },
    },
  };
}

function brandMenuEntryScope(brandId: string, asOf: Date) {
  return {
    ...publicCatalogRecordWhere(asOf),
    brandMenus: {
      some: { brandId },
    },
    retailer: brandRetailerScope(brandId, asOf),
  };
}

export async function loadCustomerDirectory({
  domain,
  type,
  query,
  page,
}: {
  domain: string;
  type: 'delivery' | 'storefront';
  query?: string | string[];
  page?: string | string[];
}) {
  const brand = await brandForDomain(domain);
  if (!brand) return null;

  const asOf = new Date();
  const requestedFilters = parseDirectorySearch({ query, type, page });
  const where = directoryRetailerWhere({
    brandId: brand.id,
    filters: requestedFilters,
    asOf,
  });
  const totalResults = await prisma.retailer.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalResults / DIRECTORY_PAGE_SIZE));
  const currentPage = Math.min(requestedFilters.page, totalPages);
  const retailers = await prisma.retailer.findMany({
    where,
    include: {
      deals: {
        where: currentDealWhere(asOf),
        select: { id: true },
        take: PUBLIC_DEAL_PREVIEW_LIMIT,
      },
      menus: {
        where: brandMenuEntryScope(brand.id, asOf),
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [...directoryRetailerOrderBy(requestedFilters.sort)],
    skip: (currentPage - 1) * DIRECTORY_PAGE_SIZE,
    take: DIRECTORY_PAGE_SIZE,
  });

  return {
    brand,
    query: requestedFilters.query,
    retailers,
    totalResults,
    totalPages,
    currentPage,
  };
}

export async function loadCustomerHome(domain: string) {
  const brand = await brandForDomain(domain);
  if (!brand) return null;

  const asOf = new Date();
  const scope = brandRetailerScope(brand.id, asOf);
  const menuEntryScope = brandMenuEntryScope(brand.id, asOf);
  const [delivery, dispensaries, deals, articles] = await Promise.all([
    prisma.retailer.findMany({
      where: { ...scope, type: 'delivery' },
      include: {
        deals: { where: currentDealWhere(asOf), select: { id: true }, take: PUBLIC_DEAL_PREVIEW_LIMIT },
        menus: { where: menuEntryScope, select: { id: true }, take: 1 },
      },
      orderBy: [{ isDemonstration: 'asc' }, { dataStatus: 'asc' }, { name: 'asc' }],
      take: 4,
    }),
    prisma.retailer.findMany({
      where: { ...scope, type: 'storefront' },
      include: {
        deals: { where: currentDealWhere(asOf), select: { id: true }, take: PUBLIC_DEAL_PREVIEW_LIMIT },
        menus: { where: menuEntryScope, select: { id: true }, take: 1 },
      },
      orderBy: [{ isDemonstration: 'asc' }, { dataStatus: 'asc' }, { name: 'asc' }],
      take: 4,
    }),
    prisma.deal.findMany({
      where: { ...currentDealWhere(asOf), retailer: scope },
      include: {
        retailer: { select: { id: true, name: true, type: true, isDemonstration: true } },
      },
      orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
      take: 5,
    }),
    prisma.article.findMany({
      where: publicCatalogRecordWhere(asOf),
      orderBy: [{ isDemonstration: 'asc' }, { updatedAt: 'desc' }],
      take: 3,
    }),
  ]);

  return {
    brand,
    delivery,
    dispensaries,
    deals: deals.filter((deal) => isPublicCatalogRecord(deal, asOf)).map(labelCustomerDealRecord),
    articles: articles.filter((article) => isPublicCatalogRecord(article, asOf)),
  };
}

export async function loadCustomerSearch(domain: string, query: string) {
  const brand = await brandForDomain(domain);
  if (!brand) return null;

  const normalizedQuery = normalizeCustomerQuery(query);
  if (!normalizedQuery) {
    return { brand, query: '', retailers: [], products: [], deals: [], neighborhoods: [] };
  }

  const asOf = new Date();
  const scope = brandRetailerScope(brand.id, asOf);
  const [retailers, products, deals] = await Promise.all([
    prisma.retailer.findMany({
      where: {
        ...scope,
        OR: [
          { name: { contains: normalizedQuery } },
          { city: { contains: normalizedQuery } },
          { zip: { contains: normalizedQuery } },
        ],
      },
      orderBy: [{ isDemonstration: 'asc' }, { name: 'asc' }],
      take: 8,
    }),
    prisma.product.findMany({
      where: {
        ...publicCatalogRecordWhere(asOf),
        OR: [
          { name: { contains: normalizedQuery } },
          { category: { contains: normalizedQuery } },
        ],
        menuEntries: {
          some: brandMenuEntryScope(brand.id, asOf),
        },
      },
      include: {
        menuEntries: {
          where: brandMenuEntryScope(brand.id, asOf),
          select: {
            isDemonstration: true,
            retailer: { select: { isDemonstration: true } },
          },
        },
      },
      orderBy: [{ isDemonstration: 'asc' }, { name: 'asc' }],
      take: 8,
    }),
    prisma.deal.findMany({
      where: {
        ...currentDealWhere(asOf),
        retailer: scope,
        OR: [
          { title: { contains: normalizedQuery } },
          { description: { contains: normalizedQuery } },
        ],
      },
      include: { retailer: { select: { id: true, name: true, isDemonstration: true } } },
      orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
      take: 8,
    }),
  ]);

  const lowerQuery = normalizedQuery.toLowerCase();
  const neighborhoods = Object.entries(NEIGHBORHOOD_CONFIGS)
    .filter(([slug, config]) =>
      `${slug} ${config.name} ${config.blurb}`.toLowerCase().includes(lowerQuery),
    )
    .slice(0, 8)
    .map(([slug, config]) => ({ slug, ...config }));

  return {
    brand,
    query: normalizedQuery,
    retailers,
    products: products
      .filter((product) => isPublicCatalogRecord(product, asOf))
      .map(labelCustomerProductRecord),
    deals: deals
      .filter((deal) => isPublicCatalogRecord(deal, asOf))
      .map(labelCustomerDealRecord),
    neighborhoods,
  };
}
