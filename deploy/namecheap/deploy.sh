#!/bin/sh
# Server-side deploy: run in the cPanel Terminal AFTER uploading the
# artifact zip to ~/uploads/. Swaps the release with rollback safety.
#
#   sh ~/uploads/deploy.sh orderweeddc-<full-40-char-sha>.tar.gz <trusted-tarball-sha256>
#
# Layout it maintains:
#   ~/apps/orderweeddc/current    <- live release (cPanel app root)
#   ~/apps/orderweeddc/previous   <- last-known-good (rollback target)
#   managed PostgreSQL            <- external canonical database, NEVER touched here
set -eu

# OWD_APP_HOME enables side-by-side STAGING installs
# (e.g. OWD_APP_HOME=$HOME/apps/orderweeddc-staging). Default: production.
APP_HOME="${OWD_APP_HOME:-$HOME/apps/orderweeddc}"
UPLOADS="${OWD_UPLOADS:-$HOME/uploads}"
TAR_NAME="${1:?usage: deploy.sh <artifact-tar.gz-name in ~/uploads> <trusted-tarball-sha256>}"
EXPECTED_SHA="${2:?usage: deploy.sh <artifact-tar.gz-name in ~/uploads> <trusted-tarball-sha256>}"
TAR_PATH="$UPLOADS/$TAR_NAME"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STRUCTURAL_COURT="${OWD_STRUCTURAL_COURT:-$SCRIPT_DIR/verify-owner-artifact-input.sh}"

printf '%s\n' "$TAR_NAME" | grep -Eq '^orderweeddc-[0-9a-f]{40}\.tar\.gz$' || {
  echo "ERROR: artifact filename must contain the exact full 40-character SHA" >&2
  exit 1
}
printf '%s\n' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{64}$' || {
  echo "ERROR: trusted tarball SHA-256 must be exactly 64 lowercase hex characters" >&2
  exit 1
}

[ -f "$TAR_PATH" ] || { echo "ERROR: $TAR_PATH not found"; exit 1; }
[ -f "$STRUCTURAL_COURT" ] && [ ! -L "$STRUCTURAL_COURT" ] || {
  echo "ERROR: structural artifact verifier unavailable" >&2
  exit 1
}

mkdir -p "$APP_HOME"
STAGE=$(mktemp -d "$APP_HOME/stage-XXXXXX")
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
ARTIFACT_ROOT_NAME=${TAR_NAME%.tar.gz}
VERIFIED_ARCHIVE="$STAGE/verified-artifact.tar.gz"
INVENTORY="$STAGE/artifact-members.txt"
EXTRACTED="$STAGE/extracted"
mkdir -p "$EXTRACTED"

# Snapshot, checksum, and structurally inspect the immutable copy before tar
# extracts any owner-supplied bytes. Then bind its receipt/release/build ID to
# the exact full-SHA artifact root before the code swap.
bash "$STRUCTURAL_COURT" --snapshot-structure-only \
  "$TAR_PATH" "$EXPECTED_SHA" "$ARTIFACT_ROOT_NAME" \
  "$VERIFIED_ARCHIVE" "$INVENTORY" || {
  echo "ERROR: artifact snapshot or structure verification failed" >&2
  exit 1
}
tar -xzf "$VERIFIED_ARCHIVE" -C "$EXTRACTED"

# The archive contains one directory: orderweeddc-<full-40-char-sha>/
RELEASE_DIR="$EXTRACTED/$ARTIFACT_ROOT_NAME"
[ -d "$RELEASE_DIR" ] || { echo "ERROR: archive did not contain the exact release directory"; exit 1; }
[ -f "$RELEASE_DIR/server.js" ] || { echo "ERROR: release missing server.js"; exit 1; }
[ -f "$RELEASE_DIR/receipt.json" ] || { echo "ERROR: release missing receipt.json"; exit 1; }
bash "$STRUCTURAL_COURT" --verify-extracted-identity \
  "$RELEASE_DIR" "$ARTIFACT_ROOT_NAME" || {
  echo "ERROR: release identity verification failed" >&2
  exit 1
}

echo "Deploying release:"
grep -E '"(artifact|gitSha|builtAt)"' "$RELEASE_DIR/receipt.json" || true

# Preserve Passenger's restart directory expectations.
mkdir -p "$RELEASE_DIR/tmp"

# Swap: current -> previous (dropping the older previous), release -> current.
if [ -d "$APP_HOME/current" ]; then
  rm -rf "$APP_HOME/previous"
  mv "$APP_HOME/current" "$APP_HOME/previous"
fi
mv "$RELEASE_DIR" "$APP_HOME/current"
rm -rf "$STAGE"
trap - EXIT HUP INT TERM

# Stable command paths: install wrappers at $APP_HOME so
# `sh ~/apps/orderweeddc/restart.sh` and `sh ~/apps/orderweeddc/rollback.sh`
# always work regardless of release layout (command-path consistency law).
cp "$APP_HOME/current/restart.sh" "$APP_HOME/restart.sh" 2>/dev/null || true
cp "$APP_HOME/current/rollback.sh" "$APP_HOME/rollback.sh" 2>/dev/null || true

# Passenger restart signal.
touch "$APP_HOME/current/tmp/restart.txt"

echo "Deployed code only. Database migrations are a separate owner-authorized step:"
echo "  cd $APP_HOME/current && CANA_PRE_MIGRATION_BACKUP_RECEIPT=<path> sh migrate.sh"
echo "Restart:   sh $APP_HOME/restart.sh"
echo "Rollback:  sh $APP_HOME/rollback.sh"
echo "Verify:    curl -s https://orderweeddc.com/api/health"
