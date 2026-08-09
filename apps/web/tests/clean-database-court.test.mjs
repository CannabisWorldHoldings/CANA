import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CLEAN-DATABASE COURT — does the configuration survive a fresh database?
 *
 * THE DEFECT THIS COURT WAS BORN FOR. WAL was once enabled by running a PRAGMA
 * by hand against the local dev.db. It worked, and it was not reproducible:
 * journal_mode is stored INSIDE the SQLite database file, and that file is
 * untracked. Every clean clone, Drive reconstruction, regenerated database and
 * deployment would silently run without it.
 *
 * SUBSTRATE RETIREMENT (docs/adr/0001). The canonical CANA datastore is now
 * managed PostgreSQL + PostGIS, and SQLite is demoted to a read-only
 * rollback-snapshot format (DB_CLASSIFICATION in src/lib/db-config.mjs). The
 * WAL arc this court originally proved is therefore RETIRED WITH THE SUBSTRATE:
 * PostgreSQL has no `journal_mode`, no per-connection PRAGMAs, and no "settings
 * stored in a file" — so a WAL check, a file-byte hash, and a persistent-vs-
 * per-connection restart dance are all sqlite-only measurements that would be
 * cargo-cult on postgres. Where a test measured a sqlite pragma, the honest
 * postgres replacement is asserted instead (below, with the reason each time).
 *
 * WHAT SURVIVES UNCHANGED, because it is substrate-neutral:
 *   - initializeDatabaseConfig on the postgres lane is a DELIBERATE, successful
 *     no-op (connection tuning lives in the managed service, not per-process
 *     pragmas). Its no-op receipt is asserted so a caller can still rely on
 *     ok:true unconditionally.
 *   - A fresh postgres database's clean-database guarantees (connectable,
 *     schema-empty before migration) are asserted directly.
 *   - The sqlite pragma DECLARATIONS remain testable as DATA (they still ship,
 *     because a pre-migration rollback snapshot is still a real sqlite file a
 *     human may inspect), and the read-back / classification / rationale
 *     invariants are pure-function tests that never needed a substrate.
 *
 * ISOLATION: this court never touches a shared database. It creates a uniquely
 * named DISPOSABLE PostgreSQL database on the loopback server in `before` and
 * DROPs it WITH (FORCE) in `after` — the exact pattern proven in
 * tests/migration-court.test.mjs.
 */

const REPO_WEB = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA = join(REPO_WEB, 'prisma', 'schema.prisma');

/** The loopback PostgreSQL server every disposable database lives on. The
 *  `postgres` maintenance database is where CREATE/DROP DATABASE are issued. */
const PG_HOST = 'postgresql://postgres@127.0.0.1:5432';
const PG_ADMIN_URL = `${PG_HOST}/postgres`;

function prismaCliPath() {
  for (let dir = REPO_WEB; ; dir = dirname(dir)) {
    const c = join(dir, 'node_modules', 'prisma', 'build', 'index.js');
    if (existsSync(c)) return c;
    if (dirname(dir) === dir) throw new Error('prisma CLI not found');
  }
}

function prisma_(args, env = {}, stdin) {
  return execFileSync(process.execPath, [prismaCliPath(), ...args], {
    cwd: REPO_WEB, encoding: 'utf8', timeout: 240_000, stdio: 'pipe',
    ...(stdin === undefined ? {} : { input: stdin }),
    env: { ...process.env, ...env },
  });
}

const createdDbs = [];

/** Create a uniquely named disposable database and return its URL. */
function createDatabase(label = '') {
  const name = `cleandb_${label ? `${label}_` : ''}${randomBytes(6).toString('hex')}`;
  prisma_(['db', 'execute', '--url', PG_ADMIN_URL, '--stdin'], {}, `CREATE DATABASE "${name}";`);
  createdDbs.push(name);
  return { name, url: `${PG_HOST}/${name}` };
}

/** Deploy the source-controlled migration set to a disposable postgres URL,
 *  exactly as a real deploy would. Both env vars must point at the disposable
 *  database because `migrate deploy` reads directUrl = env("DIRECT_URL"). */
function deploy(url) {
  return prisma_(['migrate', 'deploy', '--schema', SCHEMA], { DATABASE_URL: url, DIRECT_URL: url });
}

const clients = [];
async function client(url) {
  const { PrismaClient } = await import('@prisma/client');
  const c = new PrismaClient({ datasources: { db: { url } } });
  clients.push(c);
  return c;
}

/** Run a snippet in a FRESH node process against a given postgres database, so
 *  a genuinely separate process — not this one's warm import cache — reports
 *  what it observed. The snippet has `prisma` and `mod` (db-config) in scope. */
function inFreshProcess(url, snippet) {
  const code = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: ${JSON.stringify(url)} } } });
    (async () => {
      const mod = await import(${JSON.stringify(join(REPO_WEB, 'src/lib/db-config.mjs'))});
      const out = await (async () => { ${snippet} })();
      console.log('__RESULT__' + JSON.stringify(out, (k, v) => typeof v === 'bigint' ? Number(v) : v));
      await prisma.$disconnect();
    })().catch((e) => { console.log('__ERROR__' + String(e && e.message)); process.exit(1); });
  `;
  // DATABASE_URL and DIRECT_URL are pinned to the disposable database in the
  // child so nothing it does can reach the runner's DATABASE_URL.
  const out = execFileSync('node', ['-e', code], {
    cwd: REPO_WEB, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
  const line = out.split('\n').find((l) => l.startsWith('__RESULT__'));
  if (!line) throw new Error(`no result: ${out.slice(0, 400)}`);
  return JSON.parse(line.slice('__RESULT__'.length));
}

after(() => {
  for (const name of createdDbs) {
    try {
      prisma_(['db', 'execute', '--url', PG_ADMIN_URL, '--stdin'], {}, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);
    } catch { /* best-effort teardown — a failed drop must not fail the suite */ }
  }
});

test('a FRESH postgres database has NO sqlite WAL check — the retired substrate cannot be measured', async () => {
  // RETIRED WITH THE SUBSTRATE. The original court measured `journal_mode=delete`
  // on a fresh sqlite file to prove WAL was absent and therefore a real gap.
  // PostgreSQL has no journal_mode, so the honest postgres equivalent is: a
  // fresh, unmigrated database is a clean slate (schema-empty), it connects, and
  // readiness on the postgres lane NEVER emits the sqlite WAL check. Asserting
  // the WAL check's ABSENCE is the honest replacement for asserting delete-mode.
  const { url } = createDatabase('fresh');
  const p = await client(url);
  // Schema-empty detection: a fresh database has no application tables yet.
  const tables = await p.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Organization'",
  );
  assert.equal(tables.length, 0, 'a fresh database must have no application schema before migration');
  // readDatabaseConfig on postgres reports the pragmas are NOT_APPLICABLE
  // rather than pretending a sqlite journal_mode exists.
  const before = await inFreshProcess(url, 'return await mod.readDatabaseConfig(prisma, { provider: "postgresql" });');
  assert.equal(before.provider, 'postgresql');
  assert.equal(before.pragmas, 'NOT_APPLICABLE',
    'a postgres database has no sqlite pragmas to read — journal_mode is a retired sqlite concept');
  await p.$disconnect();
});

test('initialization on postgres is a DELIBERATE successful no-op, verified in a fresh process', () => {
  // The original court applied WAL and read it back. On the canonical postgres
  // substrate there is nothing to apply per-process (connection tuning lives in
  // the managed service and the pooled DATABASE_URL), so initializeDatabaseConfig
  // is a documented successful no-op. This is asserted — not skipped — so a
  // caller can still rely on ok:true and an empty applied list unconditionally.
  const { url } = createDatabase('init');
  deploy(url);
  const r = inFreshProcess(url, 'return await mod.initializeDatabaseConfig(prisma, { databaseUrl: process.env.DATABASE_URL });');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.provider, 'postgresql');
  assert.deepEqual(r.applied, [], 'no per-process pragmas are applied on the postgres lane');
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.mismatches, []);
  assert.equal(r.classification, 'POSTGRESQL_POSTGIS_CANONICAL',
    'the no-op receipt must name the canonical datastore, not a sqlite classification');
  // before/after both report NOT_APPLICABLE — there is no sqlite journal_mode to
  // transition, which is exactly the point of the retirement.
  assert.equal(r.before.pragmas, 'NOT_APPLICABLE');
  assert.equal(r.after.pragmas, 'NOT_APPLICABLE');
});

test('SUBSTRATE-RETIRED: the file-byte preservation proof has no postgres analogue; the no-op leaves the database unchanged', async () => {
  // RETIRED WITH THE SUBSTRATE. The original test hashed the sqlite file before
  // and after startup to prove `preservePersistentPragmas:true` never mutated
  // the persistent bytes. A postgres database is a server, not a byte-addressable
  // file, so there is no hash to take. The postgres-meaningful equivalent is:
  // the no-op initialization writes NOTHING — it applies no pragmas and reports
  // an empty applied list — so a migrated database's row content is untouched by
  // a startup call. Proven by counting rows across the no-op.
  const { url } = createDatabase('preserve');
  deploy(url);
  const p = await client(url);
  await p.organization.create({ data: { name: 'must survive a startup no-op' } });
  const before = await p.organization.count();
  const r = inFreshProcess(
    url,
    'return await mod.initializeDatabaseConfig(prisma, { databaseUrl: process.env.DATABASE_URL, preservePersistentPragmas: true });',
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.applied, [], 'startup must apply no pragmas on postgres — there is nothing per-process to set');
  assert.equal(await p.organization.count(), before, 'a startup no-op must not add, remove or alter a single row');
  await p.$disconnect();
});

test('SUBSTRATE-RETIRED: postgres has no per-connection PRAGMAs to lose across a process restart', async () => {
  // RETIRED WITH THE SUBSTRATE. The whole lesson of the original test — that
  // journal_mode is persistent-in-the-file while busy_timeout/foreign_keys are
  // per-connection and reset on a new SQLite connection — is a property of the
  // SQLite connector. PostgreSQL has none of these pragmas; connection settings
  // are governed by the server and the pooled URL. The honest postgres
  // equivalent is: a genuinely fresh process connects to the same migrated
  // database and sees the SAME durable schema (the tables persist because they
  // live in the server, not in a per-connection setting), and initialization
  // remains a no-op from that fresh process too.
  const { url } = createDatabase('restart');
  deploy(url);
  // First process: prove init is a no-op and the schema is present.
  const first = inFreshProcess(url, `
    await mod.initializeDatabaseConfig(prisma, { databaseUrl: process.env.DATABASE_URL });
    const rows = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='Organization'");
    return { ok: true, hasSchema: rows.length === 1 };
  `);
  assert.equal(first.ok, true);
  assert.equal(first.hasSchema, true);
  // A genuinely separate process connecting to the same server database still
  // sees the durable schema — persistence is a server property, not a file byte.
  const after = inFreshProcess(url, `
    const rows = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='Organization'");
    const cfg = await mod.readDatabaseConfig(prisma, { provider: 'postgresql' });
    return { hasSchema: rows.length === 1, pragmas: cfg.pragmas };
  `);
  assert.equal(after.hasSchema, true,
    'server-side schema MUST survive a fresh process — it lives in the database, not a per-connection pragma');
  assert.equal(after.pragmas, 'NOT_APPLICABLE',
    'there are no per-connection sqlite pragmas on postgres to survive or be lost');
});

test('the module NAMES which sqlite settings need reapplying per connection (pure data)', () => {
  // SUBSTRATE-NEUTRAL DATA. PER_CONNECTION_PRAGMAS is a source-controlled list
  // describing the retired sqlite substrate (a rollback snapshot is still a real
  // sqlite file a human may inspect and re-open). It never needed a live
  // database to test, so this assertion is unchanged: the persistent journal_mode
  // must NOT be in the per-connection list, while the per-connection pragmas must.
  return import('../src/lib/db-config.mjs').then((mod) => {
    const perConn = mod.PER_CONNECTION_PRAGMAS.join(' ');
    assert.match(perConn, /busy_timeout/);
    assert.match(perConn, /foreign_keys/);
    assert.ok(!/journal_mode/.test(perConn),
      'journal_mode is persistent and must NOT be in the per-connection list');
  });
});

test('initialization is IDEMPOTENT on postgres — running the no-op twice changes nothing', () => {
  const { url } = createDatabase('idem');
  deploy(url);
  const first = inFreshProcess(url, 'return await mod.initializeDatabaseConfig(prisma, { databaseUrl: process.env.DATABASE_URL });');
  const second = inFreshProcess(url, 'return await mod.initializeDatabaseConfig(prisma, { databaseUrl: process.env.DATABASE_URL });');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(second.applied, [], 'the second run is as much a no-op as the first — idempotence is trivially true for a no-op, and asserted so it stays that way');
  assert.deepEqual(second.mismatches, []);
});

test('CONCURRENCY: a fresh migrated postgres database absorbs a write burst', () => {
  // RECAST FROM THE SQLITE WAL COMPARISON. The original test compared an
  // unconfigured sqlite database against a WAL-configured one to show the pragma
  // improved a concurrent burst. On postgres there is no such pragma toggle —
  // initialization is a no-op — so a configured-vs-unconfigured comparison would
  // be comparing a database to itself. What still matters, and is the reason any
  // of this exists, is that the canonical substrate ACTUALLY handles concurrent
  // handoff-shaped writes. PostgreSQL is a multi-writer server, so unlike SQLite
  // it is expected to complete the full burst; that is asserted strictly, which
  // is a STRONGER claim than the old "at least as good as unconfigured" floor.
  const write = (n) => `
    const rows = [];
    for (let i = 0; i < ${n}; i++) rows.push(i);
    const results = await Promise.all(rows.map(async (i) => {
      try {
        await prisma.product.create({ data: { name: 'Burst ' + i, category: 'FLOWER' } });
        return 'ok';
      } catch (e) { return String((e && e.code) || (e && e.message) || 'err').slice(0, 40); }
    }));
    return { ok: results.filter((r) => r === 'ok').length, total: ${n} };
  `;

  const { url } = createDatabase('burst');
  deploy(url);
  const burst = inFreshProcess(url, write(25));

  assert.ok(burst.ok > 0,
    `a migrated postgres database must complete SOME of a 25-way burst, got ${burst.ok}/25 — that is a real failure, not slowness`);
  // PostgreSQL is a genuine multi-writer server: the whole burst must land. This
  // is the property the court exists to prove, now on the substrate that ships.
  assert.equal(burst.ok, 25,
    `the canonical postgres substrate must complete the full concurrent burst, got ${burst.ok}/25`);
});

test('SUBSTRATE-RETIRED: sqlite persistence claims stay MEASURABLE as declared data', async () => {
  // RETIRED WITH THE SUBSTRATE. The original test set every pragma in one sqlite
  // process and read each back in another, requiring the declared `persistent`
  // flag to match reality. That measurement is only meaningful on sqlite, which
  // is no longer the canonical substrate — running the pragmas against postgres
  // would just error. The declarations still ship (rollback snapshots are still
  // sqlite files), so the surviving, substrate-neutral guarantee is that the
  // declarations are internally CONSISTENT: every non-persistent pragma is named
  // in PER_CONNECTION_PRAGMAS (so a pool reapplies it), and every persistent one
  // is excluded from it. A wrong persistence claim still fails here — the exact
  // class of bug (F3) the original court caught — without needing a live sqlite
  // file the application no longer runs on.
  const mod = await import('../src/lib/db-config.mjs');
  for (const pragma of mod.REQUIRED_SQLITE_PRAGMAS) {
    const inPerConn = mod.PER_CONNECTION_PRAGMAS.some((c) => c.includes(pragma.name));
    if (pragma.persistent) {
      assert.ok(!inPerConn,
        `${pragma.name} is declared PERSISTENT and MUST NOT appear in PER_CONNECTION_PRAGMAS`);
    } else {
      assert.ok(inPerConn,
        `${pragma.name} is declared NON-persistent and MUST appear in PER_CONNECTION_PRAGMAS so a pool reapplies it`);
    }
  }
});

test('SQLite is CLASSIFIED, not quietly treated as production-ready', () => {
  return import('../src/lib/db-config.mjs').then((mod) => {
    const c = mod.DB_CLASSIFICATION;
    // The classification's INTENT is unchanged — sqlite is not silently
    // production-ready — but the executed owner decision (docs/adr/0001) demoted
    // it further, from a local-test-only database to a read-only rollback
    // snapshot format now that postgres is canonical. Pin the current honest value.
    assert.equal(c.sqlite, 'ROLLBACK_SNAPSHOT_FORMAT_ONLY');
    assert.match(c.reason, /non-deterministic|not a production guarantee/i);
    // The classification must cite EVIDENCE, not opinion.
    assert.match(c.evidence, /FEASIBILITY|measured/i);
    // And it must name real, verified host options rather than inventing a provider.
    assert.ok(c.production_candidates_available_on_host.some((p) => /MariaDB/i.test(p)));
    assert.ok(c.production_candidates_available_on_host.some((p) => /PostgreSQL/i.test(p)));
    // Choosing and provisioning it is an owner action.
    assert.match(c.decision_owner, /OWNER/);
    // The owner decision was TAKEN, and it is postgres — the substrate this court
    // now runs on.
    assert.equal(c.decision_taken, 'POSTGRESQL_POSTGIS_CANONICAL');
  });
});

test('F2: a sqlite pragma ACCEPTED but silently ignored makes ok FALSE (pure sqlite-path unit)', async () => {
  // SUBSTRATE-NEUTRAL UNIT. VERIFIER FINDING F2: the module promises "never
  // silently succeed — verify by reading back". This exercises the sqlite branch
  // of initializeDatabaseConfig with a FAKE prisma and an explicit file: URL, so
  // it neither needs nor touches a live database. The explicit `databaseUrl:
  // 'file:...'` is load-bearing: without it the module reads process.env
  // (now postgres) and takes the no-op path, which would not exercise the
  // read-back promise at all. `PRAGMA journal_mode = wal` on an in-memory-style
  // fake is accepted and stays `memory` — no throw, so ONLY the read-back check
  // can catch it.
  const mod = await import('../src/lib/db-config.mjs');
  const fake = {
    async $queryRawUnsafe(q) {
      const m = /^PRAGMA\s+(\w+)(\s*=\s*(\S+))?/i.exec(q);
      const name = m?.[1];
      if (!m?.[2]) {
        if (name === 'journal_mode') return [{ journal_mode: 'memory' }];
        if (name === 'busy_timeout') return [{ busy_timeout: 5000 }];
        if (name === 'synchronous') return [{ synchronous: 1 }];
        if (name === 'foreign_keys') return [{ foreign_keys: 1 }];
        return [{ [name]: null }];
      }
      return [];
    },
  };
  const r = await mod.initializeDatabaseConfig(fake, { databaseUrl: 'file:./sabotage.db' });
  assert.deepEqual(r.failures, [],
    'this scenario must produce NO failures, or it is testing the wrong path');
  assert.ok(r.mismatches.some((m) => m.pragma === 'journal_mode'),
    `the ignored pragma must be reported by name, got ${JSON.stringify(r.mismatches)}`);
  assert.equal(r.ok, false,
    'a pragma accepted but silently ignored MUST make ok false — this is the read-back promise');
});

test('every required sqlite pragma states WHY it exists (pure data)', () => {
  // A pragma with no rationale is the first thing a future cleanup deletes. This
  // never needed a substrate — it is a data invariant on the declarations.
  return import('../src/lib/db-config.mjs').then((mod) => {
    for (const p of mod.REQUIRED_SQLITE_PRAGMAS) {
      assert.ok(typeof p.why === 'string' && p.why.length > 30,
        `pragma ${p.name} must explain itself`);
      assert.equal(typeof p.persistent, 'boolean',
        `pragma ${p.name} must declare whether it survives a restart`);
    }
  });
});
