#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { PrismaClient } from '@prisma/client';

import { admitLiveMarketIdentity } from '../src/lib/reality/reality-repository.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
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
  const tenant = option('--tenant');
  const acquisitionEventId = option('--acquisition-event');
  const licenseNumber = option('--license');
  if (!tenant) throw new Error('CANA_REALITY_TENANT_REQUIRED');
  if (!acquisitionEventId) throw new Error('CANA_REALITY_ACQUISITION_EVENT_REQUIRED');
  if (!licenseNumber) throw new Error('CANA_REALITY_IDENTITY_LICENSE_REQUIRED');
  if (process.env.CANA_REALITY_IDENTITY_ADMISSION !== '1') {
    throw new Error('CANA_REALITY_IDENTITY_ADMISSION_CONFIRMATION_REQUIRED');
  }
  if (git('status', '--porcelain')) throw new Error('CANA_REALITY_IDENTITY_CLEAN_HEAD_REQUIRED');
  const prisma = new PrismaClient();
  try {
    await assertDisposableDatabase(prisma);
    const result = await admitLiveMarketIdentity(prisma, {
      tenant,
      acquisitionEventId,
      licenseNumber,
    });
    return Object.freeze({
      schema_version: 'cana-live-market-identity-admission-receipt/v1',
      repository_commit_sha: git('rev-parse', 'HEAD'),
      repository_tree_sha: git('rev-parse', 'HEAD^{tree}'),
      ...result,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    const candidateCode = String(error?.code ?? error?.message ?? '');
    console.error(JSON.stringify({
      schema_version: 'cana-live-market-identity-admission-receipt/v1',
      state: 'REFUSED',
      error_code: /^CANA_[A-Z0-9_]+$/.test(candidateCode)
        ? candidateCode
        : 'CANA_REALITY_IDENTITY_ADMISSION_UNEXPECTED_FAILURE',
      production_mutations: 0,
      public_mutations: 0,
    }));
    process.exitCode = 1;
  });
