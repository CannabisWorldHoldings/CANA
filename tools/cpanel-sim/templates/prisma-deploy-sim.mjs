import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const schemaIndex = args.indexOf('--schema');
if (
  args[0] !== 'migrate' ||
  args[1] !== 'deploy' ||
  schemaIndex === -1 ||
  !args[schemaIndex + 1]
) {
  throw new Error('simulation accepts only: prisma migrate deploy --schema <schema>');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('file:')) {
  throw new Error('simulation requires a file: DATABASE_URL');
}
const schema = path.resolve(args[schemaIndex + 1]);
const migrations = path.join(path.dirname(schema), 'migrations');
const databaseFile = path.resolve(decodeURIComponent(databaseUrl.slice('file:'.length)));
fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

const database = new DatabaseSync(databaseFile);
let applied = 0;
try {
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const alreadyApplied = database.prepare(
    'SELECT 1 FROM _prisma_migrations WHERE migration_name = ?',
  );
  const recordApplied = database.prepare(
    'INSERT INTO _prisma_migrations(migration_name,applied_at) VALUES (?,?)',
  );
  for (const entry of fs.readdirSync(migrations, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const migrationFile = path.join(migrations, entry.name, 'migration.sql');
    if (!fs.existsSync(migrationFile) || alreadyApplied.get(entry.name)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(fs.readFileSync(migrationFile, 'utf8'));
      recordApplied.run(entry.name, new Date().toISOString());
      database.exec('COMMIT');
      applied += 1;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
} finally {
  database.close();
}
process.stdout.write(`Applied ${applied} committed migration(s) with the local cPanel simulation adapter.\n`);
