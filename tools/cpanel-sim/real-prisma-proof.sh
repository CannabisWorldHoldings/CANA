#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${1:?expected commit required}"
ROOT=/workspace
ACCOUNT=/tmp/cana-cpanel-real-prisma
BACKUP_RECEIPT="$ACCOUNT/provider-backup-receipt.json"

: "${DATABASE_URL:?disposable PostgreSQL DATABASE_URL required}"
: "${DIRECT_URL:?disposable PostgreSQL DIRECT_URL required}"
test "$DATABASE_URL" = "$DIRECT_URL"
test "$(git -C "$ROOT" rev-parse HEAD)" = "$EXPECTED_SHA"
test -z "$(git -C "$ROOT" status --porcelain)"
mkdir -p "$ACCOUNT"
printf '{"environment":"CPANEL_SIMULATION","authority":"disposable-postgresql","restorable":true}\n' > "$BACKUP_RECEIPT"

cd "$ROOT"
(
  cd apps/web
  npx --no-install prisma generate
)
PRISMA_VERSION="$(npx --no-install prisma -v | sed -n 's/^prisma[[:space:]]*:[[:space:]]*//p' | head -1)"
test "$PRISMA_VERSION" = "6.19.3"

MIGRATION_OUTPUT="$(
  cd apps/web
  CANA_PRE_MIGRATION_BACKUP_RECEIPT="$BACKUP_RECEIPT" \
  sh ../../deploy/namecheap/migrate.sh 2>&1
)"
printf '%s\n' "$MIGRATION_OUTPUT"
grep -q 'MIGRATIONS APPLIED' <<<"$MIGRATION_OUTPUT"
if grep -Fq "$DATABASE_URL" <<<"$MIGRATION_OUTPUT" || grep -Fq "$DIRECT_URL" <<<"$MIGRATION_OUTPUT"; then
  echo 'CANA_DATABASE_URL_DISCLOSURE_REFUSED migration output contained a database URL' >&2
  exit 1
fi

PROOF_JSON="$(node --input-type=module <<'NODE'
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const [migrationCount, coreTables, versions] = await Promise.all([
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'),
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('Organization','Brand')`),
    prisma.$queryRawUnsafe(`SELECT postgis_lib_version() AS postgis, h3_get_extension_version() AS h3`),
  ]);
  process.stdout.write(JSON.stringify({
    migrationsApplied: migrationCount[0].count,
    coreTables: coreTables[0].count,
    postgis: versions[0].postgis,
    h3: versions[0].h3,
  }));
} finally {
  await prisma.$disconnect();
}
NODE
)"

set +e
WORKER_OUTPUT="$(
  cd apps/web
  OWD_BACKUP_DIR="$ACCOUNT/worker-logs" \
  node ../../deploy/namecheap/worker.mjs --once backup 2>&1
)"
WORKER_STATUS=$?
set -e
printf '%s\n' "$WORKER_OUTPUT"
test "$WORKER_STATUS" -ne 0
grep -q 'MANAGED_POSTGRES_BACKUP_AUTHORITY_REQUIRED' <<<"$WORKER_OUTPUT"

node -e '
  const db = JSON.parse(process.argv[3]);
  process.stdout.write(`CANA_REAL_PRISMA_PROOF ${JSON.stringify({
    overall: "PASS",
    commit: process.argv[1],
    prismaVersion: process.argv[2],
    ...db,
    directUrlContract: "SAME_DISPOSABLE_POSTGRESQL_INSTANCE",
    migrationOutputRedacted: true,
    backupAuthority: "PROVIDER_OPERATOR_REQUIRED",
    backupRefusalProven: true
  })}\n`);
' "$EXPECTED_SHA" "$PRISMA_VERSION" "$PROOF_JSON"
