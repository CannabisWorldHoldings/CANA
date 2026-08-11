/**
 * Read-only database inspector. Prints a compact JSON receipt and never
 * mutates anything. Used by bootstrap-production-db.sh to decide, with
 * evidence, whether a database is schema-empty, healthy, or unknown.
 *
 * Usage:
 *   DATABASE_URL=postgresql://USER@HOST:5432/DATABASE node scripts/db-inspect.mjs
 *   ... --assert-core   exit 2 unless Organization+Brand tables exist
 *
 * Engine-portable: detects PostgreSQL vs SQLite from DATABASE_URL and uses
 * the matching catalog query. PostgreSQL is the canonical CANA datastore;
 * SQLite support is retained only so rollback snapshots stay inspectable.
 *
 * Exit codes: 0 ok · 2 core tables missing (with --assert-core)
 */
import { PrismaClient } from '@prisma/client';
import { databaseProviderOf } from '../src/lib/db-config.mjs';

const assertCore = process.argv.includes('--assert-core');

/** Redact credentials so the receipt is safe to print and archive. */
function redactUrl(url) {
  if (databaseProviderOf(url) === 'sqlite') return url.replace(/^file:/, 'file:…/');
  try {
    const parsed = new URL(url);
    parsed.password = '';
    parsed.username = parsed.username ? '…' : '';
    return parsed.toString();
  } catch {
    return '(unparseable database url)';
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  const databaseUrl = process.env.DATABASE_URL;
  const provider = databaseProviderOf(databaseUrl);
  if (!['postgresql', 'sqlite'].includes(provider)) {
    throw new Error(`Unsupported database provider: ${provider}`);
  }
  const sqlite = provider === 'sqlite';
  const prisma = new PrismaClient();
  const receipt = { databaseUrl: redactUrl(databaseUrl), engine: sqlite ? 'sqlite' : 'postgresql' };
  try {
    const tables = await prisma.$queryRawUnsafe(
      sqlite
        ? "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name"
        : "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%' AND tablename NOT IN ('spatial_ref_sys') ORDER BY tablename",
    );
    receipt.tableCount = tables.length;
    receipt.tables = tables.map((row) => row.name);
    const coreTablesPresent =
      receipt.tables.includes('Organization') && receipt.tables.includes('Brand');
    receipt.coreTablesPresent = coreTablesPresent;

    if (coreTablesPresent) {
      const [organizations, brands, canonicalBrands] = await Promise.all([
        prisma.organization.count(),
        prisma.brand.count(),
        prisma.brand.count({ where: { domain: 'orderweeddc.localhost' } }),
      ]);
      receipt.counts = { organizations, brands, canonicalBrands };
      if (receipt.tables.includes('Retailer')) {
        const [retailers, demoRetailers, awaiting] = await Promise.all([
          prisma.retailer.count(),
          prisma.retailer.count({ where: { isDemonstration: true } }),
          prisma.retailer.count({
            where: { dataStatus: 'AWAITING_VERIFICATION', isDemonstration: false },
          }),
        ]);
        receipt.counts.retailers = retailers;
        receipt.counts.demonstrationRetailers = demoRetailers;
        receipt.counts.awaitingVerification = awaiting;
      }
    }
    console.log(JSON.stringify(receipt));
    if (assertCore && !coreTablesPresent) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
