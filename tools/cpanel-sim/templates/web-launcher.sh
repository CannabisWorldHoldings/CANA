#!/bin/sh
set -eu
: "${CANA_RELEASE_ROOT:?}"
exec node "$CANA_RELEASE_ROOT/app-server.mjs"
