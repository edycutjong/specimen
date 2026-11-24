#!/usr/bin/env bash
# Consequence run (seed-data "Consequence run"): does the agent's OWN answer change when the server moves to v2?
#
#   scripts/consequence-run.sh [VERSION...]      # default: v1 v2 — v1 is the control, same prompts, same setup
#
# For each version: a fresh scratch Kiro workspace outside the repo whose .kiro/settings/mcp.json starts
# hollow-inn <VERSION>, with NO hooks (capture off — nothing is jarred, nothing is gated), then the fixed RACK A and
# RACK B recording prompts (prompts/rack-a.md, prompts/rack-b.md) run headless exactly as they were recorded.
# The full stdout transcript of every run is written to evidence/consequence-v2/<version>-rack-<r>.log, untouched.
# Nothing is re-prompted: whatever the agent says is the result.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TSX="$REPO/node_modules/.bin/tsx"
OUT="$REPO/evidence/consequence-v2"
KIRO=(kiro-cli chat --no-interactive --agent-engine v3 --trust-workspace --trust-tools=@hollowinn)
VERSIONS=("$@"); [ "$#" -gt 0 ] || VERSIONS=(v1 v2)
mkdir -p "$OUT"
for v in "${VERSIONS[@]}"; do
  for r in a b; do
    WS="$(mktemp -d "${TMPDIR:-/tmp}/specimen-consequence-$v-$r-XXXXXX")"
    mkdir -p "$WS/.kiro/settings"
    cat > "$WS/.kiro/settings/mcp.json" <<JSON
{"mcpServers":{"hollowinn":{"command":"$TSX","args":["$REPO/servers/hollow-inn/src/main.ts","$v"]}}}
JSON
    log="$OUT/$v-rack-$r.log"
    {
      echo "# consequence run · hollow-inn $v · RACK $(echo "$r" | tr a-z A-Z) · $(date -u +%FT%TZ) · kiro-cli $(kiro-cli --version | awk '{print $2}') · capture hooks OFF (no .kiro/hooks in the workspace)"
      echo "# prompt (prompts/rack-$r.md, verbatim): $(sed 1d "$REPO/prompts/rack-$r.md")"
      echo
    } > "$log"
    (cd "$WS" && "${KIRO[@]}" "$(sed 1d "$REPO/prompts/rack-$r.md")") >> "$log" 2>&1 || echo "# kiro-cli exit $?" >> "$log"
    echo "$v rack $r → $log (workspace $WS)"
  done
done
