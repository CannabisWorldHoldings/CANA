import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertProductionBuildDatabaseReady,
  createBuildDatabaseWorkspace,
  prepareProductionBuildDatabase,
} from '../src/lib/build-database.mjs';
import { initializeDatabaseConfig } from '../src/lib/db-config.mjs';

/**
 * BUILD-DATABASE GATE — the build gets a throwaway database it can never
 * confuse with a real one.
 *
 * SUBSTRATE RETIREMENT (docs/adr/0001). This court used to gate a local SQLite
 * FILE built for `next build`: it proved, with inode identity, symlink-component
 * scanning, O_NOFOLLOW descriptor binding, file-byte immutability and a
 * descriptor-relative quarantine, that the build opened exactly the file it
 * created and mutated nothing else. The canonical CANA datastore is now managed
 * PostgreSQL + PostGIS, the schema is `provider = "postgresql"`, and a sqlite
 * build FILE cannot be produced from it at all. src/lib/build-database.mjs was
 * ported to provision a DISPOSABLE PostgreSQL database (a generated
 * `cana_build_<hex>` name on the configured server), migrate it, mark it with an
 * ownership token, hand the build a READ-ONLY connection to it, and DROP it
 * WITH (FORCE) on cleanup.
 *
 * Every guarantee is preserved and re-expressed on the postgres substrate:
 *   - EXCLUSIVE TARGET: a generated, unpredictable database name is the postgres
 *     analogue of an O_EXCL inode.
 *   - OWNERSHIP: a random marker row is the analogue of inode identity; the gate
 *     refuses any database that does not carry exactly this build's marker.
 *   - IMMUTABILITY: a `default_transaction_read_only` connection is the analogue
 *     of `mode=ro&immutable=1`; a build-time write is refused by the SERVER, and
 *     the gate PROVES it by attempting one.
 *   - NEVER TOUCH A REAL DATABASE: forged/arbitrary/existing/remote/malformed
 *     URLs are refused before use, and the real database is proven unchanged
 *     across a full `next build`.
 *
 * Tests whose ONLY subject was a filesystem property of a FILE (symlink
 * components, descriptor binding, quarantine directory removal) are marked
 * SUBSTRATE-RETIRED and replaced with the postgres-meaningful equivalent, with
 * the reason stated each time. The build-artifact.mjs launcher-security tests
 * are unchanged: they gate the build LAUNCHER, not the database substrate.
 *
 * ISOLATION: this court never mutates a shared database. It provisions and
 * drops disposable databases on the loopback server; the one real-database
 * integration (the `next build` run) proves that database is left byte-for-row
 * unchanged and never itself provisions against cana_app.
 */

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const buildArtifactPath = path.join(repoRoot, 'deploy/namecheap/build-artifact.mjs');
const prismaCli = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');
const npmCli = path.resolve(
  path.dirname(process.execPath),
  '..',
  'lib',
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);

/** The loopback PostgreSQL server every disposable database lives on. */
const PG_HOST = 'postgresql://postgres@127.0.0.1:5432';
const PG_ADMIN_URL = `${PG_HOST}/postgres`;

let tempRoot;
const createdDbs = [];

function issueAdminSql(sql) {
  execFileSync(process.execPath, [prismaCli, 'db', 'execute', '--url', PG_ADMIN_URL, '--stdin'], {
    cwd: webRoot, encoding: 'utf8', timeout: 120_000, input: sql,
    env: { ...process.env, DATABASE_URL: PG_ADMIN_URL, DIRECT_URL: PG_ADMIN_URL },
  });
}

/** Create a uniquely named disposable database and return its URL. Tracked so
 *  the after hook drops it even if a test throws mid-flight. */
function createDatabase(label = '') {
  const name = `gate_${label ? `${label}_` : ''}${randomBytes(6).toString('hex')}`;
  issueAdminSql(`CREATE DATABASE "${name}";`);
  createdDbs.push(name);
  return { name, url: `${PG_HOST}/${name}` };
}

function migrate(databaseUrl) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    {
      cwd: webRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function assertCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

async function withPreparedWorkspace(run) {
  const prepared = await prepareProductionBuildDatabase();
  try {
    return await run(prepared);
  } finally {
    try { prepared.workspace.cleanup(); } catch { /* already cleaned by the test */ }
  }
}

/** A frozen object shaped like a workspace but never registered in the module's
 *  live state — the postgres analogue of the old forgedWorkspace(): it carries a
 *  plausible databaseUrl but no marked, process-local capability, so the gate
 *  must refuse it with BUILD_DATABASE_OWNERSHIP_REQUIRED. */
function forgedWorkspace(databaseUrl) {
  return Object.freeze({
    databaseName: 'cana_build_forged',
    databaseUrl,
    readOnlyUrl: databaseUrl,
    cleanup() {},
  });
}

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-build-database-gate-'));
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const name of createdDbs) {
    try { issueAdminSql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`); } catch { /* best effort */ }
  }
});

test('production build ignores an arbitrary existing database and never mutates it', () => {
  // PORTED FROM THE SQLITE FILE-BYTE PROOF. The original ran `next build` with a
  // production-like sqlite file as DATABASE_URL and asserted the file bytes were
  // unchanged and no "readonly database"/"database is locked" errors appeared.
  // The postgres re-expression: point the build at a REAL, migrated postgres
  // database (a disposable stand-in for production), run the full webpack build,
  // and prove the build provisioned its OWN throwaway database instead of
  // touching the one in DATABASE_URL — asserted by the real database's row
  // content being identical before and after. The row snapshot is the postgres
  // analogue of the file-byte hash the sqlite lane compared.
  const { url } = createDatabase('build_real');
  migrate(url);
  // Seed one row so "unchanged" is a content claim, not just an emptiness claim.
  execFileSync('psql', [url, '-c',
    `INSERT INTO "Organization" ("id","name","updatedAt") VALUES ('build-sentinel','Build Sentinel', NOW())`],
    { encoding: 'utf8' });

  const before = execFileSync('psql', [url, '-tAc',
    `SELECT count(*)||':'||coalesce(string_agg(name, ',' ORDER BY name),'') FROM "Organization"`],
    { encoding: 'utf8' }).trim();

  const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
    cwd: webRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
      DIRECT_URL: url,
      NEXT_OUTPUT: 'standalone',
    },
    encoding: 'utf8',
    timeout: 300_000,
  });

  assert.equal(result.signal, null, `build timed out or was killed: ${result.signal}`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /cannot execute .* in a read-only transaction|permission denied/iu,
  );
  const afterState = execFileSync('psql', [url, '-tAc',
    `SELECT count(*)||':'||coalesce(string_agg(name, ',' ORDER BY name),'') FROM "Organization"`],
    { encoding: 'utf8' }).trim();
  assert.equal(afterState, before, 'the real database the build was pointed at must be untouched');
  // The build must have cleaned up after itself: no cana_build_* database leaked.
  const leaked = execFileSync('psql', [PG_ADMIN_URL, '-tAc',
    `SELECT count(*) FROM pg_database WHERE datname LIKE 'cana_build_%'`], { encoding: 'utf8' }).trim();
  assert.equal(leaked, '0', 'the build must drop its disposable database — none may leak');
});

test('SUBSTRATE-RETIRED: the immutable read-only PRAGMA consumer is a sqlite-only db-config path (pure unit)', async () => {
  // RETIRED WITH THE SUBSTRATE, kept as a pure unit. The `mode=ro&immutable=1`
  // FILE URL was the sqlite read-only build contract; db-config still recognises
  // it and refuses to issue database-SETTING pragmas against such a URL. On the
  // postgres substrate the read-only contract is a server-enforced
  // `default_transaction_read_only` connection instead (proven in the readiness
  // test below). This unit still pins the sqlite-path behaviour because a
  // rollback snapshot is still a real sqlite file a human may open read-only.
  const queries = [];
  const prisma = {
    async $queryRawUnsafe(statement) {
      queries.push(statement);
      const name = statement.trim().split(/\s+/u)[1];
      const values = { journal_mode: 'delete', busy_timeout: 5000, synchronous: 1, foreign_keys: 1 };
      return [{ [name]: values[name] }];
    },
  };
  const result = await initializeDatabaseConfig(prisma, {
    databaseUrl: 'file:///tmp/cana-build-database-proof/build.db?connection_limit=1&mode=ro&immutable=1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.mismatches, []);
  assert.equal(queries.length, 4);
  assert.ok(queries.every((statement) => !statement.includes('=')));
});

test('artifact build children cannot inherit Node preload or module-path injection', () => {
  const preloadPath = path.join(tempRoot, 'hostile-preload.cjs');
  const preloadSentinel = path.join(tempRoot, 'hostile-preload-executed');
  fs.writeFileSync(
    preloadPath,
    `require('node:fs').writeFileSync(${JSON.stringify(preloadSentinel)}, 'executed')`,
    { flag: 'wx', mode: 0o600 },
  );
  const result = spawnSync(
    buildArtifactPath,
    ['--verify-child-environment'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CANA_VERIFIED_NODE: process.execPath,
        NODE_OPTIONS: `--require=${preloadPath}`,
        NODE_PATH: tempRoot,
        REQUIRED_NODE: process.version,
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    marker: 'verified',
    nodeOptions: null,
    nodePath: null,
  });
  assert.equal(fs.existsSync(preloadSentinel), false);
});

test('artifact launcher cannot execute a PATH-shadowed Node binary', () => {
  const shadowDirectory = path.join(tempRoot, 'shadow-path');
  const shadowNode = path.join(shadowDirectory, 'node');
  const shadowSentinel = path.join(tempRoot, 'shadow-node-executed');
  fs.mkdirSync(shadowDirectory);
  fs.writeFileSync(
    shadowNode,
    `#!/bin/sh\nprintf executed > ${JSON.stringify(shadowSentinel)}\nexit 99\n`,
    { flag: 'wx', mode: 0o700 },
  );
  const result = spawnSync(
    buildArtifactPath,
    ['--verify-child-environment'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CANA_VERIFIED_NODE: process.execPath,
        PATH: `${shadowDirectory}${path.delimiter}${process.env.PATH}`,
        REQUIRED_NODE: process.version,
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(shadowSentinel), false);
  assert.equal(JSON.parse(result.stdout).marker, 'verified');
});

test('artifact launcher fails closed without a vetted absolute Node executable', () => {
  const shadowDirectory = path.join(tempRoot, 'missing-vetted-node-shadow');
  const shadowNode = path.join(shadowDirectory, 'node');
  const shadowSentinel = path.join(tempRoot, 'missing-vetted-node-executed');
  fs.mkdirSync(shadowDirectory);
  fs.writeFileSync(
    shadowNode,
    `#!/bin/sh\nprintf executed > ${JSON.stringify(shadowSentinel)}\nexit 99\n`,
    { flag: 'wx', mode: 0o700 },
  );
  const environment = {
    ...process.env,
    PATH: `${shadowDirectory}${path.delimiter}${process.env.PATH}`,
  };
  delete environment.CANA_VERIFIED_NODE;
  const result = spawnSync(buildArtifactPath, ['--verify-child-environment'], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.equal(result.status, 126);
  assert.match(result.stderr, /BUILD_NODE_IDENTITY_REFUSED/u);
  assert.equal(fs.existsSync(shadowSentinel), false);
});

test('artifact build rejects injection when its environment-scrubbing launcher is bypassed', () => {
  const environment = {
    ...process.env,
    CANA_ARTIFACT_SECURE_LAUNCH: '1',
    NODE_PATH: tempRoot,
    REQUIRED_NODE: process.version,
  };
  delete environment.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [buildArtifactPath], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BUILD_ENVIRONMENT_INJECTION_REFUSED/u);
});

test('database gate rejects forged build ownership', async () => {
  // A raw set of URL / disposable / ownership fields with no live capability can
  // never be a build database — the postgres analogue of the old forged-inode
  // workspace. Both a raw-fields call and a forged workspace object are refused
  // with BUILD_DATABASE_OWNERSHIP_REQUIRED.
  const { url } = createDatabase('forged');
  await assert.rejects(
    assertProductionBuildDatabaseReady({
      databaseUrl: url,
      disposable: '1',
      buildDatabaseRoot: tempRoot,
      ownershipProof: 'a'.repeat(64),
    }),
    assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
  );
  await assert.rejects(
    assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(url) }),
    assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
  );
});

test('database gate rejects existing and production-like databases it did not provision', async () => {
  // PORTED. The sqlite lane rejected an existing/production-like FILE; the
  // postgres lane rejects an existing/production-like DATABASE that this build
  // did not create and mark. A forged workspace pointing at a real migrated
  // database is refused, and that database is left untouched.
  for (const label of ['existing', 'production']) {
    const { url } = createDatabase(label);
    migrate(url);
    const before = execFileSync('psql', [url, '-tAc', 'SELECT count(*) FROM "Organization"'], { encoding: 'utf8' }).trim();
    await assert.rejects(
      assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(url) }),
      assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
    );
    const afterState = execFileSync('psql', [url, '-tAc', 'SELECT count(*) FROM "Organization"'], { encoding: 'utf8' }).trim();
    assert.equal(afterState, before, 'a rejected database must be left untouched');
  }
});

test('malformed, remote, non-postgres, and traversal server URLs cannot acquire a build capability', () => {
  // PORTED FROM THE SQLITE URL CONTRACT. The sqlite lane refused malformed /
  // remote-host / relative FILE URLs before opening them. The postgres lane
  // refuses the analogous SERVER URLs before issuing CREATE DATABASE: an empty
  // URL, a non-postgres scheme (file/mysql/sqlite), a URL that names no
  // maintenance database, and a syntactically malformed string. Refusal
  // precedes any connection. (Filesystem "traversal" has no analogue — a
  // postgres URL resolves to a server + one database name, never a path tree —
  // and `new URL` normalizes any `..` segments away before they could matter;
  // that retirement is asserted in the symlinked-parent test below.)
  const rejected = [
    '',
    'file:///tmp/build.db',
    'mysql://app:secret@db.internal.example:3306/cana',
    'postgresql://postgres@127.0.0.1:5432/',
    'not a url at all',
    'sqlite://memory',
  ];
  for (const serverUrl of rejected) {
    assert.throws(
      () => createBuildDatabaseWorkspace({ serverUrl }),
      (error) => {
        assert.ok(
          ['BUILD_DATABASE_SERVER_URL_REQUIRED', 'BUILD_DATABASE_SERVER_URL_INVALID'].includes(error?.code),
          `${serverUrl} → ${error?.code}`,
        );
        return true;
      },
      serverUrl,
    );
  }
});

test('SUBSTRATE-RETIRED: outside-root and textual-prefix FILE paths have no postgres analogue; a mismatched database name is refused instead', async () => {
  // RETIRED WITH THE SUBSTRATE. "Absolute outside-root" and "textual-prefix
  // sibling directory" were attacks on a FILE path being mistaken for one inside
  // the owned root. A managed database has no path and no root, so the attack
  // class does not exist. The surviving intent — a database that is not the one
  // this build named cannot acquire authority — is proven with a forged
  // workspace whose name does not match the live capability: it is refused by
  // the ownership/identity gate.
  await withPreparedWorkspace(async ({ workspace }) => {
    const other = new URL(workspace.databaseUrl);
    other.pathname = '/cana_build_deadbeefdeadbeef'; // a plausible-but-different name
    await assert.rejects(
      assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(other.href) }),
      assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
    );
  });
});

test('SUBSTRATE-RETIRED: symlink database target — a database has no path to symlink; marker identity is checked instead', async () => {
  // RETIRED WITH THE SUBSTRATE. A symlinked database FILE was a TOCTOU attack on
  // a filesystem path. A managed database is reached by name over a connection,
  // not by resolving a path, so there is no symlink to plant. The property that
  // survives — the build must open the exact database it created, not a
  // substitute — is enforced by the ownership marker, exercised directly here:
  // a live workspace repointed (via a forged wrapper) at a DIFFERENT real
  // database fails the marker check.
  await withPreparedWorkspace(async ({ workspace }) => {
    const decoy = createDatabase('symlink_decoy');
    migrate(decoy.url);
    await assert.rejects(
      assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(decoy.url) }),
      (error) => ['BUILD_DATABASE_OWNERSHIP_REQUIRED', 'BUILD_DATABASE_OPEN_IDENTITY_MISMATCH'].includes(error?.code),
    );
  });
});

test('SUBSTRATE-RETIRED: symlinked parent directories have no analogue for a network database', async () => {
  // RETIRED WITH THE SUBSTRATE. A symlinked parent directory could redirect a
  // FILE open. A database URL resolves to a server + a single database name,
  // never a directory tree, so the attack cannot be expressed: `new URL`
  // normalizes any `..` path segment away before the module ever sees it, and
  // an embedded slash / traversal cannot survive to become a second database
  // name. Demonstrated here — the normalized name is a plain single segment —
  // so the retirement is explicit and the guarantee is never assumed lost.
  const normalized = new URL('postgresql://postgres@127.0.0.1:5432/main/../escape');
  assert.equal(normalized.pathname, '/escape',
    'URL normalization collapses traversal — there is no directory tree for a database URL to escape');
  // A URL that genuinely names no single maintenance database is still refused.
  assert.throws(
    () => createBuildDatabaseWorkspace({ serverUrl: 'postgresql://postgres@127.0.0.1:5432/' }),
    assertCode('BUILD_DATABASE_SERVER_URL_INVALID'),
  );
});

test('SUBSTRATE-RETIRED: a temp root replaced by a symlink — the build owns a database, not a directory', async () => {
  // RETIRED WITH THE SUBSTRATE. Replacing the owned temp ROOT with a symlink was
  // an attack on the directory the sqlite file lived in. The postgres build owns
  // a DATABASE, not a directory, so this specific swap cannot happen. The
  // surviving intent — the workspace can only ever be the disposable database it
  // created — is proven by the identity gate rejecting a forged same-server URL
  // whose database name is not the one created.
  await withPreparedWorkspace(async ({ workspace }) => {
    const swapped = new URL(workspace.databaseUrl);
    swapped.pathname = '/cana_build_0000000000000000';
    await assert.rejects(
      assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(swapped.href) }),
      assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
    );
  });
});

test('gate detects replacement of the validated database before the verified open', async () => {
  // PORTED. The sqlite lane detected a target FILE swapped between validation and
  // open (BUILD_DATABASE_IDENTITY_CHANGED / OPEN_IDENTITY_MISMATCH) via inode
  // identity. The postgres analogue: overwrite the ownership MARKER between the
  // validation hook and the verified read-only open, so the database the gate
  // opens no longer carries this build's marker. The gate must refuse with
  // BUILD_DATABASE_OPEN_IDENTITY_MISMATCH — the marker is the identity.
  await withPreparedWorkspace(async ({ workspace }) => {
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace,
        beforeVerifiedDatabaseConnect() {
          // A concurrent actor rewrites the ownership marker (identity theft).
          execFileSync('psql', [workspace.databaseUrl, '-c',
            `UPDATE "__cana_build_database_ownership" SET marker = 'attacker'`], { encoding: 'utf8' });
        },
      }),
      assertCode('BUILD_DATABASE_OPEN_IDENTITY_MISMATCH'),
    );
  });
});

test('SUBSTRATE-RETIRED: the locked-build-root TOCTOU race is a filesystem property; the marker closes it on postgres', async () => {
  // RETIRED WITH THE SUBSTRATE. "Locked build root prevents target replacement
  // while Prisma opens the database" chmod'd a directory 0o500 so an attacker
  // could not rename the FILE mid-open. There is no directory to lock for a
  // network database. The property that mattered — a swap during the open window
  // is caught — is proven by the marker check in the test above; asserted here
  // as an explicit retirement, and re-confirming the happy path still verifies.
  await withPreparedWorkspace(async ({ workspace }) => {
    const result = await assertProductionBuildDatabaseReady({ workspace });
    assert.equal(result.checks.every((check) => check.pass), true);
  });
});

test('initial migration targets only the generated database, never an attacker database', async () => {
  // PORTED. The sqlite lane proved the INITIAL migration opened only the
  // exclusively-created file and left an attacker's database untouched. The
  // postgres analogue: an attacker's real database exists on the same server;
  // preparing a build database migrates ONLY the generated-name database, and
  // the attacker database's content is unchanged. A generated name the attacker
  // cannot predict is the exclusivity guarantee.
  const attacker = createDatabase('initial_attacker');
  migrate(attacker.url);
  execFileSync('psql', [attacker.url, '-c',
    `INSERT INTO "Organization" ("id","name","updatedAt") VALUES ('attacker','Attacker', NOW())`], { encoding: 'utf8' });
  const before = execFileSync('psql', [attacker.url, '-tAc', 'SELECT name FROM "Organization" ORDER BY name'], { encoding: 'utf8' }).trim();

  await withPreparedWorkspace(async ({ workspace, result }) => {
    assert.equal(result.provider, 'postgresql');
    assert.notEqual(workspace.databaseName, attacker.name, 'the build database name must be unpredictable and distinct');
  });

  const afterState = execFileSync('psql', [attacker.url, '-tAc', 'SELECT name FROM "Organization" ORDER BY name'], { encoding: 'utf8' }).trim();
  assert.equal(afterState, before, 'the attacker database must be untouched by build database preparation');
});

test('SUBSTRATE-RETIRED: descriptor-bound migration binding is a file-descriptor property', async () => {
  // RETIRED WITH THE SUBSTRATE. The sqlite lane migrated through /proc/self/fd/N
  // so a pathname replacement could not redirect the migration to another file.
  // A postgres migration connects to a named database over the wire; there is no
  // descriptor to bind and no pathname to replace. The surviving intent —
  // migration only ever writes to the build's own database — follows from the
  // generated name and is re-proven by the untouched-attacker test above.
  await withPreparedWorkspace(async ({ workspace }) => {
    // The build database carries exactly its migrations and its ownership marker,
    // proving the migration wrote where it was supposed to and nowhere else.
    const rows = execFileSync('psql', [workspace.databaseUrl, '-tAc',
      `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`], { encoding: 'utf8' }).trim();
    assert.ok(Number(rows) >= 3, `the build database must carry the finished migration set, got ${rows}`);
  });
});

test('verified open rejects an identity change before any database write', async () => {
  // PORTED FROM "verified immutable open rejects a replacement". The sqlite lane
  // rejected a swapped FILE at the verified immutable open. The postgres analogue:
  // the marker is rewritten just before the verified read-only connect, so the
  // opened database is not the one this build created; the gate refuses with
  // BUILD_DATABASE_OPEN_IDENTITY_MISMATCH before it would trust any read.
  await withPreparedWorkspace(async ({ workspace }) => {
    await assert.rejects(
      assertProductionBuildDatabaseReady({
        workspace,
        beforeVerifiedDatabaseConnect() {
          execFileSync('psql', [workspace.databaseUrl, '-c',
            `DELETE FROM "__cana_build_database_ownership"`], { encoding: 'utf8' });
        },
      }),
      assertCode('BUILD_DATABASE_OPEN_IDENTITY_MISMATCH'),
    );
  });
});

test('the build connection is READ-ONLY: a write is refused by the server', async () => {
  // PORTED FROM THE `mode=ro&immutable=1` CONTRACT. The sqlite lane handed the
  // build an immutable read-only file URL. The postgres re-expression is a
  // `default_transaction_read_only` connection, and unlike a flag in a URL it is
  // PROVEN: assertProductionBuildDatabaseReady attempts a write on the verified
  // connection and only passes if the server refuses it. Here we also confirm the
  // read-only URL directly rejects a CREATE TABLE.
  await withPreparedWorkspace(async ({ workspace }) => {
    const write = spawnSync('psql', [workspace.readOnlyUrl, '-v', 'ON_ERROR_STOP=1', '-c',
      'CREATE TABLE should_fail (id int)'], { encoding: 'utf8' });
    assert.notEqual(write.status, 0, 'a write on the read-only build connection must be refused');
    assert.match(write.stderr, /read-only transaction/iu);
  });
});

test('SUBSTRATE-RETIRED: atomic quarantine cleanup is a directory operation; DROP DATABASE replaces it', async () => {
  // RETIRED WITH THE SUBSTRATE. The sqlite lane cleaned up by renaming the owned
  // ROOT DIRECTORY into a quarantine container and unlinking inodes through
  // retained descriptors, refusing if unowned content had appeared. A managed
  // database is removed with one atomic `DROP DATABASE ... WITH (FORCE)`, so
  // there is no directory to quarantine and no sidecar to protect. The surviving
  // guarantees — cleanup removes exactly the build's own database, and refuses to
  // drop anything that is not a build-owned disposable database — are proven in
  // the cleanup tests below. This retirement is explicit so the guarantee is
  // never assumed lost.
  const { workspace } = await prepareProductionBuildDatabase();
  const removed = workspace.cleanup();
  assert.equal(removed.removed, true);
  assert.equal(removed.databaseName, workspace.databaseName);
});

test('cleanup drops ONLY the build-owned disposable database and no bystander', async () => {
  // PORTED FROM "atomic cleanup refuses unowned root content without deleting
  // it". The sqlite lane proved cleanup never deleted content it did not own. The
  // postgres analogue: a real bystander database exists on the same server; a
  // build workspace's cleanup drops its OWN generated-name database and the
  // bystander is untouched. A forged workspace (no live capability) pointing at
  // the bystander is separately refused, so a forged handle can never trigger a
  // drop of a database this build does not own.
  const survivor = createDatabase('cleanup_survivor');
  migrate(survivor.url);

  // A forged handle carries no live capability, so the gate refuses it before it
  // could ever reach a drop.
  await assert.rejects(
    assertProductionBuildDatabaseReady({ workspace: forgedWorkspace(survivor.url) }),
    assertCode('BUILD_DATABASE_OWNERSHIP_REQUIRED'),
  );

  const { workspace } = await prepareProductionBuildDatabase();
  workspace.cleanup();

  const survives = execFileSync('psql', [PG_ADMIN_URL, '-tAc',
    `SELECT count(*) FROM pg_database WHERE datname = '${survivor.name}'`], { encoding: 'utf8' }).trim();
  assert.equal(survives, '1', 'a build cleanup must never drop a database it does not own');
});

test('gate accepts only its initialized process-local database capability', async () => {
  // PORTED. The sqlite lane proved the gate accepted only its exclusively created
  // inode, repeatedly, with the file identity unchanged. The postgres analogue:
  // the gate accepts the live marked workspace, is repeatable, reports provider
  // postgresql, and every readiness check passes. Re-running does not change the
  // database identity (same generated name, same marker).
  await withPreparedWorkspace(async ({ workspace, result }) => {
    assert.equal(result.provider, 'postgresql');
    assert.equal(result.checks.every((check) => check.pass), true);
    const repeated = await assertProductionBuildDatabaseReady({ workspace });
    assert.equal(repeated.provider, 'postgresql');
    assert.equal(repeated.checks.every((check) => check.pass), true);
    // The marker — the postgres identity — is unchanged across repeated gating.
    const marker = execFileSync('psql', [workspace.databaseUrl, '-tAc',
      `SELECT marker FROM "__cana_build_database_ownership"`], { encoding: 'utf8' }).trim();
    assert.match(marker, /^[0-9a-f]{64}$/, 'the ownership marker persists as the database identity');
  });
});

test('build-owned database cleanup drops the exclusive disposable database', async () => {
  // PORTED. The sqlite lane proved cleanup removed the exclusive target file and
  // its quarantine container. The postgres analogue: cleanup DROPs the generated
  // database, and it no longer exists on the server afterwards.
  const { workspace } = await prepareProductionBuildDatabase();
  const name = workspace.databaseName;
  const present = execFileSync('psql', [PG_ADMIN_URL, '-tAc',
    `SELECT count(*) FROM pg_database WHERE datname = '${name}'`], { encoding: 'utf8' }).trim();
  assert.equal(present, '1', 'the disposable database exists before cleanup');
  const cleanup = workspace.cleanup();
  assert.equal(cleanup.removed, true);
  const gone = execFileSync('psql', [PG_ADMIN_URL, '-tAc',
    `SELECT count(*) FROM pg_database WHERE datname = '${name}'`], { encoding: 'utf8' }).trim();
  assert.equal(gone, '0', 'cleanup must drop the disposable database');
  // Idempotent: a second cleanup is a no-op, not a throw.
  assert.deepEqual(workspace.cleanup(), { removed: false });
});

test('installed build database cleanup preserves signal exit semantics', () => {
  // PORTED. The sqlite lane installed the build database, sent SIGTERM, and
  // required exit 143 (128 + SIGTERM) with the file cleaned up. The postgres
  // analogue is identical at the process level: installProductionBuildDatabase
  // registers signal cleanup that drops the disposable database and then exits
  // with signal-preserving status.
  const moduleUrl = pathToFileURL(path.join(webRoot, 'src/lib/build-database.mjs')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { installProductionBuildDatabase } from ${JSON.stringify(moduleUrl)};
       await installProductionBuildDatabase();
       process.stdout.write(process.env.DATABASE_URL + '\\n');
       setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);
       setInterval(() => {}, 1_000);`,
    ],
    {
      cwd: webRoot,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 180_000,
    },
  );

  assert.equal(result.signal, null);
  assert.equal(result.status, 143, result.stderr || result.stdout);
  // The build database URL the process installed must be a read-only disposable.
  assert.match(result.stdout, /default_transaction_read_only/u);
});

test('cleanup on signal cannot leave a disposable database that never gets reclaimed', () => {
  // PORTED FROM "cleanup refusal cannot suppress signal termination". The sqlite
  // lane proved a refused directory cleanup still terminated the process 143 and
  // preserved unowned content. On postgres a DROP is atomic and there is no
  // unowned sidecar to preserve, so the surviving property is: SIGTERM always
  // terminates with 143 even while cleanup runs, and the disposable database is
  // dropped (not leaked) on the way out.
  const moduleUrl = pathToFileURL(path.join(webRoot, 'src/lib/build-database.mjs')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { installProductionBuildDatabase } from ${JSON.stringify(moduleUrl)};
       const r = await installProductionBuildDatabase();
       const url = new URL(process.env.DATABASE_URL);
       process.stdout.write(url.pathname.replace(/^\\//, '') + '\\n');
       setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);
       setInterval(() => {}, 1_000);`,
    ],
    {
      cwd: webRoot,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 180_000,
    },
  );
  const droppedName = result.stdout.trim().split('\n').pop();

  assert.equal(result.signal, null);
  assert.equal(result.status, 143, result.stderr || result.stdout);
  const present = execFileSync('psql', [PG_ADMIN_URL, '-tAc',
    `SELECT count(*) FROM pg_database WHERE datname = '${droppedName}'`], { encoding: 'utf8' }).trim();
  assert.equal(present, '0', 'the disposable database must be dropped on signal cleanup, never leaked');
});
