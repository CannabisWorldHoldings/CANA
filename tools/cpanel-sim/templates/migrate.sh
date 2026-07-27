#!/bin/sh
set -eu
: "${CANA_SHARED_DATA:?}"
mkdir -p "$CANA_SHARED_DATA"
DB="$CANA_SHARED_DATA/cana.db"
node "$CANA_RELEASE_ROOT/sqlite-tool.mjs" migrate "$DB"
