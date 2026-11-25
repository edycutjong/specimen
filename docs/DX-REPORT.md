# Kiro developer-experience report — SPECIMEN JAR

Living document: what we measured about Kiro while building with it. Day-1 details are in
[`evidence/spikes/`](../evidence/spikes/README.md).

## Experiment 1 — credit calibration (day 1, 2026-11-24)
**Question:** what does a Kiro prompt actually cost? The plan assumed 1 credit per simple prompt and 3 per spec-task
prompt (Kiro's billing page says simple prompts can cost less than 1 credit and spec-task prompts typically more).
**Method:** Kiro writes a `usage_summary` (credits per prompt turn + the tools used) into every V3 session it stores, and
`--output-format stream-json` prints the same figure; `scripts/kiro-credits.mjs` sums it per session. The account-level
`/usage` balance (readable headless only on `--agent-engine v2`; on v3 the text `/usage` is sent to the model as a
prompt) could not be used, because the 4,000-credit event pool is shared with other projects that were running Kiro at
the same time.
**Before (assumed) vs after (measured, 19 sessions, 7.96 credits):**

| Prompt kind | Assumed | Measured |
|---|---|---|
| simple authoring prompt | 1 | 0.38 – 0.54 |
| tool-calling run (MCP calls + hooks) | 3 | 0.21 – 0.45 |
| spec design + tasks generation (Bug Fix workflow) | 3 | 3.48 |
The per-task execution rate is measured after the first feature-spec task batch (day 2).

## Findings so far
1. Headless `kiro-cli` runs the v2 engine unless something selects v3; pass `--agent-engine v3` on every headless call.
2. Hook `tool_name` for an MCP server key with hyphens is ambiguous (`hollow-inn-x` → `mcp_hollow_inn_x_search_rooms`);
   use a per-server `@<key>` selector and pass the server key to the hook command instead of parsing names.
3. An Agent Stop hook returning `decision:"block"` (or exit 1 with text) starts one more turn and the agent sees the
   reason, but in headless CLI 3.5.0 that continuation turn did not fire Stop again — one block per prompt. A hook that
   times out leaves the turn finished (fails open).
4. `kiro-cli agent validate` accepted permission rules written with undefined keys (`permission`/`tool`); the documented
   form is `capability`/`match`/`exclude`/`effect`. With that form, an agent-profile deny rule blocks `fs_write` outside
   `.kiro/specs/**` and reports `Source: agent-profile`.
5. The Bug Fix workflow runs headless in CLI V3 spec mode (`--mode spec`): a `bugfix-workflow` sub-agent writes design.md
   and tasks.md and checks them with a spec-format validator.

## Experiment 2 — feature specs and Bug Fix headless (day 2, 2026-11-25)
**Question:** can the whole Kiro spec workflow (requirements → Analyze Requirements → design → tasks → execution, and the
Bug Fix workflow) run headless from `kiro-cli`, and what does each phase cost?
**Measured** (credits from each session's `usage_summary`; prompts in [`prompts/`](../prompts/README.md)):

| Phase | Mode / model | Credits |
|---|---|---|
| feature-spec requirements (`jar-capture` 14–15, `replay-engine` 20) | `--mode spec`, auto | 9.29, 4.69 |
| Analyze Requirements pass (16, 21) | `--mode spec`, auto | 9.63, 11.65 |
| design.md + tasks.md (17, 22) | `--mode spec`, auto | 9.89, 14.91 |
| task execution, whole spec (18/19/23: 606 tool calls; 25: 461 tool calls) | `--mode spec`, claude-haiku-5.5 (0.06x per `kiro-cli chat --list-models`, [`evidence/spikes/kiro-models.txt`](../evidence/spikes/kiro-models.txt)) | 27.45, 53.23 |
| one CLI command + 21 tests (26) | default mode, claude-haiku-5.5 | 0.51 |
| curator filing one bugfix spec, incl. one retry | `--agent specimen-curator`, auto | 0.66 |
| Bug Fix workflow design.md + tasks.md (27) | `--mode spec`, auto | 6.32 |

## Findings, day 2
6. Every spec phase runs headless with `--mode spec` and a plain-words prompt. `/spec analyze_requirements <name>` sent as
   the bare prompt (without `--mode spec`) is read as text — the Analyze pass ran when phrased as a spec-mode prompt.
7. Spec-mode authoring cost 3.5–14.9 credits per phase on auto (turn-11 3.48 … turn-22 14.91) — far above the 1–3 we planned; whole-spec execution on
   claude-haiku-5.5 cost 27.45 and 53.23 credits (606 and 461 tool calls) — cost did not track the call count.
8. In V3 headless, `--trust-tools` accepts the shell tool as `run_command` (turns 18, 19, 23, 25, 26, 28).
9. In our first recording attempt, a session resumed with `--resume-id` reached a new hollow-inn process: the booking
   state from the first turn was gone (observed once; that transcript was discarded, commit `0bc41c0`). We made hollow-inn's `search_rooms` a stateless catalogue lookup so a recorded session replays on one fresh server.
10. A curator that writes the three EARS sections around a CLI-written repro block can be held to a structural checker:
    the first attempt failed `shall_continue` and `unchanged_jar`, and one retry with the failures quoted passed
    ([`evidence/slice/01-specimen-file.md`](../evidence/slice/01-specimen-file.md)).

## Experiment 3 — closing the loop for the other two breaks, and `specimen init` (day 3, 2026-11-25)
**Question:** once the curator, the Bug Fix workflow and the checker exist, what does it cost to file and fix the second and third break, and
where does headless Kiro stop on its own?
**Measured** (credits from each session's `usage_summary`; prompts [37–47 in `prompts/`](../prompts/README.md)):

| Step | Mode / model | Credits |
|---|---|---|
| `specimen file SPC-0010` (curator, CLI) | `--agent specimen-curator`, auto | 0.34 |
| `specimen file SPC-0009` (curator; the first attempt exited 22 — Kiro's model registry was unavailable — and cost 0) | auto | 0.55 |
| `specimen init` (code + 32 tests, turn 41) | claude-haiku-5.5 | 0.91 |
| Bug Fix design.md + tasks.md for `search_rooms` (turn 42) / `cancel_booking` (turn 44) | `--mode spec`, auto | 4.91, 5.01 |
| Bug Fix task execution (turn 43 / turn 45) | claude-haiku-5.5 | 1.02, 1.12 |
| cabinet fixes from the axe + hover + focus gate (turns 46, 47) | claude-haiku-5.5 | 2.51, 1.49 |

## Findings, day 3
11. A Bug Fix spec is much cheaper than a feature spec: design + tasks 4.9–6.3 credits, execution about 1 credit on claude-haiku-5.5, against 27–53 credits to execute a whole feature spec (finding 7). The fix itself is small
    because the filed spec holds a repro block, the diff and the jarred reference.
12. Headless Kiro stops by itself when a task's acceptance criterion touches code outside the task. Turn 43 stopped at its last task to ask whether four cabinet tests that pin the old
    counts should be updated; we updated them ourselves (`claude-direct:`) because `--no-interactive` cannot answer.
13. We cut two execution turns with our own `timeout` (turn 45 inside its final acceptance task, turns 46 and 47 near their final measurement). Kiro's work up to the cut was kept and the remaining acceptance steps
    were run by us and labelled so in `prompts/README.md` and the ledger. The tasks that were not completed stay unchecked in `tasks.md` — we never edited them. Next time: run the turn in the background with no timeout.
14. `specimen file` tolerates a transient Kiro failure (`exit 22`, model registry) with a plain retry; the failed attempt is not billed.
15. **axe-core reports `color-contrast` (serious) on the jars' toe-tag text that we could not fix because the measured contrast is fine.** Ink `#1E1912` on tag `#D9C49A` is 10.24:1 and
    `document.elementsFromPoint` returns the accession label first at its own points, but axe samples the dark jar art underneath the rotated, overlapping SVG + HTML tag. Four changes left axe unchanged
    (rotation removed from the tag, rotation removed from the overlay, `pointer-events:auto`, filter/blend/opacity/animation neutralised). We treat it as a false positive and do **not** claim "axe 0 violations";
    everything else axe checks is clean at 1440, 375 and 320 px (`label-content-name-mismatch` was real and Kiro fixed it in turns 46–47).
16. The interaction gate (`hover` byte-diff of the element screenshot, focus-ring check, link status, 375 and 320 px scroll width) first reported the summary in the version notes as dead on hover; the cause was that
    the notes sit inside the closed "Details" fold, whose children have no real box until it is opened. After opening the fold the same element receives the pointer and its hover changes.
