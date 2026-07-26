/**
 * DATABASE CONFIGURATION — in source control, applied at startup, never assumed.
 *
 * THE DEFECT THIS EXISTS FOR. WAL was enabled by running `PRAGMA journal_mode=WAL`
 * by hand against the local dev.db. That worked, and it was not reproducible: the
 * setting lives INSIDE the database file, which is untracked. Measured directly —
 * a fresh database created from the schema reports `journal_mode=delete`. So a
 * clean clone, a Drive reconstruction, a regenerated database or a deployment
 * would all have silently run without it, and the concurrency behaviour proven
 * locally would not exist in production.
 *
 * A configuration that only exists in an untracked file is not configuration. It is
 * a local accident that happens to be load-bearing.
 *
 * WHAT THIS MODULE DOES. It declares the required settings as data, applies them
 * idempotently at startup, and reports what it observed — before and after — so a
 * caller can assert rather than hope. It never silently succeeds: if a required
 * setting cannot be applied, that is returned as a fact.
 *
 * SCOPE HONESTY. These settings materially improve SQLite concurrency. They do not
 * make SQLite a production database for this workload. See DB_CLASSIFICATION.
 */

/**
 * The classification is deliberate and evidence-based, not a placeholder.
 *
 * Measured on this codebase: ten simultaneous handoffs against SQLite produced ten
 * HTTP 500s before repair, and 7-10/10 after a bounded retry plus WAL. Prior
 * hosting research (deploy/namecheap FEASIBILITY) independently concluded SQLite on
 * the shared host is "feasible but operationally fragile", while MariaDB 11.4.9 and
 * PostgreSQL 10.23 are both available on the target plan.
 *
 * Non-determinism under a burst is not a production data plane for a surface that
 * carries a consumer's handoff. Saying so plainly is the point.
 */
export const DB_CLASSIFICATION = Object.freeze({
  sqlite: 'LOCAL_TEST_DATABASE_ONLY',
  reason: 'single-writer locking makes concurrent handoff writes non-deterministic; measured 0/10 succeeding before repair and 7-10/10 after, which is not a production guarantee',
  production_candidates_available_on_host: ['MariaDB 11.4.9', 'PostgreSQL 10.23'],
  evidence: 'deploy/namecheap/FEASIBILITY.md (host capability research) + measured concurrency in this repo',
  decision_owner: 'OWNER — selecting and provisioning the production database is an owner action, not an agent action',
});

/**
 * Required SQLite settings. Each carries WHY, because a pragma with no rationale is
 * the first thing removed by someone tidying up.
 */
export const REQUIRED_SQLITE_PRAGMAS = Object.freeze([
  {
    name: 'journal_mode',
    value: 'wal',
    why: 'a rollback journal serialises readers against writers; WAL lets them proceed concurrently, which is the difference between a burst failing and mostly succeeding',
    // journal_mode is PERSISTENT: it is stored in the database file itself.
    persistent: true,
  },
  {
    name: 'busy_timeout',
    value: 5000,
    why: 'without it a writer that cannot get the lock fails instantly rather than waiting; 5s absorbs a realistic simultaneous-click burst',
    // MEASURED, not assumed: Prisma's SQLite connector already applies
    // busy_timeout=5000 on every connection it opens. I first wrote this as
    // per-connection-and-therefore-lost-on-restart, and a fresh process proved
    // otherwise. Setting it is still correct — it makes the requirement explicit and
    // survives a connector default changing — but the reason is documentation, not
    // repair. Marked so the court asserts what actually happens.
    persistent: false,
    supplied_by_connector: true,
  },
  {
    name: 'synchronous',
    value: 1, // NORMAL
    why: 'FULL fsyncs on every commit, which under WAL is unnecessary for durability against process crash and materially slows contended writes',
    persistent: true,
  },
  {
    name: 'foreign_keys',
    value: 1,
    why: 'raw SQLite disables foreign keys per connection; without them a cascade the schema declares simply does not happen',
    // Also supplied by Prisma today. Kept explicit for the same reason: a silent
    // connector default is not a guarantee we control.
    persistent: false,
    supplied_by_connector: true,
  },
]);

/** Normalise a pragma result to a comparable scalar. BigInt is common here. */
function scalar(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const v = Object.values(rows[0])[0];
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/**
 * Read the settings this module cares about, without changing anything.
 * Used to prove the BEFORE state, which is what makes an assertion meaningful.
 */
export async function readDatabaseConfig(prisma) {
  const out = {};
  for (const p of REQUIRED_SQLITE_PRAGMAS) {
    try {
      out[p.name] = scalar(await prisma.$queryRawUnsafe(`PRAGMA ${p.name}`));
    } catch (e) {
      out[p.name] = { error: String(e?.message ?? e).slice(0, 120) };
    }
  }
  return out;
}

/**
 * Apply the required configuration idempotently and report what happened.
 *
 * Returns { applied, before, after, ok, failures } — never throws for a pragma that
 * simply could not be set, because a startup path that crashes on a tuning setting
 * takes the whole application down for a performance concern.
 */
export async function initializeDatabaseConfig(prisma) {
  const before = await readDatabaseConfig(prisma);
  const applied = [];
  const failures = [];

  for (const p of REQUIRED_SQLITE_PRAGMAS) {
    try {
      // journal_mode returns a row; the others do not. queryRawUnsafe handles both.
      await prisma.$queryRawUnsafe(`PRAGMA ${p.name} = ${p.value}`);
      applied.push(p.name);
    } catch (e) {
      failures.push({ pragma: p.name, error: String(e?.message ?? e).slice(0, 160) });
    }
  }

  const after = await readDatabaseConfig(prisma);

  // Verify by READING BACK, not by trusting that the write succeeded. A pragma can
  // be accepted and ignored — journal_mode silently stays `delete` if the database
  // is in a transaction, for instance.
  const mismatches = [];
  for (const p of REQUIRED_SQLITE_PRAGMAS) {
    const got = after[p.name];
    const want = typeof p.value === 'string' ? p.value.toLowerCase() : p.value;
    const norm = typeof got === 'string' ? got.toLowerCase() : got;
    if (norm !== want) mismatches.push({ pragma: p.name, wanted: want, got: norm });
  }

  return {
    ok: failures.length === 0 && mismatches.length === 0,
    before,
    after,
    applied,
    failures,
    mismatches,
    classification: DB_CLASSIFICATION.sqlite,
  };
}

/**
 * Settings that must be reapplied on EVERY connection, not just at startup.
 *
 * This is the trap that makes "we set it once" wrong: busy_timeout and foreign_keys
 * are per-connection. A pool that opens a second connection gets the defaults back,
 * so a burst can behave differently from a single request for reasons invisible in
 * any startup log.
 */
export const PER_CONNECTION_PRAGMAS = Object.freeze(
  REQUIRED_SQLITE_PRAGMAS.filter((p) => !p.persistent).map((p) => `PRAGMA ${p.name} = ${p.value}`),
);
