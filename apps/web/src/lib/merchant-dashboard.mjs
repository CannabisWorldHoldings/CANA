export const MERCHANT_PAGE_SIZE = 25;
export const MERCHANT_MAX_PAGE = 1_000;
export const MERCHANT_CATALOG_QUERY_MAX_LENGTH = 80;

export const MERCHANT_PAGE_KEYS = Object.freeze([
  'menuPage',
  'dealPage',
  'catalogPage',
]);

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function pageNumber(value) {
  const first = firstValue(value);
  if (Number.isSafeInteger(first) && first >= 1) {
    return Math.min(first, MERCHANT_MAX_PAGE);
  }
  if (typeof first !== 'string' || !/^[1-9]\d{0,3}$/.test(first)) return 1;
  return Math.min(Number(first), MERCHANT_MAX_PAGE);
}

function catalogQuery(value) {
  const first = firstValue(value);
  if (typeof first !== 'string') return '';
  return first
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MERCHANT_CATALOG_QUERY_MAX_LENGTH);
}

export function parseMerchantDashboardSearch(searchParams = {}) {
  return {
    menuPage: pageNumber(searchParams.menuPage),
    dealPage: pageNumber(searchParams.dealPage),
    catalogPage: pageNumber(searchParams.catalogPage),
    catalogQuery: catalogQuery(searchParams.catalogQuery),
  };
}

export function merchantPageCount(totalItems) {
  if (!Number.isSafeInteger(totalItems) || totalItems < 0) {
    throw new TypeError('Merchant item count must be a non-negative safe integer.');
  }
  return Math.max(1, Math.ceil(totalItems / MERCHANT_PAGE_SIZE));
}

export function clampMerchantPage(requestedPage, totalItems) {
  return Math.min(pageNumber(requestedPage), merchantPageCount(totalItems));
}

export function merchantPageOffset(page) {
  return (pageNumber(page) - 1) * MERCHANT_PAGE_SIZE;
}

export function merchantDashboardHref(currentSearch, pageKey, targetPage) {
  if (!MERCHANT_PAGE_KEYS.includes(pageKey)) {
    throw new TypeError('Unknown merchant dashboard collection.');
  }

  const parsed = parseMerchantDashboardSearch({
    ...currentSearch,
    [pageKey]: targetPage,
  });
  const params = new URLSearchParams();
  if (parsed.catalogQuery) params.set('catalogQuery', parsed.catalogQuery);
  for (const key of MERCHANT_PAGE_KEYS) {
    if (parsed[key] > 1) params.set(key, String(parsed[key]));
  }
  const query = params.toString();
  return query ? `/business/dashboard?${query}` : '/business/dashboard';
}

export function availableCatalogWhere(retailerId, query = '') {
  const normalizedRetailerId =
    typeof retailerId === 'string' ? retailerId.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(normalizedRetailerId)) {
    throw new TypeError('Retailer ID has an invalid format.');
  }
  const normalizedQuery = catalogQuery(query);

  return {
    menuEntries: {
      none: {
        retailerId: normalizedRetailerId,
      },
    },
    ...(normalizedQuery
      ? {
          OR: [
            { name: { contains: normalizedQuery, mode: /** @type {const} */ ('insensitive') } },
            { category: { contains: normalizedQuery, mode: /** @type {const} */ ('insensitive') } },
            { description: { contains: normalizedQuery, mode: /** @type {const} */ ('insensitive') } },
          ],
        }
      : {}),
  };
}
