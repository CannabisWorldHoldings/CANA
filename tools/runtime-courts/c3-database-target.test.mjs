import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  parseC3DatabaseTargetArgs,
  probeLocalC3Database,
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
    read_only: { enforced: true, failure_code: '25006', write_capable: false },
    server_identity: 'local-disposable-postgres-17',
    tls: { active: true, mode: 'verify-full', strict_certificate_semantics: true, verified: true },
  };
}

function successfulProbeChild(overrides = {}) {
  return {
    status: 0,
    stdout: JSON.stringify({
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
      read_only: { enforced: true, failure_code: '25006', write_capable: false },
      server_identity: 'PostgreSQL 17.5 system=739221 secret-host.internal',
      tls: { active: false, cipher: null, protocol: null },
      ...overrides,
    }),
    stderr: '',
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
  assert.match(receipt.local.observation.server_identity, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(serializeC3DatabaseTargetReceipt(receipt), /local-disposable-postgres-17/);
  assert.equal(receipt.managed_target_certified, false);
  assert.equal(receipt.managed.verdict, 'BLOCKED_OWNER_CREDENTIALS_AND_EXTENSION_PROOF');
  assert.equal(receipt.managed.transport, 'UNDECIDED');
});

test('non-loopback and unclassified URLs are refused before the injected probe', () => {
  let calls = 0;
  const remote = localReceipt({
    databaseUrl: 'postgresql://user:secret@managed.example/cana?sslmode=verify-full',
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
    databaseUrl: 'postgresql://user:secret@managed.example/cana?sslmode=verify-full',
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
    databaseUrl: 'postgresql://user:secret@managed.example/cana?sslmode=verify-full',
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
  const forgedReadOnlyFailure = localReceipt({
    localProbe: () => ({
      ...referenceProbe(),
      read_only: { enforced: true, failure_code: 'UNKNOWN', write_capable: false },
    }),
  });

  assert.equal(writeCapable.local.code, 'C3_READ_ONLY_ENFORCEMENT_REQUIRED');
  assert.equal(noIdentity.local.code, 'C3_SERVER_IDENTITY_REQUIRED');
  assert.equal(noTls.local.code, 'C3_TLS_VERIFICATION_REQUIRED');
  assert.equal(noFunction.local.code, 'C3_H3_FUNCTION_REQUIRED');
  assert.equal(forgedReadOnlyFailure.local.code, 'C3_READ_ONLY_FAILURE_CODE_REQUIRED');
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

test('real probe parses a bounded Prisma child observation and digests server identity', () => {
  let invocation;
  process.env.C3_TEST_UNRELATED_SECRET = 'must-not-cross-process-boundary';
  let observed;
  try {
    observed = probeLocalC3Database({
      databaseUrl: LOOPBACK_URL,
      spawnCommand: (...args) => { invocation = args; return successfulProbeChild(); },
    });
  } finally {
    delete process.env.C3_TEST_UNRELATED_SECRET;
  }

  assert.equal(invocation[0], process.execPath);
  assert.equal(invocation[2].timeout, 30_000);
  assert.equal(invocation[2].env.DATABASE_URL, LOOPBACK_URL);
  assert.equal(Object.hasOwn(invocation[2].env, 'C3_TEST_UNRELATED_SECRET'), false);
  assert.match(observed.server_identity, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(observed.tls, {
    active: false,
    mode: 'DISABLED_LOOPBACK',
    strict_certificate_semantics: false,
    verified: true,
  });
  assert.doesNotMatch(JSON.stringify(observed), /secret|secret-host\.internal|127\.0\.0\.1/);
});

test('real probe fails closed on malformed output and redacts child failures', () => {
  assert.throws(
    () => probeLocalC3Database({
      databaseUrl: LOOPBACK_URL,
      spawnCommand: () => ({ status: 0, stdout: 'not-json', stderr: '' }),
    }),
    /^Error: C3_LOCAL_PROBE_OUTPUT_INVALID$/,
  );
  assert.throws(
    () => probeLocalC3Database({
      databaseUrl: LOOPBACK_URL,
      spawnCommand: () => ({ status: 1, stdout: '', stderr: `failed ${LOOPBACK_URL}` }),
    }),
    /^Error: C3_LOCAL_PROBE_CHILD_FAILED$/,
  );
});

test('injected hostile leaf values cannot cross the serialized receipt boundary', () => {
  const secret = 'C3_INJECTED_SECRET_MUST_NOT_LEAK';
  const oversized = `${secret}${'x'.repeat(8_192)}`;
  const hostileFunctions = localReceipt({
    localProbe: () => ({
      ...referenceProbe(),
      engine: 'POSTGRESQL',
      functions: {
        h3: ['h3_lat_lng_to_cell', secret, 'H3_LAT_LNG_TO_CELL', oversized],
        postgis: ['st_distance', secret, 'ST_CONTAINS', 'st_distance'],
      },
    }),
  });
  const hostileVersions = localReceipt({
    localProbe: () => ({
      ...referenceProbe(),
      extensions: {
        available: { postgis: oversized, h3: '4.2.3', h3_postgis: '4.2.3' },
        installed: { postgis: oversized, h3: '4.2.3', h3_postgis: '4.2.3' },
      },
      read_only: { enforced: true, failure_code: oversized, write_capable: false },
    }),
  });
  const hostileEngine = localReceipt({
    localProbe: () => ({ ...referenceProbe(), engine: oversized }),
  });

  assert.equal(hostileFunctions.local.verdict, 'LOCAL_REFERENCE_GREEN');
  assert.deepEqual(hostileFunctions.local.observation.functions, {
    h3: ['h3_lat_lng_to_cell'],
    postgis: ['st_contains', 'st_distance'],
  });
  assert.equal(hostileVersions.local.code, 'C3_POSTGIS_EXTENSION_REQUIRED');
  assert.equal(hostileEngine.local.code, 'C3_POSTGRESQL_REQUIRED');
  for (const receipt of [hostileFunctions, hostileVersions, hostileEngine]) {
    const serialized = serializeC3DatabaseTargetReceipt(receipt);
    assert.doesNotMatch(serialized, /C3_INJECTED_SECRET_MUST_NOT_LEAK/);
    assert.ok(serialized.length < 4_096);
  }
});

test('CLI defaults to the real probe only for loopback and records a sanitized observation', () => {
  let calls = 0;
  const receipt = runC3DatabaseTargetCli({
    argv: ['--expected-kind', 'repository-postgis-h3', '--database-url', LOOPBACK_URL],
    env: BASE_ENV,
    spawnCommand: () => { calls += 1; return successfulProbeChild(); },
  });

  assert.equal(calls, 1);
  assert.equal(receipt.local.verdict, 'LOCAL_REFERENCE_GREEN');
  assert.match(receipt.local.observation.server_identity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.local.observation.tls.mode, 'DISABLED_LOOPBACK');
  assert.doesNotMatch(serializeC3DatabaseTargetReceipt(receipt), /secret|secret-host\.internal|127\.0\.0\.1/);
});

test('CLI forged remote gate blocks before the default probe can spawn or resolve a host', () => {
  let calls = 0;
  const receipt = runC3DatabaseTargetCli({
    argv: [
      '--expected-kind', 'repository-postgis-h3',
      '--database-url', 'postgresql://user:secret@does-not-resolve.invalid/cana?sslmode=verify-full',
    ],
    env: BASE_ENV,
    spawnCommand: () => { calls += 1; return successfulProbeChild(); },
  });

  assert.equal(receipt.local.code, 'C3_NON_LOOPBACK_AUTHORIZATION_REQUIRED');
  assert.equal(calls, 0);
  assert.doesNotMatch(serializeC3DatabaseTargetReceipt(receipt), /secret|does-not-resolve/);
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
