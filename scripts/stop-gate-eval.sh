#!/usr/bin/env bash
# Evals E1-E3 for the Agent Stop gate, run through the real CLI hooks in a scratch copy of this repository (the repo itself is never touched).
# Usage: scripts/stop-gate-eval.sh [out.md]     Default output: evidence/stop-gate/eval.md
# Deterministic: it calls `specimen hook prompt` / `specimen hook stop` with the Stop payload keys measured in evidence/spikes/S2.md.
# It does NOT run a Kiro session; whether a given Kiro surface acts on the block is measured separately (S2).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/evidence/stop-gate/eval.md}"
BIN="$ROOT/packages/cli/bin/specimen.mjs"
S="$(mktemp -d)/scratch"
mkdir -p "$S" "$(dirname "$OUT")"
rsync -a --exclude node_modules --exclude replays --exclude .git --exclude apps/cabinet/dist "$ROOT/" "$S/"
ln -s "$ROOT/node_modules" "$S/node_modules"
mkdir -p "$S/replays"
rm -f "$S"/.specimen/turn.json "$S"/.specimen/gate-*.json "$S"/.specimen/unresolved.md "$S"/.specimen/quarantine.json
cd "$S" || exit 2
# the scratch copy starts with NO filed bugfix specs for the jars
for d in quote-total-total-cents search-rooms-rooms-rooms-r-08-rooms-r-09 cancel-booking-missing-tool; do rm -rf ".kiro/specs/$d"; done
git init -q && git add -A >/dev/null 2>&1 && git -c user.email=eval@example.com -c user.name=eval commit -qm base >/dev/null 2>&1
V1="npx tsx servers/hollow-inn/src/main.ts v1"
V2="npx tsx servers/hollow-inn/src/main.ts v2"
payload() { printf '{"session_id":"%s","hook_event_name":"Stop","cwd":"%s"}' "$1" "$S"; }
run_stop() { # session, server command -> prints "stdout | exit code | wall s"
  local t0 t1 out rc
  t0=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
  out=$(payload "$1" | node "$BIN" hook stop --server "$2"); rc=$?
  t1=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
  printf '`` %s `` · exit %s · %.1f s\n' "${out:-<no output: the agent may stop>}" "$rc" "$(perl -e "print $t1 - $t0")"
}
{
  echo "# Agent Stop gate — evals E1–E3 through the real hooks"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by \`scripts/stop-gate-eval.sh\` in a scratch copy with no filed bugfix specs. Each row calls \`specimen hook prompt\` (turn snapshot), edits \`servers/\`, then \`specimen hook stop --server <cmd>\`."
  echo
  echo "| Eval | Setup | Gate output (STDOUT) · exit · wall |"
  echo "|---|---|---|"
  payload s-e0 | node "$BIN" hook prompt
  echo "| E0 | turn changed nothing under \`servers/\`, server v2 | $(run_stop s-e0 "$V2") |"
  echo "// edit" >> servers/hollow-inn/src/v1.ts
  echo "| E2 | turn edited \`servers/\`, server v2, no spec filed | $(run_stop s-e0 "$V2") |"
  echo "| E2 (2nd stop, same session) | same | $(run_stop s-e0 "$V2") |"
  echo "| E2 (3rd stop, same session) | same | $(run_stop s-e0 "$V2") |"
  echo "| cap | 4th stop, same session (3 blocks already issued) | $(run_stop s-e0 "$V2") |"
  cp -R "$ROOT/.kiro/specs/quote-total-total-cents" .kiro/specs/
  payload s-e3 | node "$BIN" hook prompt
  echo "// edit2" >> servers/hollow-inn/src/v1.ts
  echo "| E3 | new session; the \`quote\` bugfix spec is filed (covers SPC-0002, 0006, 0007), the other red jars are not | $(run_stop s-e3 "$V2") |"
  payload s-e1 | node "$BIN" hook prompt
  echo "// edit3" >> servers/hollow-inn/src/v1.ts
  echo "| E1 | new session; server v1 replayed against its own jars | $(run_stop s-e1 "$V1") |"
  echo
  echo '`.specimen/unresolved.md` after the 4th stop (the cap):'
  echo
  echo '```'
  cat .specimen/unresolved.md 2>/dev/null || echo "(missing)"
  echo '```'
} > "$OUT"
echo "wrote $OUT"
