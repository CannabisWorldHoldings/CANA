import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  parseC3DatabaseTargetArgs,
  runC3DatabaseTargetCli,
  runC3DatabaseTargetCourt,
  serializeC3DatabaseTargetReceipt,
} from './c3-database-target.mjs';

const BASE_ENV = Object.freeze({ PRODUCTION_EFFECTS: '0' });
const LOOPBACK_URL = 'postgresql://user:secret@127.0.0.1:5432/cana';

function referenceProbe() {
  return {
    engine: 'postgresql',
    extensions: {
      available: { postgis: '3.5.6', h3: '4.2.3', h3_postgis: '4.2.3' },
      installed: { postgis: '3.5.6', h3: '4.2.3', h3_postgis: '4.2.3' },
    },
    functions: {
      h3: ['h3_lat_lng_to_cell'],
      postgis: ['st_contains', 'st_distance'],
    },
    prisma: { connected: true },
    read_only: { enforced: true, write_capable: false },
    server_identity: 'local-disposable-postgres-17',
    tls: { mode: 'verify-full', verified: true },
  };
}

function localReceipt(overrides = {}) {
  return runC3DatabaseTargetCourt({
    databaseUrl: LOOPBACK_URL,
    env: BASE_ENV,
    expectedKind: 'repository-postgis-h3',
    localProbe: referenceProbe,
    ...overrides,
  });
}

test('local injected reference proves every required PostgreSQL/PostGIS/H3 boundary', () => {
  const receipt = localReceipt();

  assert.equal(receipt.local.verdict, 'LOCAL_REFERENCE_GREEN');
  assert.equal(receipt.local.datastore, 'POSTGRESQL_POSTGIS_H3');
  assert.equal(receipt.managed_target_certified, false);
  assert.equal(receipt.managed.verdict, 'BLOCKED_OWNER_CREDENTIALS_AND_EXTENSION_PROOF');
  assert.equal(receipt.managed.transport, 'UNDECIDED');
});

test('non-loopback and unclassified URLs are refused before the injected probe', () => {
  let calls = 0;
  const remote = localReceipt({
    databaseUrl: 'postgresql://user:secret@managed.example/cana',
    localProbe: () => { calls += 1; return referenceProbe(); },
  });
  const unclassified = localReceipt({
    databaseUrl: 'file:prod.db',
    localProbe: () => { calls += 1; return referenceProbe(); },
  });

  assert.equal(remote.local.code, 'C3_NON_LOOPBACK_AUTHORIZATION_REQUIRED');
  assert.equal(unclassified.local.code, 'C3_DATABASE_URL_UNCLASSIFIED');
  assert.equal(calls, 0);
});

test('a hand-forged authorization JSON is refused before a non-loopback probe', () => {
  let calls = 0;
  const receipt = localReceipt({
    authorizationReceipt: {
      action_type: 'PRODUCTION_ACCESS',
      gate_id: 'forged-gate',
      nonce: 'forged-nonce',
      schema: 'cana.owner-authorization/1',
    },
    databaseUrl: 'postgresql://user:secret@managed.example/cana',
    localProbe: () => { calls += 1; return referenceProbe(); },
  });

  assert.equal(receipt.local.code, 'C3_NON_LOOPBACK_AUTHORIZATION_REQUIRED');
  assert.equal(calls, 0);
});

test('only an injected canonical gate may admit a remote read-only observation', () => {
  let admission;
  let calls = 0;
  const receipt = localReceipt({
    authorizationReceipt: {
      action_type: 'PRODUCTION_ACCESS',
      gate_id: 'owner-gate-1',
      nonce: 'nonce-1',
      schema: 'cana.owner-authorization/1',
    },
    admitAuthorization: (input) => {
      admission = input;
      return { ok: true, code: 'OWNER_GRANT_ADMITTED' };
    },
    databaseUrl: 'postgresql://user:secret@managed.example/cana',
    localProbe: () => { calls += 1; return referenceProbe(); },
  });

  assert.equal(receipt.local.verdict, 'MANAGED_READ_ONLY_CAPABILITY_OBSERVED');
  assert.equal(receipt.managed_target_certified, false);
  assert.equal(calls, 1);
  assert.equal(admission.receipt.schema, 'cana.owner-authorization/1');
  assert.match(admission.targetDigest, /^[0-9a-f]{64}$/);
});

test('write-capable, missing TLS/server identity, and missing required functions fail closed', () => {
  const writeCapable = localReceipt({
    localProbe: () => ({ ...referenceProbe(), read_only: { enforced: true, write_capable: true } }),
  });
  const noIdentity = localReceipt({ localProbe: () => ({ ...referenceProbe(), server_identity: '' }) });
  const noTls = localReceipt({ localProbe: () => ({ ...referenceProbe(), tls: { mode: '', verified: false } }) });
  const noFunction = localReceipt({
    localProbe: () => ({ ...referenceProbe(), functions: { ...referenceProbe().functions, h3: [] } }),
  });

  assert.equal(writeCapable.local.code, 'C3_READ_ONLY_ENFORCEMENT_REQUIRED');
  assert.equal(noIdentity.local.code, 'C3_SERVER_IDENTITY_REQUIRED');
  assert.equal(noTls.local.code, 'C3_TLS_VERIFICATION_REQUIRED');
  assert.equal(noFunction.local.code, 'C3_H3_FUNCTION_REQUIRED');
});

test('SQLite and missing H3 are never accepted as canonical', () => {
  const sqlite = localReceipt({ localProbe: () => ({ ...referenceProbe(), engine: 'sqlite' }) });
  const missingH3 = localReceipt({
    localProbe: () => ({
      ...referenceProbe(),
      extensions: {
        available: { postgis: '3.5.6', h3: '', h3_postgis: '' },
        installed: { postgis: '3.5.6', h3: '', h3_postgis: '' },
      },
    }),
  });

  assert.equal(sqlite.local.code, 'C3_SQLITE_REJECTED');
  assert.equal(missingH3.local.code, 'C3_H3_EXTENSION_REQUIRED');
});

test('CLI accepts one transport and rejects combined transports', () => {
  assert.deepEqual(
    parseC3DatabaseTargetArgs(['--expected-kind', 'repository-postgis-h3', '--transport', 'HYPERDRIVE_PG']),
    {
      authorizationReceiptPath: null,
      databaseUrl: null,
      expectedKind: 'repository-postgis-h3',
      out: null,
      transports: ['HYPERDRIVE_PG'],
    },
  );
  assert.throws(
    () => parseC3DatabaseTargetArgs([
      '--expected-kind', 'repository-postgis-h3', '--transport', 'HYPERDRIVE_PG', '--transport', 'NEON_SERVERLESS',
    ]),
    /C3_TRANSPORT_CONFLICT/,
  );
  assert.throws(
    () => parseC3DatabaseTargetArgs(['--expected-kind', 'repository-postgis-h3', '--transport', 'hyperdrive-pg']),
    /C3_TRANSPORT_INVALID/,
  );
  assert.throws(
    () => parseC3DatabaseTargetArgs(['--expected-kind', 'repository-postgis-h3', '--transport', 'UNKNOWN']),
    /C3_TRANSPORT_INVALID/,
  );
});

test('CLI default refuses a plausible canonical receipt without an injected gate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-court-auth-'));
  const authorizationReceiptPath = path.join(directory, 'authorization.json');
  fs.writeFileSync(authorizationReceiptPath, JSON.stringify({
    action_type: 'PRODUCTION_ACCESS',
    gate_id: 'plausible-gate',
    nonce: 'plausible-nonce',
    schema: 'cana.owner-authorization/1',
  }));
  const receipt = runC3DatabaseTargetCli({
    argv: [
      '--expected-kind', 'repository-postgis-h3',
      '--database-url', 'postgresql://user:secret@managed.example/cana',
      '--authorization-receipt', authorizationReceiptPath,
    ],
    env: BASE_ENV,
    localProbe: referenceProbe,
  });

  assert.equal(receipt.local.code, 'C3_NON_LOOPBACK_AUTHORIZATION_REQUIRED');
  assert.doesNotMatch(serializeC3DatabaseTargetReceipt(receipt), /secret|managed\.example/);
});

test('CLI --out writes the deterministic receipt without exposing URL credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-court-'));
  const out = path.join(directory, 'receipt.json');
  const argv = ['--expected-kind', 'repository-postgis-h3', '--database-url', LOOPBACK_URL, '--out', out];
  const first = runC3DatabaseTargetCli({ argv, env: BASE_ENV, localProbe: referenceProbe });
  const firstBytes = fs.readFileSync(out, 'utf8');
  const second = runC3DatabaseTargetCli({ argv, env: BASE_ENV, localProbe: referenceProbe });
  const secondBytes = fs.readFileSync(out, 'utf8');

  assert.deepEqual(first, second);
  assert.equal(firstBytes, serializeC3DatabaseTargetReceipt(first));
  assert.equal(secondBytes, firstBytes);
  assert.doesNotMatch(secondBytes, /secret|127\.0\.0\.1/);
});

test('receipts are deterministic and retain explicit managed unknowns', () => {
  const first = localReceipt();
  const second = localReceipt();

  assert.deepEqual(first, second);
  assert.deepEqual(first.managed.unknowns, {
    acceptable_use: 'UNKNOWN',
    backup_restore: 'UNKNOWN',
    h3_extension: 'UNKNOWN',
    region: 'UNKNOWN',
    rollback: 'UNKNOWN',
  });
});
