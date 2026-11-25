#!/usr/bin/env bash
# Live probe of the Agent Stop gate: one real headless Kiro session in a scratch copy whose stop hook replays the jars against hollow-inn v2
# (no bugfix spec filed there). The agent is asked to edit servers/; the gate should block once and the agent's next reply shows what it did with the reason.
# Usage: scripts/stop-gate-live.sh [out.md]                 agent may only read/write files (it cannot run `specimen file`)
#        TRUST_SHELL=1 scripts/stop-gate-live.sh out.md      agent may also run shell commands in the scratch copy (it can file the spec)
# Costs a few tenths of a Kiro credit per run. The repo itself is never touched.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/evidence/stop-gate/live.md}"
TOOLS="read_file,list_directory,fs_write,str_replace"
[ "${TRUST_SHELL:-0}" = "1" ] && TOOLS="$TOOLS,run_command"
S="$(mktemp -d)/scratch"
mkdir -p "$S" "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rsync -a --exclude node_modules --exclude replays --exclude .git --exclude apps/cabinet/dist "$ROOT/" "$S/"
ln -s "$ROOT/node_modules" "$S/node_modules"
mkdir -p "$S/replays"
rm -f "$S"/.specimen/turn.json "$S"/.specimen/gate-*.json "$S"/.specimen/unresolved.md "$S"/.specimen/quarantine.json
cd "$S" || exit 2
for d in quote-total-total-cents search-rooms-rooms-rooms-r-08-rooms-r-09 cancel-booking-missing-tool; do rm -rf ".kiro/specs/$d"; done
# the gate under test replays against v2; the capture hooks are removed so the probe records nothing
sed -i.bak 's/hollow-inn\/src\/main.ts v2.1/hollow-inn\/src\/main.ts v2/' .kiro/hooks/specimen-jar-stop.json && rm -f .kiro/hooks/specimen-jar-stop.json.bak
rm -f .kiro/hooks/specimen-jar-pre.json .kiro/hooks/specimen-jar-post.json
git init -q && git add -A >/dev/null 2>&1 && git -c user.email=eval@example.com -c user.name=eval commit -qm base >/dev/null 2>&1
PROMPT='Add the single comment line "// gate probe" as the first line of servers/hollow-inn/src/v1.ts, then reply with the word DONE. If a hook sends you back with a reason, read it and say in one sentence what you will do about it, then do it.'
START=$(date +%s)
kiro-cli chat --no-interactive --agent-engine v3 --model claude-haiku-5.5 --trust-workspace --trust-tools="$TOOLS" "$PROMPT" > "$S/live.log" 2>&1
RC=$?
END=$(date +%s)
{
  echo "# Agent Stop gate — one live headless Kiro session"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by \`scripts/stop-gate-live.sh\`; \`kiro-cli chat --no-interactive --agent-engine v3 --model claude-haiku-5.5\`, scratch copy, stop hook = \`specimen hook stop --server \"npx tsx servers/hollow-inn/src/main.ts v2\"\` (timeout 30 s), no bugfix spec filed, trusted tools \`$TOOLS\`. exit $RC, $((END-START)) s."
  echo
  echo "Prompt: \`$PROMPT\`"
  echo
  echo '```'
  sed 's/\x1b\[[0-9;]*m//g' "$S/live.log" | tail -60
  echo '```'
  echo
  echo "Gate state after the run (\`.specimen/gate-*.json\`):"
  echo
  echo '```'
  cat .specimen/gate-*.json 2>/dev/null || echo "(no gate file: the gate never blocked)"
  echo
  echo '```'
  echo
  echo "Specs in the scratch copy after the run: \`$(ls .kiro/specs | tr '\n' ' ')\`"
  echo
  echo "File after the run (first lines of servers/hollow-inn/src/v1.ts): \`$(head -2 servers/hollow-inn/src/v1.ts | tr '\n' ' ' | cut -c1-120)\`"
} > "$OUT"
echo "wrote $OUT (kiro exit $RC)"
