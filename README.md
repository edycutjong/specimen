<div align="center">
  <img src="docs/icon.svg" alt="SPECIMEN JAR icon" width="144">
  <h1>SPECIMEN JAR 🫙</h1>
  <p><em>Seal what your agent saw. Replay it against the new MCP server. Know what you are about to break before you ship.</em></p>
  <img src="docs/readme-hero.png" alt="SPECIMEN JAR — an iron shelf of glowing specimen jars; after the server swap, the broken ones rattle, flood red, and print ABNORMAL" width="100%">

  <br/>

  [![Live Demo](https://img.shields.io/badge/🚀_Live-Demo-06b6d4?style=for-the-badge)](https://specimen.edycu.dev/)
  [![Built for Kiroween](https://img.shields.io/badge/Devpost-Kiroween_2026-8b5cf6?style=for-the-badge)](https://kiroween.devpost.com/)

  <br/>

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
  ![MCP](https://img.shields.io/badge/MCP-TS_SDK-black?style=flat)
  ![Kiro](https://img.shields.io/badge/Kiro-hooks_%2B_bugfix_specs-8b5cf6?style=flat)
  ![React](https://img.shields.io/badge/React_+_Vite-149ECA?style=flat&logo=react&logoColor=white)
  ![Vitest](https://img.shields.io/badge/vitest_+_fast--check-6E9F18?style=flat&logo=vitest&logoColor=white)
  [![License](https://img.shields.io/badge/License-MIT-yellow)](https://opensource.org/licenses/MIT)

</div>

---

Built for Kiroween 2026 (Frankenstein category). **What is shown:** a changed demo server (v2) breaks 5 of the 10 jars recorded from real Kiro sessions while an input-schema diff sees 2 changes; three bugfix specs are filed for the red jars, Kiro designs and executes the fixes, and v2.1 replays SHIP 10 of 10. Live cabinet: <https://specimen.edycu.dev/> — it replays the committed jars in your browser on load.

## 💡 The Problem & Solution

### The Problem

You change an MCP server: a field is renamed, a default moves, a tool is renamed. Your tests are green. The agents that call
it find out in production. An input-schema diff of `tools/list` sees only part of it: in our demo it reports 2 changes for
the v2 server while 5 of the 10 recorded calls come back different.

### The Solution

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
   while a red jar has no filed bugfix spec (an operational crack — a timeout, a server that will not start — is logged, never blocked on).
   It blocks at most 3 times per session and fails open on any error or timeout.
   The committed hook (`.kiro/hooks/specimen-jar-stop.json`) replays the current server, hollow-inn v2.1, which is SHIP, so
   in this repository as committed it allows every stop until someone changes v2.1. The gate rows below were generated before commit 97403f7 (the fileable-only rule; its unit tests were re-run at HEAD) and ran in scratch
   copies against v1 or v2: E1–E3 pass `--server` to `specimen hook stop` directly (`scripts/stop-gate-eval.sh:26`), the
   live runs rewrite the hook's `--server` (`scripts/stop-gate-live.sh:26`); each live run's header records its hook command; `evidence/stop-gate/eval.md` names the server in its E0, first E2 and E1 rows, and the rows after them continue those sessions (E3 also replays v2, `scripts/stop-gate-eval.sh:47`).

## 🏗️ Architecture & Tech Stack

<p align="center">
  <img src="docs/architecture.png" width="100%" alt="specimen architecture, as built. A Kiro agent session (kiro-cli, agent engine v3) calls the hollow-inn MCP server. Kiro's PreToolUse and PostToolUse hook events run specimen hook, which appends one line per call to jars/ (10 jars in 2 session files, response_text byte for byte, MANIFEST.sha256). specimen replay replays the jars against a fresh server per recorded session: v2 HOLD, 4 rattled, 1 cracked; v2.1 SHIP, 10 jars compared. A red jar is filed with specimen file (run by hand, or by the agent the Stop gate blocked): the Kiro curator agent writes .kiro/specs/name/bugfix.md; once check-spec passes, a separate headless prompt runs Kiro's Bug Fix workflow, which wrote hollow-inn v2.1. On Stop, if servers/ changed, the hook replays and holds the agent's turn on an unfiled red jar (the committed hook targets v2.1, so it allows every stop; the blocks were measured in scratch copies). The judge's browser runs the same replay and verdict code in the cabinet at specimen.edycu.dev, a static Vercel page with the jars and hollow-inn v1, v2 and v2.1 built in.">
</p>

The loop in one figure, drawn from the code as built: Kiro hook events run specimen on each call, `specimen replay` runs the jars against the next server version, a red jar can be filed as a Kiro bugfix spec (`specimen file`), and Kiro's Bug Fix workflow writes the fix. Contracts and file names: [`ARCHITECTURE.md`](ARCHITECTURE.md).

| Part | What | Tech |
|---|---|---|
| `packages/core` | jar format, pairing, redaction, replay, diff, verdict — shared by the hook, the CLI and the browser cabinet | TypeScript, zod |
| `packages/cli` | the `specimen` command: hook, replay, check-spec, file, init | commander |
| `servers/hollow-inn` | the demo MCP server, v1 / v2 / v2.1 | MCP TS SDK |
| `apps/cabinet` | the browser cabinet; replays the committed jars in the page | Vite, React |
| `jars/` `replays/` `evidence/` | the sealed racks, the replay results, every measured output | JSONL, Markdown |
| `.kiro/` `prompts/` | Kiro steering, hooks, specs, agents; every Kiro prompt, numbered | Kiro |

## 🏆 How Kiro Was Used

Kiro is the builder, and every prompt that built this repository is in [`prompts/`](prompts/), verbatim and numbered (49 turns), with its measured credit cost; the few exceptions are listed in `prompts/README.md`.

- **Steering and agents** — `.kiro/steering/` (product, tech, structure, bugfix) and the curator agent `.kiro/agents/specimen-curator.json`
  were written by Kiro; the curator runs with no blanket trust and a deny rule on writes outside `.kiro/specs/`
  (spike S5, `evidence/spikes/S5.md`).
- **Hooks** — capture, the Stop gate and its turn snapshot (`UserPromptSubmit`; the `specimen hook stop` / `hook prompt` code is Kiro's turn 48, which we then edited (the `SPECIMEN_GATE=off` switch and the `UserPromptSubmit` trigger name, and later the rule that only a red jar `specimen file` can file may block a stop while operational cracks go to `unresolved.md`, were `claude-direct:` fixes, commit 97403f7); the two hook JSON files are generated by `specimen init` and were committed by us), firewall (a `PreToolUse` hook on Kiro's `write` tool that blocks an edit to a jar: "jars are evidence and read-only"; shell writes are caught only by the manifest check), manifest check and a post-task test hook
  (`.kiro/hooks/`).
- **Feature specs** — `jar-capture`, `replay-engine`, `cabinet-ui`: requirements → Analyze Requirements → design → tasks, executed by Kiro
  (`.kiro/specs/`).
- **Bug Fix specs** — three, one per v2 break, filed by the curator from the CLI's repro block; Kiro wrote the design and tasks and executed them
  into `servers/hollow-inn/src/v2_1.ts`.
- **What Kiro did not write** — the hollow-inn demo server v1 and v2 (the planted breaks are ours), test harnesses and glue
  (commits starting `claude-direct:`: glue, fixes found while reviewing Kiro's output, the eval and probe scripts, the readiness script, the docs, and the landing page and deck in `site/`). The bugfix workflow ran headless: no IDE approval step was taken. Three Kiro execution turns (45, 46, 47)
  were cut by our own timeout; the remaining acceptance steps were run by us, outside Kiro, and are labelled so in `prompts/README.md`.
  Credits, friction and the measured rate: [`docs/DX-REPORT.md`](docs/DX-REPORT.md).

## 📊 Engineering Rigor

| What | Result | Evidence |
|---|---|---|
| hollow-inn v1, self-replay | SHIP · 10 of 10 jars preserved | `evidence/bench/detect.md` |
| hollow-inn v2 (three author-made breaks) | HOLD · 5 preserved · 4 rattled · 1 cracked | `evidence/bench/detect.md`, `evidence/replay/racks-vs-v2.txt` |
| input-schema diff of the same v2 change | 2 changes (removed `cancel_booking`, added `booking_cancel`); the `quote` rename and the `search_rooms` default are invisible to it | `evidence/bench/detect.md` |
| `specimen hook pre` / `post` latency (30 fresh `npx` processes each, CLI wall-clock excluding Kiro's own hook launch, this laptop) | pre p50 465 ms · p95 628 ms; post p50 474 ms · p95 668 ms (the stop hook's budget is 30 s) | `evidence/bench/hook.md` |
| `specimen replay` of all 10 jars (10 cold runs per server, this laptop) | v1 p50 2254 ms; v2.1 p50 2365 ms (p95 = slowest of 10: 2780 / 2452 ms) | `evidence/bench/replay.md` |
| hollow-inn v2.1 (fixed by Kiro from three filed bugfix specs) | SHIP · 10 of 10 preserved · 5 of 6 tools covered (`get_room` was never called by the agent). 3 of the 10 are `quote` jars that keep `total` and also carry the new `total_cents` field, which the default mode counts as a compatible addition; with `--strict` the same replay is HOLD · 3 rattled | `evidence/replay/racks-vs-v2.1-ship.txt`, `evidence/replay/racks-vs-v2.1-strict.txt` |
| Stop gate, E1–E3 (the real `specimen hook` commands driven with scripted Stop payloads; no Kiro session) | v1 → allow; v2 with no spec → block naming all 5 red jars; v2 with the `quote` spec filed → block naming only SPC-0009, SPC-0010; 4th stop → allow + `unresolved.md`; 2.3–2.8 s per replaying stop, 0.4 s when nothing under `servers/` changed | `evidence/stop-gate/eval.md` |
| Stop gate in a live headless Kiro session (N = 1 retained run per row, an earlier set of probes was overwritten by the re-runs (`prompts/README.md`); the prompt tells the agent what to do if a hook sends it back; its edit, one comment line in `servers/`, is unrelated to the red jars, which come from the server under test being v2) | gate ON: the agent was sent back once and ran `specimen file` for the red jars; without shell trust it said it could not; gate OFF: it answered DONE; a turn that edited nothing was not blocked | `evidence/stop-gate/live-shell.md`, `live.md` (no shell trust), `live-control-off.md`, `live-no-edit.md` |
| Stop gate, break arm (N = 1 per arm; scratch at hollow-inn v1; prompt = "rename quote's `total` to `total_cents`, integer cents, reply DONE"; the prompt says nothing about hooks or replay, but the gate's own block reason does tell the agent what to do, and the rename was the requested change, so this is not an accident) | gate ON (171 s): the agent changed 2 lines and said DONE, was sent back once, replayed, ran `specimen file` for the 3 broken `quote` jars (the first filing call failed and was retried), the curator's check rejected the draft (`expected does not name the reference`), no spec was accepted, and the agent stopped with the jars still rattled and asked whether to keep the rename or revert it; gate OFF (about 20 s): 2 changed lines, DONE, "I did not run the test suite or the replay", nothing flagged. Gate ON cost 2.12 credits (6 curator sessions; figure from `prompts/README.md`, no credit output committed for these two runs), gate OFF 0.04; the unresolved ON turn is what `specimen seal` (accept an intended change, not built) would resolve | `evidence/stop-gate/live-break-on.md`, `live-break-off.md` |
| Tests | 1082 passing in 121 files (vitest + fast-check), `tsc --noEmit` exit 0 | `evidence/tests.txt` |
| Consequence run: did the agent's own answer change under v2? | No — its answer was unchanged (`$425.00`); v2's tool description names `total_cents` and the agent had it loaded (no ablation was run, so that is the likely reason, not a measurement). A deterministic consumer written against v1 (`scripts/consumer.ts`) was run since | `evidence/consequence-v2/README.md` |
| Consequence run, part 2: a client that reads `total` (our v1-era consumer, a 56-line script with no tool descriptions to read) | v2: the charge line throws (`total` is undefined), 5 of 9 rooms offered, cancel fails (`cancel_booking` not found); v2.1: every line matches v1 (`USD 425.00`, 9 rooms, cancelled) | `evidence/consequence-v2/consumer.md` |
| Field shelf: a public MCP server (`server-memory` 1.0.0 → 2.2.1) | HOLD · 3 preserved · 2 unsealed — no break found (a null result, reported as one); 2 jars unsealed because the server also returns a `structuredContent` its text does not carry, which a text-only jar cannot compare | `evidence/field/server-memory.md` |

The three breaks in hollow-inn v2 are **author-made on purpose** (`servers/hollow-inn/CHANGES.md`); the demo server is ours. The
field shelf is the only run against a server we did not write: it found no rattled or cracked jar (verdict HOLD: 3 preserved, 2 unsealed), and it found a limit of our own jar format (text only).

### Honest limits (6)

1. **Not the first MCP record/replay tool.** `mcp-recorder` ([devhelmhq/mcp-recorder](https://github.com/devhelmhq/mcp-recorder)), AgentVCR ([Victorchatter/AgentVCR](https://github.com/Victorchatter/AgentVCR)) and mcpsnoop ([kerlenton/mcpsnoop](https://github.com/kerlenton/mcpsnoop)) exist. What differs here is capture *inside* the agent
  through Kiro hooks (no proxy) and the closed loop into a Kiro bugfix spec.
2. Ten jars from two racks, five of six hollow-inn tools. "SHIP" means *replay clean on the recorded set*, nothing more.
3. **Everything ran on the Kiro CLI, headless.** Capture, replay, filing and the Stop gate were never run inside the Kiro IDE; the IDE-only steps (S2-IDE, Spec Correctness, IDE bugfix approvals) were not run. On the CLI the gate gets one block per prompt (the continuation turn fires no second Stop), so the 3-block cap is exercised only by the scripted evals, and each live variant has one retained run.
4. No unscripted 3-person timing of the judge path has been done.
5. axe-core still reports `color-contrast` on 25–28 nodes per width: the toe-tag text (measured 10.24:1), the jar flag strips (5.21:1 and 6.74:1 computed from tokens, not pixel-verified) and one legend item. We do not claim 0 axe violations. Everything else axe checks is clean at 1440, 375 and 320 px (`evidence/interaction-qa.md`).
6. No outside user has run it yet.

## 🚀 Getting Started

```sh
npm ci
npm test
npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2"     # HOLD, exit 3 once its red jars are filed
npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"   # SHIP, exit 0
npm run bench -- detect                                                      # rewrites evidence/bench/detect.md
npm run bench -- hook                                                        # p50/p95 of the capture hooks → evidence/bench/hook.md
npm run bench -- replay                                                      # p50/p95 of a full replay → evidence/bench/replay.md
```

A Kiro Power with the workflow as one skill is in [`power/specimen/`](power/specimen/) (`plugin.json` + `skills/specimen-replay/SKILL.md`, written by Kiro in turn 49; no MCP server in it, and it has not been imported in the Kiro IDE).

Add it to your own project with `specimen init` (writes the Kiro hooks, an `mcp.json` entry check, `.specimen/replay.json` with
a replay allow-list pre-filled from `readOnlyHint`, and checks the `kiro-cli` engine). Reproduction steps with the expected
outputs pasted from real runs: [`DEMO.md`](DEMO.md).

## 📄 License

MIT licensed — see [`LICENSE`](LICENSE).
