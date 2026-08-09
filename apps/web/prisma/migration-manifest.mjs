import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PRISMA_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CANONICAL_MIGRATIONS_DIR = path.join(PRISMA_DIR, 'migrations');
export const CANONICAL_MIGRATION_MANIFEST_PATH = path.join(PRISMA_DIR, 'migration-manifest.json');

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

function validateManifest(manifest) {
  if (manifest?.version !== 1 || manifest?.provider !== 'postgresql' || !Array.isArray(manifest?.migrations) || manifest.migrations.length === 0) {
    fail('CANA_MIGRATION_MANIFEST_INVALID', 'expected version 1 PostgreSQL migration manifest');
  }
  const names = [];
  const seen = new Set();
  for (const entry of manifest.migrations) {
    if (!entry || !/^\d{14}_[a-z0-9_]+$/.test(entry.name ?? '') || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
      fail('CANA_MIGRATION_MANIFEST_INVALID', `invalid entry ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry.name)) fail('CANA_MIGRATION_MANIFEST_INVALID', `duplicate migration ${entry.name}`);
    seen.add(entry.name);
    names.push(entry.name);
  }
  const ordered = [...names].sort();
  if (names.some((name, index) => name !== ordered[index])) {
    fail('CANA_MIGRATION_MANIFEST_ORDER_INVALID', 'manifest migrations must be in lexical application order');
  }
  return manifest;
}

export function loadCanonicalMigrationManifest(manifestPath = CANONICAL_MIGRATION_MANIFEST_PATH) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail('CANA_MIGRATION_MANIFEST_INVALID', `${manifestPath}: ${error?.message ?? error}`);
  }
  return validateManifest(manifest);
}

export function validateCanonicalMigrationUniverse({
  migrationsDir = CANONICAL_MIGRATIONS_DIR,
  manifest = loadCanonicalMigrationManifest(),
} = {}) {
  validateManifest(manifest);
  if (!existsSync(migrationsDir) || !lstatSync(migrationsDir).isDirectory()) {
    fail('CANA_MIGRATION_UNIVERSE_MISSING', `migration directory absent: ${migrationsDir}`);
  }
  const diskNames = [];
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail('CANA_MIGRATION_UNIVERSE_UNEXPECTED', `symlinked migration ${entry.name}`);
    if (!entry.isDirectory()) continue;
    diskNames.push(entry.name);
  }
  diskNames.sort();
  const approvedNames = manifest.migrations.map((entry) => entry.name);
  const missing = approvedNames.filter((name) => !diskNames.includes(name));
  if (missing.length) fail('CANA_MIGRATION_UNIVERSE_MISSING', missing.join(', '));
  const unexpected = diskNames.filter((name) => !approvedNames.includes(name));
  if (unexpected.length) fail('CANA_MIGRATION_UNIVERSE_UNEXPECTED', unexpected.join(', '));
  if (diskNames.some((name, index) => name !== approvedNames[index])) {
    fail('CANA_MIGRATION_MANIFEST_ORDER_INVALID', 'disk and manifest order differ');
  }

  for (const approved of manifest.migrations) {
    const sqlPath = path.join(migrationsDir, approved.name, 'migration.sql');
    if (!existsSync(sqlPath) || !lstatSync(sqlPath).isFile() || lstatSync(sqlPath).isSymbolicLink()) {
      fail('CANA_MIGRATION_UNIVERSE_MISSING', `${approved.name}/migration.sql`);
    }
    const actual = createHash('sha256').update(readFileSync(sqlPath)).digest('hex');
    if (actual !== approved.sha256) {
      fail('CANA_MIGRATION_DIGEST_MISMATCH', `${approved.name}: expected ${approved.sha256}, observed ${actual}`);
    }
  }
  return {
    version: manifest.version,
    provider: manifest.provider,
    migrations: manifest.migrations.map((entry) => ({ ...entry })),
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = validateCanonicalMigrationUniverse({
      migrationsDir: process.argv[2] ? path.resolve(process.argv[2]) : CANONICAL_MIGRATIONS_DIR,
      manifest: process.argv[3]
        ? loadCanonicalMigrationManifest(path.resolve(process.argv[3]))
        : loadCanonicalMigrationManifest(),
    });
    process.stdout.write(`${JSON.stringify({ overall: 'PASS', ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
