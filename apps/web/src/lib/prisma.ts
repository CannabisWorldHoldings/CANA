import { PrismaClient } from '@prisma/client';
import { initializeDatabaseConfig } from './db-config.mjs';

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
  prismaConfigured: Promise<unknown> | undefined;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // QUERY LOGGING IS NOT FREE. This was previously ['query', 'error', 'warn']
    // unconditionally, writing a log line for every statement — measurable overhead
    // in exactly the contended-burst case this system has to survive, and a path for
    // record values to reach production logs.
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

/**
 * APPLY THE SOURCE-CONTROLLED DATABASE CONFIGURATION AT STARTUP.
 *
 * WAL was previously enabled by running a PRAGMA by hand against the local dev.db.
 * That setting lives inside the database FILE, which is untracked — so a clean
 * clone, a Drive reconstruction, a regenerated database or a deployment would all
 * have silently run without it, and the concurrency behaviour proven locally would
 * not have existed anywhere else. A configuration that exists only in an untracked
 * file is not configuration; it is a local accident that happens to be load-bearing.
 *
 * Fired once per process and deliberately NOT awaited by request paths: a tuning
 * setting must never gate the first request, nor take the application down when it
 * fails. The promise is exported so tests and a health check can assert the outcome
 * rather than assume it.
 */
export const databaseConfigured: Promise<unknown> =
  globalForPrisma.prismaConfigured ??
  initializeDatabaseConfig(prisma, {
    preservePersistentPragmas: process.env.CANA_PRESERVE_SQLITE_FILE_BYTES === '1',
  }).catch((error: unknown) => ({
    ok: false,
    failures: [{ pragma: 'initialization', error: String(error).slice(0, 200) }],
  }));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaConfigured = databaseConfigured;
}
