#!/bin/sh
# Start @modelcontextprotocol/server-memory <version> on stdio with a FRESH, empty knowledge-graph file, so every
# replayed session starts from the same empty state the recorded session started from.
# Usage (replay): specimen replay --jars field/server-memory/jars --server "sh field/server-memory/run.sh 2.2.1"
export MEMORY_FILE_PATH="$(mktemp -d)/graph.jsonl"
exec npx -y "@modelcontextprotocol/server-memory@${1:?version}"
