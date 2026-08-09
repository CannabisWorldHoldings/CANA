-- ============================================================================
-- CANA GEO KERNEL — PostGIS provisioning and spatial indexes
--
-- Idempotent. Safe to run repeatedly and safe to run before or after
-- `prisma migrate deploy`.
--
-- Why this file exists separately from Prisma migrations:
--   Prisma models the geometry column as `Unsupported("geometry(Point, 4326)")`,
--   which creates the column but does NOT create spatial indexes, the PostGIS
--   extension ordering, or the lat/lng <-> geom consistency guarantees. Those
--   are expressed here so they are reviewable as plain SQL and portable to any
--   PostgreSQL host.
--
-- Verified against: PostgreSQL 17.8 / POSTGIS 3.5.6 / GEOS 3.14.1 / PROJ 9.8.1
-- ============================================================================

-- 1. Extensions. Must exist before any geometry column is created.
--    h3/h3_postgis: database-side H3 primitives. The H3 SEMANTICS are an open
--    CANA abstraction (the same indexes can be computed by an application-side
--    H3 library or a future spatial service); only the acceleration is
--    database-resident. h3_postgis pulls in postgis_raster as a dependency.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS h3;
CREATE EXTENSION IF NOT EXISTS h3_postgis CASCADE;

-- 2. Fail loudly if the host silently lacks PostGIS or H3 rather than
--    proceeding with a broken geo layer. An absent extension is an UNKNOWN
--    world model, not a degraded one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'PostGIS is not available on this database. CANA geo kernel cannot be provisioned.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'h3') THEN
    RAISE EXCEPTION 'H3 extension is not available on this database. CANA geo kernel cannot be provisioned. If the managed host cannot install h3, switch GeoEntity h3 maintenance to the application-side H3 library before proceeding.';
  END IF;
END
$$;

-- 3. Geometry column. Created defensively so this file also works when the
--    Prisma migration has not yet introduced it.
ALTER TABLE "GeoEntity"
  ADD COLUMN IF NOT EXISTS "geom" geometry(Point, 4326);

-- 4. Spatial index. GiST is required for && / ST_DWithin / ST_Contains to use
--    an index rather than degrading to a sequential scan.
CREATE INDEX IF NOT EXISTS "GeoEntity_geom_gist"
  ON "GeoEntity" USING GIST ("geom");

-- 5. Coordinate integrity. Reject impossible coordinates at the storage layer
--    so a bad provider response cannot poison the world model.
ALTER TABLE "GeoEntity" DROP CONSTRAINT IF EXISTS "GeoEntity_lat_range";
ALTER TABLE "GeoEntity" ADD CONSTRAINT "GeoEntity_lat_range"
  CHECK ("lat" >= -90 AND "lat" <= 90);

ALTER TABLE "GeoEntity" DROP CONSTRAINT IF EXISTS "GeoEntity_lng_range";
ALTER TABLE "GeoEntity" ADD CONSTRAINT "GeoEntity_lng_range"
  CHECK ("lng" >= -180 AND "lng" <= 180);

-- 6. Null Island guard. (0,0) is the single most common geocoding failure
--    signature and must never be mistaken for a real DC location.
ALTER TABLE "GeoEntity" DROP CONSTRAINT IF EXISTS "GeoEntity_not_null_island";
ALTER TABLE "GeoEntity" ADD CONSTRAINT "GeoEntity_not_null_island"
  CHECK (NOT ("lat" = 0 AND "lng" = 0));

-- 7. Single-truth derivation chain. lat/lng is the writable input; geom and
--    h3R9 are DERIVED from it in one place, by trigger, so the four columns
--    can never become four independently writable truths:
--
--        lat/lng (input)  ->  geom (canonical PostGIS point)  ->  h3R9 (res 9)
--
--    Any attempt to hand-write a divergent h3R9 is overwritten here. Enforced
--    at the database so it holds regardless of whether a write came from
--    Prisma, a script, or raw SQL.
CREATE OR REPLACE FUNCTION cana_geoentity_sync_geom()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."geom" := ST_SetSRID(ST_MakePoint(NEW."lng", NEW."lat"), 4326);
  NEW."h3R9" := h3_lat_lng_to_cell(POINT(NEW."lng", NEW."lat"), 9)::text;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "GeoEntity_sync_geom" ON "GeoEntity";
CREATE TRIGGER "GeoEntity_sync_geom"
  BEFORE INSERT OR UPDATE OF "lat", "lng", "h3R9" ON "GeoEntity"
  FOR EACH ROW EXECUTE FUNCTION cana_geoentity_sync_geom();

-- 8. Backfill derived values for any row written before the trigger existed.
UPDATE "GeoEntity"
   SET "geom" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326),
       "h3R9" = h3_lat_lng_to_cell(POINT("lng", "lat"), 9)::text
 WHERE "geom" IS NULL OR "h3R9" IS NULL;

-- 8b. H3 invariant audit. Returns rows whose stored h3R9 does NOT match the
--     recomputed value — the result set must always be empty. Kept as a
--     function so gates, cron checks, and humans share one definition of drift.
CREATE OR REPLACE FUNCTION cana_geoentity_h3_drift()
RETURNS TABLE (id text, stored text, expected text)
LANGUAGE sql STABLE
AS $$
  SELECT e."id", e."h3R9",
         h3_lat_lng_to_cell(POINT(e."lng", e."lat"), 9)::text
    FROM "GeoEntity" e
   WHERE e."h3R9" IS DISTINCT FROM h3_lat_lng_to_cell(POINT(e."lng", e."lat"), 9)::text;
$$;

-- 9. Supporting indexes for evidence-gated reads. The public map filters on
--    these constantly, so they must not be sequential scans.
CREATE INDEX IF NOT EXISTS "GeoClaim_eligible_lookup"
  ON "GeoClaim" ("geoEntityId", "claimType")
  WHERE "decisionEligible" = true;
