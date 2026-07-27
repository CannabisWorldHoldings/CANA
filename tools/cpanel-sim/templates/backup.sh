#!/bin/sh
set -eu
: "${CANA_SHARED_DATA:?}"
: "${CANA_BACKUP_FILE:?}"
test -f "$CANA_SHARED_DATA/cana.db"
mkdir -p "$(dirname "$CANA_BACKUP_FILE")"
node "$CANA_RELEASE_ROOT/sqlite-tool.mjs" backup "$CANA_SHARED_DATA/cana.db" "$CANA_BACKUP_FILE"
