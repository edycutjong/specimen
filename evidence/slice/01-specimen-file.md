# Vertical slice, step 1 — `specimen file SPC-0002` (P1b, 2026-11-25 03:52 WIB)

**Command:** `npx specimen file SPC-0002` (latest Replay_Result: `replays/npx-tsx-servers-hollow-inn-src-main.ts-v2-2026-11-24T20-41-40.470Z.json`, racks vs hollow-inn v2).
**Exit code:** 0. **Output:** `filed .kiro/specs/quote-total-total-cents/bugfix.md · PASS SPC-0002, SPC-0006, SPC-0007`

What happened, in order:
1. The CLI grouped every jar with the same tool and changed-path set (`quote`, `/total` + `/total_cents`): SPC-0002 (RACK A), SPC-0006 and SPC-0007 (RACK B).
2. The CLI wrote the skeleton with the repro block (verbatim input, recorded `response_text`, replayed body, changed paths) and the diff table — by code, not by a model.
3. Kiro's `specimen-curator` agent (`kiro-cli chat --no-interactive --agent-engine v3 --trust-workspace --agent specimen-curator`, no `--trust-tools`) wrote the Introduction and the three EARS sections.
4. `check-spec` failed the first attempt on all three jars — `shall_continue` (no "SHALL CONTINUE TO" line) and `unchanged_jar` (the section did not say "no preserved jar"); Kiro session `sess_601d64af…`. The six FAIL lines, as the CLI quoted them to the curator: `01-attempt1-checkspec.txt`.
5. The CLI re-ran the curator once with those failures quoted; the second attempt passed for all three jars (session `sess_cf4ce9a8…`).

Re-check: `npx specimen check-spec .kiro/specs/quote-total-total-cents/bugfix.md --jar SPC-0002 --replay replays/npx-tsx-servers-hollow-inn-src-main.ts-v2-2026-11-24T20-41-40.470Z.json` (and SPC-0006, SPC-0007) → `PASS` each. (Without `--replay` the newest file in `replays/` is used — after step 4 that is the v2.1 run, where these jars are preserved, so check-spec answers `not_red`.)
Credits (Kiro `usage_summary`, `scripts/kiro-credits.mjs`): 0.66 for both attempts.
