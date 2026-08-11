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

MODE="${1-}"
case "$MODE" in
  ""|--initialize) ;;
  *) echo "HARD STOP: unsupported migration mode: $MODE"; exit 2;;
esac

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
SCHEMA_PATH="$SCHEMA_DIR/$SCHEMA"
MIGRATION_MANIFEST="$SCHEMA_DIR/prisma/migration-manifest.json"
MIGRATION_MANIFEST_VERIFIER="$SCHEMA_DIR/prisma/migration-manifest.mjs"
: "${DATABASE_URL:?HARD STOP: DATABASE_URL is required}"
: "${DIRECT_URL:?HARD STOP: DIRECT_URL is required}"
: "${CANA_PRE_MIGRATION_BACKUP_RECEIPT:?HARD STOP: CANA_PRE_MIGRATION_BACKUP_RECEIPT is required}"
case "$DATABASE_URL" in postgres://*|postgresql://*) ;; *) echo "HARD STOP: DATABASE_URL must be PostgreSQL"; exit 5;; esac
case "$DIRECT_URL" in postgres://*|postgresql://*) ;; *) echo "HARD STOP: DIRECT_URL must be PostgreSQL"; exit 5;; esac
if [ -n "${CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER-}" ]; then
  [ "$DATABASE_URL" = "$DIRECT_URL" ] || {
    echo "HARD STOP: disposable database court requires one identical loopback URL"; exit 5;
  }
  case "$DATABASE_URL" in
    postgres://*@127.0.0.1:*/*|postgresql://*@127.0.0.1:*/*|postgres://*@localhost:*/*|postgresql://*@localhost:*/*|*'@[::1]:'*) ;;
    *) echo "HARD STOP: disposable database court requires one identical loopback URL"; exit 5;;
  esac
  NODE_BIN="${OWD_NODE:-$(command -v node || true)}"
else
  for DATABASE_CONNECTION_URL in "$DATABASE_URL" "$DIRECT_URL"; do
    DATABASE_QUERY="&${DATABASE_CONNECTION_URL#*\?}&"
    case "$DATABASE_QUERY" in *'&sslmode=require&'*) ;; *) echo "HARD STOP: database URLs must enforce strict TLS"; exit 5;; esac
    case "$DATABASE_QUERY" in *'&sslaccept=strict&'*) ;; *) echo "HARD STOP: database URLs must enforce strict TLS"; exit 5;; esac
  done
  [ -z "${OWD_NODE-}" ] || {
    echo "HARD STOP: OWD_NODE override is permitted only for a disposable database court"; exit 3;
  }
  NODE_BIN=/opt/alt/alt-nodejs20/root/usr/bin/node
fi
[ -n "$NODE_BIN" ] || { echo "HARD STOP: no Node executable found for the disposable database court"; exit 3; }
case "$NODE_BIN" in /*) ;; *) echo "HARD STOP: Node executable must resolve to an absolute path"; exit 3;; esac
[ -x "$NODE_BIN" ] || { echo "HARD STOP: resolved Node executable is not executable"; exit 3; }

[ -f "$MIGRATION_MANIFEST" ] && [ ! -L "$MIGRATION_MANIFEST" ] &&
  [ -f "$MIGRATION_MANIFEST_VERIFIER" ] && [ ! -L "$MIGRATION_MANIFEST_VERIFIER" ] || {
  echo "HARD STOP: canonical migration manifest and verifier must be regular files"; exit 2;
}
MIGRATION_MANIFEST_PROOF="$("$NODE_BIN" "$MIGRATION_MANIFEST_VERIFIER" "$MIGRATIONS_DIR" "$MIGRATION_MANIFEST")" || {
  echo "HARD STOP: committed migrations do not match the reviewed canonical manifest"; exit 2;
}

CANA_SCHEMA_DIR="$SCHEMA_DIR" "$NODE_BIN" <<'NODE' || { echo "HARD STOP: database URLs must enforce strict TLS or match the connected disposable PostgreSQL identity"; exit 5; }
const path = require('node:path');
const { createRequire } = require('node:module');
const names = ['DATABASE_URL', 'DIRECT_URL'];
let urls;
try {
  urls = names.map((name) => new URL(process.env[name]));
} catch {
  process.exit(1);
}
const disposableLoopback =
  process.env.DATABASE_URL === process.env.DIRECT_URL &&
  urls.every((url) => ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) &&
  /^\d{10,}$/.test(process.env.CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER ?? '');
if (!disposableLoopback && urls.some((url) =>
  url.searchParams.get('sslmode') !== 'require' || url.searchParams.get('sslaccept') !== 'strict'
)) process.exit(1);
if (disposableLoopback) {
  const schemaRequire = createRequire(
    path.join(process.env.CANA_SCHEMA_DIR, '__cana_migrate_resolver__.cjs'),
  );
  const { PrismaClient } = schemaRequire('@prisma/client');
  const prisma = new PrismaClient();
  (async () => {
    try {
      const [identity] = await prisma.$queryRawUnsafe(
        'SELECT current_database() AS database, system_identifier::text AS system_identifier FROM pg_control_system()',
      );
      if (
        identity?.database !== urls[0].pathname.slice(1) ||
        identity?.system_identifier !== process.env.CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER
      ) process.exitCode = 1;
    } catch {
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  })();
}
NODE
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
# Release artifacts ship the exact lockfile-installed Prisma CLI closure and
# invoke it directly. Registry fallback is deliberately forbidden.
if [ -f "$SCHEMA_DIR/node_modules/prisma/build/index.js" ]; then
  set -- "$NODE_BIN" "$SCHEMA_DIR/node_modules/prisma/build/index.js"
elif [ -x "$SCHEMA_DIR/node_modules/.bin/prisma" ]; then
  set -- "$SCHEMA_DIR/node_modules/.bin/prisma"
elif [ -x "$SCHEMA_DIR/../../node_modules/.bin/prisma" ]; then
  set -- "$SCHEMA_DIR/../../node_modules/.bin/prisma"
else
  echo "HARD STOP: no packaged or repository-local prisma CLI available."
  exit 3
fi

echo "schema:      $SCHEMA_PATH"
echo "migrations:  $MIGRATION_MANIFEST_PROOF"
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
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" "$@" migrate deploy --schema "$SCHEMA_PATH" \
  || { echo "MIGRATION FAILED — provider backup receipt remains: $BACKUP_RECEIPT_SHA"; exit 4; }

if [ "$MODE" = "--initialize" ]; then
  NODE_ENV=production "$NODE_BIN" "$SCHEMA_DIR/scripts/init-production-db.mjs"
  "$NODE_BIN" "$SCHEMA_DIR/scripts/db-inspect.mjs"
fi

echo "MIGRATIONS APPLIED. Record the commit, migration output, and backup-receipt"
echo "hash in the deployment log. This command never creates migrations."
