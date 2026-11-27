# Kiro prompts

Every prompt sent to Kiro while building this repository, verbatim and numbered in the order they ran — except one
`/usage` balance probe on day 1 (0.18 credits) and the curator prompts that `specimen file` builds at run time (row "(CLI)"). One local absolute path in `turn-19.md` is replaced by `<repo-root>`; nothing else is edited. Line 1 of each file
(an HTML comment) records the `kiro-cli` command (turns 03 and 09 name the earlier turn whose command they repeat), the engine and the
working directory where the header states them, and for the `turn-NN` files the date; the prompt is the
rest of the file. Commits that contain Kiro's output start with `kiro:`; glue, tests and harnesses written without Kiro
start with `claude-direct:`; commits with any other prefix (`docs:`, `evidence:`, `field:`, `jars:`, `chore:`) contain no
Kiro-written code. Prompts that say a spec or its requirements are "approved" are instructions to the headless agent so it
does not stop to ask — no human approval step was taken (the IDE approvals are a human step we did not run).

| Turn | What Kiro did | Credits |
|---|---|---|
| 01 | wrote `.kiro/steering/{product,tech,structure}.md` | 0.41 |
| 02 | wrote `.kiro/steering/specimen-bugfix.md` and `.kiro/agents/specimen-curator.json` | 0.54 |
| 03 | rewrote the curator's permission rules in the documented `capability`/`effect` form | 0.38 |
| 04 | spike S0/S3: three MCP calls across two server keys, capture hooks firing | 0.45 |
| 05 | spike S0 control on `--agent-engine v2` (run twice; denied before any tool ran) | not measured (v2 store) |
| 06 | spike S0 on `--agent-engine v3` | 0.21 |
| 07 | spike S2-CLI: Stop hook in `json`, `exit1` and `slow` modes (plus three runs with mangled hook arguments, and a `slow` re-run with an entry record) | 0.07 – 0.26 each |
| 08 | spike S5: the curator files a bugfix spec from a repro block | 0.37 |
| 09 | spike S5: the curator is asked to write outside `.kiro/specs/` and refuses | 0.07 |
| 10 | spike S5: the curator's permission block with a neutral prompt; the outside write is denied | 0.15 |
| 11 | spike S4b: Bug Fix workflow writes design.md + tasks.md headless in spec mode | 3.48 |
| 12 | credit-metering probe (`--output-format stream-json`) | 0.07 |
| 13 | decision D-425: the hook receives a server's `425.00` literal unchanged | 0.21 |
| 14–15 | `jar-capture` feature spec: requirements.md, Requirements-First, headless spec mode (one session) | 9.29 |
| 16 | `jar-capture` Analyze Requirements pass (a first attempt sent `/spec analyze_requirements` as plain text: 0.24) | 9.63 |
| 17 | `jar-capture` design.md + tasks.md | 9.89 |
| 18, 19, 23 | executed the `jar-capture` tasks (one session, 606 tool calls, model claude-haiku-5.5) | 27.45 |
| 20 | `replay-engine` feature spec: requirements.md | 4.69 |
| 21 | `replay-engine` Analyze Requirements pass | 11.65 |
| 22 | `replay-engine` design.md + tasks.md | 14.91 |
| rack-a, rack-a-followup, rack-b | recorded RACK A and RACK B through specimen's capture hooks (attempt 1 discarded: 1.31; committed attempt 2: 1.31) | 2.62 |
| 24 | live firewall probe: Kiro's write to a jar intercepted | 0.66 |
| field-memory | field shelf: one capture session against `@modelcontextprotocol/server-memory@1.0.0` | 0.56 |
| 25 | executed the `replay-engine` tasks (461 tool calls, model claude-haiku-5.5) | 53.23 |
| 26 | added the `specimen file` command + 21 tests (model claude-haiku-5.5) | 0.51 |
| (CLI) | `specimen file SPC-0002`: the `specimen-curator` agent wrote the quote bugfix spec; one retry after check-spec | 0.66 |
| 27 | Bug Fix workflow: design.md + tasks.md for the quote spec | 6.32 |
| 28 | executed the quote bugfix tasks → hollow-inn v2.1 (model claude-haiku-5.5) | 1.29 |
| rack-a, rack-b (consequence) | consequence run: the same two prompts re-run against hollow-inn v2 and v1 with no hooks ([`evidence/consequence-v2/`](../evidence/consequence-v2/README.md)) | 2.29 |
| 29 | `cabinet-ui` feature spec: requirements.md | 4.10 |
| 30 | `cabinet-ui` Analyze Requirements pass | 9.27 |
| 31 | `cabinet-ui` design.md + tasks.md | 11.27 |
| 32 | executed the `cabinet-ui` tasks, 45 tasks (699 tool calls, model claude-haiku-5.5) | 41.33 |
| 33 | cabinet visual polish round 1 after a real-browser review (model claude-haiku-5.5) | 14.04 |
| 34 | cabinet visual polish round 2 (model claude-haiku-5.5) | 3.64 |
| 35 | cabinet fixes from design review round 1: lede, staged cold open, flag legibility, rename callout, meta tags (model claude-haiku-5.5) | 10.68 |
| 36 | cabinet fixes from the browser check: drawer-open layout, phone tags, lab-report values (model claude-haiku-5.5) | 5.29 |
| 37 | cabinet fixes from QA round 2: schema-diff connector, filed wording, reserved layout, cold-open spoilers, drawer lab report, phone first screen (model claude-haiku-5.5) | 13.55 |
| 38 | cabinet first screen at 1440: one-sentence pitch in the header, jars higher, details folded after the shelves (model claude-haiku-5.5) | 1.89 |
| 39 | cabinet fixes from QA round 3: honest pitch and labels, rack A follow-up disclosure, one-line headline and plate, plate in step with the reveal, body face for controls (model claude-haiku-5.5) | 8.22 |
| 40 | cabinet first-screen regression fix after turn-39: one-line tagline at 1440, CountsPair grid, shelf padding (model claude-haiku-5.5) | 1.34 |
| 41 | wrote `specimen init` (hooks, mcp.json merge, replay.json allow list from `tools/list`, .gitignore, engine check) + 32 tests | 0.91 |
| 42 | Bug Fix workflow for the `search_rooms` default-limit spec: `design.md` + `tasks.md` | 4.91 |
| 43 | executed that spec's tasks: `v2_1.ts` default limit back to 20 + tests + CHANGES.md; stopped at the final acceptance task (see this table) | 1.02 |
| 44 | Bug Fix workflow for the `cancel_booking` spec: `design.md` + `tasks.md` | 5.01 |
| 45 | executed that spec's tasks 1–3 (`cancel_booking` registered again in v2.1, `booking_cancel` unlisted); cut by a timeout during the final acceptance task 4 — the replay and test run for 4.1–4.3 were done by the autopilot, so tasks 4–5 stay unchecked in `tasks.md` | 1.12 |
| 46 | cabinet UX fixes from the live axe + hover/focus gate (accession contrast, accessible name starts with the visible label, hover/press on summaries and the footer link, favicon); cut by a wall-clock timeout inside item 5 | 2.51 |
| 47 | continuation of 46: tests for items 1–4 and the phone first-screen spacing (first jar y 624 → 453 at 375×812); cut by a timeout at its final measurement, tests/typecheck/build re-run by the autopilot | 1.49 |
| 48 | the Agent Stop gate: `specimen hook prompt` (turn snapshot), `specimen hook stop --server` (replay + block while a red jar is unfiled, 3-block cap, fail open), the pure `decideStop` in `packages/core`, 33 new tests, and `specimen init` now writes the turn hook and a 30 s timeout on the stop hook; the autopilot re-ran tests/typecheck and ran the E1–E3 evals through the real hooks (`scripts/stop-gate-eval.sh`) | 3.30 |
| 49 | the Kiro Power `power/specimen/` (`plugin.json` + one skill `specimen-replay`, no MCP server); we compared its exit codes, flags and the 3-block cap with `packages/cli/src` and found no discrepancy. Kiro's output is commit `82b5126`; we edited `SKILL.md` twice since (`4138798`: the repository URL and the stop/turn hook files `init` writes; `ee36cff`: the allow-list wording), so `git log -p -- power/` shows Kiro's version and ours | 0.15 |
Credits come from Kiro's own per-session `usage_summary` ([`scripts/kiro-credits.mjs`](../scripts/kiro-credits.mjs)).
Spike prompts (04–13) ran in scratch workspaces outside this repo; their outputs are copied into `evidence/spikes/`.

## Scripted sessions that are not numbered turns

Headless sessions started by scripts in `scripts/`, with the credits Kiro reported for them (`scripts/kiro-credits.mjs`): `stop-gate-live.sh` runs (a fixed one-line prompt in the script; the agent then starts curator sessions through `specimen file`) — 7.53 credits for the first four probes (window 14:14–14:28Z, measured with `scripts/kiro-credits.mjs`; their transcripts are not kept, the re-runs overwrote `evidence/stop-gate/`), 3.27 for the final four (gate ON with and without shell trust, gate OFF, a turn that edits nothing); the two break-arm runs (`SCENARIO=break`, gate ON 2.12 credits with 6 curator sessions, gate OFF 0.04; `evidence/stop-gate/live-break-*.md`); the RACK A / RACK B recording and consequence runs are rows 4–7 and the table above.

Commit `82b5126` (prefix `kiro:`) also carries claude-direct work from the same hour: `scripts/bench.ts hook|replay`, the break-arm switch in `scripts/stop-gate-live.sh`, the cabinet change that hides the GitHub links until the public flip, and README / DEMO / EXPERIMENT edits. Only `power/specimen/` and `prompts/turn-49.md` in it are Kiro output.
