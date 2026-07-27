#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${1:?expected commit required}"
ROOT=/workspace
ACCOUNT=/tmp/cana-cpanel-real-prisma
DATA="$ACCOUNT/orderweeddc-staging-data"
BACKUPS="$ACCOUNT/orderweeddc-staging-backups"
DB="$DATA/prod.db"
RESTORE="$DATA/restored-prod.db"
RELEASE="$ACCOUNT/release"

test "$(git -C "$ROOT" rev-parse HEAD)" = "$EXPECTED_SHA"
test -z "$(git -C "$ROOT" status --porcelain)"
mkdir -p "$DATA" "$BACKUPS"

cd "$ROOT"
(
  cd apps/web
  npx --no-install prisma generate
)
PRISMA_VERSION="$(npx --no-install prisma -v | sed -n 's/^prisma[[:space:]]*:[[:space:]]*//p' | head -1)"
test "$PRISMA_VERSION" = "6.19.3"

MIGRATION_OUTPUT="$(
  cd apps/web
  OWD_DATA_DIR="$DATA" \
  OWD_DB_PATH="$DB" \
  OWD_NODE="$(command -v node)" \
  sh ../../deploy/namecheap/migrate.sh
)"
printf '%s\n' "$MIGRATION_OUTPUT"
grep -q 'MIGRATIONS APPLIED' <<<"$MIGRATION_OUTPUT"

MIGRATION_COUNT="$(
  node tools/cpanel-sim/templates/sqlite-tool.mjs \
    query "$DB" 'SELECT count(*) FROM _prisma_migrations'
)"
CORE_TABLE_COUNT="$(
  node tools/cpanel-sim/templates/sqlite-tool.mjs \
    query "$DB" \
    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('Organization','Brand')"
)"
test "$MIGRATION_COUNT" = "2"
test "$CORE_TABLE_COUNT" = "2"

node tools/cpanel-sim/templates/sqlite-tool.mjs \
  exec "$DB" \
  "CREATE TABLE cpanel_backup_probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
   INSERT INTO cpanel_backup_probe VALUES(1,'before-real-backup')"

WORKER_OUTPUT="$(
  cd apps/web
  OWD_DATA_DIR="$DATA" \
  OWD_BACKUP_DIR="$BACKUPS" \
  node ../../deploy/namecheap/worker.mjs --once backup
)"
printf '%s\n' "$WORKER_OUTPUT"
grep -q '"checkpoint":"CHECKPOINTED"' <<<"$WORKER_OUTPUT"

BACKUP="$(find "$BACKUPS" -maxdepth 1 -type f -name 'prod-*.db' -print -quit)"
test -n "$BACKUP"
test -f "$BACKUP.sha256"
BACKUP_SHA="$(cut -d' ' -f1 < "$BACKUP.sha256")"
test "$BACKUP_SHA" = "$(sha256sum "$BACKUP" | cut -d' ' -f1)"

node tools/cpanel-sim/templates/sqlite-tool.mjs \
  exec "$DB" \
  "UPDATE cpanel_backup_probe SET value='after-real-backup' WHERE id=1"

mkdir -p "$RELEASE/scripts"
cp deploy/namecheap/restore-backup.sh "$RELEASE/restore-backup.sh"
cp apps/web/scripts/db-inspect.mjs "$RELEASE/scripts/db-inspect.mjs"
ln -s "$ROOT/node_modules" "$RELEASE/node_modules"
RESTORE_OUTPUT="$(
  OWD_NODE="$(command -v node)" \
  sh "$RELEASE/restore-backup.sh" "$BACKUP" "$RESTORE"
)"
printf '%s\n' "$RESTORE_OUTPUT"
grep -q '"coreTablesPresent":true' <<<"$RESTORE_OUTPUT"
test "$(
  node tools/cpanel-sim/templates/sqlite-tool.mjs \
    query "$RESTORE" 'SELECT value FROM cpanel_backup_probe WHERE id=1'
)" = "before-real-backup"

node -e '
  process.stdout.write(`CANA_REAL_PRISMA_PROOF ${JSON.stringify({
    overall: "PASS",
    commit: process.argv[1],
    prismaVersion: process.argv[2],
    migrationsApplied: Number(process.argv[3]),
    coreTables: Number(process.argv[4]),
    workerCheckpoint: "CHECKPOINTED",
    backupSha256: process.argv[5],
    restoreInspector: "coreTablesPresent=true",
    restoredSentinel: "before-real-backup"
  })}\n`);
' "$EXPECTED_SHA" "$PRISMA_VERSION" "$MIGRATION_COUNT" "$CORE_TABLE_COUNT" "$BACKUP_SHA"
