# Detection table — `scripts/bench.ts detect`

Generated 2026-11-25T13:25:28.003Z by `npx tsx scripts/bench.ts detect` from the committed jars (`jars/`), baseline v1 for tools/list.

| server | verdict | jars compared | preserved | rattled | cracked | unsealed | skipped | red jars | input-schema diff changes | what the input-schema diff saw | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hollow-inn v1 | SHIP | 10 | 10 | 0 | 0 | 0 | 0 | - | 0 | nothing | 2111 |
| hollow-inn v2 | HOLD | 10 | 5 | 4 | 1 | 0 | 0 | SPC-0002, SPC-0010, SPC-0006, SPC-0007, SPC-0009 | 2 | removed cancel_booking, added booking_cancel | 1985 |
| hollow-inn v2.1 | SHIP | 10 | 10 | 0 | 0 | 0 | 0 | - | 0 | nothing | 2088 |

Input-schema diff = tools removed, tools added, `inputSchema` changed in `tools/list` (descriptions are not compared). Wall ms = one cold `specimen replay` process including `npx tsx` start-up of the server per session; it is not a latency benchmark.
