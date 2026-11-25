# Replay latency — `scripts/bench.ts replay`

Generated 2026-11-25T14:54:14.399Z by `npx tsx scripts/bench.ts replay` on darwin/arm64, node v22.22.0. Wall-clock of whole CLI processes, milliseconds.

| case | runs | min | p50 | p95 | max |
|---|---|---|---|---|---|
| specimen replay, hollow-inn v1 | 10 | 1831 | 2254 | 2780 | 2780 |
| specimen replay, hollow-inn v2.1 | 10 | 2176 | 2365 | 2452 | 2452 |

Each run replays all 10 committed jars (racks A and B, 5 jars each) against one hollow-inn version, with v1 as the tools/list baseline. A fresh server process per recorded session, started with `npx tsx`, so the figure includes TypeScript start-up of the server. With 10 runs per row the nearest-rank p95 is the slowest run. Machine-dependent; run on a laptop, not a CI box.
