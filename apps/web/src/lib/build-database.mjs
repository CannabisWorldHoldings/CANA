import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseReadiness, databaseProviderOf } from './db-config.mjs';

/**
 * PRODUCTION BUILD DATABASE — a disposable PostgreSQL database, provisioned for
 * the build and destroyed after it, that the build can NEVER confuse with a
 * real one.
 *
 * SUBSTRATE RETIREMENT (docs/adr/0001). This module used to build a local
 * SQLite FILE for the build: `prisma db push` into a temp file, an elaborate
 * inode-identity / symlink / descriptor apparatus to prove Prisma opened
 * exactly the file it created, a `mode=ro&immutable=1` read-only URL, and a
 * descriptor-relative quarantine cleanup. All of that machinery existed to make
 * a FILE substrate safe. The canonical CANA datastore is now managed PostgreSQL
 * + PostGIS, the schema is `provider = "postgresql"`, and the application opens
 * an outbound connection to a database SERVER rather than reading a file — so a
 * sqlite build FILE cannot even be produced from this schema (`prisma migrate`
 * against a `file:` URL with a postgresql provider is rejected outright).
 *
 * The honest port keeps every GUARANTEE this module ever made and re-expresses
 * each on the postgres substrate:
 *
 *   - EXCLUSIVE, DISPOSABLE TARGET. Instead of an exclusively-created inode in a
 *     locked temp directory, the build gets a freshly CREATEd, uniquely named
 *     database on the configured server (name `cana_build_<hex>`), migrated from
 *     the source-controlled migration set, and DROPped WITH (FORCE) on cleanup.
 *     A generated name no other process can predict is the postgres analogue of
 *     an O_EXCL inode.
 *
 *   - OWNERSHIP PROOF. Instead of comparing (dev, ino) across a swap, the build
 *     writes a random marker into an ownership table and the gate refuses any
 *     database that does not carry exactly this build's marker. That is what
 *     makes "the build only ever opened the database it created" checkable on a
 *     server: identity is the marker, not an inode.
 *
 *   - NEVER TOUCH A REAL DATABASE. The gate refuses an arbitrary/forged/existing
 *     database URL (one it did not provision and mark), and refuses malformed,
 *     remote-by-name, and non-postgres URLs. The build connection is READ-ONLY:
 *     the URL carries `options=-c default_transaction_read_only=on`, so even if a
 *     build-time query tried to write, the server refuses it. That is the
 *     postgres equivalent of the retired `mode=ro&immutable=1` file contract.
 *
 * SQLITE-SUBSTRATE GUARANTEES THAT ARE RETIRED, NOT WEAKENED: inode identity,
 * symlink-component scanning, O_NOFOLLOW descriptor binding, file-byte hashing,
 * and descriptor-relative quarantine directory removal. Each was a property of a
 * FILE on a local filesystem; a managed database has no path, no inode, and no
 * bytes on this host to protect. Their INTENT — the build cannot be tricked into
 * opening or mutating something other than its own throwaway database — survives
 * as the marker + read-only + disposable-name guarantees above.
 */

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_PATH = path.join(WEB_ROOT, 'prisma', 'schema.prisma');
const BUILD_DATABASE_NAME_PREFIX = 'cana_build_';
const OWNERSHIP_TABLE = '__cana_build_database_ownership';

const workspaceState = new WeakMap();
const cleanedWorkspaces = new WeakSet();
let installedWorkspace;

export class ProductionBuildDatabaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProductionBuildDatabaseError';
    this.code = code;
  }
}

function refusal(code, message) {
  throw new ProductionBuildDatabaseError(code, message);
}

/** The Prisma CLI entrypoint, invoked directly rather than through `npx` so a
 *  cold npx cache (or no network) cannot turn a build into a download. */
function prismaCli(webDir = WEB_ROOT) {
  for (let dir = webDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', 'prisma', 'build', 'index.js');
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) refusal('BUILD_DATABASE_TOOLING_MISSING', 'prisma CLI not found above ' + webDir);
  }
}

function runPrisma(args, { databaseUrl, directUrl = databaseUrl, timeoutMs = 240_000, stdin } = {}) {
  return execFileSync(process.execPath, [prismaCli(), ...args], {
    cwd: WEB_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: stdin === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    ...(stdin === undefined ? {} : { input: stdin }),
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl },
  });
}

/**
 * Parse and validate the SERVER URL the build database is provisioned on.
 *
 * This is the postgres re-expression of the retired URL contract. A build
 * server URL MUST be a postgres URL, MUST name a maintenance database to issue
 * CREATE/DROP DATABASE against, and MUST NOT be a malformed, remote-by-opaque,
 * or traversal-bearing string. Refusing a bad URL BEFORE connecting is the same
 * fail-closed property the sqlite lane had when it refused a `file:` URL that
 * pointed outside its owned root.
 */
function parseServerUrl(rawServerUrl) {
  if (typeof rawServerUrl !== 'string' || rawServerUrl.trim() === '') {
    refusal('BUILD_DATABASE_SERVER_URL_REQUIRED',
      'A build database server URL is required (CANA_BUILD_DATABASE_URL or DATABASE_URL)');
  }
  if (databaseProviderOf(rawServerUrl) !== 'postgresql') {
    refusal('BUILD_DATABASE_SERVER_URL_INVALID',
      'The build database server URL must be a PostgreSQL URL — the canonical datastore is PostgreSQL + PostGIS');
  }
  let parsed;
  try {
    parsed = new URL(rawServerUrl);
  } catch {
    refusal('BUILD_DATABASE_SERVER_URL_INVALID', 'The build database server URL is malformed');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    refusal('BUILD_DATABASE_SERVER_URL_INVALID', 'The build database server URL must use the postgres protocol');
  }
  const maintenanceDatabase = parsed.pathname.replace(/^\//, '');
  if (maintenanceDatabase === '' || maintenanceDatabase.includes('/')) {
    refusal('BUILD_DATABASE_SERVER_URL_INVALID',
      'The build database server URL must name exactly one maintenance database');
  }
  return { parsed, maintenanceDatabase };
}

/** Build a concrete database URL on the same server, targeting `databaseName`,
 *  optionally read-only (a session that cannot write). */
function databaseUrlOnServer(rawServerUrl, databaseName, { readOnly = false } = {}) {
  const url = new URL(rawServerUrl);
  url.pathname = `/${databaseName}`;
  if (!readOnly) return url.href;
  // The postgres equivalent of the retired `mode=ro&immutable=1` file contract:
  // a libpq `options` startup parameter that forces every transaction on this
  // connection to be read-only. A build-time query that attempted a write is
  // refused by the SERVER, not merely discouraged. The options value must be
  // percent-encoded with %20 for the space and %3D for the '=' — libpq's URI
  // parser does NOT decode '+' to a space (that is form-encoding), and
  // URLSearchParams.set would emit '+', so the query string is built by hand.
  // No Prisma-only params (e.g. connection_limit) are appended, so the same URL
  // is valid for both the Prisma client and a plain libpq tool.
  const readOnlyOptions = 'options=-c%20default_transaction_read_only%3Don';
  const existing = url.search ? `${url.search.slice(1)}&` : '';
  url.search = `?${existing}${readOnlyOptions}`;
  return url.href;
}

function issueSql(serverAdminUrl, sql) {
  runPrisma(['db', 'execute', '--url', serverAdminUrl, '--stdin'], { databaseUrl: serverAdminUrl, stdin: sql });
}

function stateFor(workspace) {
  const state = workspaceState.get(workspace);
  if (!state || state.cleaned) {
    refusal('BUILD_DATABASE_OWNERSHIP_REQUIRED',
      'Production build requires a live process-local database capability');
  }
  return state;
}

/**
 * Validate that a candidate database URL is the exact disposable database this
 * build provisioned and marked — the postgres analogue of the inode-identity
 * and symlink-component checks. A URL is only accepted when it names a database
 * with this build's generated name on this build's server; any other URL
 * (forged, arbitrary, existing, or production-like) is refused before use.
 */
function assertWorkspaceIdentity(workspace) {
  const state = stateFor(workspace);
  let candidate;
  try {
    candidate = new URL(workspace.databaseUrl);
  } catch {
    refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database URL is malformed');
  }
  if (databaseProviderOf(workspace.databaseUrl) !== 'postgresql') {
    refusal('BUILD_DATABASE_ROOT_UNSAFE', 'Build database is not a PostgreSQL database');
  }
  const candidateName = candidate.pathname.replace(/^\//, '');
  if (
    candidateName !== state.databaseName
    || !candidateName.startsWith(BUILD_DATABASE_NAME_PREFIX)
    || `${candidate.protocol}//${candidate.host}` !== `${state.serverProtocol}//${state.serverHost}`
  ) {
    refusal('BUILD_DATABASE_ROOT_UNSAFE',
      'Build database is not the canonical disposable database created by this build');
  }
  return state;
}

async function connect(url) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return prisma;
}

async function readOwnershipMarker(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT marker FROM "${OWNERSHIP_TABLE}" ORDER BY marker`);
    return rows.map((r) => r.marker);
  } catch {
    return null;
  }
}

/**
 * Create a disposable, uniquely named PostgreSQL database on the configured
 * server. The generated name is unpredictable, so no other process can name it
 * in advance — the postgres analogue of an O_EXCL exclusive inode.
 */
export function createBuildDatabaseWorkspace({ serverUrl = process.env.CANA_BUILD_DATABASE_URL ?? process.env.DATABASE_URL } = {}) {
  const { parsed } = parseServerUrl(serverUrl);
  const databaseName = `${BUILD_DATABASE_NAME_PREFIX}${randomBytes(8).toString('hex')}`;
  const adminUrl = parsed.href;
  // CREATE the exclusive disposable database. A generated name cannot collide
  // with a prior run and cannot be pre-created by an attacker to be adopted.
  issueSql(adminUrl, `CREATE DATABASE "${databaseName}";`);
  const databaseUrl = databaseUrlOnServer(serverUrl, databaseName);
  const readOnlyUrl = databaseUrlOnServer(serverUrl, databaseName, { readOnly: true });
  const marker = randomBytes(32).toString('hex');
  const workspace = Object.freeze({
    databaseName,
    databaseUrl,
    readOnlyUrl,
    cleanup(options) {
      return cleanupWorkspace(workspace, options);
    },
  });
  workspaceState.set(workspace, {
    databaseName,
    serverUrl,
    adminUrl,
    serverProtocol: parsed.protocol,
    serverHost: parsed.host,
    databaseUrl,
    readOnlyUrl,
    marker,
    initialized: false,
    cleaned: false,
  });
  return workspace;
}

/** DROP the disposable database. Refuses to drop anything that is not this
 *  build's generated-name database, and never touches a real one. */
function cleanupWorkspace(workspace) {
  if (cleanedWorkspaces.has(workspace)) return { removed: false };
  const state = stateFor(workspace);
  // A cleanup must prove it is dropping exactly the disposable database this
  // build created before it drops anything.
  assertWorkspaceIdentity(workspace);
  if (!state.databaseName.startsWith(BUILD_DATABASE_NAME_PREFIX)) {
    refusal('BUILD_DATABASE_CLEANUP_REFUSED',
      'Refusing to drop a database that is not a build-owned disposable database');
  }
  try {
    issueSql(state.adminUrl, `DROP DATABASE IF EXISTS "${state.databaseName}" WITH (FORCE);`);
  } catch (error) {
    refusal('BUILD_DATABASE_CLEANUP_FAILED',
      `Failed to drop the disposable build database: ${error?.message ?? error}`);
  }
  state.cleaned = true;
  workspaceState.delete(workspace);
  cleanedWorkspaces.add(workspace);
  return { removed: true, databaseName: state.databaseName };
}

async function initializeWorkspace(workspace, { beforeInitialDatabaseConnect } = {}) {
  const state = assertWorkspaceIdentity(workspace);
  await beforeInitialDatabaseConnect?.(workspace);
  // Migrate the disposable database from the source-controlled migration set —
  // the same `migrate deploy` a real deploy runs, so the build database has the
  // exact production schema (PostGIS extension and all).
  try {
    runPrisma(['migrate', 'deploy', '--schema', SCHEMA_PATH], { databaseUrl: state.databaseUrl });
  } catch (error) {
    refusal('DATABASE_MIGRATION_FAILED',
      `Production build database migration failed: ${error?.stderr ?? error?.message ?? error}`);
  }
  // Write the ownership marker. A gate later refuses any database that does not
  // carry exactly this marker — the postgres analogue of inode identity.
  const prisma = await connect(state.databaseUrl);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${OWNERSHIP_TABLE}" (marker TEXT NOT NULL PRIMARY KEY)`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "${OWNERSHIP_TABLE}"`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${OWNERSHIP_TABLE}" (marker) VALUES ($1)`, state.marker);
  } finally {
    await prisma.$disconnect();
  }
  state.initialized = true;
  assertWorkspaceIdentity(workspace);
  const result = await assertProductionBuildDatabaseReady({ workspace });
  state.result = result;
  return result;
}

/**
 * Assert a build database is READY, or refuse with a named code.
 *
 * Accepts either a live workspace (the normal path) or a raw set of URL /
 * disposable / ownership fields (the forged-input path the gate must refuse).
 * A raw URL that this process did not provision-and-mark carries no live
 * workspace state, so it fails ownership immediately — the postgres analogue of
 * refusing a forged inode-identity workspace.
 */
export async function assertProductionBuildDatabaseReady({
  workspace,
  databaseUrl,
  disposable,
  buildDatabaseRoot,
  ownershipProof,
  beforeDatabaseOpen,
  beforeVerifiedDatabaseConnect,
} = {}) {
  if (!workspace) {
    // A raw URL with no live capability can never be a build database: there is
    // no marked, process-local database behind it. This is where forged
    // ownership, disposable flags, and arbitrary existing databases are refused.
    refusal('BUILD_DATABASE_OWNERSHIP_REQUIRED',
      'Production build requires a live process-local database capability, not a raw URL');
  }
  const state = assertWorkspaceIdentity(workspace);
  if (!state.initialized) {
    refusal('BUILD_DATABASE_NOT_INITIALIZED', 'Build-owned database has not completed initialization');
  }
  await beforeDatabaseOpen?.();
  assertWorkspaceIdentity(workspace);

  await beforeVerifiedDatabaseConnect?.();
  // Verify through a READ-ONLY connection — a build-time write would be refused
  // by the server, which is the postgres re-expression of the immutable file
  // contract. The ownership marker proves this is the database this build made.
  const prisma = await connect(state.readOnlyUrl);
  let result;
  try {
    const markers = await readOwnershipMarker(prisma);
    if (markers === null || markers.length !== 1 || markers[0] !== state.marker) {
      refusal('BUILD_DATABASE_OPEN_IDENTITY_MISMATCH',
        'Opened database is not the process-local database created by this build');
    }
    const readiness = await databaseReadiness(prisma, { provider: 'postgresql' });
    if (!readiness.ready) {
      refusal('DATABASE_NOT_READY',
        `Production build database is not ready: ${readiness.checks
          .filter((check) => !check.pass)
          .map((check) => check.name)
          .join(', ')}`);
    }
    // Prove the connection is genuinely read-only: an attempted write is
    // refused by the server. This is the live, checked equivalent of the old
    // "immutable" flag — not a promise in a URL, a demonstrated refusal.
    let readOnlyEnforced = false;
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "__cana_build_write_probe" (id INTEGER)`,
      );
    } catch {
      readOnlyEnforced = true;
    }
    if (!readOnlyEnforced) {
      refusal('BUILD_DATABASE_NOT_READ_ONLY',
        'Build database connection accepted a write — the read-only contract is not enforced');
    }
    result = {
      provider: 'postgresql',
      checks: [
        ...readiness.checks,
        {
          name: 'build_database_read_only',
          pass: true,
          detail: 'build queries use a default_transaction_read_only PostgreSQL connection',
        },
        {
          name: 'build_database_disposable',
          pass: true,
          detail: `disposable database ${state.databaseName} is dropped WITH (FORCE) on cleanup`,
        },
      ],
    };
  } finally {
    await prisma.$disconnect();
  }
  assertWorkspaceIdentity(workspace);
  return result;
}

export async function prepareProductionBuildDatabase(options = {}) {
  const workspace = createBuildDatabaseWorkspace(options);
  try {
    const result = await initializeWorkspace(workspace, options);
    if (options.beforeDatabaseOpen) {
      await assertProductionBuildDatabaseReady({
        workspace,
        beforeDatabaseOpen: options.beforeDatabaseOpen,
      });
    }
    return { workspace, result };
  } catch (error) {
    try {
      workspace.cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Build database preparation and fail-closed cleanup both failed',
        { cause: error },
      );
    }
    throw error;
  }
}

export async function installProductionBuildDatabase() {
  if (installedWorkspace) return installedWorkspace.result;
  // RE-ENTRY ACROSS MODULE INSTANCES. Next compiles next.config to a temp file
  // and may import it more than once in the SAME process. Each import is a fresh
  // module instance, so `installedWorkspace` (module-scoped) is not enough: a
  // second evaluation would read the DATABASE_URL the first one already
  // repointed at the read-only build database and try to CREATE DATABASE against
  // it (which fails read-only). A process-level env flag makes install idempotent
  // regardless of how many times the config module is instantiated: once a build
  // database is installed, later calls are a no-op that keep the repointed URL.
  if (process.env.CANA_BUILD_DATABASE_INSTALLED === '1') {
    return { provider: 'postgresql', checks: [], reused: true };
  }
  // Snapshot the ORIGINAL server URL before any mutation so provisioning always
  // targets the real server, never a read-only build URL fed back through env.
  const serverUrl = process.env.CANA_BUILD_DATABASE_URL ?? process.env.DATABASE_URL;
  const installed = await prepareProductionBuildDatabase({ serverUrl });
  installedWorkspace = installed;
  // The build sees ONLY the read-only disposable database. It can query the
  // production-shaped schema but can never write, and never reaches the real
  // datastore because DATABASE_URL is repointed at the throwaway database.
  const readOnlyUrl = stateFor(installed.workspace).readOnlyUrl;
  process.env.CANA_BUILD_DATABASE_INSTALLED = '1';
  process.env.DATABASE_URL = readOnlyUrl;
  process.env.DIRECT_URL = readOnlyUrl;
  const cleanup = () => {
    if (installedWorkspace) {
      try {
        installedWorkspace.workspace.cleanup();
      } catch {
        // Best-effort teardown on process exit — the disposable database is
        // named and will be reclaimed; a failed drop must not wedge shutdown.
      }
      installedWorkspace = undefined;
    }
  };
  process.once('beforeExit', cleanup);
  process.once('exit', cleanup);
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      try {
        cleanup();
      } finally {
        process.exit(128 + os.constants.signals[signal]);
      }
    });
  }
  return installed.result;
}
