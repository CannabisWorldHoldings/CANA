#!/usr/bin/env bash
set -euo pipefail
echo 'Direct overlay mutation of the protected champion is intentionally disabled.' >&2
echo 'Use the top-level apply-to-local-cana.sh; it creates an isolated descendant first.' >&2
exit 64
