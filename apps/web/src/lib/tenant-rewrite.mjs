const CANONICAL_TENANT_PATH = '/orderweeddc.localhost';

export const TENANT_HOST_ROUTES = Object.freeze([
  { host: 'orderweeddc.com', destination: CANONICAL_TENANT_PATH },
  { host: 'orderweeddc.localhost', destination: CANONICAL_TENANT_PATH },
  { host: 'deals.localhost', destination: '/deals.localhost' },
  { host: 'luxury.localhost', destination: '/luxury.localhost' },
  { host: 'value.localhost', destination: '/value.localhost' },
  { host: 'flower.localhost', destination: '/flower.localhost' },
  { host: 'edibles.localhost', destination: '/edibles.localhost' },
  { host: 'wellness.localhost', destination: '/wellness.localhost' },
  { host: 'accessories.localhost', destination: '/accessories.localhost' },
  { host: 'events.localhost', destination: '/events.localhost' },
  { host: 'biz.localhost', destination: '/biz.localhost' },
]);

export const TENANT_HOST_REDIRECTS = Object.freeze({
  'dmvweeddelivery.com': '/delivery',
  'dmvweeddelivery.localhost': '/delivery',
  'weedneardc.com': '/',
  'weedneardc.localhost': '/',
  'georgetowndispensarydc.com': '/neighborhoods/georgetown',
  'georgetowndispensarydc.localhost': '/neighborhoods/georgetown',
  'dupontcircledispensarydc.com': '/neighborhoods/dupont-circle',
  'dupontcircledispensarydc.localhost': '/neighborhoods/dupont-circle',
  'capitolhilldispensarydc.com': '/neighborhoods/capitol-hill',
  'capitolhilldispensarydc.localhost': '/neighborhoods/capitol-hill',
  'ustreetdispensarydc.com': '/neighborhoods/u-street-shaw',
  'ustreetdispensarydc.localhost': '/neighborhoods/u-street-shaw',
  'navyyarddispensarydc.com': '/neighborhoods/navy-yard-wharf',
  'navyyarddispensarydc.localhost': '/neighborhoods/navy-yard-wharf',
});

const EXPLICIT_RESPONSE_HOSTS = new Set([
  'www.orderweeddc.com',
  'districtweed.com',
  'districtweed.localhost',
  'weeddmv.com',
  'weeddmv.localhost',
]);

const EXPLICIT_REQUEST_HOSTS = new Set([
  ...TENANT_HOST_ROUTES.map(({ host }) => host),
  ...Object.keys(TENANT_HOST_REDIRECTS),
  ...EXPLICIT_RESPONSE_HOSTS,
]);

export function isExplicitRequestHost(hostname) {
  return EXPLICIT_REQUEST_HOSTS.has(hostname);
}

export function tenantRedirectPath(hostname) {
  return TENANT_HOST_REDIRECTS[hostname] ?? null;
}

function destinationWithQuery(destination, query) {
  return query ? `${destination}?${query}` : destination;
}

export function tenantRewriteRules() {
  return TENANT_HOST_ROUTES.flatMap(({ host, destination, query }) => [
    {
      source: '/',
      has: [{ type: 'host', value: host }],
      destination: destinationWithQuery(destination, query),
    },
    {
      source: '/:path*',
      has: [{ type: 'host', value: host }],
      destination: destinationWithQuery(`${destination}/:path*`, query),
    },
  ]);
}
