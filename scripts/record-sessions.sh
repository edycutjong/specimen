#!/usr/bin/env bash
# Record the racks: real headless Kiro sessions against hollow-inn v1, captured ONLY by specimen's own Kiro hooks.
#
#   scripts/record-sessions.sh record [WORKSPACE] [RACKS...]   # default racks: a b — runs prompts/rack-<r>.md
#   scripts/record-sessions.sh followup WORKSPACE RACK "<prompt>"  # one same-session follow-up (--resume-id) for a missing call
#   scripts/record-sessions.sh promote WORKSPACE               # copy the jars into jars/, write racks.json + MANIFEST.sha256
#
# The workspace is a scratch directory outside the repo: its own .kiro/ (mcp.json + capture hooks + firewall),
# its own .specimen/ (counter, pending, redaction policy) and its own jars/. Nothing in a jar is typed by hand:
# promote copies the files byte for byte and refuses to overwrite an existing jar.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SPECIMEN="$REPO/node_modules/.bin/specimen"
TSX="$REPO/node_modules/.bin/tsx"
KIRO=(kiro-cli chat --no-interactive --agent-engine v3 --trust-workspace --trust-tools=@hollowinn)

setup() {
  local ws="$1"
  mkdir -p "$ws/.kiro/settings" "$ws/.kiro/hooks" "$ws/.specimen" "$ws/jars"
  cat > "$ws/.kiro/settings/mcp.json" <<JSON
{"mcpServers":{"hollowinn":{"command":"$TSX","args":["$REPO/servers/hollow-inn/src/main.ts","v1"]}}}
JSON
  cat > "$ws/.kiro/hooks/specimen-capture.json" <<JSON
{"version":"v1","hooks":[
 {"name":"specimen-jar-pre","trigger":"PreToolUse","matcher":"@hollowinn","action":{"type":"command","command":"$SPECIMEN hook pre --server hollowinn"}},
 {"name":"specimen-jar-post","trigger":"PostToolUse","matcher":"@hollowinn","action":{"type":"command","command":"$SPECIMEN hook post --server hollowinn"}},
 {"name":"specimen-jar-firewall","trigger":"PreToolUse","matcher":"write","action":{"type":"command","command":"$SPECIMEN hook firewall"}}
]}
JSON
  cp "$REPO/.specimen/redact.json" "$ws/.specimen/redact.json"
  [ -f "$ws/.specimen/counter" ] || [ ! -f "$REPO/.specimen/counter" ] || cp "$REPO/.specimen/counter" "$ws/.specimen/counter"
}

new_jar() { comm -13 <(echo "$1") <(ls "$2/jars" 2>/dev/null | grep '\.jsonl$' | sort); }

cmd="${1:-record}"; shift || true
case "$cmd" in
  record)
    WS="${1:-$(mktemp -d "${TMPDIR:-/tmp}/specimen-record-XXXXXX")}"; shift || true
    RACKS=("${@:-a b}"); [ "$#" -gt 0 ] || RACKS=(a b)
    setup "$WS"
    for r in "${RACKS[@]}"; do
      before="$(ls "$WS/jars" | grep '\.jsonl$' | sort || true)"
      echo "rack $r: $(date -u +%FT%TZ) kiro-cli … prompts/rack-$r.md (workspace $WS)"
      (cd "$WS" && "${KIRO[@]}" "$(sed 1d "$REPO/prompts/rack-$r.md")") > "$WS/rack-$r.log" 2>&1 || echo "rack $r: kiro-cli exit $?"
      jar="$(new_jar "$before" "$WS")"
      echo "rack $r: jar ${jar:-NONE}"
      [ -n "$jar" ] && printf '%s\t%s\n' "$r" "$jar" >> "$WS/racks.tsv"
      [ -n "$jar" ] && node -e 'for (const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)) { const j = JSON.parse(l); console.log(`  ${j.id}  seq ${j.seq}  ${j.tool}  ${JSON.stringify(j.input)}`); }' "$WS/jars/$jar"
    done
    echo "$WS" ;;
  followup)
    WS="$1"; r="$2"; prompt="$3"
    jar="$(awk -v r="$r" '$1==r{print $2}' "$WS/racks.tsv")"; sid="${jar%.jsonl}"
    (cd "$WS" && "${KIRO[@]}" --resume-id "$sid" "$prompt") >> "$WS/rack-$r.log" 2>&1 || echo "followup $r: kiro-cli exit $?"
    node -e 'for (const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)) { const j = JSON.parse(l); console.log(`  ${j.id}  seq ${j.seq}  ${j.tool}`); }' "$WS/jars/$jar" ;;
  promote)
    WS="$1"; mkdir -p "$REPO/jars"
    while IFS=$'\t' read -r r jar; do
      [ -e "$REPO/jars/$jar" ] && { echo "refusing to overwrite jars/$jar"; exit 1; }
      cp "$WS/jars/$jar" "$REPO/jars/$jar"
    done < "$WS/racks.tsv"
    node -e 'const fs=require("fs"); const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>l.split("\t")); const out={}; for (const [r,j] of rows) out["RACK "+r.toUpperCase()]=j; fs.writeFileSync(process.argv[2], JSON.stringify(out,null,2)+"\n")' "$WS/racks.tsv" "$REPO/jars/racks.json"
    cp "$WS/.specimen/counter" "$REPO/.specimen/counter"
    (cd "$REPO" && "$SPECIMEN" manifest write && "$SPECIMEN" manifest check && echo "promoted: $(ls jars | tr '\n' ' ')") ;;
  *) echo "usage: $0 record|followup|promote …" >&2; exit 2 ;;
esac
