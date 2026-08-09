import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as dbConfig from '../src/lib/db-config.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function stagedUniverse() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-migration-manifest-'));
  const migrationsDir = path.join(root, 'migrations');
  fs.mkdirSync(migrationsDir);
  const entries = [
    { name: '20260101000000_first', sql: 'CREATE TABLE first_table (id TEXT);\n' },
    { name: '20260102000000_second', sql: 'ALTER TABLE first_table ADD COLUMN value TEXT;\n' },
  ];
  for (const entry of entries) {
    const dir = path.join(migrationsDir, entry.name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'migration.sql'), entry.sql);
  }
  return {
    root,
    migrationsDir,
    manifest: {
      version: 1,
      provider: 'postgresql',
      migrations: entries.map(({ name, sql }) => ({ name, sha256: sha256(sql) })),
    },
  };
}

test('canonical migration manifest accepts only the reviewed ordered names and SQL digests', () => {
  assert.equal(typeof dbConfig.validateCanonicalMigrationUniverse, 'function');
  const fixture = stagedUniverse();
  try {
    const verified = dbConfig.validateCanonicalMigrationUniverse({
      migrationsDir: fixture.migrationsDir,
      manifest: fixture.manifest,
    });
    assert.deepEqual(verified.migrations, fixture.manifest.migrations);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the committed canonical manifest exactly binds the complete repository migration universe', () => {
  const manifest = dbConfig.loadCanonicalMigrationManifest();
  const verified = dbConfig.validateCanonicalMigrationUniverse({ manifest });
  assert.deepEqual(verified.migrations, manifest.migrations);
  assert.equal(verified.provider, 'postgresql');
});

test('canonical migration manifest refuses missing, unexpected, reordered, and modified migrations', () => {
  assert.equal(typeof dbConfig.validateCanonicalMigrationUniverse, 'function');
  const fixture = stagedUniverse();
  const validate = (manifest = fixture.manifest) => dbConfig.validateCanonicalMigrationUniverse({
    migrationsDir: fixture.migrationsDir,
    manifest,
  });
  try {
    fs.rmSync(path.join(fixture.migrationsDir, fixture.manifest.migrations[1].name), { recursive: true });
    assert.throws(validate, /CANA_MIGRATION_UNIVERSE_MISSING/);

    const second = fixture.manifest.migrations[1];
    fs.mkdirSync(path.join(fixture.migrationsDir, second.name));
    fs.writeFileSync(path.join(fixture.migrationsDir, second.name, 'migration.sql'),
      'ALTER TABLE first_table ADD COLUMN value TEXT;\n');
    const surprise = path.join(fixture.migrationsDir, '20260103000000_surprise');
    fs.mkdirSync(surprise);
    fs.writeFileSync(path.join(surprise, 'migration.sql'), 'SELECT 1;\n');
    assert.throws(validate, /CANA_MIGRATION_UNIVERSE_UNEXPECTED/);
    fs.rmSync(surprise, { recursive: true });

    assert.throws(
      () => validate({ ...fixture.manifest, migrations: [...fixture.manifest.migrations].reverse() }),
      /CANA_MIGRATION_MANIFEST_ORDER_INVALID/,
    );

    fs.appendFileSync(path.join(fixture.migrationsDir, second.name, 'migration.sql'), '-- tampered\n');
    assert.throws(validate, /CANA_MIGRATION_DIGEST_MISMATCH/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('migration ledger lookup propagates operational errors instead of classifying them as an empty database', async () => {
  const unavailable = Object.assign(new Error('connection terminated'), { code: 'P1001' });
  const prisma = { $queryRawUnsafe: async () => { throw unavailable; } };
  await assert.rejects(() => dbConfig.readMigrationRows(prisma), (error) => error === unavailable);
});

test('migration ledger lookup returns null only for a provider-confirmed missing Prisma ledger', async () => {
  const missing = Object.assign(new Error('relation "_prisma_migrations" does not exist'), {
    code: 'P2010',
    meta: { code: '42P01', message: 'relation "_prisma_migrations" does not exist' },
  });
  const prisma = { $queryRawUnsafe: async () => { throw missing; } };
  assert.equal(await dbConfig.readMigrationRows(prisma), null);
});
