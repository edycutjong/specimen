#!/bin/bash
# Usage: setup-stop.sh <workspace-dir> <json|exit1|slow> [timeoutSeconds] [sleepMs]  — adds an Agent Stop hook (spike S2) to a setup-ws.sh workspace.
set -euo pipefail
WS="$1"; MODE="$2"; TIMEOUT="${3:-30}"; SLEEP="${4:-0}"; REPO="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$REPO/spikes/kiro/setup-ws.sh" "$WS" >/dev/null
cat > "$WS/.kiro/hooks/stop.json" <<JSON
{"version":"v1","hooks":[
 {"name":"spike-s2-stop","trigger":"Stop","timeout":$TIMEOUT,"action":{"type":"command","command":"node $REPO/spikes/kiro/stop-hook.mjs $WS/out $MODE $SLEEP"}}
]}
JSON
echo "$WS"
