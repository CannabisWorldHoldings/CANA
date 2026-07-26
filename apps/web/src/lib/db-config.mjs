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
    // VERIFIER FINDING F3 (MEDIUM). I marked this persistent:true. It is NOT.
    // Measured: set synchronous=1 on one connection, a fresh process reads 2.
    // Because the flag said persistent, it was excluded from PER_CONNECTION_PRAGMAS,
    // so any additional pool connection would silently run FULL — defeating the very
    // WAL+NORMAL rationale this entry states. In a module whose thesis is "measured,
    // not assumed", asserting persistence without measuring it was the exact error
    // the module exists to prevent.
    persistent: false,
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

/* ────────────────────────────────────────────────────────────────────────────
 * MIGRATION MACHINERY — locking, idempotent initialization, health/readiness.
 *
 * THE GAP THIS CLOSES. Until 2026-07-26 there were NO migrations at all: the
 * schema had only ever been applied with `prisma db push`. `db push` has no
 * history, no ordering, no record of what a given database has already had
 * applied — which means a production database could be neither deployed nor
 * rolled back. `prisma/migrations/` now holds a baseline plus incremental
 * migrations, and this section makes applying them safe:
 *
 *   - LOCKING: two processes running the migrator concurrently are serialised
 *     by an atomic on-disk lock. Prisma itself advisory-locks on
 *     MySQL/Postgres, but SQLite has no advisory locks, and two `migrate
 *     deploy` invocations racing on one file is exactly the deploy-time shape
 *     of the concurrency defect this module already documents.
 *   - IDEMPOTENT INITIALIZATION: `ensureDatabaseMigrated` may be called on
 *     every startup, by many processes, against a fresh database, an existing
 *     db-push database (it baselines it), or a fully migrated one (no-op).
 *   - HEALTH/READINESS as library functions. Deliberately NOT a route: routes
 *     belong to other lanes. Wiring these into /api/health is a cross-lane
 *     dependency, recorded rather than reached for.
 *
 * PROVIDER HONESTY. Everything here is exercised against SQLite, the local
 * substrate. The migration-name bookkeeping (`_prisma_migrations`) is identical
 * across sqlite/mysql/postgres, and the lock is filesystem-based so it works
 * regardless of provider — but only the SQLite paths are PROVEN by tests in
 * this repository. MariaDB behaviour is argued from documentation until a real
 * instance exists. See tests/migration-court.test.mjs.
 * ──────────────────────────────────────────────────────────────────────────── */

import { mkdirSync, rmSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash as _createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** The migration that captures the pre-migration-era schema. An existing
 *  db-push database adopts migrations by being marked as already having this. */
export const BASELINE_MIGRATION_NAME = '20260726000000_baseline';

/** Classify a DATABASE_URL by provider. Fail closed: unknown is its own answer. */
export function databaseProviderOf(databaseUrl) {
  const u = String(databaseUrl ?? '').trim().toLowerCase();
  if (u.startsWith('file:')) return 'sqlite';
  if (u.startsWith('mysql://') || u.startsWith('mariadb://')) return 'mysql';
  if (u.startsWith('postgres://') || u.startsWith('postgresql://')) return 'postgresql';
  return 'unknown';
}

/** Resolve a `file:` URL to an absolute filesystem path (relative to cwd, which
 *  is how Prisma's CLI resolves it when the schema lives elsewhere). */
export function sqliteFilePathOf(databaseUrl, baseDir = process.cwd()) {
  const raw = String(databaseUrl).replace(/^file:/, '').replace(/\?.*$/, '');
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

const sha8 = (s) => _createHash('sha256').update(String(s)).digest('hex').slice(0, 8);

/** Where the lock for a given database lives. Next to the file for SQLite so it
 *  travels with the database; keyed by URL digest in tmpdir for server DBs. */
export function migrationLockPathFor(databaseUrl, baseDir = process.cwd()) {
  if (databaseProviderOf(databaseUrl) === 'sqlite') {
    return `${sqliteFilePathOf(databaseUrl, baseDir)}.migrate.lock`;
  }
  return path.join(os.tmpdir(), `cana-migrate-${sha8(databaseUrl)}.lock`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Acquire the migration lock, or throw MIGRATION_LOCK_TIMEOUT.
 *
 * `mkdir` is the primitive because it is ATOMIC on POSIX: exactly one of two
 * simultaneous callers succeeds. A lockfile written with writeFile is not — both
 * writers "succeed" and believe they hold the lock. Stale locks (a migrator that
 * was SIGKILLed) are broken only after `staleMs` of no modification, so a crash
 * cannot wedge deploys forever, and an ACTIVE holder is never stolen from.
 */
export async function acquireMigrationLock(databaseUrl, {
  timeoutMs = 60_000, staleMs = 10 * 60_000, pollMs = 100, baseDir = process.cwd(),
} = {}) {
  const lockDir = migrationLockPathFor(databaseUrl, baseDir);
  mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lockDir); // atomic: succeeds for exactly one concurrent caller
      writeFileSync(path.join(lockDir, 'holder.json'),
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      let released = false;
      return {
        lockDir,
        release() {
          if (released) return; // idempotent — a double release must not remove a successor's lock
          released = true;
          rmSync(lockDir, { recursive: true, force: true });
        },
      };
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      // Held by someone. Stale-break only when the holder has gone quiet.
      try {
        const age = Date.now() - statSync(lockDir).mtimeMs;
        if (age > staleMs) rmSync(lockDir, { recursive: true, force: true });
      } catch { /* raced with the holder's own release — fine, retry */ }
      if (Date.now() >= deadline) {
        const err = new Error(`MIGRATION_LOCK_TIMEOUT: ${lockDir} still held after ${timeoutMs}ms`);
        err.code = 'MIGRATION_LOCK_TIMEOUT';
        throw err;
      }
      await sleep(pollMs);
    }
  }
}

/** Run `fn` while holding the migration lock; the lock is released even on throw. */
export async function withMigrationLock(databaseUrl, fn, opts = {}) {
  const lock = await acquireMigrationLock(databaseUrl, opts);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/** apps/web directory, resolved from this module so callers need not know it. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Default locations, overridable for tests that stage trimmed migration sets. */
export const MIGRATIONS_DIR = path.join(WEB_DIR, 'prisma', 'migrations');
const SCHEMA_PATH = path.join(WEB_DIR, 'prisma', 'schema.prisma');

/** The Prisma CLI entrypoint, invoked directly rather than through `npx` so a
 *  cold npx cache (or no network) cannot turn a deploy into a download. */
function prismaCli(webDir = WEB_DIR) {
  for (let dir = webDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', 'prisma', 'build', 'index.js');
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error('prisma CLI not found above ' + webDir);
  }
}

function runPrisma(args, { databaseUrl, webDir = WEB_DIR, timeoutMs = 240_000 } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [prismaCli(webDir), ...args], {
      cwd: webDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return {
      ok: false,
      stdout: String(e?.stdout ?? ''),
      stderr: String(e?.stderr ?? e?.message ?? e),
    };
  }
}

/** List migration names present on disk (directories containing migration.sql). */
export function migrationsOnDisk(migrationsDir = MIGRATIONS_DIR) {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(migrationsDir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();
}

/** Read `_prisma_migrations` rows, or null when the table does not exist yet.
 *  The table shape is identical across sqlite/mysql/postgres — Prisma owns it. */
export async function readMigrationRows(prisma) {
  try {
    return await prisma.$queryRawUnsafe(
      'SELECT migration_name, started_at, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at',
    );
  } catch {
    return null; // table absent: an unmigrated (fresh or db-push-era) database
  }
}

/**
 * Idempotent, lock-serialised database initialization.
 *
 * Handles the three real states a database can be in:
 *   FRESH            → apply every migration.
 *   DB_PUSH_ERA      → schema exists but `_prisma_migrations` does not; mark the
 *                      baseline as applied (it IS applied — the tables are there),
 *                      then deploy anything newer. This is how the existing
 *                      dev/production databases adopt migrations without loss.
 *   MIGRATED         → `migrate deploy`, which is a no-op when current.
 *
 * A FAILED migration row (started, never finished, not rolled back) makes this
 * return ok:false with the exact recovery commands instead of "repairing"
 * anything: a half-applied migration is a restore-from-backup decision for a
 * human, and auto-rolling it back is how data quietly disappears.
 */
export async function ensureDatabaseMigrated({
  databaseUrl,
  webDir = WEB_DIR,
  schemaPath = SCHEMA_PATH,
  migrationsDir = MIGRATIONS_DIR,
  prismaClientFactory = null,
  lockOpts = {},
} = {}) {
  if (!databaseUrl) throw new Error('ensureDatabaseMigrated requires an explicit databaseUrl — never assume a default database');
  return withMigrationLock(databaseUrl, async () => {
    const factory = prismaClientFactory ?? (async () => {
      const { PrismaClient } = await import('@prisma/client');
      return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    });
    const prisma = await factory();
    let state;
    try {
      const rows = await readMigrationRows(prisma);
      if (rows === null) {
        const tables = await probeApplicationTables(prisma, databaseProviderOf(databaseUrl));
        state = tables ? 'DB_PUSH_ERA' : 'FRESH';
      } else if (rows.some((r) => r.finished_at == null && r.rolled_back_at == null)) {
        const broken = rows.filter((r) => r.finished_at == null && r.rolled_back_at == null);
        return {
          ok: false,
          state: 'FAILED_MIGRATION_PRESENT',
          failed: broken.map((r) => r.migration_name),
          recovery: [
            'restore the database from the pre-migration backup, OR verify by hand that the partial migration left no changes',
            ...broken.map((r) => `npx prisma migrate resolve --rolled-back ${r.migration_name}`),
            'npx prisma migrate deploy',
          ],
        };
      } else {
        state = 'MIGRATED';
      }
    } finally {
      await prisma.$disconnect().catch(() => {});
    }

    const actions = [];
    if (state === 'DB_PUSH_ERA') {
      const r = runPrisma(['migrate', 'resolve', '--applied', BASELINE_MIGRATION_NAME, '--schema', schemaPath], { databaseUrl, webDir });
      actions.push({ action: `baseline:${BASELINE_MIGRATION_NAME}`, ok: r.ok });
      if (!r.ok) return { ok: false, state, actions, error: r.stderr.slice(0, 500) };
    }
    const dep = runPrisma(['migrate', 'deploy', '--schema', schemaPath], { databaseUrl, webDir });
    actions.push({ action: 'migrate deploy', ok: dep.ok });
    if (!dep.ok) return { ok: false, state, actions, error: (dep.stderr || dep.stdout).slice(0, 800) };
    return { ok: true, state, actions, migrationsOnDisk: migrationsOnDisk(migrationsDir) };
  }, lockOpts);
}

/** Does the application schema exist? Provider-aware probe of one anchor table.
 *  PROVEN on sqlite; the information_schema branch is argued until MariaDB exists. */
async function probeApplicationTables(prisma, provider) {
  try {
    if (provider === 'sqlite') {
      const r = await prisma.$queryRawUnsafe(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='Organization'",
      );
      return Array.isArray(r) && r.length > 0;
    }
    const r = await prisma.$queryRawUnsafe(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'Organization'",
    );
    return Array.isArray(r) && r.length > 0;
  } catch {
    return false;
  }
}

/**
 * LIVENESS: can the database answer at all, and how quickly.
 * Small on purpose — a liveness probe that does real work becomes load.
 */
export async function databaseHealth(prisma) {
  const startedAt = Date.now();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return { healthy: true, latencyMs: Date.now() - startedAt };
  } catch (e) {
    return { healthy: false, latencyMs: Date.now() - startedAt, error: String(e?.message ?? e).slice(0, 300) };
  }
}

/**
 * READINESS: is this database safe to serve traffic from?
 *
 * Every check reports individually so an operator sees WHICH condition failed,
 * not a bare false. `ready` is the conjunction of the required checks:
 *   - connectable
 *   - migration bookkeeping exists (`_prisma_migrations`)
 *   - no failed/interrupted migration rows
 *   - nothing on disk is still pending
 *   - (sqlite only) journal_mode is WAL, per the measured concurrency evidence
 *
 * This is a LIBRARY function by design. Exposing it at /api/health or
 * /api/ready is a route, and routes belong to other lanes — recorded as a
 * cross-lane dependency, not implemented here.
 */
export async function databaseReadiness(prisma, {
  migrationsDir = MIGRATIONS_DIR,
  provider = 'sqlite',
} = {}) {
  const checks = [];
  const push = (name, pass, detail) => checks.push({ name, pass, detail });

  const live = await databaseHealth(prisma);
  push('database_connectable', live.healthy, live.healthy ? `latency ${live.latencyMs}ms` : live.error);

  let rows = null;
  if (live.healthy) {
    rows = await readMigrationRows(prisma);
    push('migrations_table_present', rows !== null,
      rows === null ? '_prisma_migrations missing — this database has never been migrated (db push is not deployment)' : `${rows.length} recorded`);
    if (rows !== null) {
      const broken = rows.filter((r) => r.finished_at == null && r.rolled_back_at == null);
      push('no_failed_migrations', broken.length === 0,
        broken.length ? `interrupted/failed: ${broken.map((r) => r.migration_name).join(', ')}` : 'all recorded migrations finished or were rolled back');
      const applied = new Set(rows.filter((r) => r.finished_at != null).map((r) => r.migration_name));
      const pending = migrationsOnDisk(migrationsDir).filter((name) => !applied.has(name));
      push('no_pending_migrations', pending.length === 0,
        pending.length ? `pending: ${pending.join(', ')}` : 'disk and database agree');
    }
    if (provider === 'sqlite') {
      const cfg = await readDatabaseConfig(prisma);
      const wal = String(cfg.journal_mode).toLowerCase() === 'wal';
      push('sqlite_journal_mode_wal', wal,
        wal ? 'WAL active' : `journal_mode=${JSON.stringify(cfg.journal_mode)} — run initializeDatabaseConfig`);
    }
  }

  return { ready: checks.every((c) => c.pass), checks, checkedAt: new Date().toISOString() };
}
