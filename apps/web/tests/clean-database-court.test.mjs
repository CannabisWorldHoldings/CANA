import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * CLEAN-DATABASE COURT — does the configuration survive a fresh database?
 *
 * THE DEFECT THIS COURT EXISTS FOR. WAL was enabled by running a PRAGMA by hand
 * against the local dev.db. It worked, and it was not reproducible: journal_mode is
 * stored INSIDE the database file, and that file is untracked. Measured here rather
 * than assumed — a database created fresh from the source-controlled schema reports
 * `journal_mode=delete`. Every clean clone, Drive reconstruction, regenerated
 * database and deployment would have silently run without it, and the concurrency
 * behaviour proven locally would not have existed in production.
 *
 * So this court never touches the local dev.db. It builds a database from scratch in
 * a temp directory, reads the configuration BEFORE initialization, applies it,
 * reads it back, opens a NEW process against the same file, and confirms what
 * persisted and what did not — because those are different answers and conflating
 * them is how this defect happened.
 */

const REPO_WEB = '/agent/workspace/ui-recover/apps/web';

/** Run a snippet in a FRESH node process against a given database. */
function inFreshProcess(dbPath, snippet) {
  const code = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: 'file:${dbPath}' } } });
    (async () => {
      const mod = await import('${REPO_WEB}/src/lib/db-config.mjs');
      const out = await (async () => { ${snippet} })();
      console.log('__RESULT__' + JSON.stringify(out, (k, v) => typeof v === 'bigint' ? Number(v) : v));
      await prisma.$disconnect();
    })().catch((e) => { console.log('__ERROR__' + String(e && e.message)); process.exit(1); });
  `;
  const out = execFileSync('node', ['-e', code], { cwd: REPO_WEB, encoding: 'utf8', timeout: 120_000 });
  const line = out.split('\n').find((l) => l.startsWith('__RESULT__'));
  if (!line) throw new Error(`no result: ${out.slice(0, 400)}`);
  return JSON.parse(line.slice('__RESULT__'.length));
}

/** Create a database from the SOURCE-CONTROLLED schema, exactly as a deploy would. */
function freshDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'cana-cleandb-'));
  const dbPath = join(dir, 'fresh.db');
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: REPO_WEB, env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    encoding: 'utf8', timeout: 240_000, stdio: 'pipe',
  });
  return { dir, dbPath };
}

test('a FRESH database from source-controlled schema does NOT default to WAL', () => {
  // The measurement that proves the gap is real rather than theoretical.
  const { dir, dbPath } = freshDatabase();
  try {
    const before = inFreshProcess(dbPath, 'return await mod.readDatabaseConfig(prisma);');
    assert.equal(before.journal_mode, 'delete',
      `a fresh database must be shown to lack WAL, got ${JSON.stringify(before.journal_mode)}`);
    assert.ok(existsSync(dbPath), 'the database file must exist');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('initialization applies the configuration and VERIFIES it by reading back', () => {
  const { dir, dbPath } = freshDatabase();
  try {
    const r = inFreshProcess(dbPath, 'return await mod.initializeDatabaseConfig(prisma);');
    assert.equal(r.before.journal_mode, 'delete', 'the BEFORE state must be captured, or the test proves nothing');
    assert.equal(r.after.journal_mode, 'wal');
    assert.equal(r.after.busy_timeout, 5000);
    assert.equal(r.after.foreign_keys, 1);
    assert.deepEqual(r.failures, [], `pragmas failed: ${JSON.stringify(r.failures)}`);
    assert.deepEqual(r.mismatches, [], `pragmas did not read back: ${JSON.stringify(r.mismatches)}`);
    assert.equal(r.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('after a PROCESS RESTART, persistent settings survive and per-connection ones do NOT', () => {
  // This distinction is the whole lesson. Treating them as one is how a setting
  // appears configured while silently absent on every new connection.
  const { dir, dbPath } = freshDatabase();
  try {
    inFreshProcess(dbPath, 'return await mod.initializeDatabaseConfig(prisma);');

    // A genuinely separate process, connecting to the same file.
    const after = inFreshProcess(dbPath, 'return await mod.readDatabaseConfig(prisma);');

    assert.equal(after.journal_mode, 'wal',
      'journal_mode is stored in the file and MUST survive a restart');

    // MEASURED CORRECTION. I asserted busy_timeout and foreign_keys would be LOST
    // on a new connection, because raw SQLite resets them. A fresh process proved
    // otherwise: Prisma's SQLite connector already applies busy_timeout=5000 and
    // foreign_keys=1 itself. My model of the system was wrong, not the system.
    //
    // The distinction still matters, so the test now pins the REAL behaviour: these
    // arrive from the connector rather than from the database file, which means they
    // depend on a connector default we do not control. That is exactly why the module
    // still sets them explicitly.
    assert.equal(after.busy_timeout, 5000,
      'Prisma supplies busy_timeout per connection — pinned so a connector change is caught here');
    assert.equal(after.foreign_keys, 1,
      'Prisma supplies foreign_keys per connection — pinned for the same reason');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the module NAMES which settings need reapplying per connection', () => {
  // A pool opening a second connection gets defaults back. If the code does not
  // say so, nobody reapplies them and a burst behaves differently from a single
  // request for reasons invisible in any startup log.
  return import('../src/lib/db-config.mjs').then((mod) => {
    const perConn = mod.PER_CONNECTION_PRAGMAS.join(' ');
    assert.match(perConn, /busy_timeout/);
    assert.match(perConn, /foreign_keys/);
    assert.ok(!/journal_mode/.test(perConn),
      'journal_mode is persistent and must NOT be in the per-connection list');
  });
});

test('initialization is IDEMPOTENT — running it twice changes nothing', () => {
  const { dir, dbPath } = freshDatabase();
  try {
    const first = inFreshProcess(dbPath, 'return await mod.initializeDatabaseConfig(prisma);');
    const second = inFreshProcess(dbPath, 'return await mod.initializeDatabaseConfig(prisma);');
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.before.journal_mode, 'wal', 'the second run should already find WAL in place');
    assert.deepEqual(second.mismatches, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CONCURRENCY on a fresh configured database beats an unconfigured one', () => {
  // The reason any of this matters. Same schema, same writes, one difference.
  // The table used here must actually accept the insert, or the comparison measures
  // a schema error instead of contention. My first version inserted into Brand and
  // every write failed on a NOT NULL organizationId — 0/25 on BOTH databases, which
  // looked like a WAL failure and was really my bad fixture. Product has no required
  // foreign key, so contention is what is actually being measured.
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

  const bare = freshDatabase();
  let unconfigured;
  try {
    unconfigured = inFreshProcess(bare.dbPath, write(25));
  } finally { rmSync(bare.dir, { recursive: true, force: true }); }

  const tuned = freshDatabase();
  let configured;
  try {
    inFreshProcess(tuned.dbPath, 'return await mod.initializeDatabaseConfig(prisma);');
    configured = inFreshProcess(tuned.dbPath, write(25));
  } finally { rmSync(tuned.dir, { recursive: true, force: true }); }

  // The configured database must be at least as good, and is normally much better.
  // Asserting a fixed ratio would be a flaky test; asserting non-regression plus a
  // floor keeps the signal without inviting deletion.
  assert.ok(configured.ok >= unconfigured.ok,
    `configuration must not make concurrency worse: ${configured.ok} vs ${unconfigured.ok} of 25`);
  assert.ok(configured.ok >= 20,
    `a configured fresh database should absorb most of a 25-way burst, got ${configured.ok}/25`);
});

test('EVERY persistence claim is MEASURED, not asserted', async () => {
  // VERIFIER FINDING F3. I marked `synchronous` persistent:true without measuring
  // it. It is per-connection: set it on one connection and a fresh process reads
  // the default back. Because the flag said persistent, it was excluded from
  // PER_CONNECTION_PRAGMAS, so an extra pool connection would silently run FULL —
  // defeating the WAL+NORMAL rationale the entry itself states.
  //
  // A declarative flag nobody checks is a comment with extra steps. This test sets
  // every pragma in one process and reads each back in ANOTHER, then requires the
  // declared flag to match what actually happened. It is impossible to add a wrong
  // persistence claim without failing here.
  const mod = await import('../src/lib/db-config.mjs');
  const { dir, dbPath } = freshDatabase();
  try {
    inFreshProcess(dbPath, 'return await mod.initializeDatabaseConfig(prisma);');
    const afterRestart = inFreshProcess(dbPath, 'return await mod.readDatabaseConfig(prisma);');

    for (const pragma of mod.REQUIRED_SQLITE_PRAGMAS) {
      const got = afterRestart[pragma.name];
      const want = typeof pragma.value === 'string' ? pragma.value.toLowerCase() : pragma.value;
      const norm = typeof got === 'string' ? got.toLowerCase() : got;
      const survived = norm === want;

      if (pragma.persistent) {
        assert.ok(survived,
          `${pragma.name} is declared PERSISTENT but a fresh connection read ${JSON.stringify(norm)} instead of ${JSON.stringify(want)}`);
      } else if (!pragma.supplied_by_connector) {
        // Declared non-persistent AND not supplied by the connector: it genuinely
        // must not survive, or the declaration is wrong in the other direction.
        assert.ok(!survived,
          `${pragma.name} is declared NON-persistent but survived a fresh connection — the declaration is wrong`);
      }
      // Whatever the answer, a non-persistent pragma must be in the reapply list.
      if (!pragma.persistent) {
        assert.ok(mod.PER_CONNECTION_PRAGMAS.some((c) => c.includes(pragma.name)),
          `${pragma.name} is non-persistent and MUST appear in PER_CONNECTION_PRAGMAS`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SQLite is CLASSIFIED, not quietly treated as production-ready', () => {
  return import('../src/lib/db-config.mjs').then((mod) => {
    const c = mod.DB_CLASSIFICATION;
    assert.equal(c.sqlite, 'LOCAL_TEST_DATABASE_ONLY');
    assert.match(c.reason, /non-deterministic|not a production guarantee/i);
    // The classification must cite EVIDENCE, not opinion.
    assert.match(c.evidence, /FEASIBILITY|measured/i);
    // And it must name real, verified host options rather than inventing a provider.
    assert.ok(c.production_candidates_available_on_host.some((p) => /MariaDB/i.test(p)));
    assert.ok(c.production_candidates_available_on_host.some((p) => /PostgreSQL/i.test(p)));
    // Choosing and provisioning it is an owner action.
    assert.match(c.decision_owner, /OWNER/);
  });
});

test('F2: a pragma ACCEPTED but silently ignored makes ok FALSE', async () => {
  // VERIFIER FINDING F2 (MEDIUM, test-coverage). The module promises "never silently
  // succeed — verify by reading back". It does so at runtime, but dropping the
  // mismatch term from `ok` left the whole 500-test suite green.
  //
  // MY FIRST ATTEMPT AT THIS TEST WAS WRONG. I ran initialization inside an open
  // transaction, expecting SQLite to accept the pragma and ignore it. It does not —
  // it THROWS ("cannot change into wal mode from within a transaction"), so
  // `failures` was populated and `ok` was false for a reason that had nothing to do
  // with the mismatch check. The sabotage passed and I nearly recorded a court that
  // could not catch what it claimed to.
  //
  // The accepted-but-ignored case needs a pragma that SUCCEEDS and still does not
  // read back. `PRAGMA journal_mode = wal` on an in-memory database is exactly that:
  // SQLite accepts it and stays in `memory` mode. No throw, so `failures` is empty
  // and ONLY the read-back check can catch it.
  const mod = await import('../src/lib/db-config.mjs');
  const fake = {
    async $queryRawUnsafe(q) {
      const m = /^PRAGMA\s+(\w+)(\s*=\s*(\S+))?/i.exec(q);
      const name = m?.[1];
      // Reads: report values that will NOT match what was requested for
      // journal_mode, while every other pragma reads back correctly.
      if (!m?.[2]) {
        if (name === 'journal_mode') return [{ journal_mode: 'memory' }];
        if (name === 'busy_timeout') return [{ busy_timeout: 5000 }];
        if (name === 'synchronous') return [{ synchronous: 1 }];
        if (name === 'foreign_keys') return [{ foreign_keys: 1 }];
        return [{ [name]: null }];
      }
      // Writes: accept everything without error. This is the whole point — the
      // statement SUCCEEDS and is silently ignored.
      return [];
    },
  };
  const r = await mod.initializeDatabaseConfig(fake);
  assert.deepEqual(r.failures, [],
    'this scenario must produce NO failures, or it is testing the wrong path');
  assert.ok(r.mismatches.some((m) => m.pragma === 'journal_mode'),
    `the ignored pragma must be reported by name, got ${JSON.stringify(r.mismatches)}`);
  assert.equal(r.ok, false,
    'a pragma accepted but silently ignored MUST make ok false — this is the read-back promise');
});

test('every required pragma states WHY it exists', () => {
  // A pragma with no rationale is the first thing a future cleanup deletes.
  return import('../src/lib/db-config.mjs').then((mod) => {
    for (const p of mod.REQUIRED_SQLITE_PRAGMAS) {
      assert.ok(typeof p.why === 'string' && p.why.length > 30,
        `pragma ${p.name} must explain itself`);
      assert.equal(typeof p.persistent, 'boolean',
        `pragma ${p.name} must declare whether it survives a restart`);
    }
  });
});
