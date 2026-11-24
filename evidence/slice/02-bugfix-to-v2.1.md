# Vertical slice, steps 2–3 — Kiro Bug Fix → hollow-inn v2.1 → the quote jars PRESERVED (P1b, 2026-11-25)

| step | who | what | evidence | credits |
|---|---|---|---|---|
| 1 | specimen CLI + Kiro `specimen-curator` | filed `.kiro/specs/quote-total-total-cents/bugfix.md` (check-spec PASS ×3) | `01-specimen-file.md` | 0.66 |
| 2 | Kiro Bug Fix workflow, headless CLI V3 `--mode spec` | wrote `.kiro/specs/quote-total-total-cents/design.md` + `tasks.md` (4 top-level tasks) for that spec | `prompts/turn-27.md`, `.kiro/specs/quote-total-total-cents/` | 6.32 |
| 3 | Kiro, `--mode spec --model claude-haiku-5.5` | executed the tasks: bug-condition test, preservation tests, `servers/hollow-inn/src/v2_1.ts`, `createServer("v2.1")`, `servers/hollow-inn/test/v2_1.test.ts`, CHANGES.md | `prompts/turn-28.md`, `.kiro/specs/quote-total-total-cents/tasks.meta.json` (execution history) | 1.29 |
| 4 | specimen CLI | `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"` | `evidence/replay/racks-vs-v2.1.txt` | 0 |

Result of step 4 (exit 1, because two out-of-scope breaks remain):
`HOLD · 1 rattled, 1 cracked · 10 jars compared` — SPC-0002, SPC-0006, SPC-0007 (`quote`) **preserved · +1 field**
(`total` is back as `425.00` / `98.00` / `142.00`; `total_cents` is an additive, compatible field); SPC-0010 (`search_rooms`
default limit) still rattled and SPC-0009 (`cancel_booking`) still cracked — v2.1 fixes only what the quote spec covers.

Review (by the build agent, not a human; no IDE approval): the IDE approval steps of the Bug Fix workflow were not taken
(headless path, proven by spike S4b) — the prompts' "reviewed and approved" wording was an instruction to the headless
agent, not a human gate. The design, tasks and code were read and re-tested outside Kiro (`npm test`: 76 files, 680 tests; `npm run typecheck`: exit 0 — `evidence/tests.txt`).
`servers/hollow-inn/src/v1.ts`, `v2.ts` and `jars/` are unchanged by these steps (`git log --oneline -- servers/hollow-inn/src/v1.ts servers/hollow-inn/src/v2.ts jars/` shows no commit after `7926c62`).
