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
#   - A timestamped backup is taken BEFORE any change; the pre/post SHA-256
#     of the database file is printed so the change is attributable.
#   - Never run this because an endpoint returned 500. Exonerate or convict
#     the database with a read-only check first (db-inspect.mjs).
#
# DATABASE INITIALIZATION (first deploy, empty provider database) is a
# DIFFERENT command and stays separate on purpose:
#   cd <release-root> && sh bootstrap-production-db.sh
# (installs the build-verified schema template ONLY into an absent/empty db,
#  then runs the idempotent canonical init + real ABCA seed; zero demo data.)
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
DATA_DIR="${OWD_DATA_DIR:-$HOME/orderweeddc-data}"
DB="${OWD_DB_PATH:-$DATA_DIR/prod.db}"

# --- Convention gate: the migration lane's work must exist ------------------
if [ ! -d "$MIGRATIONS_DIR" ] || [ -z "$(ls -A "$MIGRATIONS_DIR" 2>/dev/null)" ]; then
  echo "HARD STOP: no committed migrations at $MIGRATIONS_DIR."
  echo "Migrations are authored by the migration lane (apps/web/prisma/migrations/**)."
  echo "Until they land, schema installation happens ONLY via the guarded"
  echo "first-deploy bootstrap:  sh bootstrap-production-db.sh"
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
echo "database:    $DB"

# --- Backup + before-hash (attributable change) ------------------------------
if [ -f "$DB" ]; then
  BEFORE_SHA=$(sha256sum "$DB" | cut -d' ' -f1)
  BACKUP="$DB.pre-migrate-$(date -u +%Y%m%d%H%M%S)"
  cp -p "$DB" "$BACKUP"
  echo "db sha256 before: $BEFORE_SHA"
  echo "backup:           $BACKUP"
else
  echo "database absent — 'migrate deploy' will create it with full history."
  BEFORE_SHA="(absent)"
fi

# --- Apply committed migrations ----------------------------------------------
DATABASE_URL="file:$DB" $PRISMA migrate deploy --schema "$SCHEMA" \
  || { echo "MIGRATION FAILED — database backup preserved: ${BACKUP:-n/a}"; exit 4; }

AFTER_SHA=$(sha256sum "$DB" | cut -d' ' -f1)
echo "db sha256 after:  $AFTER_SHA"
echo "MIGRATIONS APPLIED. Record both hashes in the deployment log; a code-only"
echo "deploy must never change the database hash — this command is the ONLY"
echo "approved way a release changes it."
