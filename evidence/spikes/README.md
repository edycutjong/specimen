# Day-1 spikes (2026-11-24, kiro-cli 3.5.0, Node 22)

Every Kiro surface the build depends on, proven end to end before any product code. Each file has the command, the exit
code, the output lines that decide it and the credits it cost. Every Kiro prompt is in [`../../prompts/`](../../prompts/).

| Spike | Question | Verdict | Evidence |
|---|---|---|---|
| S0 | does `--agent-engine v3` pin the engine for headless runs (hooks fire)? | **PASS (partial)** — the flag beats a v3 global setting; "setting unset" not tested | [S0.md](S0.md) |
| S1 | MCP `McpServer` + `Client` over `InMemoryTransport` in a production Vite bundle: stateful replay, fresh session, field diff | **PASS** | [S1.md](S1.md) |
| S2-CLI | does an Agent Stop hook returning `decision:"block"` start another turn? timeout behaviour? | **PASS with a limit**: one block per prompt (the continuation turn fired no second Stop); a timed-out hook fails open | [S2.md](S2.md) |
| S2-IDE | the same in the Kiro IDE | not run — human step | — |
| S3 | does `@hollowinn` select one server? what does the sanitiser do to `hollow-inn-x`? | **PASS** (`mcp_hollow_inn_x_search_rooms`: `-` → `_`) | [S3.md](S3.md) |
| S4a | does a bugfix.md load as a spec in the Kiro IDE? | not run — human step | — |
| S4b | can Kiro's Bug Fix workflow produce design + tasks headless? | **PASS** — CLI V3 `--mode spec`, built-in `bugfix-workflow` sub-agent, spec-format validator | [S4.md](S4.md) |
| S5 | does the curator profile write under `.kiro/specs/` and get denied elsewhere, with no `--trust-tools`? | **PASS** (both halves; deny proven with the curator's exact permission block) | [S5.md](S5.md) |

## Credit calibration (measured)
Kiro stores a `usage_summary` (credits per prompt turn, tools used) for every V3 session; `--output-format stream-json`
prints the same number at run time. [`scripts/kiro-credits.mjs`](../../scripts/kiro-credits.mjs) sums it per session. This
matters because the 4,000-credit Kiroween pool is shared with other projects on the same account that were running Kiro at
the same time, so the pool balance (`/usage`) cannot attribute a cost to one call.

| Prompt kind | Sessions | Credits per session (measured) |
|---|---|---|
| simple authoring prompt (write 1–3 small files) | 3 (`turn-01..03`) | 0.38 – 0.54 |
| tool-calling capture run (1–3 MCP calls, hooks firing) | 3 (`turn-04`, `turn-06`, `turn-13`) | 0.21 – 0.45 |
| Stop-hook run (the prompt plus the turn the hook started, one `usage_summary` entry) | 7 (`turn-07`) | 0.07 – 0.26 |
| curator filing / deny probe | 3 (`turn-08..10`) | 0.07 – 0.37 |
| Bug Fix workflow: design + tasks from a bugfix.md (sub-agent + validator) | 1 (`turn-11`) | **3.48** |
| one-word reply (`turn-12`, metering probe) | 1 | 0.07 |
| the text `/usage` on the v3 engine (sent to the model as a prompt; no prompt file) | 1 | 0.18 |
| **all 19 V3 sessions of day 1** | 19 | **7.96** |
Not in that total: two `--agent-engine v2` control runs (the v2 engine stores sessions elsewhere; both were denied before a
tool ran) and the `/usage` reads (the v2 `/usage` read is client-side and left the pool unchanged).
The plan assumed 1 credit per simple prompt and 3 per spec task. Measured: simple prompts cost about half of that; a spec
design + tasks generation cost 3.48. The rate is final after the first feature-spec task batch on day 2.

## Decision D-425 — how hollow-inn writes money
The demo's headline pair is `quote` → `total: 425.00` in v1 and `total_cents: 42500` in v2. Measured: a TypeScript server
that returns the number 425 serialises it as `425` (`JSON.stringify` drops trailing zeros; S1 printed `v1 /total=425`).
Chosen: hollow-inn writes its response text with a money-aware serialiser that emits money as a **two-decimal JSON number
literal** (`"total":425.00`, `"nightly":212.50`). That is valid JSON, it is what the fixture specifies ("USD, two
decimals"), and it parses to the number 425 — so the v1 → v2 pair stays numeric on both sides and the detector's
"suspected rename ×100" holds (not a TYPE change). Kiro passes the server's response text into the hook byte for byte
— **measured** (`prompts/turn-13.md`, 2026-11-24 23:55 WIB, 0.21 credits): the toy server in `money-literal` mode answered
`quote`, and the PostToolUse hook received `"tool_response": "{\"room_id\":\"R-101\",\"nights\":2,\"total\":425.00,\"currency\":\"USD\"}"`
— the literal survived; the agent itself answered "425.00 USD". So the jar keeps `425.00` and the cabinet can show the
recorded literal, provided the jar writer never re-serialises the parsed response (redaction edits value spans in the raw text).
Rejected: a string `"425.00"` (turns the headline into a TYPE change + rename) and a bare `425` (contradicts the fixture
and every asset). Probes: [`spikes/s1-browser/test/money-literal.test.ts`](../../spikes/s1-browser/test/money-literal.test.ts) (parse + diff) and the turn-13 capture above.
