const DIRECTORY_TYPES = new Set(['delivery', 'storefront']);
const DIRECTORY_STATUSES = new Set([
  'VERIFIED_CURRENT',
  'AWAITING_VERIFICATION',
  'DEMONSTRATION_ONLY',
  'STALE',
  'DISPUTED',
]);
const DIRECTORY_SORTS = new Set([
  'TRUTH_FIRST',
  'RECENTLY_UPDATED',
  'NAME_ASC',
]);
const DIRECTORY_NEIGHBORHOODS = new Set([
  'dupont-circle',
  'adams-morgan',
  'navy-yard',
  'capitol-hill',
  'downtown',
  'shaw',
]);

export const DC_NEIGHBORHOOD_MAP = {
  'dupont-circle': { label: 'Dupont Circle', keywords: ['Dupont', 'Connecticut', '19th St', '20th St', '21st St', 'P St'] },
  'adams-morgan': { label: 'Adams Morgan', keywords: ['Adams Morgan', '18th St', 'Columbia Rd', 'Florida Ave'] },
  'navy-yard': { label: 'Navy Yard', keywords: ['Navy Yard', 'M St SE', 'Tingey', 'Half St', 'N St SE'] },
  'capitol-hill': { label: 'Capitol Hill', keywords: ['Capitol Hill', 'Pennsylvania Ave SE', '8th St SE', 'Massachusetts Ave NE'] },
  'downtown': { label: 'Downtown', keywords: ['Downtown', 'K St', 'L St', 'I St', 'H St', '14th St NW'] },
  'shaw': { label: 'Shaw', keywords: ['Shaw', 'U St', '7th St NW', '9th St NW', 'Florida Ave NW'] },
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const DIRECTORY_QUERY_MAX_LENGTH = 80;
export const DIRECTORY_PAGE_SIZE = 20;
export const DIRECTORY_MAX_PAGE = 1_000;
export const DIRECTORY_DEFAULT_SORT = 'TRUTH_FIRST';

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
    .slice(0, DIRECTORY_QUERY_MAX_LENGTH);
}

function selectedValue(value, allowed) {
  const text = firstValue(value);
  return typeof text === 'string' && allowed.has(text) ? text : '';
}

function pageNumber(value) {
  const text = firstValue(value);
  if (typeof text !== 'string' || !/^[1-9]\d{0,3}$/.test(text)) return 1;
  return Math.min(Number(text), DIRECTORY_MAX_PAGE);
}

function identifier(value, label) {
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
    throw new TypeError('Directory search time must be a valid date.');
  }
  return new Date(asOf);
}

export function parseDirectorySearch(searchParams = {}) {
  return {
    query: normalizedQuery(searchParams.query),
    type: selectedValue(searchParams.type, DIRECTORY_TYPES),
    status: selectedValue(searchParams.status, DIRECTORY_STATUSES),
    neighborhood: selectedValue(searchParams.neighborhood, DIRECTORY_NEIGHBORHOODS),
    sort:
      selectedValue(searchParams.sort, DIRECTORY_SORTS) ||
      DIRECTORY_DEFAULT_SORT,
    page: pageNumber(searchParams.page),
  };
}

function statusWhere(status, asOf) {
  switch (status) {
    case 'VERIFIED_CURRENT':
      return {
        isDemonstration: false,
        dataStatus: 'VERIFIED_CURRENT',
        verifiedAt: { not: null },
        freshnessExpiresAt: { gt: asOf },
      };
    case 'DEMONSTRATION_ONLY':
      return { isDemonstration: true };
    case 'STALE':
      return {
        isDemonstration: false,
        OR: [
          { dataStatus: 'STALE' },
          {
            dataStatus: 'VERIFIED_CURRENT',
            verifiedAt: { not: null },
            freshnessExpiresAt: { lte: asOf },
          },
        ],
      };
    case 'DISPUTED':
      return {
        isDemonstration: false,
        dataStatus: 'DISPUTED',
      };
    case 'AWAITING_VERIFICATION':
      return {
        isDemonstration: false,
        OR: [
          { dataStatus: 'AWAITING_VERIFICATION' },
          {
            dataStatus: 'VERIFIED_CURRENT',
            OR: [{ verifiedAt: null }, { freshnessExpiresAt: null }],
          },
        ],
      };
    default:
      return {};
  }
}

export function directoryRetailerWhere({ brandId, filters, asOf = new Date() }) {
  const scopedBrandId = identifier(brandId, 'Brand ID');
  const timestamp = validTime(asOf);
  const parsedFilters = parseDirectorySearch(filters);
  const constraints = [];

  if (parsedFilters.query) {
    constraints.push({
      OR: [
        { name: { contains: parsedFilters.query } },
        { zip: { contains: parsedFilters.query } },
        { address: { contains: parsedFilters.query } },
        { city: { contains: parsedFilters.query } },
        {
          menus: {
            some: {
              product: {
                name: { contains: parsedFilters.query },
              },
              brandMenus: {
                some: {
                  brandId: scopedBrandId,
                },
              },
            },
          },
        },
      ],
    });
  }

  const truthConstraint = statusWhere(parsedFilters.status, timestamp);
  if (Object.keys(truthConstraint).length > 0) {
    constraints.push(truthConstraint);
  }

  if (parsedFilters.neighborhood && DC_NEIGHBORHOOD_MAP[parsedFilters.neighborhood]) {
    const keywords = DC_NEIGHBORHOOD_MAP[parsedFilters.neighborhood].keywords;
    constraints.push({
      OR: keywords.map((kw) => ({ address: { contains: kw } })),
    });
  }

  return {
    ...publicRetailerWhere(timestamp),
    menus: {
      some: {
        brandMenus: {
          some: {
            brandId: scopedBrandId,
          },
        },
      },
    },
    ...(parsedFilters.type ? { type: parsedFilters.type } : {}),
    ...(constraints.length > 0 ? { AND: constraints } : {}),
  };
}

export function directoryRetailerOrderBy(sort) {
  const selectedSort =
    selectedValue(sort, DIRECTORY_SORTS) || DIRECTORY_DEFAULT_SORT;
  switch (selectedSort) {
    case 'RECENTLY_UPDATED':
      return Object.freeze([
        Object.freeze({ updatedAt: 'desc' }),
        Object.freeze({ id: 'asc' }),
      ]);
    case 'NAME_ASC':
      return Object.freeze([
        Object.freeze({ name: 'asc' }),
        Object.freeze({ id: 'asc' }),
      ]);
    default:
      return Object.freeze([
        Object.freeze({ isDemonstration: 'asc' }),
        Object.freeze({ verifiedAt: 'desc' }),
        Object.freeze({ freshnessExpiresAt: 'desc' }),
        Object.freeze({ updatedAt: 'desc' }),
        Object.freeze({ id: 'asc' }),
      ]);
  }
}

export function currentDealWhere(asOf = new Date()) {
  const timestamp = validTime(asOf);
  return {
    expiryDate: { gt: timestamp },
    isActive: true,
    ...publicCatalogRecordWhere(timestamp),
  };
}

export function publicCatalogRecordWhere(asOf = new Date()) {
  const timestamp = validTime(asOf);
  return {
    OR: [
      { isDemonstration: true },
      {
        isDemonstration: false,
        dataStatus: 'VERIFIED_CURRENT',
        verifiedAt: { not: null },
        freshnessExpiresAt: { gt: timestamp },
      },
    ],
  };
}

export function isPublicCatalogRecord(record, asOf = new Date()) {
  const timestamp = validTime(asOf);
  return (
    record?.isDemonstration === true ||
    resolveDataStatus(record ?? {}, timestamp) === DATA_STATUS.VERIFIED_CURRENT
  );
}

export function directorySearchHref(filters, page) {
  const parsedFilters = parseDirectorySearch({ ...filters, page: String(page) });
  const params = new URLSearchParams();
  if (parsedFilters.query) params.set('query', parsedFilters.query);
  if (parsedFilters.type) params.set('type', parsedFilters.type);
  if (parsedFilters.status) params.set('status', parsedFilters.status);
  if (parsedFilters.neighborhood) params.set('neighborhood', parsedFilters.neighborhood);
  if (parsedFilters.sort !== DIRECTORY_DEFAULT_SORT) {
    params.set('sort', parsedFilters.sort);
  }
  if (parsedFilters.page > 1) params.set('page', String(parsedFilters.page));
  const queryString = params.toString();
  return queryString ? `/?${queryString}` : '/';
}
import { publicRetailerWhere } from './public-retailer.mjs';
import { DATA_STATUS, resolveDataStatus } from './data-status.mjs';
