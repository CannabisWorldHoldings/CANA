#!/bin/sh
# RESTORE a database backup produced by worker.mjs — to a DIFFERENT location
# by default, because proving a backup restorable must not risk the live db.
#
#   sh restore-backup.sh <backup-file.db> <target-db-path>
#   FORCE=1 sh restore-backup.sh <backup-file.db> <existing-target.db>
#
# Guarantees:
#   - The .sha256 sidecar is VERIFIED before anything is written (a backup
#     that fails its own checksum is corrupt and must not be restored).
#   - An existing, non-empty target is NEVER overwritten without FORCE=1,
#     and FORCE overwrites only after backing the target up first.
#   - When run from a release root, the restored file is proven READABLE
#     via scripts/db-inspect.mjs (table inventory printed), not just copied.
set -eu

BACKUP="${1:?usage: restore-backup.sh <backup-file.db> <target-db-path>}"
TARGET="${2:?target database path required}"

[ -f "$BACKUP" ] || { echo "HARD STOP: backup not found: $BACKUP"; exit 1; }

# 1. Checksum gate.
if [ -f "$BACKUP.sha256" ]; then
  ( cd "$(dirname "$BACKUP")" && sha256sum -c "$(basename "$BACKUP").sha256" ) \
    || { echo "HARD STOP: backup fails its own checksum — refusing to restore corruption"; exit 1; }
  echo "checksum verified: $(cut -d' ' -f1 < "$BACKUP.sha256")"
else
  echo "WARNING: no .sha256 sidecar next to $BACKUP — integrity unproven, continuing"
fi

# 2. Overwrite gate.
if [ -f "$TARGET" ] && [ -s "$TARGET" ]; then
  if [ "${FORCE:-0}" != "1" ]; then
    echo "HARD STOP: target exists and is non-empty: $TARGET"
    echo "Restore to a NEW path to prove restorability, or FORCE=1 after due care."
    exit 1
  fi
  SAFETY="$TARGET.pre-restore-$(date -u +%Y%m%d%H%M%S)"
  cp -p "$TARGET" "$SAFETY"
  echo "existing target backed up to: $SAFETY"
fi

mkdir -p "$(dirname "$TARGET")"
cp "$BACKUP" "$TARGET"
chmod 600 "$TARGET"
echo "restored: $BACKUP -> $TARGET"

# 3. Readability proof (when the release tooling is present).
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$HERE/scripts/db-inspect.mjs" ]; then
  NODE_BIN="${OWD_NODE:-$(command -v node || echo /opt/alt/alt-nodejs20/root/usr/bin/node)}"
  echo "inventory of restored database:"
  DATABASE_URL="file:$TARGET" "$NODE_BIN" "$HERE/scripts/db-inspect.mjs" \
    || { echo "HARD STOP: restored file is not readable as this schema"; exit 1; }
else
  echo "NOTE: run scripts/db-inspect.mjs against the restored file from a release root to prove readability."
fi
echo "RESTORE COMPLETE — restored data is only proven once inspected above."
