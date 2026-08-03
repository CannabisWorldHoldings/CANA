import { prisma } from '@/lib/prisma';
import { currentDealWhere } from '@/lib/directory-search.mjs';
import { NEIGHBORHOOD_CONFIGS } from '@/lib/neighborhood-configs.mjs';

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

function brandRetailerScope(brandId: string) {
  return {
    menus: {
      some: {
        brandMenus: {
          some: { brandId },
        },
      },
    },
  };
}

export async function loadCustomerDirectory({
  domain,
  type,
  query,
  limit = 24,
}: {
  domain: string;
  type: 'delivery' | 'storefront';
  query?: string;
  limit?: number;
}) {
  const brand = await brandForDomain(domain);
  if (!brand) return null;

  const normalizedQuery = normalizeCustomerQuery(query);
  const asOf = new Date();
  const retailers = await prisma.retailer.findMany({
    where: {
      ...brandRetailerScope(brand.id),
      type,
      ...(normalizedQuery
        ? {
            OR: [
              { name: { contains: normalizedQuery } },
              { city: { contains: normalizedQuery } },
              { zip: { contains: normalizedQuery } },
            ],
          }
        : {}),
    },
    include: {
      deals: {
        where: currentDealWhere(asOf),
        select: { id: true },
        take: 3,
      },
      menus: {
        where: { brandMenus: { some: { brandId: brand.id } } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [
      { isDemonstration: 'asc' },
      { dataStatus: 'asc' },
      { name: 'asc' },
    ],
    take: Math.min(Math.max(limit, 1), 50),
  });

  return { brand, query: normalizedQuery, retailers };
}

export async function loadCustomerHome(domain: string) {
  const brand = await brandForDomain(domain);
  if (!brand) return null;

  const asOf = new Date();
  const scope = brandRetailerScope(brand.id);
  const [delivery, dispensaries, deals, articles] = await Promise.all([
    prisma.retailer.findMany({
      where: { ...scope, type: 'delivery' },
      include: {
        deals: { where: currentDealWhere(asOf), select: { id: true }, take: 3 },
        menus: { where: { brandMenus: { some: { brandId: brand.id } } }, select: { id: true }, take: 1 },
      },
      orderBy: [{ isDemonstration: 'asc' }, { dataStatus: 'asc' }, { name: 'asc' }],
      take: 4,
    }),
    prisma.retailer.findMany({
      where: { ...scope, type: 'storefront' },
      include: {
        deals: { where: currentDealWhere(asOf), select: { id: true }, take: 3 },
        menus: { where: { brandMenus: { some: { brandId: brand.id } } }, select: { id: true }, take: 1 },
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
      orderBy: [{ isDemonstration: 'asc' }, { updatedAt: 'desc' }],
      take: 3,
    }),
  ]);

  return { brand, delivery, dispensaries, deals, articles };
}

export async function loadCustomerSearch(domain: string, query: string) {
  const brand = await brandForDomain(domain);
  if (!brand) return null;

  const normalizedQuery = normalizeCustomerQuery(query);
  if (!normalizedQuery) {
    return { brand, query: '', retailers: [], products: [], deals: [], neighborhoods: [] };
  }

  const asOf = new Date();
  const scope = brandRetailerScope(brand.id);
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
        OR: [
          { name: { contains: normalizedQuery } },
          { category: { contains: normalizedQuery } },
        ],
        menuEntries: {
          some: { brandMenus: { some: { brandId: brand.id } } },
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
      include: { retailer: { select: { id: true, name: true } } },
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

  return { brand, query: normalizedQuery, retailers, products, deals, neighborhoods };
}
