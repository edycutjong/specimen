# Hook latency — `scripts/bench.ts hook`

Generated 2026-11-25T14:53:25.243Z by `npx tsx scripts/bench.ts hook` on darwin/arm64, node v22.22.0. Wall-clock of whole CLI processes, milliseconds.

| case | runs | min | p50 | p95 | max |
|---|---|---|---|---|---|
| hook pre (PreToolUse) | 30 | 404 | 465 | 628 | 711 |
| hook post (PostToolUse) | 30 | 422 | 474 | 668 | 801 |

Each run is a fresh `npx --no-install specimen hook <pre|post> --server hollowinn` process fed one payload on stdin, in a throw-away `.specimen/` directory (cwd in the payload), so the committed jars are never touched. The Kiro hook adds the cost of its own process launch on top; the number to compare against the hook `timeout` in `.kiro/hooks/*.json`.
