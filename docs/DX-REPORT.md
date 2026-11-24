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
| task execution, whole spec (18/19/23: 606 tool calls; 25: 461 tool calls) | `--mode spec`, claude-haiku-5.5 (0.06x per `kiro-cli chat --list-models`) | 27.45, 53.23 |
| one CLI command + 21 tests (26) | default mode, claude-haiku-5.5 | 0.51 |
| curator filing one bugfix spec, incl. one retry | `--agent specimen-curator`, auto | 0.66 |
| Bug Fix workflow design.md + tasks.md (27) | `--mode spec`, auto | 6.32 |

## Findings, day 2
6. Every spec phase runs headless with `--mode spec` and a plain-words prompt. `/spec analyze_requirements <name>` sent as
   the bare prompt (without `--mode spec`) is read as text — the Analyze pass ran when phrased as a spec-mode prompt.
7. Spec-mode authoring cost 4.7–14.9 credits per phase on auto — far above the 1–3 we planned; whole-spec execution on
   claude-haiku-5.5 cost 27–53 credits because it made hundreds of tool calls.
8. In V3 headless the shell tool id is `run_command` (the denial message names it), not `execute_bash`.
9. A session resumed with `--resume-id` starts a NEW MCP server process: server state from the first turn is gone.
   We made hollow-inn's `search_rooms` a stateless catalogue lookup so a recorded session replays on one fresh server.
10. A curator that writes the three EARS sections around a CLI-written repro block can be held to a structural checker:
    the first attempt failed `shall_continue` and `unchanged_jar`, and one retry with the failures quoted passed
    ([`evidence/slice/01-specimen-file.md`](../evidence/slice/01-specimen-file.md)).
