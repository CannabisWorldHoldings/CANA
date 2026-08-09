#!/bin/sh
# Database MIGRATION command — applies committed Prisma migrations, by
# CONVENTION, from the migration lane's work at apps/web/prisma/migrations/**
# (shipped into the artifact under prisma/migrations/ when present).
#
#   From an extracted release:   cd <release-root> && sh migrate.sh
#   From the repo (off-server):  sh deploy/namecheap/migrate.sh
#
# LAWS (PRODUCTION_RELEASE_GATES.md, "Database laws"):
#   - This script NEVER creates or edits a migration. Authoring migrations is
#     the migration lane's exclusive work; this script only APPLIES what is
#     committed. No migrations directory -> HARD STOP, not improvisation.
#   - `prisma db push` is NOT a migration and is never run here against a
#     populated database (it can drop and re-create structures).
#   - A provider/operator backup receipt is required BEFORE any change. This
#     script cannot manufacture a truthful managed-PostgreSQL snapshot.
#   - Never run this because an endpoint returned 500. Exonerate or convict
#     the database with a read-only check first (db-inspect.mjs).
#
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
# Resolve context: release root (schema at prisma/schema.prisma next to this
# script) or repo root (schema at apps/web/prisma/schema.prisma).
if [ -f "$HERE/prisma/schema.prisma" ]; then
  SCHEMA_DIR="$HERE"
  SCHEMA="prisma/schema.prisma"
elif [ -f "$HERE/../../apps/web/prisma/schema.prisma" ]; then
  SCHEMA_DIR="$(cd "$HERE/../../apps/web" && pwd)"
  SCHEMA="prisma/schema.prisma"
else
  echo "HARD STOP: cannot locate prisma/schema.prisma from $HERE"; exit 1
fi

MIGRATIONS_DIR="$SCHEMA_DIR/prisma/migrations"
: "${DATABASE_URL:?HARD STOP: DATABASE_URL is required}"
: "${DIRECT_URL:?HARD STOP: DIRECT_URL is required}"
: "${CANA_PRE_MIGRATION_BACKUP_RECEIPT:?HARD STOP: CANA_PRE_MIGRATION_BACKUP_RECEIPT is required}"

case "$DATABASE_URL" in postgres://*|postgresql://*) ;; *) echo "HARD STOP: DATABASE_URL must be PostgreSQL"; exit 5;; esac
case "$DIRECT_URL" in postgres://*|postgresql://*) ;; *) echo "HARD STOP: DIRECT_URL must be PostgreSQL"; exit 5;; esac
[ -f "$CANA_PRE_MIGRATION_BACKUP_RECEIPT" ] && [ ! -L "$CANA_PRE_MIGRATION_BACKUP_RECEIPT" ] && [ -s "$CANA_PRE_MIGRATION_BACKUP_RECEIPT" ] || {
  echo "HARD STOP: backup receipt must be a nonempty regular file, not a symlink"; exit 6;
}

# --- Convention gate: the migration lane's work must exist ------------------
if [ ! -d "$MIGRATIONS_DIR" ] || [ -z "$(ls -A "$MIGRATIONS_DIR" 2>/dev/null)" ]; then
  echo "HARD STOP: no committed migrations at $MIGRATIONS_DIR."
  echo "Migrations are authored by the migration lane (apps/web/prisma/migrations/**)."
  exit 2
fi

# --- Tooling gate: prisma CLI must be available ------------------------------
# The standalone artifact ships RUNTIME node_modules; the prisma CLI is a dev
# tool. Preference order: local bin (repo checkout), then npx (registry access
# required — flagged, because shared-host installs are the documented weak
# point; see CAPABILITIES.md section 10).
if [ -x "$SCHEMA_DIR/node_modules/.bin/prisma" ]; then
  PRISMA="$SCHEMA_DIR/node_modules/.bin/prisma"
elif [ -x "$SCHEMA_DIR/../../node_modules/.bin/prisma" ]; then
  PRISMA="$SCHEMA_DIR/../../node_modules/.bin/prisma"
elif command -v npx >/dev/null 2>&1; then
  PRISMA="npx prisma"
  echo "NOTE: using 'npx prisma' — requires registry access; on the shared host"
  echo "prefer running migrations from a machine with the repo checkout, or ship"
  echo "the CLI explicitly. Recorded as an owner-visible operational caveat."
else
  echo "HARD STOP: no prisma CLI available (node_modules/.bin/prisma or npx)."
  exit 3
fi

echo "schema:      $SCHEMA_DIR/$SCHEMA"
echo "migrations:  $MIGRATIONS_DIR ($(ls "$MIGRATIONS_DIR" | wc -l | tr -d ' ') entries)"
if command -v sha256sum >/dev/null 2>&1; then
  BACKUP_RECEIPT_SHA=$(sha256sum "$CANA_PRE_MIGRATION_BACKUP_RECEIPT" | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then
  BACKUP_RECEIPT_SHA=$(shasum -a 256 "$CANA_PRE_MIGRATION_BACKUP_RECEIPT" | cut -d' ' -f1)
else
  echo "HARD STOP: sha256sum or shasum is required to bind the backup receipt"; exit 7
fi
echo "database:    canonical PostgreSQL (URL redacted)"
echo "direct:      configured (URL redacted)"
echo "backup receipt sha256: $BACKUP_RECEIPT_SHA"

# --- Apply committed migrations ----------------------------------------------
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" $PRISMA migrate deploy --schema "$SCHEMA" \
  || { echo "MIGRATION FAILED — provider backup receipt remains: $BACKUP_RECEIPT_SHA"; exit 4; }

echo "MIGRATIONS APPLIED. Record the commit, migration output, and backup-receipt"
echo "hash in the deployment log. This command never creates migrations."
