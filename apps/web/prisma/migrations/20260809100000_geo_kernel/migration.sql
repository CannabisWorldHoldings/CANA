-- CreateTable
CREATE TABLE "GeoEntity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'business',
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "geom" geometry(Point, 4326),
    "h3R9" TEXT,
    "retailerId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "verification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoEntityAlias" (
    "id" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoEntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoClaim" (
    "id" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "claimValue" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3),
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "corroboratingSources" INTEGER NOT NULL DEFAULT 0,
    "contradictorySources" INTEGER NOT NULL DEFAULT 0,
    "verification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "decisionEligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeoEntity_retailerId_key" ON "GeoEntity"("retailerId");

-- CreateIndex
CREATE INDEX "GeoEntity_kind_verification_idx" ON "GeoEntity"("kind", "verification");

-- CreateIndex
CREATE INDEX "GeoEntity_h3R9_idx" ON "GeoEntity"("h3R9");

-- CreateIndex
CREATE INDEX "GeoEntity_validUntil_idx" ON "GeoEntity"("validUntil");

-- CreateIndex
CREATE INDEX "GeoEntityAlias_geoEntityId_idx" ON "GeoEntityAlias"("geoEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoEntityAlias_namespace_externalId_key" ON "GeoEntityAlias"("namespace", "externalId");

-- CreateIndex
CREATE INDEX "GeoClaim_geoEntityId_claimType_idx" ON "GeoClaim"("geoEntityId", "claimType");

-- CreateIndex
CREATE INDEX "GeoClaim_verification_decisionEligible_idx" ON "GeoClaim"("verification", "decisionEligible");

-- CreateIndex
CREATE INDEX "GeoClaim_freshnessExpiresAt_idx" ON "GeoClaim"("freshnessExpiresAt");

-- AddForeignKey
ALTER TABLE "GeoEntityAlias" ADD CONSTRAINT "GeoEntityAlias_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "GeoEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoClaim" ADD CONSTRAINT "GeoClaim_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "GeoEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- CANA geo kernel hardening (mirrors prisma/sql/geo_kernel_postgis.sql so a
-- bare `prisma migrate deploy` always produces the COMPLETE geo layer:
-- spatial index, coordinate constraints, and the single-truth derivation
-- trigger. The standalone SQL file remains for re-hardening existing DBs.)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS h3;
CREATE EXTENSION IF NOT EXISTS h3_postgis CASCADE;

CREATE INDEX IF NOT EXISTS "GeoEntity_geom_gist" ON "GeoEntity" USING GIST ("geom");

ALTER TABLE "GeoEntity" DROP CONSTRAINT IF EXISTS "GeoEntity_lat_range";
ALTER TABLE "GeoEntity" ADD CONSTRAINT "GeoEntity_lat_range" CHECK ("lat" >= -90 AND "lat" <= 90);
ALTER TABLE "GeoEntity" DROP CONSTRAINT IF EXISTS "GeoEntity_lng_range";
ALTER TABLE "GeoEntity" ADD CONSTRAINT "GeoEntity_lng_range" CHECK ("lng" >= -180 AND "lng" <= 180);
ALTER TABLE "GeoEntity" DROP CONSTRAINT IF EXISTS "GeoEntity_not_null_island";
ALTER TABLE "GeoEntity" ADD CONSTRAINT "GeoEntity_not_null_island" CHECK (NOT ("lat" = 0 AND "lng" = 0));

CREATE OR REPLACE FUNCTION cana_geoentity_sync_geom()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."geom" := ST_SetSRID(ST_MakePoint(NEW."lng", NEW."lat"), 4326);
  NEW."h3R9" := h3_lat_lng_to_cell(POINT(NEW."lng", NEW."lat"), 9)::text;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "GeoEntity_sync_geom" ON "GeoEntity";
CREATE TRIGGER "GeoEntity_sync_geom"
  BEFORE INSERT OR UPDATE OF "lat", "lng", "h3R9" ON "GeoEntity"
  FOR EACH ROW EXECUTE FUNCTION cana_geoentity_sync_geom();

CREATE OR REPLACE FUNCTION cana_geoentity_h3_drift()
RETURNS TABLE (id text, stored text, expected text) LANGUAGE sql STABLE AS $$
  SELECT e."id", e."h3R9", h3_lat_lng_to_cell(POINT(e."lng", e."lat"), 9)::text
    FROM "GeoEntity" e
   WHERE e."h3R9" IS DISTINCT FROM h3_lat_lng_to_cell(POINT(e."lng", e."lat"), 9)::text;
$$;

CREATE INDEX IF NOT EXISTS "GeoClaim_eligible_lookup"
  ON "GeoClaim" ("geoEntityId", "claimType") WHERE "decisionEligible" = true;
