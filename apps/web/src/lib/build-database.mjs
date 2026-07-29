import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  databaseReadiness,
  initializeDatabaseConfig,
} from './db-config.mjs';

const BUILD_DATABASE_ROOT_PREFIX = 'cana-build-database-';
const INVALIDATED_DATABASE_ROOT_PREFIX = 'cana-invalidated-database-';
const BUILD_DATABASE_NAME = 'build.db';
const BUILD_DATABASE_SIDECARS = [`${BUILD_DATABASE_NAME}-shm`, `${BUILD_DATABASE_NAME}-wal`];
const OWNERSHIP_TABLE = '__cana_build_database_ownership';
const SQLITE_HEADER = Buffer.from('SQLite format 3\0');
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS_ROOT = path.join(WEB_ROOT, 'prisma/migrations');
const MIGRATION_TABLE_SQL = `
  CREATE TABLE "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )
`;
const DESCRIPTOR_CLEANUP_SCRIPT = `
import json
import os
import stat

root_fd, container_fd, temporary_fd, database_fd = 3, 4, 5, 6
allowed = {"build.db", "build.db-shm", "build.db-wal"}
entries = set(os.listdir(root_fd))
if "build.db" not in entries or entries - allowed:
    raise RuntimeError("owned root contains unexpected entries")

database = os.fstat(database_fd)
named_database = os.stat("build.db", dir_fd=root_fd, follow_symlinks=False)
if (
    not stat.S_ISREG(named_database.st_mode)
    or named_database.st_nlink != 1
    or named_database.st_uid != os.getuid()
    or named_database.st_mode & 0o077
    or (database.st_dev, database.st_ino) != (named_database.st_dev, named_database.st_ino)
):
    raise RuntimeError("owned database identity changed before descriptor cleanup")

for name in entries - {"build.db"}:
    sidecar = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    if (
        not stat.S_ISREG(sidecar.st_mode)
        or sidecar.st_nlink != 1
        or sidecar.st_uid != os.getuid()
        or sidecar.st_mode & 0o077
    ):
        raise RuntimeError("database sidecar is not build owned")

os.ftruncate(database_fd, 0)
os.fsync(database_fd)
os.fchmod(database_fd, 0)
for name in sorted(entries - {"build.db"}):
    os.unlink(name, dir_fd=root_fd)
os.unlink("build.db", dir_fd=root_fd)

root = os.fstat(root_fd)
root_names = []
for name in os.listdir(container_fd):
    candidate = os.stat(name, dir_fd=container_fd, follow_symlinks=False)
    if (candidate.st_dev, candidate.st_ino) == (root.st_dev, root.st_ino):
        root_names.append(name)
if len(root_names) != 1:
    raise RuntimeError("owned root moved outside its quarantine container")
os.rmdir(root_names[0], dir_fd=container_fd)

removed_container = False
if not os.listdir(container_fd):
    container = os.fstat(container_fd)
    container_names = []
    for name in os.listdir(temporary_fd):
        candidate = os.stat(name, dir_fd=temporary_fd, follow_symlinks=False)
        if (candidate.st_dev, candidate.st_ino) == (container.st_dev, container.st_ino):
            container_names.append(name)
    if len(container_names) != 1:
        raise RuntimeError("quarantine container moved outside the temporary root")
    os.rmdir(container_names[0], dir_fd=temporary_fd)
    removed_container = True

print(json.dumps({"removedContainer": removed_container}))
`;
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

function openFileDescriptors() {
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
      if (!stats.isFile()) continue;
      let sqlite = false;
      if (stats.size >= BigInt(SQLITE_HEADER.length)) {
        const header = Buffer.alloc(SQLITE_HEADER.length);
        sqlite = (
          fs.readSync(descriptor, header, 0, header.length, 0) === header.length
          && header.equals(SQLITE_HEADER)
        );
      }
      descriptors.set(descriptor, { identity: identityOf(stats), sqlite });
    } catch {
      // Descriptors can close between directory enumeration and fstat.
    }
  }
  return descriptors;
}

function assertOpenedDatabaseIdentity(beforeOpen, state) {
  const opened = [];
  for (const [descriptor, candidate] of openFileDescriptors()) {
    const previous = beforeOpen.get(descriptor);
    if (!previous || !sameIdentity(previous.identity, candidate.identity)) {
      opened.push(candidate);
    }
  }
  if (
    !opened.some(({ identity }) => sameIdentity(state.databaseIdentity, identity))
    || opened.some(({ identity, sqlite }) => (
      sqlite && !sameIdentity(state.databaseIdentity, identity)
    ))
  ) {
    refusal(
      'BUILD_DATABASE_OPEN_IDENTITY_MISMATCH',
      'Prisma did not open only the SQLite inode exclusively created by this build',
    );
  }
}

function buildMigrations() {
  return fs.readdirSync(MIGRATIONS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const migrationPath = path.join(MIGRATIONS_ROOT, entry.name, 'migration.sql');
      const stats = fs.lstatSync(migrationPath, { bigint: true });
      if (!stats.isFile() || stats.isSymbolicLink()) {
        refusal(
          'BUILD_DATABASE_MIGRATION_INVALID',
          `Build migration ${entry.name} must be a tracked regular file`,
        );
      }
      const sql = fs.readFileSync(migrationPath, 'utf8');
      return {
        name: entry.name,
        sql,
        statements: sql
          .split(/;\s*(?:\r?\n|$)/u)
          .map((statement) => statement.trim())
          .filter(Boolean),
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function migrateOwnedBuildDatabase(prisma) {
  await prisma.$executeRawUnsafe(MIGRATION_TABLE_SQL);
  for (const migration of buildMigrations()) {
    for (const statement of migration.statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "logs",
         "rolled_back_at", "started_at", "applied_steps_count")
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, NULL, NULL, CURRENT_TIMESTAMP, 1)`,
      randomBytes(16).toString('hex'),
      migration.checksum,
      migration.name,
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

function singleConnectionDatabaseUrl(workspace) {
  const databaseUrl = new URL(workspace.databaseUrl);
  databaseUrl.searchParams.set('connection_limit', '1');
  return databaseUrl.href;
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

function setWorkspacePathLock(state, locked) {
  fs.fchmodSync(state.rootDescriptor, locked ? 0o500 : 0o700);
  state.pathLocked = locked;
}

function assertOwnedSidecars(state) {
  if (state.sidecars.size === 0) return;
  const expected = new Set([BUILD_DATABASE_NAME, ...BUILD_DATABASE_SIDECARS]);
  const entries = fs.readdirSync(state.rootPath);
  if (
    entries.length !== expected.size
    || entries.some((entry) => !expected.has(entry))
  ) {
    refusal(
      'BUILD_DATABASE_IDENTITY_CHANGED',
      'Locked build database root contains content outside its owned database lifecycle',
    );
  }
  for (const [sidecarPath, sidecar] of state.sidecars) {
    let named;
    let retained;
    try {
      named = fs.lstatSync(sidecarPath, { bigint: true });
      retained = fs.fstatSync(sidecar.descriptor, { bigint: true });
    } catch {
      refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database sidecar identity changed');
    }
    if (
      !named.isFile()
      || named.isSymbolicLink()
      || named.nlink !== 1n
      || !sameIdentity(sidecar.identity, identityOf(named))
      || !sameIdentity(sidecar.identity, identityOf(retained))
      || (Number(named.mode) & 0o077) !== 0
      || (
        typeof process.getuid === 'function'
        && Number(named.uid) !== process.getuid()
      )
    ) {
      refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database sidecar identity changed');
    }
  }
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
    || (Number(rootStats.mode) & 0o777) !== (state.pathLocked ? 0o500 : 0o700)
    || (Number(databaseStats.mode) & 0o077) !== 0
    || (
      typeof process.getuid === 'function'
      && Number(databaseStats.uid) !== process.getuid()
    )
  ) {
    refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database identity changed before use');
  }
  assertOwnedSidecars(state);
  return state;
}

function retainBuildDatabaseSidecars(state) {
  const retained = new Map();
  try {
    for (const name of BUILD_DATABASE_SIDECARS) {
      const sidecarPath = path.join(state.rootPath, name);
      let descriptor;
      try {
        descriptor = fs.openSync(
          sidecarPath,
          fs.constants.O_CREAT
            | fs.constants.O_EXCL
            | fs.constants.O_RDWR
            | (fs.constants.O_NOFOLLOW ?? 0),
          0o600,
        );
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        descriptor = fs.openSync(
          sidecarPath,
          fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0),
        );
      }
      retained.set(sidecarPath, { descriptor, identity: null });
      const stats = fs.fstatSync(descriptor, { bigint: true });
      const named = fs.lstatSync(sidecarPath, { bigint: true });
      if (
        !stats.isFile()
        || named.isSymbolicLink()
        || named.nlink !== 1n
        || !sameIdentity(identityOf(stats), identityOf(named))
        || (Number(named.mode) & 0o077) !== 0
        || (
          typeof process.getuid === 'function'
          && Number(named.uid) !== process.getuid()
        )
      ) {
        refusal(
          'BUILD_DATABASE_IDENTITY_CHANGED',
          'Build database sidecar was not exclusively owned by this build',
        );
      }
      retained.get(sidecarPath).identity = identityOf(stats);
    }
  } catch (error) {
    for (const sidecar of retained.values()) fs.closeSync(sidecar.descriptor);
    throw error;
  }
  state.sidecars = retained;
  setWorkspacePathLock(state, true);
}

function descriptorCleanupPython() {
  try {
    const resolved = fs.realpathSync('/usr/bin/python3');
    const stats = fs.lstatSync(resolved, { bigint: true });
    if (
      !stats.isFile()
      || (Number(stats.mode) & 0o022) !== 0
      || (Number(stats.mode) & 0o111) === 0
      || (typeof process.getuid === 'function' && Number(stats.uid) !== 0)
    ) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function removeOwnedQuarantine(state, quarantineDescriptor) {
  try {
    const output = execFileSync(state.cleanupPython, ['-I', '-c', DESCRIPTOR_CLEANUP_SCRIPT], {
      encoding: 'utf8',
      env: {},
      stdio: [
        'ignore',
        'pipe',
        'pipe',
        state.rootDescriptor,
        quarantineDescriptor,
        state.temporaryRootDescriptor,
        state.descriptor,
      ],
    });
    return {
      executed: true,
      removedContainer: JSON.parse(output).removedContainer === true,
    };
  } catch {
    return { executed: false, removedContainer: false };
  }
}

function cleanupWorkspace(workspace, { afterQuarantineValidation } = {}) {
  if (cleanedWorkspaces.has(workspace)) return;
  const state = stateFor(workspace);
  try {
    assertWorkspaceIdentity(workspace);
  } catch {
    refusal(
      'BUILD_DATABASE_CLEANUP_REFUSED',
      'Cleanup refused a changed build database identity before quarantine',
    );
  }
  const quarantineContainer = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), INVALIDATED_DATABASE_ROOT_PREFIX),
  );
  fs.chmodSync(quarantineContainer, 0o700);
  const quarantineDescriptor = fs.openSync(
    quarantineContainer,
    fs.constants.O_RDONLY
      | (fs.constants.O_DIRECTORY ?? 0)
      | (fs.constants.O_NOFOLLOW ?? 0),
  );
  const quarantinePath = path.join(quarantineContainer, 'root');
  setWorkspacePathLock(state, false);
  fs.renameSync(state.rootPath, quarantinePath);
  const restoreQuarantine = () => {
    let restored = false;
    try {
      fs.lstatSync(state.rootPath);
    } catch {
      fs.renameSync(quarantinePath, state.rootPath);
      restored = true;
    }
    if (restored) setWorkspacePathLock(state, true);
    fs.closeSync(quarantineDescriptor);
    if (restored) {
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
  const removal = removeOwnedQuarantine(state, quarantineDescriptor);
  let cleanupFailed = false;
  if (!removal.executed) {
    // The retained descriptors are the only authority after quarantine
    // validation. If descriptor-relative unlink is unavailable, invalidate
    // those exact inodes and leave the tombstone for OS temp reclamation.
    fs.ftruncateSync(state.descriptor, 0);
    fs.fsyncSync(state.descriptor);
    fs.fchmodSync(state.descriptor, 0);
    for (const sidecar of state.sidecars.values()) {
      fs.ftruncateSync(sidecar.descriptor, 0);
      fs.fsyncSync(sidecar.descriptor);
      fs.fchmodSync(sidecar.descriptor, 0);
    }
    fs.fchmodSync(state.rootDescriptor, 0);
    cleanupFailed = true;
  }
  for (const sidecar of state.sidecars.values()) fs.closeSync(sidecar.descriptor);
  state.sidecars.clear();
  fs.closeSync(quarantineDescriptor);
  fs.closeSync(state.rootDescriptor);
  state.rootDescriptor = undefined;
  fs.closeSync(state.temporaryRootDescriptor);
  state.temporaryRootDescriptor = undefined;
  fs.closeSync(state.descriptor);
  state.descriptor = undefined;
  state.cleaned = true;
  workspaceState.delete(workspace);
  cleanedWorkspaces.add(workspace);
  if (cleanupFailed) {
    refusal(
      'BUILD_DATABASE_CLEANUP_FAILED',
      'Descriptor-relative cleanup failed after invalidating the exact build-owned inodes',
    );
  }
  return {
    removed: removal.executed,
    removedContainer: removal.removedContainer,
    quarantinePath,
  };
}

export function createBuildDatabaseWorkspace() {
  const canonicalTemporaryRoot = fs.realpathSync(os.tmpdir());
  const cleanupPython = descriptorCleanupPython();
  if (!cleanupPython) {
    refusal(
      'BUILD_DATABASE_CLEANUP_UNAVAILABLE',
      'Build database creation requires a trusted descriptor-relative cleanup runtime',
    );
  }
  const temporaryRootDescriptor = fs.openSync(
    canonicalTemporaryRoot,
    fs.constants.O_RDONLY
      | (fs.constants.O_DIRECTORY ?? 0)
      | (fs.constants.O_NOFOLLOW ?? 0),
  );
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
  fs.fchmodSync(rootDescriptor, 0o500);
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
    cleanupPython,
    temporaryRootDescriptor,
    rootDescriptor,
    descriptor,
    marker: randomBytes(32).toString('hex'),
    sidecars: new Map(),
    pathLocked: true,
    initialized: false,
    cleaned: false,
  });
  return workspace;
}

async function initializeWorkspace(workspace, beforeInitialDatabaseOpen) {
  const state = assertWorkspaceIdentity(workspace);
  await beforeInitialDatabaseOpen?.(workspace);
  assertWorkspaceIdentity(workspace);
  const prisma = new PrismaClient({
    datasources: { db: { url: singleConnectionDatabaseUrl(workspace) } },
  });
  let result;
  try {
    const beforeOpen = openFileDescriptors();
    await prisma.$connect();
    assertOpenedDatabaseIdentity(beforeOpen, state);
    setWorkspacePathLock(state, false);
    assertWorkspaceIdentity(workspace);
    try {
      await migrateOwnedBuildDatabase(prisma);
    } catch (error) {
      refusal(
        'DATABASE_MIGRATION_FAILED',
        `Production build database migration failed: ${error?.message ?? error}`,
      );
    }
    assertWorkspaceIdentity(workspace);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${OWNERSHIP_TABLE}" (marker TEXT NOT NULL PRIMARY KEY)`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "${OWNERSHIP_TABLE}"`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${OWNERSHIP_TABLE}" (marker) VALUES (?)`,
      state.marker,
    );
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
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    result = { provider: 'sqlite', checks: readiness.checks };
    state.result = result;
    state.initialized = true;
  } finally {
    await prisma.$disconnect();
  }
  retainBuildDatabaseSidecars(state);
  assertWorkspaceIdentity(workspace);
  return result;
}

export async function assertProductionBuildDatabaseReady({
  workspace,
  beforeDatabaseOpen,
} = {}) {
  const state = assertWorkspaceIdentity(workspace);
  if (!state.initialized) {
    refusal('BUILD_DATABASE_NOT_INITIALIZED', 'Build-owned database has not completed initialization');
  }
  await beforeDatabaseOpen?.();
  assertWorkspaceIdentity(workspace);

  const prisma = new PrismaClient({
    datasources: { db: { url: singleConnectionDatabaseUrl(workspace) } },
  });
  try {
    const beforeOpen = openFileDescriptors();
    await prisma.$connect();
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
    return { provider: 'sqlite', checks: readiness.checks };
  } finally {
    await prisma.$disconnect();
  }
}

export async function prepareProductionBuildDatabase(options = {}) {
  const workspace = createBuildDatabaseWorkspace();
  try {
    const result = await initializeWorkspace(workspace, options.beforeInitialDatabaseOpen);
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
      try {
        cleanup();
      } finally {
        process.exit(128 + os.constants.signals[signal]);
      }
    });
  }
  return installed.result;
}
