import { PrismaClient } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  databaseProviderOf,
  databaseReadiness,
  initializeDatabaseConfig,
} from './db-config.mjs';

const BUILD_DATABASE_ROOT_PREFIX = 'cana-build-database-';
const BUILD_DATABASE_NAME = 'build.db';
const OWNERSHIP_PROOF_NAME = '.cana-build-database-ownership.json';

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

function lstatIdentity(target) {
  return identityOf(fs.lstatSync(target, { bigint: true }));
}

function pathIsContained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function parseLocalBuildDatabaseUrl(databaseUrl) {
  const rawPath = databaseUrl.slice('file:'.length).split(/[?#]/u, 1)[0].replaceAll('\\', '/');
  if (
    !rawPath.startsWith('/')
    || /(^|\/)(?:\.\.|%2e%2e|%2e\.|\.%2e)(?:\/|$)/iu.test(rawPath)
  ) {
    refusal('BUILD_DATABASE_URL_UNSAFE', 'Build database URL must not contain traversal');
  }

  let parsed;
  let databasePath;
  try {
    parsed = new URL(databaseUrl);
    if (
      parsed.protocol !== 'file:'
      || parsed.host !== ''
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.port !== ''
      || parsed.search !== ''
      || parsed.hash !== ''
    ) {
      refusal('BUILD_DATABASE_URL_UNSAFE', 'Build database must use a local file URL without unsupported components');
    }
    databasePath = fileURLToPath(parsed);
  } catch (error) {
    if (error instanceof ProductionBuildDatabaseError) throw error;
    refusal('BUILD_DATABASE_URL_UNSAFE', 'Build database URL is malformed');
  }

  if (
    !path.isAbsolute(databasePath)
    || databasePath.includes('\0')
    || databasePath.startsWith('//')
    || databasePath.startsWith('\\\\')
  ) {
    refusal('BUILD_DATABASE_URL_UNSAFE', 'Build database URL must resolve to an absolute local path');
  }
  return path.normalize(databasePath);
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
  const relative = path.relative(rootPath, targetPath);
  if (!pathIsContained(rootPath, targetPath) || relative === '') {
    refusal('BUILD_DATABASE_PATH_OUTSIDE_ROOT', 'Build database must be contained inside its owned root');
  }

  let current = rootPath;
  for (const component of relative.split(path.sep)) {
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

function readOwnershipProof({
  databasePath,
  buildDatabaseRoot,
  ownershipProof,
}) {
  if (!buildDatabaseRoot || !ownershipProof) {
    refusal(
      'BUILD_DATABASE_OWNERSHIP_REQUIRED',
      'Production build requires build-created database ownership proof',
    );
  }
  if (!path.isAbsolute(buildDatabaseRoot) || buildDatabaseRoot.includes('\0')) {
    refusal('BUILD_DATABASE_ROOT_UNSAFE', 'Build database root must be an absolute local path');
  }

  const normalizedRoot = path.normalize(buildDatabaseRoot);
  const rootStats = secureDirectoryStats(normalizedRoot, 'BUILD_DATABASE_ROOT_UNSAFE');
  const canonicalTemporaryRoot = fs.realpathSync(os.tmpdir());
  const realRoot = fs.realpathSync(normalizedRoot);
  if (
    realRoot !== normalizedRoot
    || path.dirname(realRoot) !== canonicalTemporaryRoot
    || !path.basename(realRoot).startsWith(BUILD_DATABASE_ROOT_PREFIX)
  ) {
    refusal('BUILD_DATABASE_ROOT_UNSAFE', 'Build database root is not a canonical build-owned temporary directory');
  }
  if (!pathIsContained(realRoot, databasePath)) {
    refusal('BUILD_DATABASE_PATH_OUTSIDE_ROOT', 'Build database is outside its owned temporary root');
  }

  assertNoSymlinkComponents(realRoot, databasePath);
  const realDatabasePath = fs.realpathSync(databasePath);
  if (realDatabasePath !== databasePath || !pathIsContained(realRoot, realDatabasePath)) {
    refusal('BUILD_DATABASE_SYMLINK_REJECTED', 'Build database must resolve inside its owned root without symbolic links');
  }

  const databaseStats = fs.lstatSync(databasePath, { bigint: true });
  if (!databaseStats.isFile() || databaseStats.isSymbolicLink() || databaseStats.nlink !== 1n) {
    refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database must be one exclusively owned regular file');
  }
  if ((Number(databaseStats.mode) & 0o077) !== 0) {
    refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database must not be group or world accessible');
  }
  if (typeof process.getuid === 'function' && Number(databaseStats.uid) !== process.getuid()) {
    refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database must be owned by the current build user');
  }

  const proofPath = path.join(realRoot, OWNERSHIP_PROOF_NAME);
  assertNoSymlinkComponents(realRoot, proofPath);
  const proofStats = fs.lstatSync(proofPath, { bigint: true });
  if (!proofStats.isFile() || proofStats.isSymbolicLink() || proofStats.nlink !== 1n) {
    refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database ownership proof must be a regular file');
  }
  if ((Number(proofStats.mode) & 0o077) !== 0) {
    refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database ownership proof must not be group or world accessible');
  }

  let proof;
  try {
    proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  } catch {
    refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database ownership proof is malformed');
  }
  const suppliedToken = String(ownershipProof);
  const recordedToken = String(proof.token ?? '');
  if (
    proof.schemaVersion !== 1
    || !/^[0-9a-f]{64}$/u.test(suppliedToken)
    || !/^[0-9a-f]{64}$/u.test(recordedToken)
    || !timingSafeEqual(Buffer.from(suppliedToken, 'hex'), Buffer.from(recordedToken, 'hex'))
    || proof.rootPath !== realRoot
    || proof.databasePath !== databasePath
    || !sameIdentity(proof.rootIdentity ?? {}, identityOf(rootStats))
    || !sameIdentity(proof.databaseIdentity ?? {}, identityOf(databaseStats))
  ) {
    refusal('BUILD_DATABASE_OWNERSHIP_INVALID', 'Build database ownership proof does not match the current build');
  }

  return {
    rootPath: realRoot,
    rootIdentity: identityOf(rootStats),
    databasePath,
    databaseIdentity: identityOf(databaseStats),
  };
}

function assertDatabaseIdentity(ownership) {
  let rootStats;
  let databaseStats;
  try {
    rootStats = fs.lstatSync(ownership.rootPath, { bigint: true });
    databaseStats = fs.lstatSync(ownership.databasePath, { bigint: true });
  } catch {
    refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database identity changed before use');
  }
  if (
    rootStats.isSymbolicLink()
    || databaseStats.isSymbolicLink()
    || !databaseStats.isFile()
    || databaseStats.nlink !== 1n
    || !sameIdentity(ownership.rootIdentity, identityOf(rootStats))
    || !sameIdentity(ownership.databaseIdentity, identityOf(databaseStats))
  ) {
    refusal('BUILD_DATABASE_IDENTITY_CHANGED', 'Build database identity changed before use');
  }
}

export function createBuildDatabaseWorkspace() {
  const canonicalTemporaryRoot = fs.realpathSync(os.tmpdir());
  const rootPath = fs.mkdtempSync(path.join(canonicalTemporaryRoot, BUILD_DATABASE_ROOT_PREFIX));
  fs.chmodSync(rootPath, 0o700);
  const rootStats = secureDirectoryStats(rootPath, 'BUILD_DATABASE_ROOT_UNSAFE');
  const databasePath = path.join(rootPath, BUILD_DATABASE_NAME);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(
    databasePath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | noFollow,
    0o600,
  );
  fs.closeSync(descriptor);
  const databaseStats = fs.lstatSync(databasePath, { bigint: true });
  const ownershipProof = randomBytes(32).toString('hex');
  fs.writeFileSync(
    path.join(rootPath, OWNERSHIP_PROOF_NAME),
    `${JSON.stringify({
      schemaVersion: 1,
      token: ownershipProof,
      rootPath,
      databasePath,
      rootIdentity: identityOf(rootStats),
      databaseIdentity: identityOf(databaseStats),
    })}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );

  let cleaned = false;
  return {
    rootPath,
    databasePath,
    databaseUrl: pathToFileURL(databasePath).href,
    ownershipProof,
    cleanup() {
      if (cleaned) return;
      const currentRootIdentity = lstatIdentity(rootPath);
      if (!sameIdentity(identityOf(rootStats), currentRootIdentity)) {
        refusal('BUILD_DATABASE_CLEANUP_REFUSED', 'Build database root identity changed before cleanup');
      }
      fs.rmSync(rootPath, { recursive: true, force: false });
      cleaned = true;
    },
  };
}

export async function assertProductionBuildDatabaseReady({
  databaseUrl = process.env.DATABASE_URL,
  disposable = process.env.CANA_BUILD_DATABASE_IS_DISPOSABLE,
  buildDatabaseRoot = process.env.CANA_BUILD_DATABASE_ROOT,
  ownershipProof = process.env.CANA_BUILD_DATABASE_OWNERSHIP_PROOF,
  beforeDatabaseOpen,
} = {}) {
  const normalizedUrl = String(databaseUrl ?? '').trim();
  if (!normalizedUrl) {
    throw new ProductionBuildDatabaseError(
      'DATABASE_URL_REQUIRED',
      'Production build requires an explicit DATABASE_URL',
    );
  }
  if (disposable !== '1') {
    throw new ProductionBuildDatabaseError(
      'DISPOSABLE_DATABASE_REQUIRED',
      'Production build requires an explicitly disposable database',
    );
  }

  const provider = databaseProviderOf(normalizedUrl);
  if (provider !== 'sqlite') {
    throw new ProductionBuildDatabaseError(
      'BUILD_DATABASE_PROVIDER_MISMATCH',
      `Disposable build database must match the current sqlite schema; received ${provider}`,
    );
  }

  const databasePath = parseLocalBuildDatabaseUrl(normalizedUrl);
  const ownership = readOwnershipProof({
    databasePath,
    buildDatabaseRoot,
    ownershipProof,
  });
  await beforeDatabaseOpen?.();
  assertDatabaseIdentity(ownership);

  const prisma = new PrismaClient({ datasources: { db: { url: normalizedUrl } } });
  let result;
  try {
    await prisma.$connect();
    assertDatabaseIdentity(ownership);
    const initialized = await initializeDatabaseConfig(prisma);
    if (!initialized.ok) {
      throw new ProductionBuildDatabaseError(
        'DATABASE_INITIALIZATION_FAILED',
        `Production build database initialization failed for: ${[
          ...initialized.failures.map((failure) => failure.pragma),
          ...initialized.mismatches.map((mismatch) => mismatch.pragma),
        ].join(', ')}`,
      );
    }
    assertDatabaseIdentity(ownership);
    const readiness = await databaseReadiness(prisma, { provider });
    if (!readiness.ready) {
      throw new ProductionBuildDatabaseError(
        'DATABASE_NOT_READY',
        `Production build database is not ready: ${readiness.checks
          .filter((check) => !check.pass)
          .map((check) => check.name)
        .join(', ')}`,
      );
    }
    assertDatabaseIdentity(ownership);
    result = { provider, checks: readiness.checks };
  } finally {
    await prisma.$disconnect();
  }
  assertDatabaseIdentity(ownership);
  return result;
}
