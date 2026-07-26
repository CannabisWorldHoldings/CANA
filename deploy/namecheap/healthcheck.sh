#!/bin/sh
# HEALTH CHECK (liveness) — read-only. Exit 0 iff the app answers
# 200 + "status":"HEALTHY" on /api/health.
#
#   sh healthcheck.sh [base-url]
#   OWD_BASE_URL=https://staging.example.com sh healthcheck.sh
#   OWD_ORIGIN_IP=203.0.113.10 sh healthcheck.sh https://orderweeddc.com
#
# OWD_ORIGIN_IP pins the connection to the origin (curl --resolve) so origin
# health is judged SEPARATELY from public DNS/edge — the provider's Pingora
# edge has 502'd zone-wide independent of the app (observed 2026-07-23).
# Never conflate the two: this script reports which one it measured.
set -eu

BASE="${1:-${OWD_BASE_URL:-https://orderweeddc.com}}"
HOSTNAME_PART=$(printf '%s' "$BASE" | sed -e 's|^https\?://||' -e 's|/.*$||' -e 's|:.*$||')
OUT="${TMPDIR:-/tmp}/owd-health-$$.json"
trap 'rm -f "$OUT"' EXIT

RESOLVE_ARGS=""
MEASURED="public-dns"
if [ -n "${OWD_ORIGIN_IP:-}" ]; then
  RESOLVE_ARGS="--resolve $HOSTNAME_PART:443:$OWD_ORIGIN_IP --resolve $HOSTNAME_PART:80:$OWD_ORIGIN_IP"
  MEASURED="origin-pinned"
fi

# shellcheck disable=SC2086
CODE=$(curl -s -o "$OUT" -w "%{http_code}" --max-time 15 $RESOLVE_ARGS "$BASE/api/health" || echo "000")

if [ "$CODE" = "200" ] && grep -q '"status":"HEALTHY"' "$OUT"; then
  echo "HEALTHY ($MEASURED) $BASE/api/health"
  exit 0
fi

echo "UNHEALTHY ($MEASURED) $BASE/api/health -> HTTP $CODE"
head -c 300 "$OUT" 2>/dev/null || true; echo
if [ "$MEASURED" = "public-dns" ]; then
  echo "diagnosis order: client -> DNS -> TLS/edge -> vhost/Passenger -> app (failure-signatures.json)."
  echo "A 502 here can be the provider edge, not the app: re-run with OWD_ORIGIN_IP=<origin-ip>."
fi
exit 1
