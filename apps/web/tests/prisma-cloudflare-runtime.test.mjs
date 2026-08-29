import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestScopedPrismaProxy } from '../src/lib/prisma-cloudflare-runtime.mjs';

test('Worker Prisma is request scoped, prefers Hyperdrive, and passes PrismaPg to PrismaClient', () => {
  const first = { env: { HYPERDRIVE: { connectionString: 'postgresql://worker@127.0.0.1:5432/cana' } } };
  const second = { env: { HYPERDRIVE: { connectionString: 'postgresql://worker@127.0.0.1:5432/cana' } } };
  let current = first;
  const adapters = [];
  const clients = [];
  class Adapter {
    constructor(options) { this.options = options; adapters.push(this); }
  }
  class Client {
    constructor(options) { this.options = options; clients.push(this); this.marker = clients.length; }
    query() { return this.marker; }
  }
  const proxy = createRequestScopedPrismaProxy({
    getContext: () => current,
    PrismaClient: Client,
    PrismaPg: Adapter,
    nodeEnv: 'test',
  });

  assert.equal(proxy.query(), 1);
  assert.equal(proxy.query(), 1, 'same request context must reuse one client');
  current = second;
  assert.equal(proxy.query(), 2, 'different request context must receive a different client');
  assert.equal(clients.length, 2);
  assert.equal(adapters.length, 2);
  assert.equal(adapters[0].options.connectionString, first.env.HYPERDRIVE.connectionString);
  assert.equal(clients[0].options.adapter, adapters[0]);
});

test('Worker Prisma preserves strict DATABASE_URL fallback until a Hyperdrive binding is configured', () => {
  const strict = 'postgresql://worker:secret@example.invalid/cana?sslmode=require&sslaccept=strict';
  const contexts = [{ env: { DATABASE_URL: strict } }];
  const seen = [];
  class Adapter { constructor(options) { seen.push(options.connectionString); } }
  class Client { constructor() { this.ok = true; } }
  const proxy = createRequestScopedPrismaProxy({
    getContext: () => contexts[0],
    PrismaClient: Client,
    PrismaPg: Adapter,
    nodeEnv: 'test',
  });
  assert.equal(proxy.ok, true);
  assert.match(seen[0], /sslmode=verify-full/);
});
