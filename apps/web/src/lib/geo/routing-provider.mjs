/**
 * CANA Routing Provider contract (Slice 3 foundation).
 *
 * Provider-neutral interface for network travel intelligence. The rule from
 * the mission stands: geographic relevance is travel time on the real road
 * network, not straight-line distance — so this contract's core unit is
 * seconds-of-travel, and NO adapter is allowed to fake it.
 *
 * Truth law for this module:
 *   An adapter that cannot compute a real network route MUST return
 *   { status: 'UNKNOWN' } — never a haversine estimate dressed up as a
 *   travel time. Straight-line distance is allowed ONLY as an explicitly
 *   labeled lower bound (distanceLowerBoundMetres), because the road network
 *   can only make the true route longer, never shorter.
 *
 * Planned adapters (Slice 3 execution):
 *   - ValhallaProvider  (sovereign/self-hostable target)
 *   - OSRMProvider      (managed/demo alternative)
 * Present adapter:
 *   - NullRoutingProvider — honest UNKNOWN + geodesic lower bounds.
 *     It exists so calling code, ranking logic, and tests are built against
 *     the real contract shape from day one, with honest degradation.
 */

/** Shared result statuses. */
export const ROUTE_STATUS = Object.freeze({
  OK: 'OK',
  UNKNOWN: 'UNKNOWN', // provider unavailable / unimplemented — NOT an error
  UNROUTABLE: 'UNROUTABLE', // provider ran and proved no route exists
  ERROR: 'ERROR',
});

/** Geodesic (haversine) distance in metres — labeled lower bound ONLY. */
export function geodesicLowerBoundMetres(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The contract every routing adapter implements.
 *
 * route({ from, to, mode })            -> single route
 * routeMatrix({ origins, destinations, mode }) -> matrix of results
 * isochrone({ center, mode, minutes }) -> reachable-area polygon
 * capabilities()                       -> what this adapter can really do
 *
 * All coordinates are { lat, lng }. Modes: 'driving' | 'walking' | 'bicycling'.
 */
export class NullRoutingProvider {
  /** Honest capability report: this provider computes nothing network-based. */
  capabilities() {
    return {
      name: 'null',
      route: false,
      routeMatrix: false,
      isochrone: false,
      modes: [],
      network: 'none',
    };
  }

  /**
   * Returns UNKNOWN with a labeled geodesic lower bound. Ranking code may use
   * the lower bound to short-circuit obviously-too-far candidates, but must
   * treat travel time as unknown and say so in any customer-facing surface.
   */
  async route({ from, to }) {
    return {
      status: ROUTE_STATUS.UNKNOWN,
      provider: 'null',
      travelTimeSeconds: null,
      routeDistanceMetres: null,
      distanceLowerBoundMetres: geodesicLowerBoundMetres(from, to),
      geometry: null,
      reason: 'No network routing provider is configured. Travel time is UNKNOWN, not estimated.',
    };
  }

  async routeMatrix({ origins, destinations }) {
    const rows = origins.map((origin) =>
      destinations.map((destination) => ({
        status: ROUTE_STATUS.UNKNOWN,
        provider: 'null',
        travelTimeSeconds: null,
        routeDistanceMetres: null,
        distanceLowerBoundMetres: geodesicLowerBoundMetres(origin, destination),
      })),
    );
    return { status: ROUTE_STATUS.UNKNOWN, provider: 'null', rows };
  }

  async isochrone() {
    return {
      status: ROUTE_STATUS.UNKNOWN,
      provider: 'null',
      polygon: null,
      reason: 'Isochrones require a network routing provider (Valhalla planned, Slice 3).',
    };
  }
}

/**
 * Registry + selection. Providers register with a name; selection is
 * configuration (CANA_ROUTING_PROVIDER), defaulting to the honest null
 * provider. Benchmark-driven promotion (mission §12) replaces this default
 * once a real adapter exists and wins its evaluation.
 */
const registry = new Map([['null', () => new NullRoutingProvider()]]);

export function registerRoutingProvider(name, factory) {
  if (registry.has(name)) throw new Error(`routing provider already registered: ${name}`);
  registry.set(name, factory);
}

export function selectRoutingProvider(env = process.env) {
  const name = env.CANA_ROUTING_PROVIDER || 'null';
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown routing provider "${name}". Registered: ${[...registry.keys()].join(', ')}`,
    );
  }
  return factory();
}
