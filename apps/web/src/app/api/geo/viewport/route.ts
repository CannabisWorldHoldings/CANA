/**
 * GET /api/geo/viewport?south=&west=&north=&east=&kind=
 *
 * Viewport-scoped geo entity read for the customer map. Returns canonical
 * CANA geo entities inside the bounding box, evidence-gated:
 *
 *  - geometry comes from PostGIS via the typed geo repository (the only
 *    module allowed raw spatial SQL) — never computed in application code
 *  - only claims passing the eligibility gate are attached
 *  - result size is bounded; the client never receives an unbounded dump
 *
 * At low zoom (large boxes) callers should use /api/geo/cells (H3 parent
 * aggregation) instead of individual entities; this route enforces an area
 * ceiling to make the cheap path the only working path for huge viewports.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findEntitiesInViewport } from '@/lib/geo/geo-repository.mjs';

/** Reject viewports larger than roughly the DC metro area (~1.0 deg^2). */
const MAX_VIEWPORT_AREA_DEG2 = 1.0;

// A truth-bearing public read is never cached — on the success path OR any error
// path. A cached 400/500 is a cached truth claim about the surface's state, and
// the release gate holds every response of this route to no-store.
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawBounds = ['south', 'west', 'north', 'east'].map((key) => params.get(key));
  const [south, west, north, east] = rawBounds.map((value) =>
    value === null || value.trim() === '' ? Number.NaN : Number(value));
  const kind = params.get('kind') ?? undefined;

  if (
    ![south, west, north, east].every(Number.isFinite) ||
    south >= north ||
    west >= east
  ) {
    return NextResponse.json(
      { error: 'south, west, north, east are required finite numbers with south < north and west < east' },
      { status: 400, headers: NO_STORE },
    );
  }
  const area = Math.abs(north - south) * Math.abs(east - west);
  if (area > MAX_VIEWPORT_AREA_DEG2) {
    return NextResponse.json(
      { error: 'viewport too large; use /api/geo/cells for aggregated views' },
      { status: 400, headers: NO_STORE },
    );
  }

  const startedAt = Date.now();
  try {
    const entities = await findEntitiesInViewport(prisma, {
      south,
      west,
      north,
      east,
      kind,
      limit: 200,
    });
    return NextResponse.json(
      {
        entities,
        meta: {
          count: Array.isArray(entities) ? entities.length : 0,
          bounded: true,
          latencyMs: Date.now() - startedAt,
        },
      },
      {
        // TRUTH-BEARING PUBLIC SURFACE. This route publishes geographic entity
        // records (name, coordinates, verification state) to consumers, so it is
        // governed by the release gate like every other v1 read: it must not be
        // cached. A shared cache would let a stale verification state — or an
        // entity retired via validUntil — keep rendering as current on someone
        // else's map. Pan-storm protection belongs in the aggregated
        // /api/geo/cells path, not in caching individual truth rows.
        headers: NO_STORE,
      },
    );
  } catch {
    // Never leak SQL or connection details to the public surface.
    return NextResponse.json({ error: 'geo query failed' }, { status: 500, headers: NO_STORE });
  }
}
