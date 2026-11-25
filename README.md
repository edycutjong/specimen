# SPECIMEN JAR

**Seal what your agent saw. Replay it against the new MCP server. Know what you are about to break before you ship.**

Built for Kiroween 2026 (Frankenstein category). Live cabinet: <https://specimen.edycu.dev/> — it replays the committed jars in your browser on load.

## The problem

You change an MCP server: a field is renamed, a default moves, a tool is renamed. Your tests are green. The agents that call
it find out in production. An input-schema diff of `tools/list` sees only part of it: in our demo it reports 2 changes for
the v2 server while 5 of the 10 recorded calls come back different.

## What it does

1. **Capture** — Kiro hooks (`PreToolUse` / `PostToolUse` on the MCP server's tools) seal every real tool call a Kiro agent makes as a *jar*:
   request, response text byte for byte, redacted on write. Jars are checksummed (`jars/MANIFEST.sha256`).
2. **Replay** — `specimen replay --server "<command>"` starts a fresh instance of the changed server per recorded session, replays the
   jars in order, and compares each response with the jar: **preserved**, **rattled** (came back different), **cracked** (the call
   no longer works). The detector names a likely rename or unit change (`/total` → `/total_cents`, ×100).
3. **Verdict** — `SHIP` only when the replay is clean on the recorded set, always printed with its coverage; otherwise `HOLD`.
4. **File** — `specimen file <jar>` has a Kiro curator agent write a bugfix spec for the red jar (repro block + diff written by
   the CLI, prose by Kiro); `specimen check-spec` verifies it is structurally valid and names the jarred reference.
5. **Fix** — Kiro's Bug Fix workflow designs and executes the fix; the replay turns the jar calm again.
6. **Gate** — a Kiro `Stop` hook (`specimen hook stop`) replays the jars when a turn changed the server and sends the agent back, with the jar ids as the reason,
   while a red jar has no filed bugfix spec. It blocks at most 3 times per session and fails open on any error or timeout.

## Measured results (every number is a committed output)

| What | Result | Evidence |
|---|---|---|
| hollow-inn v1, self-replay | SHIP · 10 of 10 jars preserved | `evidence/bench/detect.md` |
| hollow-inn v2 (three author-made breaks) | HOLD · 5 preserved · 4 rattled · 1 cracked | `evidence/bench/detect.md`, `evidence/replay/racks-vs-v2.txt` |
| input-schema diff of the same v2 change | 2 changes (removed `cancel_booking`, added `booking_cancel`); the `quote` rename and the `search_rooms` default are invisible to it | `evidence/bench/detect.md` |
| hollow-inn v2.1 (fixed by Kiro from three filed bugfix specs) | SHIP · 10 of 10 preserved · 5 of 6 tools covered (`get_room` was never called by the agent) | `evidence/replay/racks-vs-v2.1-ship.txt` |
| Stop gate, E1–E3 through the real hooks | v1 → allow; v2 with no spec → block naming all 5 red jars; v2 with the `quote` spec filed → block naming only SPC-0009, SPC-0010; 4th stop → allow + `unresolved.md`; about 1.2–2 s per stop | `evidence/stop-gate/eval.md` |
| Stop gate in a live headless Kiro session (N = 1 per row) | gate ON: the agent was sent back once and ran `specimen file` for the red jars instead of changing the server; gate OFF: it answered DONE; a turn that edited nothing was not blocked | `evidence/stop-gate/live-shell.md`, `live-control-off.md`, `live-no-edit.md` |
| Tests | 1023 passing in 117 files (vitest + fast-check), typecheck clean | `evidence/tests.txt` |
| Consequence run: did the agent's own answer change under v2? | No — it read the new tool description and coped (`$425.00`); anything else reading `total` would not | `evidence/consequence-v2/README.md` |
| Field shelf: a public MCP server (`server-memory` 1.0.0 → 2.2.1) | SHIP 5 of 5 on the recorded set — a null result, reported as one | `evidence/field/server-memory.md` |

The three breaks in hollow-inn v2 are **author-made on purpose** (`servers/hollow-inn/CHANGES.md`); the demo server is ours. The
field shelf is the only run against a server we did not write, and it found nothing.

## Try it

```sh
npm ci
npm test
npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2"     # HOLD, exit 3 once its red jars are filed
npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"   # SHIP, exit 0
npm run bench -- detect                                                      # rewrites evidence/bench/detect.md
```

Add it to your own project with `specimen init` (writes the Kiro hooks, an `mcp.json` entry check, `.specimen/replay.json` with
a replay allow-list pre-filled from `readOnlyHint`, and checks the `kiro-cli` engine). Reproduction steps with the expected
outputs pasted from real runs: [`DEMO.md`](DEMO.md).

## How Kiro was used

Kiro is the builder, and every prompt is in [`prompts/`](prompts/), verbatim and numbered (48 turns), with its measured credit cost.

- **Steering and agents** — `.kiro/steering/` (product, tech, structure, bugfix) and the curator agent `.kiro/agents/specimen-curator.json`
  were written by Kiro; the curator runs with no blanket trust and a deny rule on writes outside `.kiro/specs/`
  (spike S5, `evidence/spikes/S5.md`).
- **Hooks** — capture, the Stop gate and its turn snapshot (`UserPromptSubmit`), firewall (a `PreToolUse` write hook that blocks an agent edit to a jar: "jars are evidence and read-only"), manifest check and a post-task test hook
  (`.kiro/hooks/`).
- **Feature specs** — `jar-capture`, `replay-engine`, `cabinet-ui`: requirements → Analyze Requirements → design → tasks, executed by Kiro
  (`.kiro/specs/`).
- **Bug Fix specs** — three, one per v2 break, filed by the curator from the CLI's repro block; Kiro wrote the design and tasks and executed them
  into `servers/hollow-inn/src/v2_1.ts`.
- **What Kiro did not write** — the hollow-inn demo server v1 and v2 (the planted breaks are ours), test harnesses and glue
  (commits starting `claude-direct:`). The bugfix workflow ran headless: no IDE approval step was taken. Two Kiro execution turns
  were cut by our own timeout; the acceptance run was ours and is labelled so in `prompts/README.md`.
  Credits, friction and the measured rate: [`docs/DX-REPORT.md`](docs/DX-REPORT.md).

## Honest limits

- **Not the first MCP record/replay tool.** `mcp-recorder`, AgentVCR and mcpsnoop exist. What differs here is capture *inside* the agent
  through Kiro hooks (no proxy) and the closed loop into a Kiro bugfix spec.
- Ten jars from two racks, five of six hollow-inn tools. "SHIP" means *replay clean on the recorded set*, nothing more.
- The Stop gate was measured on the Kiro CLI only (one block per prompt: the continuation turn fires no second Stop), one live run per variant; the IDE behaviour
  (S2-IDE) and the IDE-only Kiro steps (Spec Correctness, IDE bugfix approvals) were not run.
- axe-core still reports `color-contrast` on the rotated toe-tag text of the jars, although the measured contrast of ink on tag is
  10.24:1 (tag text is the topmost element at its own points); see `docs/DX-REPORT.md`. Everything else axe checks is clean at 1440, 375 and 320 px.
- No outside user has run it yet.

## Layout

```
packages/core     jar format, pairing, redaction, replay, diff, verdict (shared by hook, CLI, MCP server and browser)
packages/cli      the `specimen` command: hook, replay, check-spec, file, init
servers/hollow-inn the demo MCP server, v1 / v2 / v2.1
apps/cabinet      the browser cabinet (Vite + React)
jars/ replays/    the sealed racks and the replay results
evidence/         every measured output the numbers above come from
.kiro/ prompts/   Kiro steering, hooks, specs; every Kiro prompt, numbered
```

MIT licensed — see [`LICENSE`](LICENSE).
