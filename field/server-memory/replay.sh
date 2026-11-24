#!/bin/sh
# Replays the field jars against @modelcontextprotocol/server-memory <version> (baseline 1.0.0 for the schema diff).
# The repo's own .specimen/replay.json allows only hollow-inn's tools, so this builds a scratch workspace whose
# replay.json (field/server-memory/replay.json) allows the memory tools, then runs the repo's specimen CLI there.
# Usage, from the repo root: sh field/server-memory/replay.sh 2.2.1
set -e
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
ws="$(mktemp -d)"; mkdir -p "$ws/.kiro" "$ws/.specimen" "$ws/jars"
cp "$here"/jars/*.jsonl "$ws/jars/"; cp "$here/replay.json" "$ws/.specimen/replay.json"; cp "$repo/.specimen/redact.json" "$ws/.specimen/"
cd "$ws"
set +e
"$repo/node_modules/.bin/specimen" replay --server "sh $here/run.sh ${1:?version}" --baseline "sh $here/run.sh 1.0.0" --timeout 60000 --out "$ws/result.json"
code=$?
echo "exit=$code · result: $ws/result.json"
exit $code
