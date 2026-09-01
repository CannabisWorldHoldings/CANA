import { resolveCloudflarePrismaConnection } from './prisma-cloudflare-database-url.mjs';

export function createRequestScopedPrismaProxy({
  getContext,
  PrismaClient,
  PrismaPg,
  nodeEnv,
}) {
  if (typeof getContext !== 'function') throw new Error('CLOUDFLARE_CONTEXT_RESOLVER_REQUIRED');
  if (typeof PrismaClient !== 'function' || typeof PrismaPg !== 'function') {
    throw new Error('CLOUDFLARE_PRISMA_CONSTRUCTORS_REQUIRED');
  }
  const requestClients = new WeakMap();

  function currentPrisma() {
    let context;
    try {
      context = getContext();
    } catch {
      throw new Error('CLOUDFLARE_REQUEST_CONTEXT_REQUIRED');
    }
    if (!context || typeof context !== 'object') {
      throw new Error('CLOUDFLARE_REQUEST_CONTEXT_REQUIRED');
    }
    const existing = requestClients.get(context);
    if (existing) return existing;

    const { connectionString } = resolveCloudflarePrismaConnection(context.env);
    const adapter = new PrismaPg({ connectionString, max: 1 });
    const client = new PrismaClient({
      adapter,
      log: nodeEnv === 'production' ? ['error'] : ['error', 'warn'],
    });
    requestClients.set(context, client);
    return client;
  }

  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return undefined;
      const client = currentPrisma();
      const value = Reflect.get(client, property, client);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}
