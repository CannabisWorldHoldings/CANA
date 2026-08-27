import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCloudflareDatabaseUrl } from '../src/lib/prisma-cloudflare-database-url.mjs';

test('Cloudflare PostgreSQL URLs fail closed unless remote TLS is strict', () => {
  const strict = 'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict';
  assert.equal(assertCloudflareDatabaseUrl(strict), strict);

  for (const rejected of [
    undefined,
    'not-a-url',
    'mysql://user:secret@example.invalid/db?sslmode=require&sslaccept=strict',
    'postgresql://user:secret@example.invalid/db',
    'postgresql://user:secret@example.invalid/db?sslmode=prefer&sslaccept=strict',
    'postgresql://user:secret@example.invalid/db?sslmode=require&sslaccept=accept_invalid_certs',
  ]) {
    assert.throws(
      () => assertCloudflareDatabaseUrl(rejected),
      /CLOUDFLARE_DATABASE_URL_(?:REQUIRED|INVALID|POSTGRESQL_REQUIRED|STRICT_TLS_REQUIRED)/,
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
