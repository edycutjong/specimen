# Consequence run, part 2 — a deterministic consumer written against v1's contract

Generated 2026-11-25 22:38 WIB by `npx tsx scripts/consumer.ts v1 v2 v2.1` (fresh hollow-inn per version over stdio; the output below is pasted unedited). Re-run 2026-11-25 (P1e QA) with the current 56-line script (97403f7 made a connect failure print as a line): output identical.
The consumer is ours: a 56-line script of v1-era client code (search, quote, book, cancel) with no tool descriptions to read —
the kind of caller the agent in part 1 was not. It is one consumer, run once per version; it shows what a client that
reads `total` gets, not how many real clients exist.

```
## hollow-inn v1
- rooms offered for 2026-12-24, 2 nights, 2 guests (no limit): 9 rooms (r-01, r-02, r-03, r-04, r-05, r-06, r-07, r-08, r-09)
- charge for r-04, 2 nights: USD 425.00
- book r-04: booking BK-0001
- cancel it: cancelled

## hollow-inn v2
- rooms offered for 2026-12-24, 2 nights, 2 guests (no limit): 5 rooms (r-01, r-02, r-03, r-04, r-05)
- charge for r-04, 2 nights: THREW TypeError: Cannot read properties of undefined (reading 'toFixed')
- book r-04: booking BK-0001
- cancel it: THREW Error: MCP error -32602: Tool cancel_booking not found

## hollow-inn v2.1
- rooms offered for 2026-12-24, 2 nights, 2 guests (no limit): 9 rooms (r-01, r-02, r-03, r-04, r-05, r-06, r-07, r-08, r-09)
- charge for r-04, 2 nights: USD 425.00
- book r-04: booking BK-0001
- cancel it: cancelled

```
