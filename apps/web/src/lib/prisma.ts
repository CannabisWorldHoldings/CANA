import path from 'node:path';
import { PrismaClient } from '../generated/prisma';
import { initializeDatabaseConfig } from './db-config.mjs';

if (!process.env.DATABASE_URL || process.env.DATABASE_URL === 'file:./dev.db') {
  process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), 'prisma/dev.db')}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaConfigured?: Promise<unknown>;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

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
