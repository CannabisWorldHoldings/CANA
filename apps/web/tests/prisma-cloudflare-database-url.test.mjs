import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'pg-connection-string';

import { assertCloudflareDatabaseUrl } from '../src/lib/prisma-cloudflare-database-url.mjs';

test('Cloudflare PostgreSQL URLs fail closed unless remote TLS is strict', () => {
  const strict = 'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict';
  const normalized = assertCloudflareDatabaseUrl(strict);
  const normalizedUrl = new URL(normalized);
  const driverConfig = parse(normalized);
  assert.equal(normalizedUrl.searchParams.get('sslmode'), 'verify-full');
  assert.equal(normalizedUrl.searchParams.has('sslaccept'), false);
  assert.notEqual(driverConfig.ssl, false);
  assert.notEqual(driverConfig.ssl?.rejectUnauthorized, false);
  assert.equal(driverConfig.ssl?.checkServerIdentity, undefined);

  for (const rejected of [
    undefined,
    'not-a-url',
    'mysql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict',
    'postgresql://user:secret@example.invalid/db',
    'postgresql://user:secret@example.invalid/db?sslmode=prefer&sslaccept=strict',
    'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=accept_invalid_certs',
    'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict&uselibpqcompat=true',
    'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict&sslmode=disable',
    'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict&SSLMODE=disable',
    'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict&SSLACCEPT=accept_invalid_certs',
    'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict&ssl=0',
    'postgresql://user:secret@localhost/db?host=example.invalid',
  ]) {
    assert.throws(
      () => assertCloudflareDatabaseUrl(rejected),
      /CLOUDFLARE_DATABASE_URL_(?:REQUIRED|INVALID|POSTGRESQL_REQUIRED|STRICT_TLS_REQUIRED|CONNECTION_OVERRIDE_FORBIDDEN|TLS_OVERRIDE_FORBIDDEN)/,
    );
  }
});

test('disposable loopback PostgreSQL remains available without remote TLS claims', () => {
  for (const url of [
    'postgresql://postgres@127.0.0.1:5432/cana_verify',
    'postgresql://postgres@localhost:5432/cana_verify',
    'postgresql://postgres@[::1]:5432/cana_verify',
  ]) {
    assert.equal(assertCloudflareDatabaseUrl(url), url);
  }
});
