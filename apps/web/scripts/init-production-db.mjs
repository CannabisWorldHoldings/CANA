/**
 * Production database initialization — idempotent, demo-free.
 *
 * Creates exactly the records production needs and nothing synthetic:
 *   1. The platform Organization (real operating entity, not the demo
 *      holding company).
 *   2. The canonical Brand row whose `domain` is the tenant key that
 *      orderweeddc.com requests resolve to (orderweeddc.localhost via
 *      TENANT_ALIASES in src/lib/tenant-host.mjs).
 *
 * It NEVER creates demonstration retailers, products, menus, reviews, or
 * prices. Market records are admitted separately through the canonical
 * Reality Compiler, sovereign identity resolution, and Verification Court.
 * This initializer does not infer or materialize a live-market cohort.
 *
 * Usage:
 *   DATABASE_URL=postgresql://USER@HOST:5432/DATABASE \
 *     node scripts/init-production-db.mjs [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const CANONICAL_TENANT_DOMAIN = 'orderweeddc.localhost';
const ORGANIZATION_NAME = 'Order Weed DC';
const BRAND_NAME = 'orderweeddc';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required. Refusing to guess a PostgreSQL database location.',
    );
  }
  const prisma = new PrismaClient();
  try {
    const existingBrand = await prisma.brand.findUnique({
      where: { domain: CANONICAL_TENANT_DOMAIN },
      include: { organization: true },
    });

    if (existingBrand) {
      console.log(
        `Canonical brand already present: "${existingBrand.name}" (org "${existingBrand.organization.name}") — nothing to do.`,
      );
      return;
    }

    if (dryRun) {
      console.log(
        `[dry-run] Would create organization "${ORGANIZATION_NAME}" and brand "${BRAND_NAME}" (domain ${CANONICAL_TENANT_DOMAIN}) with schema-default light theme.`,
      );
      return;
    }

    const organization =
      (await prisma.organization.findFirst({
        where: { name: ORGANIZATION_NAME },
      })) ??
      (await prisma.organization.create({
        data: { name: ORGANIZATION_NAME },
      }));

    const brand = await prisma.brand.create({
      data: {
        name: BRAND_NAME,
        domain: CANONICAL_TENANT_DOMAIN,
        description:
          'Washington, D.C. cannabis directory with a public evidence trail: licenses, verification dates, and sources on every record.',
        organizationId: organization.id,
        // Theme fields intentionally omitted: schema defaults are the
        // canonical light "DC Fresh, Evidence Forward" palette.
      },
    });

    console.log(
      `Created organization "${organization.name}" and canonical brand "${brand.name}" (domain ${brand.domain}).`,
    );
    console.log('Market truth remains empty until separately admitted by the Reality Compiler.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
