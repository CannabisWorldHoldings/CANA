#!/bin/sh
# Roll back to the last-known-good release. Run in the cPanel Terminal:
#   sh ~/apps/orderweeddc/rollback.sh
# The database is never touched: rollback swaps code only.
set -eu

# OWD_APP_HOME override supports staging installs; default is production.
APP_HOME="${OWD_APP_HOME:-$HOME/apps/orderweeddc}"

[ -d "$APP_HOME/previous" ] || { echo "ERROR: no previous release to roll back to"; exit 1; }
[ -f "$APP_HOME/previous/server.js" ] || { echo "ERROR: previous release is incomplete"; exit 1; }

BROKEN="$APP_HOME/broken-$(date +%Y%m%d%H%M%S)"
mv "$APP_HOME/current" "$BROKEN"
mv "$APP_HOME/previous" "$APP_HOME/current"
mkdir -p "$APP_HOME/current/tmp"
touch "$APP_HOME/current/tmp/restart.txt"

echo "Rolled back. Broken release preserved at: $BROKEN"
echo "Rolled-back release identity:"
grep -E '"(artifact|gitSha|builtAt)"' "$APP_HOME/current/receipt.json" || true
echo "Verify:  curl -s https://orderweeddc.com/api/health"
