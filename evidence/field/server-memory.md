# Field shelf — @modelcontextprotocol/server-memory 1.0.0 → 2.2.1 (P1b, 2026-11-25 WIB)

The 5 jars in `field/server-memory/jars/` were captured by specimen's own hooks from one real headless Kiro session
against the public npm package `@modelcontextprotocol/server-memory@1.0.0` (prompt: `prompts/field-memory.md`).

Reproduce (from the repo root; each replayed session starts on a fresh empty `MEMORY_FILE_PATH`, `field/server-memory/run.sh`):

```sh
sh field/server-memory/replay.sh 1.0.0   # self-replay
sh field/server-memory/replay.sh 2.2.1
```

`replay.sh` builds a scratch workspace whose `.specimen/replay.json` is `field/server-memory/replay.json` (it allows six of
the nine memory tools — the three `delete_*` tools are excluded; the repo's own replay.json allows only hollow-inn's), then runs
`specimen replay --server "sh field/server-memory/run.sh <version>" --baseline "sh field/server-memory/run.sh 1.0.0"`.

Re-run 2026-11-25 22:33 WIB after the agent-review round 05 change to the replay engine (a clean text compare no
longer vouches for result content the text does not carry — `uncoveredContent` in `packages/core/src/replay.ts`):

| target | verdict | jars compared | preserved | rattled | cracked | unsealed | input-schema diff vs 1.0.0 | exit |
|---|---|---|---|---|---|---|---|---|
| 1.0.0 (self-replay) | HOLD | 3 | 3 | 0 | 0 | 2 | nothing | 1 |
| 2.2.1 | HOLD | 3 | 3 | 0 | 0 | 2 | inputSchema changed on 9 of 9 tools | 1 |

The two unsealed jars are `create_entities` and `create_relations`. Both versions return the created items twice: as
text, a bare JSON array, and as `structuredContent`, the same array wrapped in an object (`{"entities": [...]}` for
`create_entities`). The wrapper key is not in the text, and a jar records only the text the agent saw, so specimen
cannot tell whether that key survived — it says so (unsealed, HOLD) instead of calling the jar preserved. The other
three tools return a `structuredContent` equal to their text, which counts as covered. Before this change (P1b run,
same jars, same commands) both targets were SHIP with 5 of 5 preserved.

Outputs: `replay-1.0.0.txt`, `replay-2.2.1.txt` (CLI output + exit code, produced by `field/server-memory/replay.sh`; the temp path on the last line was replaced by
`(scratch dir)`); `server-memory-1.0.0-self.json`, `server-memory-vs-2.2.1.json` (the Replay_Results of those two runs).

What the input-schema diff is reacting to (`server-memory-tools-1.0.0.json` vs `server-memory-tools-2.2.1.json`, the
`tools/list` of each version; the diff compares each whole `inputSchema`): all nine tools changed their `$schema` dialect
URI (draft-07 → 2020-12); three also gained OPTIONAL top-level inputs — `search_nodes` (`limit`, `observationLimit`),
`read_graph` (`entityTypes`, `observationLimit`), `open_nodes` (`observationLimit`); four gained a description on their
top-level property (`create_entities`, `create_relations`, `add_observations`, `delete_observations`); `delete_entities`
and `delete_relations` changed nothing in their `inputSchema` but the dialect URI (their tool descriptions did change;
descriptions and `outputSchema` are not part of the input-schema diff). No input was removed and every `required` list is unchanged.

What this shows, and only this: across 1.0.0 → 2.2.1 the five recorded calls (create_entities, create_relations,
search_nodes, open_nodes, read_graph) return the same text, while an input-schema diff flags every tool; two of those
calls also return a structured form that jar format v1 cannot compare, so the verdict is HOLD, not SHIP. It is NOT a
claim that 2.2.1 is safe or unsafe; 4 of 9 tools were never recorded (add_observations, delete_entities,
delete_observations, delete_relations). No break was found on this shelf in hour 1 — a null result for breaks,
reported as one; what it did find is a limit of the jar format on a real server.
