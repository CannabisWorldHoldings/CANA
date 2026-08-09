/**
 * SQLite -> PostgreSQL one-way data migration for the CANA canonical store.
 *
 * Migration law (see docs/migration/SQLITE_TO_POSTGRES.md):
 *   - The SQLite file is treated as READ-ONLY. This script never writes to it.
 *   - PostgreSQL must be schema-ready (`prisma migrate deploy`) before running.
 *   - Refuses to run against a non-empty PostgreSQL unless --allow-nonempty,
 *     so a second run cannot silently double-insert or clobber live data.
 *   - Verifies row counts per table AND a set of business invariants after
 *     the copy. Any mismatch is a hard failure with a non-zero exit.
 *   - Prints a JSON receipt suitable for the evidence ledger.
 *
 * Reading uses node:sqlite (built into Node 22+), so no extra dependency and
 * no second Prisma schema is required. Writing uses the generated Prisma
 * client, which is already pointed at PostgreSQL.
 *
 * Usage:
 *   SQLITE_PATH=/path/prod.db \
 *   DATABASE_URL=postgresql://... DIRECT_URL=postgresql://... \
 *   node scripts/migrate-sqlite-to-postgres.mjs [--dry-run] [--allow-nonempty]
 *
 * Exit codes: 0 migrated and verified · 1 failure (nothing committed)
 */
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient, Prisma } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const ALLOW_NONEMPTY = process.argv.includes('--allow-nonempty');
const BATCH = 500;

/** Models that exist only in PostgreSQL (the geo kernel) and have no SQLite source. */
const POSTGRES_ONLY = new Set(['GeoEntity', 'GeoEntityAlias', 'GeoClaim']);

/**
 * Order models so a row is never inserted before the row it references.
 * Derived from the Prisma DMMF rather than hand-maintained, so adding a model
 * later cannot silently break ordering.
 */
function topologicallyOrderModels(models) {
  const byName = new Map(models.map((m) => [m.name, m]));
  const ordered = [];
  const done = new Set();
  const visiting = new Set();

  const visit = (name) => {
    if (done.has(name) || !byName.has(name)) return;
    if (visiting.has(name)) return; // cycle (self/mutual FK) — order resolved by nullable FKs
    visiting.add(name);
    for (const field of byName.get(name).fields) {
      // Only follow relations where THIS model holds the foreign key.
      if (field.kind === 'object' && field.relationFromFields?.length > 0) {
        visit(field.type);
      }
    }
    visiting.delete(name);
    done.add(name);
    ordered.push(name);
  };

  for (const model of models) visit(model.name);
  return ordered;
}

/** Coerce one SQLite row into Prisma/PostgreSQL types using the model's schema. */
function coerceRow(row, model) {
  const out = {};
  for (const field of model.fields) {
    if (field.kind === 'object') continue; // relations are carried by scalar FKs
    if (field.type === 'Unsupported') continue; // geometry is derived, never copied
    if (field.dbName && field.dbName !== field.name) {
      throw new Error(
        `Mapped field ${model.name}.${field.name} (${field.dbName}) is unsupported by the SQLite migration`,
      );
    }
    if (!(field.name in row)) continue;

    const key = field.name;
    const value = row[key];
    if (value === undefined) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }

    switch (field.type) {
      case 'DateTime':
        // SQLite stores these as epoch-ms integers or ISO strings.
        out[key] = value instanceof Date ? value : new Date(value);
        break;
      case 'Boolean':
        out[key] = value === 1 || value === true || value === '1';
        break;
      case 'Int':
        out[key] = Number(value);
        break;
      case 'Float':
        out[key] = Number(value);
        break;
      case 'BigInt':
        out[key] = BigInt(value);
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

async function main() {
  const sqlitePath = process.env.SQLITE_PATH;
  if (!sqlitePath) {
    throw new Error('SQLITE_PATH is required (path to the source .db file).');
  }
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('postgres')) {
    throw new Error(
      'DATABASE_URL must point at PostgreSQL. Refusing to migrate into a non-PostgreSQL target.',
    );
  }

  const receipt = {
    startedAt: new Date().toISOString(),
    source: sqlitePath,
    dryRun: DRY_RUN,
    tables: {},
    invariants: {},
  };

  // Source is opened read-only so the rollback snapshot cannot be mutated.
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const prisma = new PrismaClient();

  try {
    const models = Prisma.dmmf.datamodel.models.filter((m) => !POSTGRES_ONLY.has(m.name));
    const order = topologicallyOrderModels(models).filter((n) => !POSTGRES_ONLY.has(n));
    const byName = new Map(models.map((m) => [m.name, m]));
    const copyAndVerify = async (destination) => {

    // -- Guard: destination must be empty unless explicitly overridden. -------
    const preexisting = [];
    for (const name of order) {
      const delegate = destination[name.charAt(0).toLowerCase() + name.slice(1)];
      if (!delegate) continue;
      const count = await delegate.count();
      if (count > 0) preexisting.push(`${name}=${count}`);
    }
    if (preexisting.length > 0 && !ALLOW_NONEMPTY) {
      throw new Error(
        `Destination PostgreSQL is not empty (${preexisting.join(', ')}). ` +
          'Refusing to migrate to avoid duplicating or clobbering live data. ' +
          'Re-run with --allow-nonempty only if you are certain.',
      );
    }

    // -- Copy, parent tables first. ------------------------------------------
    for (const name of order) {
      const model = byName.get(name);
      const delegate = destination[name.charAt(0).toLowerCase() + name.slice(1)];
      if (!delegate) continue;

      let sourceRows = [];
      try {
        sourceRows = sqlite.prepare(`SELECT * FROM "${name}"`).all();
      } catch {
        // Table absent in the older SQLite snapshot — record and continue.
        receipt.tables[name] = { source: 0, written: 0, note: 'absent in source' };
        continue;
      }

      const rows = sourceRows.map((r) => coerceRow(r, model));
      let written = 0;
      if (!DRY_RUN && rows.length > 0) {
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          await delegate.createMany({ data: chunk, skipDuplicates: false });
          written += chunk.length;
        }
      }
      receipt.tables[name] = { source: rows.length, written: DRY_RUN ? 0 : written };
    }

    // -- Verify: per-table counts must match the source exactly. -------------
    const mismatches = [];
    for (const name of order) {
      const delegate = destination[name.charAt(0).toLowerCase() + name.slice(1)];
      if (!delegate) continue;
      const expected = receipt.tables[name]?.source ?? 0;
      const actual = DRY_RUN ? expected : await delegate.count();
      receipt.tables[name].verified = actual;
      if (actual !== expected) mismatches.push(`${name}: expected ${expected}, got ${actual}`);
    }
    if (mismatches.length > 0) {
      throw new Error(`Row count verification FAILED:\n  ${mismatches.join('\n  ')}`);
    }

    // -- Verify: business invariants that a pure count cannot catch. ---------
    // These protect the truth laws the directory depends on.
    const [retailers, verifiedRetailers, demoRetailers, brands, orphanRetailerCoords] =
      await Promise.all([
        destination.retailer.count(),
        destination.retailer.count({ where: { dataStatus: 'VERIFIED_CURRENT' } }),
        destination.retailer.count({ where: { isDemonstration: true } }),
        destination.brand.count(),
        destination.retailer.count({ where: { OR: [{ lat: 0 }, { lng: 0 }] } }),
      ]);
    receipt.invariants = {
      retailers,
      verifiedRetailers,
      demoRetailers,
      brands,
      retailersAtNullIsland: orphanRetailerCoords,
    };
    if (orphanRetailerCoords > 0) {
      throw new Error(
        `${orphanRetailerCoords} retailer(s) carry (0,0) coordinates. ` +
          'These would become invalid geo entities. Fix the source data before migrating.',
      );
    }
    };

    if (DRY_RUN) {
      await copyAndVerify(prisma);
    } else {
      await prisma.$transaction(copyAndVerify, { maxWait: 10_000, timeout: 15 * 60_000 });
    }

    receipt.status = DRY_RUN ? 'DRY_RUN_OK' : 'MIGRATED_AND_VERIFIED';
    receipt.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
});
