export const CUSTOMER_WORLD_JOURNEYS = Object.freeze([
  'HOME', 'SEARCH', 'DELIVERY', 'DISPENSARIES',
]);

export const CUSTOMER_WORLD_JOURNEY_PATHS = Object.freeze({
  HOME: '/',
  SEARCH: '/search',
  DELIVERY: '/delivery',
  DISPENSARIES: '/dispensaries',
});

export function customerWorldViewHref(world, view) {
  const params = new URLSearchParams({ market: world.request.market_id, view });
  if (world.request.customer_query) params.set('query', world.request.customer_query);
  return `${CUSTOMER_WORLD_JOURNEY_PATHS[world.request.journey]}?${params}`;
}
