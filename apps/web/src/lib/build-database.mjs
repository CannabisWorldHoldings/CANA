import { PrismaClient } from '@prisma/client';
import {
  databaseProviderOf,
  databaseReadiness,
  initializeDatabaseConfig,
} from './db-config.mjs';

export class ProductionBuildDatabaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProductionBuildDatabaseError';
    this.code = code;
  }
}

export async function assertProductionBuildDatabaseReady({
  databaseUrl = process.env.DATABASE_URL,
  disposable = process.env.CANA_BUILD_DATABASE_IS_DISPOSABLE,
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

  const prisma = new PrismaClient({ datasources: { db: { url: normalizedUrl } } });
  try {
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
    return { provider, checks: readiness.checks };
  } finally {
    await prisma.$disconnect();
  }
}
