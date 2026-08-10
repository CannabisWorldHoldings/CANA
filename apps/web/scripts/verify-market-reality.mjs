#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

import { verifyOfficialMarketSnapshot } from '../src/lib/reality/reality-repository.mjs';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function assertDisposableDatabase(prisma) {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const expected = process.env.CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER ?? '';
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('CANA_REALITY_DISPOSABLE_DATABASE_REQUIRED');
  }
  if (
    process.env.NODE_ENV === 'production'
    || !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
    || !/^\d{10,}$/.test(expected)
  ) throw new Error('CANA_REALITY_DISPOSABLE_DATABASE_REQUIRED');
  const [identity] = await prisma.$queryRawUnsafe(
    'SELECT current_database() AS database, system_identifier::text AS system_identifier FROM pg_control_system()',
  );
  if (identity?.database !== parsed.pathname.slice(1) || identity?.system_identifier !== expected) {
    throw new Error('CANA_REALITY_DISPOSABLE_DATABASE_IDENTITY_MISMATCH');
  }
}

async function main() {
  const asOf = option('--as-of');
  if (!asOf) throw new Error('CANA_REALITY_EXPLICIT_AS_OF_REQUIRED');
  const prisma = new PrismaClient();
  try {
    await assertDisposableDatabase(prisma);
    return await verifyOfficialMarketSnapshot(prisma, {
      tenant: option('--tenant', 'orderweeddc.com'),
      asOf: new Date(asOf),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(JSON.stringify({ state: 'REFUSED', reason: String(error?.message ?? error).slice(0, 300) }));
    process.exitCode = 1;
  });
