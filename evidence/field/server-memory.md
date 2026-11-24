# Field shelf — @modelcontextprotocol/server-memory 1.0.0 → 2.2.1 (P1b, 2026-11-25 03:48 WIB)

The 5 jars in `field/server-memory/jars/` were captured by specimen's own hooks from one real headless Kiro session
against the public npm package `@modelcontextprotocol/server-memory@1.0.0` (prompt: `prompts/field-memory.md`).
Replayed from a scratch workspace whose `.specimen/replay.json` allows the memory tools (the repo's own replay.json
allows only hollow-inn), each session on a fresh empty `MEMORY_FILE_PATH` (`field/server-memory/run.sh`):

```
specimen replay --server "sh field/server-memory/run.sh <version>" --baseline "sh field/server-memory/run.sh 1.0.0" --timeout 60000
```

| target | verdict | jars compared | preserved | rattled | cracked | schema diff vs 1.0.0 |
|---|---|---|---|---|---|---|
| 1.0.0 (self-replay) | SHIP | 5 | 5 | 0 | 0 | nothing |
| 2.2.1 | SHIP | 5 | 5 | 0 | 0 | input schema changed on 9 of 9 tools |

Result files: `server-memory-1.0.0-self.json`, `server-memory-vs-2.2.1.json` (exit 0 both).

What this shows, and only this: across 1.0.0 → 2.2.1 the five recorded calls (create_entities, create_relations,
search_nodes, open_nodes, read_graph) return the same responses, while a tools/list schema diff reports an input-schema
change on every tool. It is NOT a claim that 2.2.1 is safe — "clean on the recorded set" only; 4 of 9 tools were never
recorded (add_observations, delete_entities, delete_observations, delete_relations). No break was found on this shelf
in hour 1 — a null result, reported as one.

What the schema diff is reacting to (probed by listing tools on both versions): e.g. `search_nodes` gained two OPTIONAL
inputs in 2.2.1, `limit` and `observationLimit`, with `required: ["query"]` unchanged — additive, and a call that omits
them (as the recorded one does) still replays identically.
