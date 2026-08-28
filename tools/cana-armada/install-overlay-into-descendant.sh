#!/usr/bin/env bash
set -euo pipefail
EXPECTED_HEAD='9ba72d607150efec429f0718715918b823d36e94'
EXPECTED_TREE='2943dc4c008d6bc5f2373c84930034f7e60422e1'
DESC="${1:-}"
OVERLAY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -n "$DESC" ]] || { echo 'usage: install-overlay-into-descendant.sh /path/to/exact-c3-pass-descendant' >&2; exit 2; }
actual_head="$(git -C "$DESC" rev-parse HEAD)"; actual_tree="$(git -C "$DESC" rev-parse HEAD^{tree})"
[[ "$actual_head" == "$EXPECTED_HEAD" ]] || { echo "C3 HEAD mismatch: $actual_head" >&2; exit 3; }
[[ "$actual_tree" == "$EXPECTED_TREE" ]] || { echo "C3 tree mismatch: $actual_tree" >&2; exit 4; }
[[ -z "$(git -C "$DESC" status --porcelain=v1)" ]] || { echo 'C3 target must be clean' >&2; exit 5; }
# This is a preparation helper only. It must not overwrite canonical capability owners.
for target in 'apps/web/src/lib/cana-intelligence' 'apps/web/tests/cana-intelligence-kernel.test.mjs' 'apps/web/tests/cana-intelligence-full-fabric.test.mjs' 'apps/web/tests/cana-intelligence-v3-adversarial.test.mjs' 'tools/cana-armada'; do
  [[ ! -e "$DESC/$target" ]] || { echo "target already exists; reconcile through capability census, refusing overwrite: $target" >&2; exit 6; }
done
mkdir -p "$DESC/apps/web/src/lib/cana-intelligence" "$DESC/apps/web/tests" "$DESC/tools/cana-armada" "$DESC/docs/armada"
cp -R "$OVERLAY/apps/web/src/lib/cana-intelligence/." "$DESC/apps/web/src/lib/cana-intelligence/"
cp "$OVERLAY/apps/web/tests/cana-intelligence-kernel.test.mjs" "$DESC/apps/web/tests/"
cp "$OVERLAY/apps/web/tests/cana-intelligence-full-fabric.test.mjs" "$DESC/apps/web/tests/"
cp "$OVERLAY/apps/web/tests/cana-intelligence-v3-adversarial.test.mjs" "$DESC/apps/web/tests/"
cp -R "$OVERLAY/tools/cana-armada/." "$DESC/tools/cana-armada/"
cp -R "$OVERLAY/docs/armada/." "$DESC/docs/armada/"
echo 'WELD v3 overlay prepared against exact C3 PASS descendant.'
echo 'No commit, push, merge, deploy, DB mutation, route creation, or production effect was performed.'
echo 'Before canonical integration: run ./cana census declare and reconcile each capability into its existing owner.'
