/**
 * CANA Geo Repository — the ONLY module allowed to run raw spatial SQL.
 *
 * Architecture rule (ADR-0001 §5, mission §33): geometry is computed by
 * deterministic database engines, never guessed in application code, and raw
 * spatial SQL is isolated behind this typed boundary instead of scattering
 * $queryRaw through the application. Rendering and reasoning layers call
 * these functions; they never write SQL.
 *
 * Portability rule: every statement here is standard PostgreSQL + PostGIS +
 * H3 (h3-pg). No Neon-specific SQL, no vendor functions. The same statements
 * pass `prisma/sql/geo_smoke_test.sql` on any conforming host.
 *
 * All functions take a PrismaClient (or transaction client) as their first
 * argument so callers control connection/transaction scope.
 */

/** Guard: reject values that cannot be a finite coordinate before they reach SQL. */
function requireFinite(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${label} must be a finite number, got: ${String(value)}`);
  }
  return num;
}

function requireLat(lat) {
  const value = requireFinite(lat, 'latitude');
  if (value < -90 || value > 90) throw new Error(`latitude out of range: ${value}`);
  return value;
}

function requireLng(lng) {
  const value = requireFinite(lng, 'longitude');
  if (value < -180 || value > 180) throw new Error(`longitude out of range: ${value}`);
  return value;
}

function requireRadius(metres) {
  const value = requireFinite(metres, 'radiusMetres');
  if (value <= 0 || value > 100_000) {
    throw new Error(`radiusMetres must be in (0, 100000], got: ${value}`);
  }
  return value;
}

/**
 * Geo entities within `radiusMetres` of a point, nearest first, with true
 * geodesic distance in metres. Uses the GiST index via ST_DWithin.
 *
 * Returns [{ id, name, kind, lat, lng, h3R9, verification, distanceMetres }].
 */
export async function findEntitiesNearPoint(prisma, { lat, lng, radiusMetres, kind, limit = 50 }) {
  const qLat = requireLat(lat);
  const qLng = requireLng(lng);
  const qRadius = requireRadius(radiusMetres);
  const qLimit = Math.min(Math.max(1, Number(limit) || 50), 200);

  // Parameterized ($1...) — never string-interpolated.
  return prisma.$queryRawUnsafe(
    `SELECT e."id", e."name", e."kind", e."lat", e."lng", e."h3R9", e."verification",
            ST_Distance(e."geom"::geography,
                        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS "distanceMetres"
       FROM "GeoEntity" e
      WHERE e."geom" IS NOT NULL
        AND ($4::text IS NULL OR e."kind" = $4)
        AND (e."validUntil" IS NULL OR e."validUntil" > now())
        AND ST_DWithin(e."geom"::geography,
                       ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY "distanceMetres" ASC
      LIMIT $5`,
    qLat,
    qLng,
    qRadius,
    kind ?? null,
    qLimit,
  );
}

/**
 * Geo entities inside a map viewport (bounding box). This is the query the
 * public map calls per viewport change; it must stay index-backed (&&).
 */
export async function findEntitiesInViewport(prisma, { south, west, north, east, kind, limit = 200 }) {
  const qSouth = requireLat(south);
  const qNorth = requireLat(north);
  const qWest = requireLng(west);
  const qEast = requireLng(east);
  if (qSouth >= qNorth) throw new Error('viewport: south must be < north');
  const qLimit = Math.min(Math.max(1, Number(limit) || 200), 500);

  // TRUTH BOUNDARY. A GeoEntity that mirrors a DEMONSTRATION retailer must never
  // reach a public map. The entity table carries no demonstration flag of its own,
  // so the operational record it links to is authoritative — and the linkage is
  // adjudicated by the DATABASE, not assumed:
  //
  //   - retailerId IS NULL          -> a natively-sourced geo entity with no
  //                                    operational record to hide behind; eligible.
  //   - retailerId set, retailer    -> the retailer decides; only NON-demonstration
  //     exists                         entities render.
  //   - retailerId set, retailer    -> a DANGLING reference. It once pointed at an
  //     MISSING (join is NULL)         operational record and now points at nothing
  //                                    verifiable. It must NOT be treated as a safe
  //                                    orphan — that is precisely how a stale
  //                                    demonstration row (its retailer since removed)
  //                                    would leak onto a public map. Excluded.
  //
  // Serving any of the excluded rows would manufacture the exact counterfeit "real
  // place" the whole system refuses, and this route is public — the leak is durable.
  return prisma.$queryRawUnsafe(
    `SELECT e."id", e."name", e."kind", e."lat", e."lng", e."h3R9", e."verification"
       FROM "GeoEntity" e
       LEFT JOIN "Retailer" r ON r."id" = e."retailerId"
      WHERE e."geom" IS NOT NULL
        AND ($6::text IS NULL OR e."kind" = $6)
        AND (e."validUntil" IS NULL OR e."validUntil" > now())
        AND (e."retailerId" IS NULL OR (r."id" IS NOT NULL AND r."isDemonstration" IS NOT TRUE))
        AND e."geom" && ST_MakeEnvelope($2, $1, $4, $3, 4326)
      LIMIT $5`,
    qSouth,
    qWest,
    qNorth,
    qEast,
    qLimit,
    kind ?? null,
  );
}

/**
 * Aggregate entity counts per H3 cell at a coarser resolution for cluster /
 * heatmap rendering. `resolution` must be <= 9 because cells are derived
 * from the stored res-9 index via parent traversal.
 */
export async function countEntitiesByH3Parent(prisma, { resolution = 7, kind } = {}) {
  const res = Number(resolution);
  if (!Number.isInteger(res) || res < 0 || res > 9) {
    throw new Error(`resolution must be an integer in [0, 9], got: ${String(resolution)}`);
  }

  return prisma.$queryRawUnsafe(
    `SELECT h3_cell_to_parent(e."h3R9"::h3index, $1)::text AS "cell",
            count(*)::int AS "entityCount"
       FROM "GeoEntity" e
      WHERE e."h3R9" IS NOT NULL
        AND ($2::text IS NULL OR e."kind" = $2)
        AND (e."validUntil" IS NULL OR e."validUntil" > now())
      GROUP BY 1
      ORDER BY "entityCount" DESC`,
    res,
    kind ?? null,
  );
}

/**
 * H3 drift audit — thin wrapper over the database-side invariant function.
 * Returns divergent rows; an empty array is the only healthy answer.
 */
export async function auditH3Drift(prisma) {
  return prisma.$queryRawUnsafe('SELECT * FROM cana_geoentity_h3_drift()');
}

/**
 * Evidence-gated read: the ONLY claim accessor customer-facing surfaces may
 * use. Returns claims that are decision-eligible, verified to at least the
 * given states, and not stale. Everything else is invisible to the public
 * map — absence of a claim renders as UNKNOWN, never as a guess.
 */
export async function findEligibleClaims(
  prisma,
  { geoEntityId, claimType, states = ['VERIFIED', 'SUPPORTED'] },
) {
  if (typeof geoEntityId !== 'string' || geoEntityId.length === 0) {
    throw new Error('geoEntityId is required');
  }
  const allowed = new Set(['VERIFIED', 'SUPPORTED']);
  const requested = states.filter((s) => allowed.has(s));
  if (requested.length === 0) {
    throw new Error('states must include at least one of VERIFIED, SUPPORTED');
  }

  return prisma.geoClaim.findMany({
    where: {
      geoEntityId,
      ...(claimType ? { claimType } : {}),
      decisionEligible: true,
      verification: { in: requested },
      OR: [{ freshnessExpiresAt: null }, { freshnessExpiresAt: { gt: new Date() } }],
    },
    orderBy: [{ verification: 'asc' }, { observedAt: { sort: 'desc', nulls: 'last' } }],
  });
}
