# SPECIMEN JAR

**Seal what your agent saw. Replay it against the new MCP server. Know what you are about to break before you ship.**

Built for Kiroween 2026 (Frankenstein category). **What is shown:** a changed demo server (v2) breaks 5 of the 10 jars recorded from real Kiro sessions while an input-schema diff sees 2 changes; three bugfix specs are filed for the red jars, Kiro designs and executes the fixes, and v2.1 replays SHIP 10 of 10. Live cabinet: <https://specimen.edycu.dev/> — it replays the committed jars in your browser on load.

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
| Stop gate, E1–E3 (the real `specimen hook` commands driven with scripted Stop payloads; no Kiro session) | v1 → allow; v2 with no spec → block naming all 5 red jars; v2 with the `quote` spec filed → block naming only SPC-0009, SPC-0010; 4th stop → allow + `unresolved.md`; 2.3–2.8 s per replaying stop, 0.4 s when nothing under `servers/` changed | `evidence/stop-gate/eval.md` |
| Stop gate in a live headless Kiro session (N = 1 per row; the prompt tells the agent what to do if a hook sends it back; its edit, one comment line in `servers/`, is unrelated to the red jars, which come from the server under test being v2) | gate ON: the agent was sent back once and ran `specimen file` for the red jars; without shell trust it said it could not; gate OFF: it answered DONE; a turn that edited nothing was not blocked | `evidence/stop-gate/live-shell.md`, `live-control-off.md`, `live-no-edit.md` |
| Tests | 1023 passing in 117 files (vitest + fast-check), `tsc --noEmit` exit 0 | `evidence/tests.txt` |
| Consequence run: did the agent's own answer change under v2? | No — its answer was unchanged (`$425.00`); v2's tool description names `total_cents` and the agent had it loaded (no ablation was run, so that is the likely reason, not a measurement). A consumer that reads `total` was not run | `evidence/consequence-v2/README.md` |
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

Kiro is the builder, and every prompt that built this repository is in [`prompts/`](prompts/), verbatim and numbered (48 turns), with its measured credit cost; the few exceptions are listed in `prompts/README.md`.

- **Steering and agents** — `.kiro/steering/` (product, tech, structure, bugfix) and the curator agent `.kiro/agents/specimen-curator.json`
  were written by Kiro; the curator runs with no blanket trust and a deny rule on writes outside `.kiro/specs/`
  (spike S5, `evidence/spikes/S5.md`).
- **Hooks** — capture, the Stop gate and its turn snapshot (`UserPromptSubmit`), firewall (a `PreToolUse` hook on Kiro's `write` tool that blocks an edit to a jar: "jars are evidence and read-only"; shell writes are caught only by the manifest check), manifest check and a post-task test hook
  (`.kiro/hooks/`).
- **Feature specs** — `jar-capture`, `replay-engine`, `cabinet-ui`: requirements → Analyze Requirements → design → tasks, executed by Kiro
  (`.kiro/specs/`).
- **Bug Fix specs** — three, one per v2 break, filed by the curator from the CLI's repro block; Kiro wrote the design and tasks and executed them
  into `servers/hollow-inn/src/v2_1.ts`.
- **What Kiro did not write** — the hollow-inn demo server v1 and v2 (the planted breaks are ours), test harnesses and glue
  (commits starting `claude-direct:`: glue, fixes found while reviewing Kiro's output, the eval and probe scripts, the readiness script, the docs). The bugfix workflow ran headless: no IDE approval step was taken. Three Kiro execution turns (45, 46, 47)
  were cut by our own timeout; the remaining acceptance steps were run by us, outside Kiro, and are labelled so in `prompts/README.md`.
  Credits, friction and the measured rate: [`docs/DX-REPORT.md`](docs/DX-REPORT.md).

## Honest limits

- **Not the first MCP record/replay tool.** `mcp-recorder` ([devhelmhq/mcp-recorder](https://github.com/devhelmhq/mcp-recorder)), AgentVCR ([Victorchatter/AgentVCR](https://github.com/Victorchatter/AgentVCR)) and mcpsnoop ([kerlenton/mcpsnoop](https://github.com/kerlenton/mcpsnoop)) exist. What differs here is capture *inside* the agent
  through Kiro hooks (no proxy) and the closed loop into a Kiro bugfix spec.
- Ten jars from two racks, five of six hollow-inn tools. "SHIP" means *replay clean on the recorded set*, nothing more.
- **Everything ran on the Kiro CLI, headless.** Capture, replay, filing and the Stop gate were never run inside the Kiro IDE; the IDE-only steps (S2-IDE, Spec Correctness, IDE bugfix approvals) were not run. On the CLI the gate gets one block per prompt (the continuation turn fires no second Stop), so the 3-block cap is exercised only by the scripted evals, and each live variant ran once.
- No unscripted 3-person timing of the judge path has been done.
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
