import { getCloudflareContext } from '@opennextjs/cloudflare';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@cana/prisma-worker/wasm';

const requestClients = new WeakMap<object, PrismaClient>();

function currentPrisma(): PrismaClient {
  let context;
  try {
    context = getCloudflareContext();
  } catch {
    throw new Error('CLOUDFLARE_REQUEST_CONTEXT_REQUIRED');
  }

  const databaseUrl = (context.env as typeof context.env & {
    DATABASE_URL?: string;
  }).DATABASE_URL;
  if (!databaseUrl) throw new Error('CLOUDFLARE_DATABASE_URL_REQUIRED');

  const requestKey = context as object;
  const existing = requestClients.get(requestKey);
  if (existing) return existing;

  const adapter = new PrismaPg({ connectionString: databaseUrl, max: 1 });
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });
  requestClients.set(requestKey, client);
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    if (property === 'then') return undefined;
    const client = currentPrisma();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export const databaseConfigured = Promise.resolve({
  ok: true,
  provider: 'postgresql',
  before: { provider: 'postgresql', pragmas: 'NOT_APPLICABLE' },
  after: { provider: 'postgresql', pragmas: 'NOT_APPLICABLE' },
  applied: [],
  failures: [],
  mismatches: [],
  classification: 'POSTGRESQL_POSTGIS_CANONICAL',
});
