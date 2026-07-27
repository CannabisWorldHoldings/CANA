import { backup, DatabaseSync } from 'node:sqlite';

const [action, databaseFile, value] = process.argv.slice(2);
if (!action || !databaseFile) {
  throw new Error('usage: sqlite-tool.mjs <exec|query|migrate|backup|restore> <database> [value]');
}

if (action === 'exec') {
  const database = new DatabaseSync(databaseFile);
  try {
    database.exec(value);
  } finally {
    database.close();
  }
} else if (action === 'query') {
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const row = database.prepare(value).get();
    const result = row ? Object.values(row)[0] : '';
    process.stdout.write(result == null ? '' : String(result));
  } finally {
    database.close();
  }
} else if (action === 'migrate') {
  const database = new DatabaseSync(databaseFile);
  try {
    database.exec(`
      PRAGMA journal_mode=WAL;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS persistent_probe (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version,applied_at)
      VALUES (2,datetime('now'));
      COMMIT;
    `);
  } finally {
    database.close();
  }
} else if (action === 'backup') {
  if (!value) throw new Error('backup needs a destination');
  const database = new DatabaseSync(databaseFile);
  try {
    await backup(database, value);
  } finally {
    database.close();
  }
} else if (action === 'restore') {
  if (!value) throw new Error('restore needs a source backup');
  const source = new DatabaseSync(value, { readOnly: true });
  try {
    await backup(source, databaseFile);
  } finally {
    source.close();
  }
} else {
  throw new Error(`unknown sqlite action: ${action}`);
}
