#!/bin/sh
set -eu
: "${CANA_SHARED_DATA:?}"
: "${CANA_BACKUP_FILE:?}"
test -f "$CANA_BACKUP_FILE"
sqlite3 "$CANA_SHARED_DATA/cana.db" ".restore '$CANA_BACKUP_FILE'"
