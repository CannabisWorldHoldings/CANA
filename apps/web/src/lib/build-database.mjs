import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  databaseReadiness,
  ensureDatabaseMigrated,
  initializeDatabaseConfig,
} from './db-config.mjs';

const BUILD_DATABASE_ROOT_PREFIX = 'cana-build-database-';
const INVALIDATED_DATABASE_ROOT_PREFIX = 'cana-invalidated-database-';
const BUILD_DATABASE_NAME = 'build.db';
const BUILD_DATABASE_SIDECARS = [`${BUILD_DATABASE_NAME}-shm`, `${BUILD_DATABASE_NAME}-wal`];
const OWNERSHIP_TABLE = '__cana_build_database_ownership';
const SQLITE_HEADER = Buffer.from('SQLite format 3\0');
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

function identityOf(stats) {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function openSqliteDescriptors() {
  const descriptorDirectory = ['/proc/self/fd', '/dev/fd'].find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
  if (!descriptorDirectory) {
    refusal(
      'BUILD_DATABASE_OPEN_IDENTITY_UNAVAILABLE',
      'This platform cannot prove which SQLite file the build connection opened',
    );
  }

  const descriptors = new Map();
  for (const entry of fs.readdirSync(descriptorDirectory)) {
    const descriptor = Number(entry);
    if (!Number.isSafeInteger(descriptor) || descriptor < 0) continue;
    try {
      const stats = fs.fstatSync(descriptor, { bigint: true });
      if (!stats.isFile() || stats.size < BigInt(SQLITE_HEADER.length)) continue;
      const header = Buffer.alloc(SQLITE_HEADER.length);
      if (
        fs.readSync(descriptor, header, 0, header.length, 0) === header.length
        && header.equals(SQLITE_HEADER)
      ) {
        descriptors.set(descriptor, identityOf(stats));
      }
    } catch {
      // Descriptors can close between directory enumeration and fstat.
    }
  }
  return descriptors;
}

function assertOpenedDatabaseIdentity(beforeOpen, state) {
  const opened = [];
  for (const [descriptor, identity] of openSqliteDescriptors()) {
    const previous = beforeOpen.get(descriptor);
    if (!previous || !sameIdentity(previous, identity)) opened.push(identity);
  }
  if (
    !opened.some((identity) => sameIdentity(state.databaseIdentity, identity))
    || opened.some((identity) => !sameIdentity(state.databaseIdentity, identity))
  ) {
    refusal(
      'BUILD_DATABASE_OPEN_IDENTITY_MISMATCH',
      'Prisma did not open only the SQLite inode exclusively created by this build',
    );
  }
}

function pathIsContained(root, target) {
  const relative = path.relative(root, target);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function secureDirectoryStats(directory, code) {
  let stats;
  try {
    stats = fs.lstatSync(directory, { bigint: true });
  } catch {
    refusal(code, 'Build database directory is missing');
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    refusal(code, 'Build database directory must be a real directory');
  }
  if ((Number(stats.mode) & 0o077) !== 0) {
    refusal(code, 'Build database directory must not be group or world accessible');
  }
  if (typeof process.getuid === 'function' && Number(stats.uid) !== process.getuid()) {
    refusal(code, 'Build database directory must be owned by the current build user');
  }
  return stats;
}

function assertNoSymlinkComponents(rootPath, targetPath) {
  if (!pathIsContained(rootPath, targetPath)) {
    refusal('BUILD_DATABASE_PATH_OUTSIDE_ROOT', 'Build database must be contained inside its owned root');
  }
  let current = rootPath;
  for (const component of path.relative(rootPath, targetPath).split(path.sep)) {
    current = path.join(current, component);
    let stats;
    try {
      stats = fs.lstatSync(current, { bigint: true });
    } catch {
      refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database ownership path is missing');
    }
    if (stats.isSymbolicLink()) {
      refusal('BUILD_DATABASE_SYMLINK_REJECTED', 'Build database path must not contain symbolic links');
    }
  }
}

function stateFor(workspace) {
  const state = workspaceState.get(workspace);
  if (!state || state.cleaned) {
    refusal(
      'BUILD_DATABASE_OWNERSHIP_REQUIRED',
      'Production build requires a live process-local database capability',
    );
  }
  return state;
}

function assertWorkspaceIdentity(workspace) {
  const state = stateFor(workspace);
  let rootStats;
  let databaseStats;
  let descriptorStats;
  let rootDescriptorStats;
  try {
    rootStats = fs.lstatSync(state.rootPath, { bigint: true });
    databaseStats = fs.lstatSync(state.databasePath, { bigint: true });
    descriptorStats = fs.fstatSync(state.descriptor, { bigint: true });
    rootDescriptorStats = fs.fstatSync(state.rootDescriptor, { bigint: true });
  } catch {
    refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database identity changed before use');
  }
  const canonicalTemporaryRoot = fs.realpathSync(os.tmpdir());
  const realRoot = fs.realpathSync(state.rootPath);
  const realDatabasePath = fs.realpathSync(state.databasePath);
  if (
    realRoot !== state.rootPath
    || path.dirname(realRoot) !== canonicalTemporaryRoot
    || !path.basename(realRoot).startsWith(BUILD_DATABASE_ROOT_PREFIX)
    || state.databasePath !== path.join(realRoot, BUILD_DATABASE_NAME)
    || fileURLToPath(workspace.databaseUrl) !== state.databasePath
    || realDatabasePath !== state.databasePath
    || !pathIsContained(realRoot, realDatabasePath)
  ) {
    refusal('BUILD_DATABASE_ROOT_UNSAFE', 'Build database is not inside its canonical owned temporary root');
  }
  assertNoSymlinkComponents(realRoot, realDatabasePath);
  if (
    rootStats.isSymbolicLink()
    || databaseStats.isSymbolicLink()
    || !databaseStats.isFile()
    || databaseStats.nlink !== 1n
    || !sameIdentity(state.rootIdentity, identityOf(rootStats))
    || !sameIdentity(state.rootIdentity, identityOf(rootDescriptorStats))
    || !sameIdentity(state.databaseIdentity, identityOf(databaseStats))
    || !sameIdentity(state.databaseIdentity, identityOf(descriptorStats))
    || (Number(databaseStats.mode) & 0o077) !== 0
    || (
      typeof process.getuid === 'function'
      && Number(databaseStats.uid) !== process.getuid()
    )
  ) {
    refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database identity changed before use');
  }
  return state;
}

function cleanupWorkspace(workspace, { afterQuarantineValidation } = {}) {
  if (cleanedWorkspaces.has(workspace)) return;
  const state = stateFor(workspace);
  const quarantineContainer = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), INVALIDATED_DATABASE_ROOT_PREFIX),
  );
  fs.chmodSync(quarantineContainer, 0o700);
  const quarantinePath = path.join(quarantineContainer, 'root');
  fs.renameSync(state.rootPath, quarantinePath);
  const restoreQuarantine = () => {
    try {
      fs.lstatSync(state.rootPath);
    } catch {
      fs.renameSync(quarantinePath, state.rootPath);
      fs.rmdirSync(quarantineContainer);
    }
  };
  let quarantinedRoot;
  let quarantinedDatabase;
  let entries;
  let sidecars;
  try {
    quarantinedRoot = fs.lstatSync(quarantinePath, { bigint: true });
    quarantinedDatabase = fs.lstatSync(
      path.join(quarantinePath, BUILD_DATABASE_NAME),
      { bigint: true },
    );
    entries = fs.readdirSync(quarantinePath).sort();
    sidecars = entries
      .filter((entry) => entry !== BUILD_DATABASE_NAME)
      .map((entry) => fs.lstatSync(path.join(quarantinePath, entry), { bigint: true }));
  } catch {
    restoreQuarantine();
    refusal(
      'BUILD_DATABASE_CLEANUP_REFUSED',
      'Atomic quarantine could not prove the complete build-owned database root',
    );
  }
  if (
    !sameIdentity(state.rootIdentity, identityOf(quarantinedRoot))
    || !sameIdentity(state.databaseIdentity, identityOf(quarantinedDatabase))
    || entries.some(
      (entry) => entry !== BUILD_DATABASE_NAME && !BUILD_DATABASE_SIDECARS.includes(entry),
    )
    || sidecars.some((stats) => (
      !stats.isFile()
      || stats.isSymbolicLink()
      || stats.nlink !== 1n
      || (Number(stats.mode) & 0o077) !== 0
      || (
        typeof process.getuid === 'function'
        && Number(stats.uid) !== process.getuid()
      )
    ))
  ) {
    restoreQuarantine();
    refusal(
      'BUILD_DATABASE_CLEANUP_REFUSED',
      'Atomic quarantine captured content not owned by this build',
    );
  }
  afterQuarantineValidation?.({ quarantinePath });
  // No pathname is trusted after quarantine validation. Invalidate the exact
  // retained inodes; OS temporary-directory reclamation removes the tombstone.
  fs.ftruncateSync(state.descriptor, 0);
  fs.fsyncSync(state.descriptor);
  fs.fchmodSync(state.descriptor, 0);
  fs.fchmodSync(state.rootDescriptor, 0);
  fs.closeSync(state.rootDescriptor);
  state.rootDescriptor = undefined;
  fs.closeSync(state.descriptor);
  state.descriptor = undefined;
  state.cleaned = true;
  workspaceState.delete(workspace);
  cleanedWorkspaces.add(workspace);
  return quarantinePath;
}

export function createBuildDatabaseWorkspace() {
  const canonicalTemporaryRoot = fs.realpathSync(os.tmpdir());
  const rootPath = fs.mkdtempSync(path.join(canonicalTemporaryRoot, BUILD_DATABASE_ROOT_PREFIX));
  fs.chmodSync(rootPath, 0o700);
  const rootStats = secureDirectoryStats(rootPath, 'BUILD_DATABASE_ROOT_UNSAFE');
  const rootDescriptor = fs.openSync(
    rootPath,
    fs.constants.O_RDONLY
      | (fs.constants.O_DIRECTORY ?? 0)
      | (fs.constants.O_NOFOLLOW ?? 0),
  );
  const databasePath = path.join(rootPath, BUILD_DATABASE_NAME);
  const descriptor = fs.openSync(
    databasePath,
    fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | fs.constants.O_RDWR
      | (fs.constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  const databaseStats = fs.fstatSync(descriptor, { bigint: true });
  const workspace = Object.freeze({
    rootPath,
    databasePath,
    databaseUrl: pathToFileURL(databasePath).href,
    cleanup(options) {
      return cleanupWorkspace(workspace, options);
    },
  });
  workspaceState.set(workspace, {
    rootPath,
    databasePath,
    rootIdentity: identityOf(rootStats),
    databaseIdentity: identityOf(databaseStats),
    rootDescriptor,
    descriptor,
    marker: randomBytes(32).toString('hex'),
    initialized: false,
    cleaned: false,
  });
  return workspace;
}

async function initializeWorkspace(workspace) {
  const state = assertWorkspaceIdentity(workspace);
  const migration = await ensureDatabaseMigrated({ databaseUrl: workspace.databaseUrl });
  if (!migration.ok) {
    refusal(
      'DATABASE_MIGRATION_FAILED',
      `Production build database migration failed: ${migration.error ?? migration.state}`,
    );
  }
  assertWorkspaceIdentity(workspace);
  const prisma = new PrismaClient({ datasources: { db: { url: workspace.databaseUrl } } });
  try {
    const beforeOpen = openSqliteDescriptors();
    await prisma.$connect();
    assertOpenedDatabaseIdentity(beforeOpen, state);
    assertWorkspaceIdentity(workspace);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${OWNERSHIP_TABLE}" (marker TEXT NOT NULL PRIMARY KEY)`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "${OWNERSHIP_TABLE}"`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${OWNERSHIP_TABLE}" (marker) VALUES (?)`,
      state.marker,
    );
  } finally {
    await prisma.$disconnect();
  }
  assertWorkspaceIdentity(workspace);
  state.initialized = true;
}

export async function assertProductionBuildDatabaseReady({
  workspace,
  beforeDatabaseOpen,
  connectDatabase,
} = {}) {
  const state = assertWorkspaceIdentity(workspace);
  if (!state.initialized) {
    refusal('BUILD_DATABASE_NOT_INITIALIZED', 'Build-owned database has not completed initialization');
  }
  await beforeDatabaseOpen?.();
  assertWorkspaceIdentity(workspace);

  const prisma = new PrismaClient({ datasources: { db: { url: workspace.databaseUrl } } });
  let result;
  try {
    const beforeOpen = openSqliteDescriptors();
    await (connectDatabase ? connectDatabase(prisma) : prisma.$connect());
    assertOpenedDatabaseIdentity(beforeOpen, state);
    let markers;
    try {
      markers = await prisma.$queryRawUnsafe(
        `SELECT marker FROM "${OWNERSHIP_TABLE}" ORDER BY marker`,
      );
    } catch {
      refusal(
        'BUILD_DATABASE_OPEN_IDENTITY_MISMATCH',
        'Opened database does not contain this build process ownership marker',
      );
    }
    if (
      markers.length !== 1
      || markers[0]?.marker !== state.marker
    ) {
      refusal(
        'BUILD_DATABASE_OPEN_IDENTITY_MISMATCH',
        'Opened database is not the process-local database created by this build',
      );
    }
    assertWorkspaceIdentity(workspace);
    const initialized = await initializeDatabaseConfig(prisma);
    if (!initialized.ok) {
      refusal(
        'DATABASE_INITIALIZATION_FAILED',
        `Production build database initialization failed for: ${[
          ...initialized.failures.map((failure) => failure.pragma),
          ...initialized.mismatches.map((mismatch) => mismatch.pragma),
        ].join(', ')}`,
      );
    }
    assertWorkspaceIdentity(workspace);
    const readiness = await databaseReadiness(prisma, { provider: 'sqlite' });
    if (!readiness.ready) {
      refusal(
        'DATABASE_NOT_READY',
        `Production build database is not ready: ${readiness.checks
          .filter((check) => !check.pass)
          .map((check) => check.name)
          .join(', ')}`,
      );
    }
    assertWorkspaceIdentity(workspace);
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    result = { provider: 'sqlite', checks: readiness.checks };
  } finally {
    await prisma.$disconnect();
  }
  assertWorkspaceIdentity(workspace);
  return result;
}

export async function prepareProductionBuildDatabase(options = {}) {
  const workspace = createBuildDatabaseWorkspace();
  try {
    await initializeWorkspace(workspace);
    const result = await assertProductionBuildDatabaseReady({ workspace, ...options });
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
  const installed = await prepareProductionBuildDatabase();
  installedWorkspace = installed;
  process.env.DATABASE_URL = installed.workspace.databaseUrl;
  const cleanup = () => {
    if (installedWorkspace) {
      installedWorkspace.workspace.cleanup();
      installedWorkspace = undefined;
    }
  };
  process.once('beforeExit', cleanup);
  process.once('exit', cleanup);
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      cleanup();
      process.exitCode = 128 + os.constants.signals[signal];
      process.kill(process.pid, signal);
    });
  }
  return installed.result;
}
