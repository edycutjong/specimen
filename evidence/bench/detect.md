# Detection table — `scripts/bench.ts detect`

Generated 2026-11-24T21:12:05.137Z by `npx tsx scripts/bench.ts detect` from the committed jars (`jars/`), baseline v1 for tools/list.

| server | verdict | jars compared | preserved | rattled | cracked | unsealed | skipped | red jars | schema-diff changes | what the schema diff saw | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hollow-inn v1 | SHIP | 10 | 10 | 0 | 0 | 0 | 0 | - | 0 | nothing | 2082 |
| hollow-inn v2 | HOLD | 10 | 5 | 4 | 1 | 0 | 0 | SPC-0002, SPC-0010, SPC-0006, SPC-0007, SPC-0009 | 2 | removed cancel_booking, added booking_cancel | 2060 |
| hollow-inn v2.1 | HOLD | 10 | 8 | 1 | 1 | 0 | 0 | SPC-0010, SPC-0009 | 2 | removed cancel_booking, added booking_cancel | 2227 |

Wall ms = one cold `specimen replay` process including `npx tsx` start-up of the server per session; it is not a latency benchmark.
