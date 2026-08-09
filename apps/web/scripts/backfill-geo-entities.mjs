/**
 * Backfill CANA canonical geo entities from existing Retailer records.
 *
 * Truth laws applied here (this is the point of the script, not a formality):
 *
 *  1. A retailer's lat/lng is an OBSERVATION, not verified geographic truth.
 *     Existing rows have no recorded geocoding provenance, so their derived
 *     GeoEntity is created with verification=UNKNOWN and the honest source
 *     'legacy:retailer.lat_lng'. It is NOT promoted to VERIFIED just because
 *     it has been in the database for a long time.
 *
 *  2. The retailer's own evidence fields are carried across where they exist
 *     (dataSource, sourceUrl, retrievedAt, confidence) so provenance is not
 *     lost in translation.
 *
 *  3. Coordinates that cannot be real are skipped and reported, never written.
 *     (0,0) is the classic geocoding failure and must not enter the world model.
 *
 *  4. Idempotent: re-running updates the existing entity for a retailer rather
 *     than creating duplicates. Entity resolution is keyed on retailerId.
 *
 * The PostGIS `geom` column is populated by the database trigger installed by
 * prisma/sql/geo_kernel_postgis.sql — this script deliberately writes only
 * lat/lng so there is exactly one place that derives geometry.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/backfill-geo-entities.mjs [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');

/** Reject coordinates that cannot describe a real place. */
function coordinateProblem(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return 'non-numeric';
  if (Number.isNaN(lat) || Number.isNaN(lng)) return 'NaN';
  if (lat < -90 || lat > 90) return `latitude ${lat} out of range`;
  if (lng < -180 || lng > 180) return `longitude ${lng} out of range`;
  if (lat === 0 && lng === 0) return 'Null Island (0,0) — geocoding failure signature';
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  const receipt = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    created: 0,
    updated: 0,
    skipped: [],
  };

  try {
    const retailers = await prisma.retailer.findMany({
      select: {
        id: true,
        name: true,
        lat: true,
        lng: true,
        dataSource: true,
        sourceUrl: true,
        retrievedAt: true,
        confidence: true,
        isDemonstration: true,
      },
    });
    receipt.retailersScanned = retailers.length;

    for (const retailer of retailers) {
      const problem = coordinateProblem(retailer.lat, retailer.lng);
      if (problem) {
        receipt.skipped.push({ retailerId: retailer.id, name: retailer.name, reason: problem });
        continue;
      }

      const existing = await prisma.geoEntity.findUnique({
        where: { retailerId: retailer.id },
        select: { id: true },
      });

      // Demonstration records must never masquerade as observed reality.
      const source = retailer.isDemonstration
        ? 'demonstration:seed'
        : `legacy:retailer.lat_lng${retailer.dataSource ? ` (${retailer.dataSource})` : ''}`;

      const payload = {
        kind: 'business',
        name: retailer.name,
        lat: retailer.lat,
        lng: retailer.lng,
        retailerId: retailer.id,
        source,
        sourceUrl: retailer.sourceUrl ?? null,
        observedAt: retailer.retrievedAt ?? null,
        // Confidence is inherited, never invented. No evidence -> no number.
        confidence: retailer.confidence ?? null,
        // Unproven coordinates stay UNKNOWN until a geocoder corroborates them.
        verification: 'UNKNOWN',
      };

      if (DRY_RUN) {
        if (existing) receipt.updated += 1;
        else receipt.created += 1;
        continue;
      }

      if (existing) {
        await prisma.geoEntity.update({ where: { id: existing.id }, data: payload });
        receipt.updated++;
      } else {
        await prisma.geoEntity.create({ data: payload });
        receipt.created++;
      }
    }

    receipt.skippedCount = receipt.skipped.length;
    receipt.status = DRY_RUN ? 'DRY_RUN_OK' : 'BACKFILLED';
    receipt.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(receipt, null, 2));

    if (receipt.skipped.length > 0) {
      console.error(
        `\nWARNING: ${receipt.skipped.length} retailer(s) had unusable coordinates and were ` +
          'not added to the geo world model. They will not appear on the map.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
});
