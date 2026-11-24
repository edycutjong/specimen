#!/bin/bash
# Usage: setup-ws.sh <workspace-dir>  — scratch Kiro workspace for spikes S0/S2/S3 (outside the repo; nothing here is committed).
# Registers the toy stdio server twice: as `hollowinn` (no separators) and as `hollow-inn-x` (sanitiser probe, S3).
set -euo pipefail
WS="$1"; REPO="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$WS/.kiro/settings" "$WS/.kiro/hooks" "$WS/out"
TSX="$REPO/node_modules/.bin/tsx"; SRV="$REPO/spikes/kiro/toy-stdio.ts"; HOOK="node $REPO/spikes/kiro/hook.mjs"
cat > "$WS/.kiro/settings/mcp.json" <<JSON
{"mcpServers":{
  "hollowinn":{"command":"$TSX","args":["$SRV","v1"]},
  "hollow-inn-x":{"command":"$TSX","args":["$SRV","v1"]}
}}
JSON
cat > "$WS/.kiro/hooks/capture.json" <<JSON
{"version":"v1","hooks":[
 {"name":"pre-hollowinn","trigger":"PreToolUse","matcher":"@hollowinn","action":{"type":"command","command":"$HOOK pre-hollowinn $WS/out"}},
 {"name":"post-hollowinn","trigger":"PostToolUse","matcher":"@hollowinn","action":{"type":"command","command":"$HOOK post-hollowinn $WS/out"}},
 {"name":"post-hollow-inn-x","trigger":"PostToolUse","matcher":"@hollow-inn-x","action":{"type":"command","command":"$HOOK post-hollow-inn-x $WS/out"}},
 {"name":"post-mcp","trigger":"PostToolUse","matcher":"@mcp","action":{"type":"command","command":"$HOOK post-mcp $WS/out"}}
]}
JSON
echo "$WS"
