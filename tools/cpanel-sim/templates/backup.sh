#!/bin/sh
set -eu
: "${CANA_SHARED_DATA:?}"
: "${CANA_BACKUP_FILE:?}"
test -f "$CANA_SHARED_DATA/cana.db"
mkdir -p "$(dirname "$CANA_BACKUP_FILE")"
sqlite3 "$CANA_SHARED_DATA/cana.db" ".backup '$CANA_BACKUP_FILE'"
