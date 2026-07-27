#!/bin/sh
set -eu
: "${CANA_SHARED_DATA:?}"
mkdir -p "$CANA_SHARED_DATA"
DB="$CANA_SHARED_DATA/cana.db"
sqlite3 "$DB" <<'SQL'
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
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (2,datetime('now'));
COMMIT;
SQL
