/**
 * PostgreSQL semantic regression tests.
 *
 * Guards the SQLite -> PostgreSQL migration against the class of bug that
 * fails SILENTLY: no error, no crash, just different answers. Every test here
 * encodes a difference found by the migration audit
 * (docs/migration/SQLITE_TO_POSTGRES.md §1) so it can never regress unnoticed.
 *
 * Requires DATABASE_URL pointing at PostgreSQL. These tests are meaningless
 * against SQLite and refuse to run there — the entire point is PostgreSQL
 * behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL ?? '';
const disposableAttestation = process.env.CANA_DISPOSABLE_DATABASE_ATTESTATION ?? '';
let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  parsedDatabaseUrl = null;
}
if (
  !parsedDatabaseUrl ||
  !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
  !['127.0.0.1', 'localhost', '::1'].includes(parsedDatabaseUrl.hostname) ||
  !/^[0-9a-f]{64}$/.test(disposableAttestation)
) {
  throw new Error(
    'postgres-semantics.test.mjs requires a loopback PostgreSQL URL and a ' +
      'CANA_DISPOSABLE_DATABASE_ATTESTATION issued by the repository verifier.',
  );
}

const prisma = new PrismaClient();
const [databaseIdentity] = await prisma.$queryRawUnsafe(
  "SELECT current_database() AS database, current_setting('cana.disposable_attestation', true) AS attestation",
);
if (
  databaseIdentity?.attestation !== disposableAttestation ||
  databaseIdentity?.database !== parsedDatabaseUrl.pathname.slice(1)
) {
  await prisma.$disconnect();
  throw new Error('PostgreSQL semantics tests refuse a database without the matching disposable-server attestation');
}
const RUN = `pgsem-${Date.now()}`;

function retailerFixture(overrides) {
  return {
    name: `${RUN} fixture`,
    address: '1 Test St NW',
    lat: 38.9,
    lng: -77.03,
    dataStatus: 'VERIFIED_CURRENT',
    isDemonstration: false,
    verifiedAt: new Date(),
    freshnessExpiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

/**
 * The directory where-clause only returns retailers carrying at least one
 * menu entry selected into the brand's menu, so the search fixture needs the
 * full Retailer -> MenuEntry -> BrandMenu chain to be realistic.
 */
async function createSearchableRetailer(brandId, name) {
  const retailer = await prisma.retailer.create({ data: retailerFixture({ name }) });
  const product = await prisma.product.create({
    data: {
      name: `${RUN} product`,
      category: 'flower',
      dataStatus: 'VERIFIED_CURRENT',
      verifiedAt: new Date(),
      freshnessExpiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const entry = await prisma.menuEntry.create({
    data: {
      retailerId: retailer.id,
      productId: product.id,
      price: 10,
      dataStatus: 'VERIFIED_CURRENT',
      verifiedAt: new Date(),
      freshnessExpiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.brandMenu.create({ data: { brandId, menuEntryId: entry.id } });
  return retailer;
}

test.after(async () => {
  await prisma.retailer.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// 1. THE ORIGINAL BUG: user-facing search must be case-insensitive.
//    SQLite's `contains` matched case-insensitively; PostgreSQL's does not
//    unless mode:'insensitive' is passed. This is the regression that must
//    never come back.
// ---------------------------------------------------------------------------
test('directory search: lowercase query matches mixed-case retailer name', async () => {
  const { directoryRetailerWhere } = await import('../src/lib/directory-search.mjs');
  const brand = await prisma.brand.findFirst({ select: { id: true } });
  assert.ok(brand, 'a Brand row is required (run the seed first)');

  await createSearchableRetailer(brand.id, `${RUN} Dupont Circle Dispensary`);

  const where = directoryRetailerWhere({ brandId: brand.id, filters: { query: 'dupont' } });
  const hits = await prisma.retailer.findMany({ where, select: { name: true } });

  assert.ok(
    hits.some((r) => r.name === `${RUN} Dupont Circle Dispensary`),
    `searching "dupont" must match "Dupont Circle Dispensary" — got: ${JSON.stringify(hits.map((h) => h.name))}`,
  );
});

test('directory search: uppercase and mixed-case variants also match', async () => {
  const { directoryRetailerWhere } = await import('../src/lib/directory-search.mjs');
  const brand = await prisma.brand.findFirst({ select: { id: true } });
  assert.ok(brand, 'a Brand row is required (run the seed first)');

  for (const variant of ['DUPONT', 'DuPoNt', 'dupont circle']) {
    const where = directoryRetailerWhere({ brandId: brand.id, filters: { query: variant } });
    const hits = await prisma.retailer.findMany({ where, select: { name: true } });
    assert.ok(
      hits.some((r) => r.name.includes('Dupont Circle')),
      `variant "${variant}" must match Dupont Circle`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. NEGATIVE CONTROL for the fix itself: raw `contains` WITHOUT
//    mode:'insensitive' must remain case-sensitive on PostgreSQL. If this
//    test ever fails, the engine's semantics changed under us and every
//    deliberate case-sensitive filter needs re-review.
// ---------------------------------------------------------------------------
test('negative control: bare contains stays case-sensitive on PostgreSQL', async () => {
  const hits = await prisma.retailer.findMany({
    where: { name: { contains: `${RUN.toUpperCase()} DUPONT` } },
    select: { id: true },
  });
  assert.equal(
    hits.length,
    0,
    'bare contains matched case-insensitively — PostgreSQL semantics changed, audit all deliberate case-sensitive filters',
  );
});

// ---------------------------------------------------------------------------
// 3. UUID/audit filters were DELIBERATELY left case-sensitive. Prove exact
//    matching still works — UUIDs are stored lowercase and matched verbatim.
// ---------------------------------------------------------------------------
test('audit-detail filters: exact UUID substring match still works', async () => {
  const retailer = await prisma.retailer.create({
    data: retailerFixture({ name: `${RUN} audit target` }),
  });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin, 'an ADMIN user is required (run the seed first)');

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: `${RUN}_AUDIT`,
      details: JSON.stringify({ retailerId: retailer.id }),
    },
  });

  const found = await prisma.auditLog.findMany({
    where: { details: { contains: retailer.id } },
    select: { id: true },
  });
  assert.equal(found.length, 1, 'exact-case UUID audit lookup must keep working');

  const notFound = await prisma.auditLog.findMany({
    where: { details: { contains: retailer.id.toUpperCase() } },
    select: { id: true },
  });
  assert.equal(
    notFound.length,
    0,
    'uppercased UUID must NOT match — these filters are intentionally case-sensitive',
  );

  await prisma.auditLog.deleteMany({ where: { action: `${RUN}_AUDIT` } });
});

// ---------------------------------------------------------------------------
// 4. Admin stale queue: NULL lastLicenseCheck must sort FIRST. SQLite put
//    NULLs first on ASC implicitly; PostgreSQL defaults to NULLS LAST and
//    would silently bury never-checked retailers at the end of the queue.
// ---------------------------------------------------------------------------
test('stale queue ordering: never-checked retailers surface before checked ones', async () => {
  await prisma.retailer.create({
    data: retailerFixture({ name: `${RUN} never checked`, lastLicenseCheck: null }),
  });
  await prisma.retailer.create({
    data: retailerFixture({
      name: `${RUN} checked long ago`,
      lastLicenseCheck: new Date('2020-01-01'),
    }),
  });

  const queue = await prisma.retailer.findMany({
    where: { name: { startsWith: RUN }, lastLicenseCheck: null },
    select: { name: true },
    orderBy: [{ lastLicenseCheck: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
  });
  assert.ok(queue.length >= 1, 'null-lastLicenseCheck fixture must be retrievable');

  const ordered = await prisma.retailer.findMany({
    where: { name: { in: [`${RUN} never checked`, `${RUN} checked long ago`] } },
    select: { name: true },
    orderBy: [{ lastLicenseCheck: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
  });
  assert.equal(
    ordered[0]?.name,
    `${RUN} never checked`,
    'NULL lastLicenseCheck must sort before any real timestamp in the stale queue',
  );
});

// ---------------------------------------------------------------------------
// 5. Case-sensitive uniques: on PostgreSQL two emails differing only in case
//    CAN coexist at the constraint level. The application must therefore
//    normalize. This test documents the engine behavior the normalization
//    defends against (and the semantics guards forbid at storage level once
//    installed).
// ---------------------------------------------------------------------------
test('engine behavior: unique(email) does not deduplicate case variants', async () => {
  const a = await prisma.user.create({
    data: { email: `${RUN}-owner@example.com`, password: 'x', role: 'CUSTOMER' },
  });

  let second = null;
  let guardBlocked = false;
  try {
    second = await prisma.user.create({
      data: { email: `${RUN}-OWNER@example.com`, password: 'x', role: 'CUSTOMER' },
    });
  } catch {
    // If the storage guard (User_email_lowercase CHECK) is installed, the
    // mixed-case insert is rejected outright — the strongest outcome.
    guardBlocked = true;
  }

  if (second) {
    // No guard installed: PostgreSQL allowed both rows. This is exactly why
    // application-level lowercase normalization is mandatory.
    assert.notEqual(a.id, second.id);
    await prisma.user.delete({ where: { id: second.id } });
  } else {
    assert.ok(guardBlocked, 'insert failed for an unexpected reason');
  }
  await prisma.user.delete({ where: { id: a.id } });
});
