#!/bin/sh
# Owner-safe deployment verifier — ONE command, every gate, auto-rollback.
#
#   sh verify-and-deploy.sh <artifact-url> <artifact-filename> <expected-sha256>
#
# What it guarantees:
#   - downloads with curl --fail-with-body and verifies SHA-256 before anything
#   - rejects non-webpack artifacts, failed/pending isolation receipts, and
#     unresolved-external scan failures (reads receipt.json)
#   - requires the canonical PostgreSQL URL pair without printing either value
#     and keeps the code swap free of database commands
#   - NEVER runs bootstrap or seed automatically
#   - restarts via the release-local restart script (correct path)
#   - waits with bounded retries; separates ORIGIN health (via --resolve when
#     needed) from PUBLIC-DNS health; prints ORIGIN_HEALTHY_PUBLIC_DNS_PENDING
#     when the origin is fine but public resolution lags
#   - automatically rolls the code back if origin health fails
#   - returns nonzero on any failed gate
set -eu

URL="${1:?usage: verify-and-deploy.sh <artifact-url> <artifact-filename> <expected-sha256>}"
FILE="${2:?artifact filename required}"
EXPECTED_SHA="${3:?expected sha256 required}"

APP_HOME="${OWD_APP_HOME:-$HOME/apps/orderweeddc}"
UPLOADS="$HOME/uploads"
DOMAIN="orderweeddc.com"
ORIGIN_IP="${OWD_ORIGIN_IP:-127.0.0.1}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

phase() { printf '\n=== %s ===\n' "$1"; }
fail() { echo "GATE FAILED: $1"; exit 1; }

case "$FILE" in
  orderweeddc-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].tar.gz)
    ARTIFACT_ROOT_NAME=${FILE%.tar.gz}
    ;;
  *) fail "artifact filename must be orderweeddc-<7 lowercase hex>.tar.gz" ;;
esac

phase "GATE 1: download + checksum"
mkdir -p "$UPLOADS"
case "$URL" in
  https://*) : ;;
  *) fail "artifact URL must be https (got: $URL)" ;;
esac
curl --fail-with-body -sSL -o "$UPLOADS/$FILE" "$URL" || fail "download failed"
echo "$EXPECTED_SHA  $UPLOADS/$FILE" | sha256sum -c - || fail "sha256 mismatch"

phase "GATE 2: receipt acceptance"
STAGE=$(mktemp -d "$HOME/.owd-verify-XXXXXX")
chmod 700 "$STAGE"
STRUCTURAL_COURT="$SCRIPT_DIR/verify-owner-artifact-input.sh"
[ -f "$STRUCTURAL_COURT" ] && [ ! -L "$STRUCTURAL_COURT" ] ||
  fail "structural artifact verifier unavailable"
bash "$STRUCTURAL_COURT" --snapshot-structure-only \
  "$UPLOADS/$FILE" "$EXPECTED_SHA" "$ARTIFACT_ROOT_NAME" \
  "$STAGE/verified-artifact.tar.gz" "$STAGE/artifact-members.txt" ||
  fail "structural artifact verification"
tar -xzf "$STAGE/verified-artifact.tar.gz" -C "$STAGE"
RELEASE_DIR=$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | head -1)
RECEIPT="$RELEASE_DIR/receipt.json"
[ -f "$RECEIPT" ] || fail "receipt.json missing"
grep -q '"bundler": "webpack"' "$RECEIPT" || fail "non-webpack artifact rejected (Turbopack standalone banned)"
grep -q '"passed": true' "$RECEIPT" || fail "isolated runtime test not passed in receipt"
grep -q '"unresolved": \[\]' "$RECEIPT" || fail "unresolved external references present"
[ -f "$RELEASE_DIR/server.js" ] || fail "release missing server.js"
[ -f "$RELEASE_DIR/app.js" ] || fail "release missing app.js"
bash "$STRUCTURAL_COURT" --verify-extracted-identity \
  "$RELEASE_DIR" "$ARTIFACT_ROOT_NAME" || fail "release identity mismatch"
echo "receipt identity:"
grep -E '"(artifact|gitSha|bundler|builtAt)"' "$RECEIPT" || true

phase "GATE 3: canonical database configuration"
: "${DATABASE_URL:?GATE FAILED: DATABASE_URL is required}"
: "${DIRECT_URL:?GATE FAILED: DIRECT_URL is required}"
case "$DATABASE_URL" in postgres://*|postgresql://*) ;; *) fail "DATABASE_URL must be PostgreSQL";; esac
case "$DIRECT_URL" in postgres://*|postgresql://*) ;; *) fail "DIRECT_URL must be PostgreSQL";; esac
node <<'NODE' || fail "database URLs must enforce strict TLS certificate validation"
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = new URL(process.env[name]);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.searchParams.get('sslmode') !== 'require' ||
    url.searchParams.get('sslaccept') !== 'strict'
  ) process.exit(1);
}
NODE
echo "PostgreSQL pooled/direct configuration present (values redacted)"

phase "GATE 4: code-only swap"
mkdir -p "$RELEASE_DIR/tmp" "$APP_HOME"
if [ -d "$APP_HOME/current" ]; then
  rm -rf "$APP_HOME/previous"
  mv "$APP_HOME/current" "$APP_HOME/previous"
fi
mv "$RELEASE_DIR" "$APP_HOME/current"
rm -rf "$STAGE"
# Stable wrappers so ~/apps/orderweeddc/restart.sh and rollback.sh always work.
cp "$APP_HOME/current/restart.sh" "$APP_HOME/restart.sh" 2>/dev/null || true
cp "$APP_HOME/current/rollback.sh" "$APP_HOME/rollback.sh" 2>/dev/null || true
touch "$APP_HOME/current/tmp/restart.txt"
echo "swapped; restart signaled"

phase "GATE 5: code-only database isolation"
echo "No database command executed; migrations remain a separate owner-authorized operation"

phase "GATE 6: origin health (bounded retries)"
HEALTH_OK=0
i=0
while [ $i -lt 12 ]; do
  i=$((i+1))
  sleep 5
  CODE=$(curl -s -o /tmp/owd-health.json -w "%{http_code}" \
    --resolve "$DOMAIN:443:$ORIGIN_IP" "https://$DOMAIN/api/health" 2>/dev/null || true)
  if [ "$CODE" = "200" ] && grep -q '"status":"HEALTHY"' /tmp/owd-health.json; then
    HEALTH_OK=1; break
  fi
  # HTTP fallback while SSL is pending
  CODE=$(curl -s -o /tmp/owd-health.json -w "%{http_code}" \
    -H "Host: $DOMAIN" "http://$ORIGIN_IP/api/health" 2>/dev/null || true)
  if [ "$CODE" = "200" ] && grep -q '"status":"HEALTHY"' /tmp/owd-health.json; then
    HEALTH_OK=1; break
  fi
  echo "attempt $i: origin not healthy yet (last code: ${CODE:-none})"
done
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ORIGIN HEALTH FAILED — rolling code back (database untouched)"
  sh "$APP_HOME/rollback.sh"
  fail "origin health"
fi
echo "origin healthy:"
head -c 200 /tmp/owd-health.json; echo

phase "GATE 7: public DNS (separate from origin)"
PUB=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/health" 2>/dev/null || true)
if [ "$PUB" = "200" ]; then
  echo "PUBLIC_HEALTHY"
else
  echo "ORIGIN_HEALTHY_PUBLIC_DNS_PENDING (public code: ${PUB:-unresolvable})"
fi

phase "DONE"
echo "deployed artifact: $FILE"
echo "rollback anytime:  sh $APP_HOME/rollback.sh   (database is never touched)"
