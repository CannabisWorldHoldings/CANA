#!/bin/sh
# READINESS CHECK — "safe to receive traffic", strictly stronger than
# healthcheck.sh. Read-only. Exit 0 iff ALL of:
#
#   1. /api/health answers 200 + HEALTHY            (liveness)
#   2. /api/release answers 200 + RELEASE_SHA_PRESENT (provenance is stated)
#   3. when OWD_EXPECTED_SHA is set: the running SHA EQUALS it
#      (a healthy app running the WRONG code is not ready)
#   4. the homepage answers 200                      (render path works)
#
#   sh readycheck.sh [base-url]
#   OWD_EXPECTED_SHA=<40-hex> OWD_ORIGIN_IP=<ip> sh readycheck.sh https://staging.example.com
set -eu

BASE="${1:-${OWD_BASE_URL:-https://orderweeddc.com}}"
HOSTNAME_PART=$(printf '%s' "$BASE" | sed -e 's|^https\?://||' -e 's|/.*$||' -e 's|:.*$||')
TMP="${TMPDIR:-/tmp}/owd-ready-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

RESOLVE_ARGS=""
if [ -n "${OWD_ORIGIN_IP:-}" ]; then
  RESOLVE_ARGS="--resolve $HOSTNAME_PART:443:$OWD_ORIGIN_IP --resolve $HOSTNAME_PART:80:$OWD_ORIGIN_IP"
fi

FAILED=0
check() { # label expected_code path grep_pattern(optional)
  LABEL="$1"; WANT="$2"; PATHNAME="$3"; PATTERN="${4:-}"
  # shellcheck disable=SC2086
  CODE=$(curl -s -o "$TMP/body" -w "%{http_code}" --max-time 15 $RESOLVE_ARGS "$BASE$PATHNAME" || echo "000")
  if [ "$CODE" != "$WANT" ]; then
    echo "FAIL  $LABEL — HTTP $CODE (wanted $WANT)"; FAILED=1; return
  fi
  if [ -n "$PATTERN" ] && ! grep -q "$PATTERN" "$TMP/body"; then
    echo "FAIL  $LABEL — body lacks $PATTERN"; FAILED=1; return
  fi
  echo "PASS  $LABEL"
}

check "health HEALTHY"            200 "/api/health"  '"status":"HEALTHY"'
check "release SHA present"       200 "/api/release" '"status":"RELEASE_SHA_PRESENT"'

if [ -n "${OWD_EXPECTED_SHA:-}" ]; then
  # shellcheck disable=SC2086
  RUNNING=$(curl -s --max-time 15 $RESOLVE_ARGS "$BASE/api/release" \
    | sed -n 's/.*"gitSha":"\([0-9a-f]\{40\}\)".*/\1/p')
  if [ "$RUNNING" = "$OWD_EXPECTED_SHA" ]; then
    echo "PASS  running SHA matches expected ($OWD_EXPECTED_SHA)"
  else
    echo "FAIL  running SHA is '${RUNNING:-none}', expected '$OWD_EXPECTED_SHA' — healthy-but-wrong-code is NOT ready"
    FAILED=1
  fi
else
  echo "NOTE  OWD_EXPECTED_SHA unset — provenance presence checked, equality not pinned"
fi

check "homepage renders" 200 "/"

if [ "$FAILED" -ne 0 ]; then
  echo "NOT READY: $BASE"
  exit 1
fi
echo "READY: $BASE"
