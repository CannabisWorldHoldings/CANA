import {
  publicCatalogRecordWhere,
} from './directory-search.mjs';
import { publicRetailerWhere } from './public-retailer.mjs';

export const PRODUCT_DISCOVERY_PAGE_SIZE = 16;
export const PRODUCT_DISCOVERY_MAX_PAGE = 1_000;
export const PRODUCT_DISCOVERY_QUERY_MAX_LENGTH = 80;

export const PRODUCT_DISCOVERY_CATEGORIES = Object.freeze([
  'flower',
  'edibles',
  'concentrates',
  'vapes',
  'pre-rolls',
  'topicals',
  'accessories',
]);

export const PRODUCT_DISCOVERY_STRAIN_TYPES = Object.freeze([
  'sativa',
  'indica',
  'hybrid',
  'cbd',
]);

export const PRODUCT_DISCOVERY_SERVICE_TYPES = Object.freeze([
  'delivery',
  'storefront',
]);

export const PRODUCT_DISCOVERY_EVIDENCE_STATES = Object.freeze([
  'VERIFIED_CURRENT',
  'DEMONSTRATION_ONLY',
]);

export const PRODUCT_DISCOVERY_STOCK_STATES = Object.freeze([
  'IN_STOCK',
]);

export const PRODUCT_DISCOVERY_PRICE_BANDS = Object.freeze([
  'UNDER_25',
  '25_TO_50',
  '50_TO_100',
  '100_PLUS',
]);

export const PRODUCT_DISCOVERY_SORTS = Object.freeze([
  'TRUTH_FIRST',
  'PRICE_ASC',
  'PRICE_DESC',
  'RECENTLY_UPDATED',
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedQuery(value) {
  const text = firstValue(value);
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PRODUCT_DISCOVERY_QUERY_MAX_LENGTH);
}

function selectedValue(value, allowed, fallback = '') {
  const text = firstValue(value);
  return typeof text === 'string' && allowed.includes(text)
    ? text
    : fallback;
}

function pageNumber(value) {
  const text = firstValue(value);
  if (Number.isSafeInteger(text) && text >= 1) {
    return Math.min(text, PRODUCT_DISCOVERY_MAX_PAGE);
  }
  if (typeof text !== 'string' || !/^[1-9]\d{0,3}$/.test(text)) return 1;
  return Math.min(Number(text), PRODUCT_DISCOVERY_MAX_PAGE);
}

function validIdentifier(value, label) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} is required.`);
  }
  const normalized = value.trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(`${label} has an invalid format.`);
  }
  return normalized;
}

function validTime(asOf) {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw new TypeError('Product discovery time must be a valid date.');
  }
  return new Date(asOf);
}

function currentEvidenceWhere(asOf) {
  return {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: asOf },
    freshnessExpiresAt: { gt: asOf },
  };
}

function priceWhere(priceBand) {
  switch (priceBand) {
    case 'UNDER_25':
      return { lt: 25 };
    case '25_TO_50':
      return { gte: 25, lt: 50 };
    case '50_TO_100':
      return { gte: 50, lt: 100 };
    case '100_PLUS':
      return { gte: 100 };
    default:
      return null;
  }
}

export function parseProductDiscoverySearch(searchParams = {}) {
  return Object.freeze({
    query: normalizedQuery(searchParams.query),
    category: selectedValue(
      searchParams.category,
      PRODUCT_DISCOVERY_CATEGORIES,
    ),
    strainType: selectedValue(
      searchParams.strainType,
      PRODUCT_DISCOVERY_STRAIN_TYPES,
    ),
    serviceType: selectedValue(
      searchParams.serviceType,
      PRODUCT_DISCOVERY_SERVICE_TYPES,
    ),
    evidence: selectedValue(
      searchParams.evidence,
      PRODUCT_DISCOVERY_EVIDENCE_STATES,
    ),
    stock: selectedValue(
      searchParams.stock,
      PRODUCT_DISCOVERY_STOCK_STATES,
    ),
    priceBand: selectedValue(
      searchParams.priceBand,
      PRODUCT_DISCOVERY_PRICE_BANDS,
    ),
    sort: selectedValue(
      searchParams.sort,
      PRODUCT_DISCOVERY_SORTS,
      'TRUTH_FIRST',
    ),
    page: pageNumber(searchParams.page),
  });
}

export function productDiscoveryWhere({
  brandId,
  filters,
  asOf = new Date(),
}) {
  const scopedBrandId = validIdentifier(brandId, 'Brand ID');
  const timestamp = validTime(asOf);
  const parsed = parseProductDiscoverySearch(filters);
  const entryConstraints = [publicCatalogRecordWhere(timestamp)];
  const productConstraints = [publicCatalogRecordWhere(timestamp)];
  const retailerConstraints = [publicRetailerWhere(timestamp)];

  if (parsed.query) {
    entryConstraints.push({
      OR: [
        { product: { name: { contains: parsed.query, mode: 'insensitive' } } },
        {
          product: {
            description: { contains: parsed.query, mode: 'insensitive' },
          },
        },
        { retailer: { name: { contains: parsed.query, mode: 'insensitive' } } },
      ],
    });
  }

  if (parsed.evidence === 'VERIFIED_CURRENT') {
    const current = currentEvidenceWhere(timestamp);
    entryConstraints.push(current);
    productConstraints.push(current);
    retailerConstraints.push(current);
  } else if (parsed.evidence === 'DEMONSTRATION_ONLY') {
    entryConstraints.push({
      OR: [
        { isDemonstration: true },
        { product: { isDemonstration: true } },
        { retailer: { isDemonstration: true } },
      ],
    });
  }

  const boundedPrice = priceWhere(parsed.priceBand);

  return {
    AND: entryConstraints,
    brandMenus: {
      some: {
        brandId: scopedBrandId,
      },
    },
    product: {
      AND: [
        ...productConstraints,
        ...(parsed.category ? [{ category: parsed.category }] : []),
        ...(parsed.strainType
          ? [{ strainType: parsed.strainType }]
          : []),
      ],
    },
    retailer: {
      AND: retailerConstraints,
      ...(parsed.serviceType ? { type: parsed.serviceType } : {}),
    },
    ...(parsed.stock ? { inStock: true } : {}),
    ...(boundedPrice ? { price: boundedPrice } : {}),
  };
}

export function productDiscoveryOrderBy(sort) {
  const parsed = parseProductDiscoverySearch({ sort });
  switch (parsed.sort) {
    case 'PRICE_ASC':
      return Object.freeze([
        Object.freeze({ price: 'asc' }),
        Object.freeze({ id: 'asc' }),
      ]);
    case 'PRICE_DESC':
      return Object.freeze([
        Object.freeze({ price: 'desc' }),
        Object.freeze({ id: 'asc' }),
      ]);
    case 'RECENTLY_UPDATED':
      return Object.freeze([
        Object.freeze({ updatedAt: 'desc' }),
        Object.freeze({ id: 'asc' }),
      ]);
    default:
      return Object.freeze([
        Object.freeze({ isDemonstration: 'asc' }),
        Object.freeze({
          product: Object.freeze({ isDemonstration: 'asc' }),
        }),
        Object.freeze({
          retailer: Object.freeze({ isDemonstration: 'asc' }),
        }),
        Object.freeze({ verifiedAt: 'desc' }),
        Object.freeze({ freshnessExpiresAt: 'desc' }),
        Object.freeze({ updatedAt: 'desc' }),
        Object.freeze({ id: 'asc' }),
      ]);
  }
}

export function productDiscoveryPageCount(totalItems) {
  if (!Number.isSafeInteger(totalItems) || totalItems < 0) {
    throw new TypeError(
      'Product discovery count must be a non-negative safe integer.',
    );
  }
  return Math.max(1, Math.ceil(totalItems / PRODUCT_DISCOVERY_PAGE_SIZE));
}

export function clampProductDiscoveryPage(requestedPage, totalItems) {
  return Math.min(
    pageNumber(requestedPage),
    productDiscoveryPageCount(totalItems),
  );
}

export function productDiscoveryPageOffset(page) {
  return (pageNumber(page) - 1) * PRODUCT_DISCOVERY_PAGE_SIZE;
}

export function productDiscoveryHref(filters, page) {
  const parsed = parseProductDiscoverySearch({ ...filters, page });
  const params = new URLSearchParams();
  if (parsed.query) params.set('query', parsed.query);
  if (parsed.category) params.set('category', parsed.category);
  if (parsed.strainType) params.set('strainType', parsed.strainType);
  if (parsed.serviceType) params.set('serviceType', parsed.serviceType);
  if (parsed.evidence) params.set('evidence', parsed.evidence);
  if (parsed.stock) params.set('stock', parsed.stock);
  if (parsed.priceBand) params.set('priceBand', parsed.priceBand);
  if (parsed.sort !== 'TRUTH_FIRST') params.set('sort', parsed.sort);
  if (parsed.page > 1) params.set('page', String(parsed.page));
  const query = params.toString();
  return query ? `/products?${query}` : '/products';
}
