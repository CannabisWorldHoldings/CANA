#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { PrismaClient } from '@prisma/client';

import { ENTITY_NORMALIZATION_VERSION } from '../src/lib/reality/entity-resolution.mjs';
import { MARKET_CLAIM_COURT_VERSION } from '../src/lib/reality/market-claim-court.mjs';
import { assertLiveAcquisitionAuthority } from '../src/lib/reality/live-abca-adapter.mjs';
import {
  acquireLiveMarketReality,
  createPrismaAcquisitionStore,
} from '../src/lib/reality/live-reality-acquisition.mjs';
import { OFFICIAL_SOURCE_SCHEMA_VERSION } from '../src/lib/reality/official-source-snapshot.mjs';
import { REALITY_COMPILER_VERSION } from '../src/lib/reality/reality-compiler.mjs';

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
  const asOf = option('--as-of');
  if (!tenant) throw new Error('CANA_REALITY_TENANT_REQUIRED');
  if (!asOf) throw new Error('CANA_REALITY_EXPLICIT_AS_OF_REQUIRED');
  assertLiveAcquisitionAuthority({ env: process.env });
  if (git('status', '--porcelain')) throw new Error('CANA_LIVE_REALITY_CLEAN_HEAD_REQUIRED');
  const versions = {
    repositoryCommitSha: git('rev-parse', 'HEAD'),
    repositoryTreeSha: git('rev-parse', 'HEAD^{tree}'),
    adapterVersion: 'dc-abca-live-v1',
    parserVersion: OFFICIAL_SOURCE_SCHEMA_VERSION,
    compilerVersion: REALITY_COMPILER_VERSION,
    entityResolverVersion: ENTITY_NORMALIZATION_VERSION,
    authorityPolicyVersion: 'dc-abca-authority-v1',
    freshnessPolicyVersion: 'dc-abca-freshness-v1',
    verificationCourtVersion: MARKET_CLAIM_COURT_VERSION,
  };
  const prisma = new PrismaClient();
  try {
    await assertDisposableDatabase(prisma);
    return await acquireLiveMarketReality(createPrismaAcquisitionStore(prisma), {
      tenant,
      attemptId: `owner-live-${randomUUID()}`,
      asOf,
      env: process.env,
      versions,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((result) => {
    console.log(JSON.stringify(result));
    if (result.state !== 'COMPLETED') process.exitCode = 1;
  })
  .catch((error) => {
    console.error(JSON.stringify({
      schema_version: 'cana-live-reality-acquisition-receipt/v1',
      state: 'REFUSED',
      error_code: error?.code ?? String(error?.message ?? error).slice(0, 160),
      external_effects: 0,
      production_mutations: 0,
    }));
    process.exitCode = 1;
  });
