#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${1:?expected commit required}"
ROOT=/workspace
ACCOUNT=/tmp/cana-cpanel-real-prisma
BACKUP_RECEIPT="$ACCOUNT/provider-backup-receipt.json"

: "${DATABASE_URL:?disposable PostgreSQL DATABASE_URL required}"
: "${DIRECT_URL:?disposable PostgreSQL DIRECT_URL required}"
: "${CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER:?disposable PostgreSQL system identifier required}"
if [[ ! "$CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER" =~ ^[0-9]{10,}$ ]]; then
  echo 'CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER must be numeric' >&2
  exit 1
fi
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

APP_IDENTITY_ROOT="$ROOT/.cana-local/cpanel-app-identity"
rm -rf "$APP_IDENTITY_ROOT"
mkdir -p "$APP_IDENTITY_ROOT"
cp deploy/namecheap/app.js "$APP_IDENTITY_ROOT/app.js"
printf '%s\n' "process.stdout.write('CANA_APP_IDENTITY_ACCEPTED\\n');" > "$APP_IDENTITY_ROOT/server.js"
set +e
APP_IDENTITY_REFUSAL_OUTPUT="$(
  cd "$APP_IDENTITY_ROOT"
  CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER=9999999999999999999 \
  node app.js 2>&1
)"
APP_IDENTITY_REFUSAL_STATUS=$?
set -e
test "$APP_IDENTITY_REFUSAL_STATUS" -ne 0
grep -q 'Disposable PostgreSQL identity verification failed' <<<"$APP_IDENTITY_REFUSAL_OUTPUT"
if grep -q 'CANA_APP_IDENTITY_ACCEPTED' <<<"$APP_IDENTITY_REFUSAL_OUTPUT"; then
  echo 'CANA_APP_IDENTITY_REFUSAL_INVALID server started after identity refusal' >&2
  exit 1
fi
if grep -Fq "$DATABASE_URL" <<<"$APP_IDENTITY_REFUSAL_OUTPUT" || grep -Fq "$DIRECT_URL" <<<"$APP_IDENTITY_REFUSAL_OUTPUT"; then
  echo 'CANA_DATABASE_URL_DISCLOSURE_REFUSED app identity-refusal output contained a database URL' >&2
  exit 1
fi
APP_IDENTITY_ACCEPT_OUTPUT="$(cd "$APP_IDENTITY_ROOT" && node app.js 2>&1)"
grep -q 'CANA_APP_IDENTITY_ACCEPTED' <<<"$APP_IDENTITY_ACCEPT_OUTPUT"
rm -rf "$APP_IDENTITY_ROOT"

set +e
IDENTITY_REFUSAL_OUTPUT="$(
  cd "$ACCOUNT"
  CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER=9999999999999999999 \
  CANA_PRE_MIGRATION_BACKUP_RECEIPT="$BACKUP_RECEIPT" \
  sh "$ROOT/deploy/namecheap/migrate.sh" 2>&1
)"
IDENTITY_REFUSAL_STATUS=$?
set -e
test "$IDENTITY_REFUSAL_STATUS" -ne 0
grep -q 'match the connected disposable PostgreSQL identity' <<<"$IDENTITY_REFUSAL_OUTPUT"
if grep -Fq "$DATABASE_URL" <<<"$IDENTITY_REFUSAL_OUTPUT" || grep -Fq "$DIRECT_URL" <<<"$IDENTITY_REFUSAL_OUTPUT"; then
  echo 'CANA_DATABASE_URL_DISCLOSURE_REFUSED identity-refusal output contained a database URL' >&2
  exit 1
fi

MIGRATION_OUTPUT="$(
  cd "$ACCOUNT"
  CANA_PRE_MIGRATION_BACKUP_RECEIPT="$BACKUP_RECEIPT" \
  sh "$ROOT/deploy/namecheap/migrate.sh" 2>&1
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
  if (
    migrationCount[0]?.count !== 3 ||
    coreTables[0]?.count !== 2 ||
    typeof versions[0]?.postgis !== 'string' || versions[0].postgis.length === 0 ||
    typeof versions[0]?.h3 !== 'string' || versions[0].h3.length === 0
  ) {
    throw new Error('CANA_REAL_PRISMA_DATABASE_STATE_INVALID');
  }
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
    forgedLoopbackIdentityRefusalProven: true,
    appIdentityRefusalProven: true,
    appIdentityAcceptanceProven: true,
    migrationOutputRedacted: true,
    backupAuthority: "PROVIDER_OPERATOR_REQUIRED",
    backupRefusalProven: true
  })}\n`);
' "$EXPECTED_SHA" "$PRISMA_VERSION" "$PROOF_JSON"
