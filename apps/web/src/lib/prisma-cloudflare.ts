import { getCloudflareContext } from '@opennextjs/cloudflare';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@cana/prisma-worker/wasm';
import { createRequestScopedPrismaProxy } from './prisma-cloudflare-runtime.mjs';

export const prisma = createRequestScopedPrismaProxy({
  getContext: getCloudflareContext,
  PrismaClient,
  PrismaPg,
  nodeEnv: process.env.NODE_ENV,
}) as PrismaClient;

export const databaseConfigured = Promise.resolve({
  ok: true,
  provider: 'postgresql',
  before: { provider: 'postgresql', pragmas: 'NOT_APPLICABLE' },
  after: { provider: 'postgresql', pragmas: 'NOT_APPLICABLE' },
  applied: [],
  failures: [],
  mismatches: [],
  classification: 'POSTGRESQL_CONFIGURATION_DECLARED',
  connectivity: 'NOT_ESTABLISHED',
});
