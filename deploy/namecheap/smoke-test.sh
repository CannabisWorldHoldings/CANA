#!/bin/sh
# SMOKE TEST — the full read-only post-deploy battery, with an honest receipt.
#
#   sh smoke-test.sh <base-url>
#   OWD_EXPECTED_SHA=<40-hex> OWD_ORIGIN_IP=<ip> sh smoke-test.sh https://staging.example.com
#
# RECEIPT DISCIPLINE (hard rule): the receipt this writes is labelled
# `environment: staging` unless BOTH OWD_ENVIRONMENT=production AND
# OWD_CONFIRM_PRODUCTION=1 are set. A staging receipt states in plain text
# that it makes NO claim that production is live. No green staging run may
# ever be presented as a production result.
#
# Read-only: GET/HEAD requests only. No writes, no state, no login attempts.
set -eu

BASE="${1:-${OWD_BASE_URL:?usage: smoke-test.sh <base-url> (refusing to default to production)}}"
HOSTNAME_PART=$(printf '%s' "$BASE" | sed -e 's|^https\?://||' -e 's|/.*$||' -e 's|:.*$||')
TMP=$(mktemp -d "${TMPDIR:-/tmp}/owd-smoke-XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# --- Receipt environment gate ------------------------------------------------
ENVIRONMENT="staging"
if [ "${OWD_ENVIRONMENT:-staging}" = "production" ]; then
  if [ "${OWD_CONFIRM_PRODUCTION:-0}" = "1" ]; then
    ENVIRONMENT="production"
  else
    echo "NOTE: OWD_ENVIRONMENT=production requires OWD_CONFIRM_PRODUCTION=1;"
    echo "      writing a STAGING-labelled receipt instead."
  fi
fi

RESOLVE_ARGS=""
MEASURED="public-dns"
if [ -n "${OWD_ORIGIN_IP:-}" ]; then
  RESOLVE_ARGS="--resolve $HOSTNAME_PART:443:$OWD_ORIGIN_IP --resolve $HOSTNAME_PART:80:$OWD_ORIGIN_IP"
  MEASURED="origin-pinned"
fi

PASS=0; FAIL=0; RESULTS="$TMP/results"
: > "$RESULTS"
verdict() { # name ok detail
  if [ "$2" = "1" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1${3:+ — $3}"; fi
  printf '{"check":"%s","ok":%s}\n' "$1" "$([ "$2" = "1" ] && echo true || echo false)" >> "$RESULTS"
}

fetch() { # path -> sets CODE, BODY_FILE, HDR_FILE
  BODY_FILE="$TMP/body"; HDR_FILE="$TMP/hdr"
  # shellcheck disable=SC2086
  CODE=$(curl -s -o "$BODY_FILE" -D "$HDR_FILE" -w "%{http_code}" --max-time 20 $RESOLVE_ARGS "$BASE$1" || echo "000")
}

# --- 1. Health ---------------------------------------------------------------
fetch "/api/health"
OK=0; [ "$CODE" = "200" ] && grep -q '"status":"HEALTHY"' "$BODY_FILE" && OK=1
verdict "health 200 HEALTHY" "$OK" "HTTP $CODE"

# --- 2. Release identity -------------------------------------------------------
fetch "/api/release"
OK=0; [ "$CODE" = "200" ] && grep -q '"status":"RELEASE_SHA_PRESENT"' "$BODY_FILE" && OK=1
verdict "release SHA present (200)" "$OK" "HTTP $CODE $(head -c 120 "$BODY_FILE" 2>/dev/null)"
RUNNING_SHA=$(sed -n 's/.*"gitSha":"\([0-9a-f]\{40\}\)".*/\1/p' "$BODY_FILE" 2>/dev/null || true)

OK=0; grep -qi 'cache-control:.*no-store' "$HDR_FILE" && OK=1
verdict "release identity is no-store" "$OK"

if [ -n "${OWD_EXPECTED_SHA:-}" ]; then
  OK=0; [ "$RUNNING_SHA" = "$OWD_EXPECTED_SHA" ] && OK=1
  verdict "running SHA == expected SHA" "$OK" "running=${RUNNING_SHA:-none} expected=$OWD_EXPECTED_SHA"
fi

# --- 3. Governed public routes -------------------------------------------------
for ROUTE in / /pricing /robots.txt /sitemap.xml /llms.txt; do
  fetch "$ROUTE"
  OK=0; [ "$CODE" = "200" ] && OK=1
  verdict "GET $ROUTE -> 200" "$OK" "HTTP $CODE"
done

# --- 4. Security headers on the homepage ---------------------------------------
fetch "/"
OK=0; grep -qi 'strict-transport-security' "$HDR_FILE" && OK=1
verdict "HSTS header present" "$OK"
OK=1; grep -qi 'x-powered-by' "$HDR_FILE" && OK=0
verdict "x-powered-by absent" "$OK"
OK=0; grep -qi 'content-security-policy' "$HDR_FILE" && OK=1
verdict "CSP header present" "$OK"

# --- 5. Host discipline (origin-pinned mode only: needs Host control) ----------
if [ "$MEASURED" = "origin-pinned" ]; then
  # shellcheck disable=SC2086
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 $RESOLVE_ARGS -H "Host: unknown-host.example" "$BASE/" || echo "000")
  OK=0; [ "$CODE" = "421" ] && OK=1
  verdict "unknown Host refused (421)" "$OK" "HTTP $CODE"
fi

# --- Receipt -------------------------------------------------------------------
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RECEIPT="${OWD_RECEIPT_DIR:-.}/smoke-receipt-$STAMP.json"
CLAIM="This is a $ENVIRONMENT smoke receipt. It asserts only the checks listed, against $BASE ($MEASURED), at $STAMP."
if [ "$ENVIRONMENT" = "staging" ]; then
  CLAIM="$CLAIM It makes NO claim that production is live."
fi
{
  echo "{"
  echo "  \"environment\": \"$ENVIRONMENT\","
  echo "  \"claim\": \"$CLAIM\","
  echo "  \"baseUrl\": \"$BASE\","
  echo "  \"measured\": \"$MEASURED\","
  echo "  \"runningSha\": \"${RUNNING_SHA:-}\","
  echo "  \"expectedSha\": \"${OWD_EXPECTED_SHA:-}\","
  echo "  \"pass\": $PASS,"
  echo "  \"fail\": $FAIL,"
  echo "  \"checks\": ["
  sed '$!s/$/,/' "$RESULTS"
  echo "  ]"
  echo "}"
} > "$RECEIPT"

echo "---"
echo "$CLAIM"
echo "receipt: $RECEIPT  (pass=$PASS fail=$FAIL)"
[ "$FAIL" -eq 0 ] || exit 1
