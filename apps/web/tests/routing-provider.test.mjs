/**
 * Routing contract tests — dependency-free, run with bare `node --test`.
 *
 * The central law under test: no adapter may dress a straight-line estimate
 * up as a travel time. The null provider must be HONEST about not knowing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NullRoutingProvider,
  ROUTE_STATUS,
  geodesicLowerBoundMetres,
  registerRoutingProvider,
  selectRoutingProvider,
} from '../src/lib/geo/routing-provider.mjs';

const DUPONT = { lat: 38.9097, lng: -77.0434 };
const WHITE_HOUSE = { lat: 38.8977, lng: -77.0365 };
const BALTIMORE = { lat: 39.2904, lng: -76.6122 };

test('geodesic lower bound matches PostGIS geography within 1%', () => {
  // PostGIS ST_Distance(geography) measured 1460 m for this pair (evidence
  // ledger claim 13). Haversine on a sphere must land within 1%.
  const metres = geodesicLowerBoundMetres(DUPONT, WHITE_HOUSE);
  assert.ok(Math.abs(metres - 1460) < 15, `expected ~1460m, got ${metres}`);
});

test('null provider returns UNKNOWN — never a fabricated travel time', async () => {
  const provider = new NullRoutingProvider();
  const result = await provider.route({ from: DUPONT, to: WHITE_HOUSE });
  assert.equal(result.status, ROUTE_STATUS.UNKNOWN);
  assert.equal(result.travelTimeSeconds, null, 'travel time must be null, not estimated');
  assert.equal(result.routeDistanceMetres, null, 'route distance must be null, not haversine');
  assert.ok(result.distanceLowerBoundMetres > 0, 'lower bound is allowed and labeled');
  assert.ok(result.reason.includes('UNKNOWN'), 'reason explains the honesty contract');
});

test('null provider capabilities are honest (all false)', () => {
  const caps = new NullRoutingProvider().capabilities();
  assert.equal(caps.route, false);
  assert.equal(caps.isochrone, false);
  assert.equal(caps.network, 'none');
});

test('matrix carries per-cell UNKNOWN with per-cell lower bounds', async () => {
  const provider = new NullRoutingProvider();
  const matrix = await provider.routeMatrix({
    origins: [DUPONT],
    destinations: [WHITE_HOUSE, BALTIMORE],
  });
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0].length, 2);
  assert.equal(matrix.rows[0][0].status, ROUTE_STATUS.UNKNOWN);
  assert.ok(
    matrix.rows[0][1].distanceLowerBoundMetres > matrix.rows[0][0].distanceLowerBoundMetres,
    'Baltimore lower bound must exceed White House lower bound',
  );
});

test('provider selection defaults to null and rejects unknown names', () => {
  assert.equal(selectRoutingProvider({}).capabilities().name, 'null');
  assert.throws(() => selectRoutingProvider({ CANA_ROUTING_PROVIDER: 'nonexistent' }), /Unknown routing provider/);
});

test('registry rejects duplicate registration (no silent provider swaps)', () => {
  registerRoutingProvider('test-dup', () => new NullRoutingProvider());
  assert.throws(() => registerRoutingProvider('test-dup', () => new NullRoutingProvider()));
});
