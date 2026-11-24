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
**Before (assumed) vs after (measured, 17 sessions, 7.67 credits):**

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
