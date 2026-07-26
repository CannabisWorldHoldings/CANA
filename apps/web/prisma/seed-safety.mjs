/**
 * SEED SAFETY — demonstration data must be UNABLE to enter a production
 * database by accident. A hard refusal, not a flag.
 *
 * THE ACCIDENT THIS PREVENTS. `seed.mjs` begins with deleteMany() across most
 * of the schema and then inserts DEMONSTRATION_ONLY rows. Pointed at the wrong
 * DATABASE_URL — a paste, a stale shell export, a CI variable leaking into an
 * operator's session — it would destroy real merchants, real users and real
 * evidence, then replace them with synthetic listings that the truth boundary
 * exists to keep out of public view. One wrong environment variable is not a
 * plausible mistake; it is an inevitable one.
 *
 * WHY THERE IS NO OVERRIDE. Every rule below is refused with no bypass
 * environment variable, no --force flag, no confirmation prompt. A flag that
 * disables a safety guard becomes part of someone's muscle memory or a CI
 * default within a month, and then the guard is decoration. If a future,
 * legitimate need arises to seed a server database (e.g. staging MariaDB with
 * synthetic data), that is a NEW, deliberately-written code path with its own
 * review — not a hole punched in this one.
 *
 * The rules, each independently sufficient to refuse:
 *   R1  NODE_ENV=production                    → refuse. No demonstration seed
 *       has any business existing in a production process, ever.
 *   R2  DATABASE_URL missing/blank             → refuse. Seeding "whatever the
 *       default resolves to" is how the wrong database gets seeded.
 *   R3  DATABASE_URL is not a local file: URL  → refuse. MariaDB/PostgreSQL/
 *       anything with a hostname is a server database; the demonstration seed
 *       supports exactly one substrate: a local SQLite file.
 *   R4  The database already holds NON-demonstration data → refuse. This is the
 *       deepest rule: a database containing even one real (isDemonstration:
 *       false) provenance row, one demand-credit ledger entry, one lead event,
 *       or one non-demo user account is treated as production-shaped, and the
 *       seed will not delete or dilute it. The ledger check is absolute — an
 *       append-only hash chain must never coexist with a routine that starts
 *       with deleteMany.
 *
 * Exercised, including by sabotage (falsification), in
 * tests/migration-court.test.mjs.
 */

/** The only accounts the demonstration seed itself creates. Anything else in
 *  the User table is presumed real. */
export const DEMONSTRATION_SEED_USER_EMAILS = Object.freeze([
  'admin@orderweeddc.com',
  'retailer@orderweeddc.com',
  'customer@orderweeddc.com',
]);

/** Tables carrying the provenance flag the truth boundary is built on. */
const PROVENANCE_TABLES = Object.freeze([
  'retailer', 'product', 'menuEntry', 'deal', 'article', 'licenseEvidence',
]);

const isFileUrl = (u) => /^file:/i.test(String(u ?? '').trim());

/**
 * Environment-level refusals. Pure and synchronous so it can be checked before
 * any connection is opened — a guard that must first CONNECT to the production
 * database it is refusing has already gone too far.
 */
export function environmentRefusalsForSeed({ databaseUrl, nodeEnv } = {}) {
  const refusals = [];
  if (String(nodeEnv ?? '').trim().toLowerCase() === 'production') {
    refusals.push({
      rule: 'R1_PRODUCTION_NODE_ENV',
      detail: 'NODE_ENV=production — the demonstration seed must never run in a production process',
    });
  }
  if (!String(databaseUrl ?? '').trim()) {
    refusals.push({
      rule: 'R2_DATABASE_URL_REQUIRED',
      detail: 'DATABASE_URL is not set — refusing to seed an implicit default database',
    });
  } else if (!isFileUrl(databaseUrl)) {
    refusals.push({
      rule: 'R3_SERVER_DATABASE_REFUSED',
      detail: `DATABASE_URL (${String(databaseUrl).split('@').pop().slice(0, 60)}…) is not a local file: SQLite URL — `
        + 'a server database (MariaDB/PostgreSQL/anything with a hostname) is never a demonstration target',
    });
  }
  return refusals;
}

/** Count rows defensively: a missing table (fresh, unmigrated file) is zero,
 *  because an absent table cannot contain production data. Any OTHER error is
 *  rethrown — refusing to look is not the same as looking and finding nothing. */
async function safeCount(countFn) {
  try {
    return await countFn();
  } catch (e) {
    if (e?.code === 'P2021' || /does not exist|no such table/i.test(String(e?.message ?? ''))) return 0;
    throw e;
  }
}

/**
 * Data-level refusals (rule R4): does this database already contain anything
 * that is not demonstration data? Runs read-only queries only.
 */
export async function dataRefusalsForSeed(prisma) {
  const refusals = [];

  for (const table of PROVENANCE_TABLES) {
    const real = await safeCount(() => prisma[table].count({ where: { isDemonstration: false } }));
    if (real > 0) {
      refusals.push({
        rule: 'R4_REAL_DATA_PRESENT',
        detail: `${table} holds ${real} row(s) with isDemonstration=false — this database is not a demonstration database`,
      });
    }
  }

  const ledger = await safeCount(() => prisma.demandCreditEntry.count());
  if (ledger > 0) {
    refusals.push({
      rule: 'R4_LEDGER_PRESENT',
      detail: `DemandCreditEntry holds ${ledger} row(s) — an append-only ledger must never share a database with a destructive seed`,
    });
  }

  const leads = await safeCount(() => prisma.leadEvent.count());
  if (leads > 0) {
    refusals.push({
      rule: 'R4_LEAD_EVENTS_PRESENT',
      detail: `LeadEvent holds ${leads} row(s) of attribution history the seed would erase`,
    });
  }

  const realUsers = await safeCount(() => prisma.user.count({
    where: { email: { notIn: [...DEMONSTRATION_SEED_USER_EMAILS] } },
  }));
  if (realUsers > 0) {
    refusals.push({
      rule: 'R4_REAL_USERS_PRESENT',
      detail: `User holds ${realUsers} account(s) beyond the demonstration trio — real accounts must not be deleted by a seed`,
    });
  }

  return refusals;
}

export class SeedRefusedError extends Error {
  constructor(refusals) {
    super(
      'SEED REFUSED — this database is not a safe demonstration target:\n'
      + refusals.map((r) => `  [${r.rule}] ${r.detail}`).join('\n')
      + '\nThere is deliberately no override. See prisma/seed-safety.mjs.',
    );
    this.name = 'SeedRefusedError';
    this.code = 'SEED_REFUSED';
    this.refusals = refusals;
  }
}

/**
 * The gate seed.mjs calls before touching anything. Throws SeedRefusedError on
 * the first category of refusal; environment rules are checked BEFORE any
 * query is issued, so a production URL is refused without ever connecting.
 */
export async function assertSeedTargetIsSafe({ prisma, databaseUrl, nodeEnv }) {
  const envRefusals = environmentRefusalsForSeed({ databaseUrl, nodeEnv });
  if (envRefusals.length > 0) throw new SeedRefusedError(envRefusals);
  const dataRefusals = await dataRefusalsForSeed(prisma);
  if (dataRefusals.length > 0) throw new SeedRefusedError(dataRefusals);
  return { safe: true };
}
