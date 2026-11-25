# Agent Stop gate — evals E1–E3 through the real hooks

Generated 2026-11-25T14:13:55Z by `scripts/stop-gate-eval.sh` in a scratch copy with no filed bugfix specs. Each row calls `specimen hook prompt` (turn snapshot), edits `servers/`, then `specimen hook stop --server <cmd>`.

| Eval | Setup | Gate output (STDOUT) · exit · wall |
|---|---|---|
| E0 | turn changed nothing under `servers/`, server v2 | `` <no output: the agent may stop> `` · exit 0 · 0.4 s |
| E2 | turn edited `servers/`, server v2, no spec filed | `` {"decision":"block","reason":"jars rattled or cracked: SPC-0002, SPC-0006, SPC-0007, SPC-0009, SPC-0010. Keep the old contract so the jars replay calm. Or run `specimen file <id>` for each jar to file a bugfix spec."} `` · exit 0 · 2.8 s |
| E2 (2nd stop, same session) | same | `` {"decision":"block","reason":"jars rattled or cracked: SPC-0002, SPC-0006, SPC-0007, SPC-0009, SPC-0010. Keep the old contract so the jars replay calm. Or run `specimen file <id>` for each jar to file a bugfix spec."} `` · exit 0 · 2.6 s |
| E2 (3rd stop, same session) | same | `` {"decision":"block","reason":"jars rattled or cracked: SPC-0002, SPC-0006, SPC-0007, SPC-0009, SPC-0010. Keep the old contract so the jars replay calm. Or run `specimen file <id>` for each jar to file a bugfix spec."} `` · exit 0 · 2.4 s |
| cap | 4th stop, same session (3 blocks already issued) | `` <no output: the agent may stop> `` · exit 0 · 2.3 s |
| E3 | new session; the `quote` bugfix spec is filed (covers SPC-0002, 0006, 0007), the other red jars are not | `` {"decision":"block","reason":"jars rattled or cracked: SPC-0009, SPC-0010. Keep the old contract so the jars replay calm. Or run `specimen file <id>` for each jar to file a bugfix spec."} `` · exit 0 · 2.4 s |
| E1 | new session; server v1 replayed against its own jars | `` <no output: the agent may stop> `` · exit 0 · 2.3 s |

`.specimen/unresolved.md` after the 4th stop (the cap):

```
## 2026-11-25T14:14:06.087Z

session: s-e0

jars still rattled or cracked and unfiled after 3 blocks: SPC-0002, SPC-0006, SPC-0007, SPC-0009, SPC-0010

```
