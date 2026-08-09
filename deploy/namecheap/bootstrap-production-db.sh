#!/bin/sh
set -eu

echo "HARD STOP: bootstrap-production-db.sh is retired by ADR-0001." >&2
echo "CANA has one canonical datastore: owner-provisioned PostgreSQL/PostGIS." >&2
echo "Create a provider backup receipt, then apply committed migrations with:" >&2
echo "  CANA_PRE_MIGRATION_BACKUP_RECEIPT=<path> sh migrate.sh" >&2
echo "This command will not create or modify a SQLite database." >&2
exit 78
