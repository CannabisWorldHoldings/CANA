-- ============================================================================
-- CANA GEO SMOKE TEST
--
-- Proves a target database really has a working geo kernel. Run against ANY
-- PostgreSQL host (local, Neon, Crunchy, RDS) to verify the geo layer before
-- trusting it:
--
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/sql/geo_smoke_test.sql
--
-- Exits non-zero on the first failed assertion. Rolls back everything it
-- writes, so it is safe against a populated database.
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

-- Assertion helper: raises (aborting the transaction) when cond is false.
CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN
    RAISE EXCEPTION 'GEO SMOKE FAIL: %', label;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- 1. PostGIS present and usable.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_extension WHERE extname = 'postgis') = 1,
  'postgis extension installed');

SELECT pg_temp.assert(
  PostGIS_Lib_Version() IS NOT NULL,
  'postgis library reports version ' || PostGIS_Lib_Version());

-- 2. Geometry column exists with the correct type and SRID.
SELECT pg_temp.assert(
  (SELECT type FROM geometry_columns
    WHERE f_table_name = 'GeoEntity' AND f_geometry_column = 'geom') = 'POINT',
  'GeoEntity.geom is POINT');

SELECT pg_temp.assert(
  (SELECT srid FROM geometry_columns
    WHERE f_table_name = 'GeoEntity' AND f_geometry_column = 'geom') = 4326,
  'GeoEntity.geom SRID is 4326');

-- 3. GiST spatial index exists.
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE tablename = 'GeoEntity' AND indexname = 'GeoEntity_geom_gist'),
  'GiST spatial index present');

-- 4. Trigger derives geom from lat/lng automatically.
INSERT INTO "GeoEntity" (id,name,lat,lng,"updatedAt")
VALUES ('smoke-dupont','Dupont Circle',38.9097,-77.0434,now());

SELECT pg_temp.assert(
  (SELECT geom IS NOT NULL FROM "GeoEntity" WHERE id='smoke-dupont'),
  'trigger populated geom on insert');

SELECT pg_temp.assert(
  (SELECT ST_SRID(geom) FROM "GeoEntity" WHERE id='smoke-dupont') = 4326,
  'derived geom carries SRID 4326');

-- 5. Trigger keeps geom coherent when coordinates are updated.
UPDATE "GeoEntity" SET lat=38.9076, lng=-77.0654 WHERE id='smoke-dupont';
SELECT pg_temp.assert(
  ROUND(ST_X((SELECT geom FROM "GeoEntity" WHERE id='smoke-dupont'))::numeric,4) = -77.0654,
  'geom follows lat/lng update (no silent divergence)');

-- 6. Geodesic distance is correct, not naive euclidean.
--    Dupont Circle -> White House is ~1.4-1.5 km on the ground.
INSERT INTO "GeoEntity" (id,name,lat,lng,"updatedAt")
VALUES ('smoke-wh','White House',38.8977,-77.0365,now());

SELECT pg_temp.assert(
  (SELECT ST_Distance(
      (SELECT geom FROM "GeoEntity" WHERE id='smoke-dupont')::geography,
      (SELECT geom FROM "GeoEntity" WHERE id='smoke-wh')::geography)) BETWEEN 2000 AND 3500,
  'geography distance Georgetown->White House is realistic metres');

-- 7. Radius search returns the near point and excludes the far one.
INSERT INTO "GeoEntity" (id,name,lat,lng,"updatedAt")
VALUES ('smoke-far','Baltimore',39.2904,-76.6122,now());

SELECT pg_temp.assert(
  (SELECT count(*) FROM "GeoEntity"
    WHERE ST_DWithin(geom::geography,
      ST_SetSRID(ST_MakePoint(-77.0365,38.8977),4326)::geography, 5000)
      AND id LIKE 'smoke-%') = 2,
  'ST_DWithin 5km selects DC points and excludes Baltimore');

-- 8. Coordinate integrity constraints actually reject bad data.
DO $$
BEGIN
  BEGIN
    INSERT INTO "GeoEntity" (id,name,lat,lng,"updatedAt")
    VALUES ('smoke-bad-lat','Impossible',91,-77,now());
    RAISE EXCEPTION 'GEO SMOKE FAIL: latitude 91 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  latitude out of range rejected';
  END;

  BEGIN
    INSERT INTO "GeoEntity" (id,name,lat,lng,"updatedAt")
    VALUES ('smoke-null-island','Null Island',0,0,now());
    RAISE EXCEPTION 'GEO SMOKE FAIL: Null Island (0,0) was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  Null Island geocoding failure rejected';
  END;
END $$;

-- 9. Evidence gating: a claim is not customer-facing until marked eligible.
INSERT INTO "GeoClaim" (id,"geoEntityId","claimType","claimValue",source,"updatedAt")
VALUES ('smoke-claim','smoke-dupont','is_open','true','unverified-scrape',now());

SELECT pg_temp.assert(
  (SELECT "decisionEligible" FROM "GeoClaim" WHERE id='smoke-claim') = false,
  'new claim defaults to NOT decision-eligible');

SELECT pg_temp.assert(
  (SELECT verification FROM "GeoClaim" WHERE id='smoke-claim') = 'UNKNOWN',
  'new claim defaults to UNKNOWN, not assumed true');

-- 10. H3: extension present, deterministic, correct resolution, and enforced
--     as an invariant rather than trusted as stored decoration.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_extension WHERE extname = 'h3') = 1,
  'h3 extension installed');

-- Known vector: Dupont Circle (38.9097, -77.0434) at res 9.
SELECT pg_temp.assert(
  h3_lat_lng_to_cell(POINT(-77.0434, 38.9097), 9)::text = '892aa84edabffff',
  'H3 conversion matches known Dupont Circle vector');

-- Determinism: recomputing yields the identical cell.
SELECT pg_temp.assert(
  h3_lat_lng_to_cell(POINT(-77.0434, 38.9097), 9)
    = h3_lat_lng_to_cell(POINT(-77.0434, 38.9097), 9),
  'H3 conversion is deterministic');

-- The trigger derived h3R9 automatically for rows inserted above.
SELECT pg_temp.assert(
  (SELECT "h3R9" IS NOT NULL FROM "GeoEntity" WHERE id='smoke-dupont'),
  'trigger populated h3R9 on insert');

SELECT pg_temp.assert(
  (SELECT h3_get_resolution((SELECT "h3R9" FROM "GeoEntity" WHERE id='smoke-dupont')::h3index)) = 9,
  'derived h3R9 is resolution 9');

-- h3R9 follows coordinate updates (smoke-dupont was moved to Georgetown in §5).
SELECT pg_temp.assert(
  (SELECT "h3R9" FROM "GeoEntity" WHERE id='smoke-dupont')
    = h3_lat_lng_to_cell(POINT(-77.0654, 38.9076), 9)::text,
  'h3R9 follows lat/lng update (no silent divergence)');

-- Falsification: a hand-written WRONG h3R9 must be overwritten by the trigger,
-- not stored. Stored H3 is never trusted over recomputation.
UPDATE "GeoEntity" SET "h3R9" = '8f2aaaaaaaaaaaa' WHERE id='smoke-wh';
SELECT pg_temp.assert(
  (SELECT "h3R9" FROM "GeoEntity" WHERE id='smoke-wh')
    = h3_lat_lng_to_cell(POINT(-77.0365, 38.8977), 9)::text,
  'hand-written divergent h3R9 is overwritten by derivation (single truth)');

-- Drift audit function reports zero divergent rows.
SELECT pg_temp.assert(
  (SELECT count(*) FROM cana_geoentity_h3_drift()) = 0,
  'cana_geoentity_h3_drift() finds no drift');

-- Falsification of the audit itself: disable the trigger, force drift, and
-- prove the audit CATCHES it. An audit that cannot fail proves nothing.
ALTER TABLE "GeoEntity" DISABLE TRIGGER "GeoEntity_sync_geom";
UPDATE "GeoEntity" SET "h3R9" = '892aa84edabffff' WHERE id='smoke-far'; -- Baltimore w/ DC cell
SELECT pg_temp.assert(
  (SELECT count(*) FROM cana_geoentity_h3_drift()) = 1,
  'drift audit detects a forced divergent h3R9 (negative control)');
ALTER TABLE "GeoEntity" ENABLE TRIGGER "GeoEntity_sync_geom";

-- Parent derivation for future neighborhood-level aggregation.
SELECT pg_temp.assert(
  h3_get_resolution(h3_cell_to_parent('892aa84edabffff'::h3index, 7)) = 7,
  'parent cell derivation to res 7 works');

-- H3 <-> PostGIS interop: res-9 cell centroid sits within 200 m of the point.
SELECT pg_temp.assert(
  ST_Distance(
    h3_cell_to_geometry('892aa84edabffff'::h3index)::geography,
    ST_SetSRID(ST_MakePoint(-77.0434, 38.9097),4326)::geography) < 200,
  'H3 cell geometry round-trips within a res-9 cell radius');

-- 11. Alias uniqueness: one external ID cannot map to two canonical entities.
INSERT INTO "GeoEntityAlias" (id,"geoEntityId",namespace,"externalId")
VALUES ('smoke-alias','smoke-dupont','overture_gers','08f2aa8c8f2aa8c8');

DO $$
BEGIN
  BEGIN
    INSERT INTO "GeoEntityAlias" (id,"geoEntityId",namespace,"externalId")
    VALUES ('smoke-alias-dupe','smoke-wh','overture_gers','08f2aa8c8f2aa8c8');
    RAISE EXCEPTION 'GEO SMOKE FAIL: duplicate provider alias was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  duplicate provider alias rejected (entity resolution intact)';
  END;
END $$;

SELECT 'GEO SMOKE TEST PASSED' AS result;

ROLLBACK;
