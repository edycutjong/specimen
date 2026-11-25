# Consequence run — does the agent's own answer change under hollow-inn v2?

A rattled jar says a response changed. It does not say an agent gave a wrong answer. This run measures that second
question once, on the two recorded tasks, and reports what happened, not what we hoped.

**How it ran (2026-11-25 04:38 WIB = 2026-11-24 21:38 UTC, the time in the log headers; `scripts/consequence-run.sh v2 v1`, then `node scripts/consequence-extract.mjs`):** the fixed RACK A and RACK B
prompts (`prompts/rack-a.md`, `prompts/rack-b.md`, verbatim) ran headless with `kiro-cli 3.6.0 chat --no-interactive --agent-engine v3`,
each in a fresh scratch workspace whose `.kiro/settings/mcp.json` starts hollow-inn `v2` (and, as the control, `v1`), with **no hooks**
(nothing jarred, nothing gated). Nothing was re-prompted. Files:

| File | What it is |
|---|---|
| `v2-rack-a.log`, `v2-rack-b.log`, `v1-rack-a.log`, `v1-rack-b.log` | the full stdout transcript of each run, untouched |
| `*.calls.jsonl` | every `@hollowinn` call the agent made, in order: tool, input, the exact response text, and the tool description the agent loaded — pulled from the Kiro v3 session store by `scripts/consequence-extract.mjs` |

## Result

| | RACK A under v2 | RACK B under v2 |
|---|---|---|
| What the server returned | `quote` → `"total_cents":42500` (and `47200` for r-07) — no `total` | `quote` → `"total_cents":9800`, `14200`; `cancel_booking` is gone, `booking_cancel` exists |
| What the agent said | "Hearth Room (r-04) … 2-night total **$425.00**" | "r-01 Lantern Room: **$98.00 (9800 cents)**"; booked, then cancelled with `booking_cancel` |
| Same answer as the v1 control? | **yes** — v1 said "The total is $425.00 USD" | **yes** — v1 said "r-01 Lantern Room: $98.00", cancelled with `cancel_booking` |

**The agent's own answer did not change.** In both tasks it converted cents to dollars correctly and found the renamed
cancel tool. (The paths differ a little: under v2 the RACK A agent quoted two rooms, under v1 one; both quoted the
cheaper Hearth Room at $425.00.) The likely reason is in `*.calls.jsonl`: v2 changed the tool description along with the
field (`quote`: "`total_cents` is the nightly rate times `nights`, in integer cents"), and the agent had it loaded. We did
not run an ablation with the old description, so that is an explanation, not a measurement.

What the run did **not** exercise: v2's default page size drops `r-08`/`r-09` only when `search_rooms` is called without
`limit`, and in both RACK A runs (v1 and v2) the agent passed `"limit": 50` although the prompt says "search without a
result limit" — so the room comparison was never put at risk here. (In the recorded RACK A jars the agent did make the
no-limit call, `SPC-0010`, which is the jar that rattles on `/rooms/r-08`, `/rooms/r-09`.)

## What it means for SPECIMEN JAR

The jars still rattle, and they should: the response contract changed (`/total` removed, `/total_cents` added ×100,
a tool renamed). One LLM agent with the new tool descriptions loaded adapted this time, in n = 1 run per
task. Hypothesis, not tested here: code and clients that read `total` (a typed SDK, a cached plan, a downstream service, an
agent with a stale tool list) would not have the new description and would get nothing. Replay reports the change; whether a given consumer survives it is a separate,
per-consumer question — and this run is the measured answer for one consumer, on one day.
