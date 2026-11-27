# SPECIMEN JAR, for judges

> Seal what your agent saw. Replay it against the new MCP server. Know what you are about to break before you ship.

Three minutes: the 30-second test, about 60 seconds in the live cabinet (no setup), where Kiro did the work with a file
behind every line, four commands to check it from a clone, and the limits. The full reproduction, with every expected
output, is [`DEMO.md`](DEMO.md). The same path as a web page, with a live replay you can run in place:
<https://specimen.edycu.dev/judge>.

## The 30-second test

**What:** SPECIMEN JAR seals the MCP tool calls a Kiro agent really makes (Kiro hooks, inside the agent), replays them
against the changed server, and files each call that comes back different as a Kiro bugfix spec, with the captured call
as its repro. **Who:** anyone who maintains an MCP server that Kiro agents call. **Why:** the server's own tests are
updated with the change and stay green while its callers break; on our demo server an input-schema diff reports 2
changes (one renamed tool: `cancel_booking` removed, `booking_cancel` added), and the replay finds 5 of the 10 recorded
calls changed.

**Why Frankenstein:** four parts built for different jobs, stitched into one loop: MCP (the thing under test), Kiro
hooks (the capture), a replay engine (the verdict) and Kiro's Bug Fix specs (where a break lands as work). **Why Kiro:**
a `PreToolUse` / `PostToolUse` hook runs inside the agent and sees each MCP call's `tool_input` and `tool_response` with
Kiro's `session_id`, so there is no proxy in front of the server, and a red jar becomes a spec Kiro's Bug Fix workflow can
execute (payload keys measured in [`evidence/spikes/S3.md`](evidence/spikes/S3.md); every jar line in [`jars/`](jars/)
carries the `session_id`).

**Video (2:37, public):** <https://youtu.be/41UlOy2X318>. Kiro on screen at
[0:43](https://youtu.be/41UlOy2X318?t=43) (a live Kiro CLI session, its calls sealed by the capture hooks),
[1:04](https://youtu.be/41UlOy2X318?t=64) (the curator agent files a bugfix spec, `check-spec` PASS) and
[1:42](https://youtu.be/41UlOy2X318?t=102) (Kiro's Bug Fix tasks, then SHIP v2.1).

| Criterion | Where to look |
|---|---|
| Potential Impact | [In the browser](#in-the-browser-60-s). A 56-line client written for v1 throws on v2's missing `total`, is offered 5 of 9 rooms and cannot cancel, while v2's own test suite passes ([`evidence/consequence-v2/consumer.md`](evidence/consequence-v2/consumer.md), [`servers/hollow-inn/CHANGES.md`](servers/hollow-inn/CHANGES.md)) |
| Technological Implementation | [Kiro, impossible to miss](#kiro-impossible-to-miss): 7 hook files, a custom agent fenced to `.kiro/specs/`, 3 feature specs executed by Kiro, 3 Bug Fix specs (Kiro's design, tasks and fixes; we ran the final acceptance of two), steering, a Power, 49 numbered prompts in the repo |
| Design | the live cabinet (no login, no keys, it replays in your tab), the [landing](https://specimen.edycu.dev/landing/) and the 10-slide [deck](https://specimen.edycu.dev/deck/) |
| Innovation | capture inside the agent through Kiro hooks (no proxy), and one loop from a changed response to a Kiro bugfix spec to a Kiro fix; the prior art is named under [Honest limits](#honest-limits) |
| Presentation | the video above; the [README](README.md) opens with who it is for and four GIFs of the real cabinet and terminal |

## In the browser (~60 s)

Open <https://specimen.edycu.dev/> on a desktop browser. No install, no login, no keys: the page runs the same
`@specimen/core` replay as the CLI, in your tab, against the hollow-inn server modules over an in-memory MCP transport.
(Below 600 px wide the version switch is a dropdown.)

1. **Load.** The 10 jars recorded from two real Kiro sessions replay against hollow-inn v2 by themselves. The plate ends
   on **HOLD v2 · 5 preserved · 4 rattled · 1 cracked**; above the shelves, **INPUT-SCHEMA DIFF: 1 of 6 tools changed**
   (the renamed tool) stands against **REPLAY: 3 tools · 5 jars changed**.
2. **Baseline.** Click **v1**, then **Replay**: **SHIP v1 · 10 preserved**. The server the jars were recorded against
   agrees with them.
3. **Swap.** Click **v2**, then **Replay**. Four jars flood red with ABNORMAL tags and one cracks (`cancel_booking` is
   gone from `tools/list`): HOLD again.
4. **Open a red jar:** A2, `SPC-0002 quote`. The drawer names the break: `/total 425.00 → /total_cents 42500 ×100`,
   "Renamed, and the unit changed from dollars to cents." The schema diff cannot see it: `quote`'s inputs never changed.
5. **Read its bugfix spec,** under the diff in the same drawer: **filed as a Kiro bugfix spec · check-spec PASS**, filed
   by the `specimen-curator` agent through `specimen file`. It is `.kiro/specs/quote-total-total-cents/bugfix.md`
   rendered in the page: the repro block the CLI wrote (recorded and replayed bodies), then Kiro's WHEN … THEN
   requirements for SPC-0002, SPC-0006 and SPC-0007. The link above it opens the same file on GitHub in a new tab.
6. **Switch to v2.1 and replay.** v2.1 is the server Kiro's Bug Fix workflow wrote from the three filed specs:
   **SHIP v2.1 · 10 preserved · 0 rattled · 0 cracked**, input-schema diff 0 of 6. Three of the ten are `quote` jars that
   keep `total` and gain `total_cents`, which the default mode counts as compatible; `--strict` says HOLD · 3 rattled.

The strip above the shelves is the page's own guide to steps 4–6 (its middle step ticks once the bugfix spec fills
half of the screen as you scroll the drawer, or when you open its GitHub link). Also live: the [landing](https://specimen.edycu.dev/landing/), whose hero shelf replays v2 in the tab, and the
[deck](https://specimen.edycu.dev/deck/) (arrow keys).

## Kiro, impossible to miss

Everything ran on the Kiro CLI, headless; the Kiro IDE was not used. Commits that hold Kiro's output start `kiro:`; our
code commits start `claude-direct:`, and the other prefixes (`docs:`, `ci:`, `evidence:`, `chore:` …) hold no
Kiro-written code. By lines added to `packages/`, `apps/` and `servers/`, `kiro:` commits are 94.3 %, with our edits
inside three `kiro:` commits counted as ours ([`evidence/authorship.md`](evidence/authorship.md)).

| Kiro feature | Where | What it did here | Evidence |
|---|---|---|---|
| **Hooks: capture** (`PreToolUse` + `PostToolUse`, matcher `@hollowinn`) | [`specimen-jar-pre.json`](.kiro/hooks/specimen-jar-pre.json), [`specimen-jar-post.json`](.kiro/hooks/specimen-jar-post.json), server in [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) | Run `specimen hook pre` / `post` on every call the agent makes to the `hollowinn` MCP server; each pair is redacted and appended as one jar. The 10 committed jars come from two real headless Kiro sessions. The hook files were written by Kiro while it executed `jar-capture` (commit `6570cbc`) | [`jars/`](jars/) (each line carries Kiro's `session_id` and its tool id `mcp_hollowinn_…`); prompts [`rack-a.md`](prompts/rack-a.md), [`rack-b.md`](prompts/rack-b.md); the matcher fires only for its own server: [`evidence/spikes/S3.md`](evidence/spikes/S3.md) |
| **Hook: Stop gate** (`Stop`, 30 s timeout) + turn snapshot (`UserPromptSubmit`) | [`specimen-jar-stop.json`](.kiro/hooks/specimen-jar-stop.json), [`specimen-jar-turn.json`](.kiro/hooks/specimen-jar-turn.json) | When a turn changed `servers/` (the watch path in [`.specimen/replay.json`](.specimen/replay.json)), replays the jars at Stop and sends the agent back, naming the jar ids, while a red jar has no filed bugfix spec; at most 3 blocks per session, fails open. `specimen hook stop` is Kiro's turn 48, edited by us since (README, "How Kiro Was Used"); the two hook files were generated by `specimen init` and committed by us | [`eval.md`](evidence/stop-gate/eval.md) (the hook's block JSON; re-run it [below](#verify-it-yourself-from-a-clone-2-min)); [`live-shell.md`](evidence/stop-gate/live-shell.md) (a live Kiro session sent back once, which then ran `specimen file`); [`live-control-off.md`](evidence/stop-gate/live-control-off.md) (gate off: DONE) |
| **Hook: firewall** (`PreToolUse`, matcher `write`) | [`specimen-jar-firewall.json`](.kiro/hooks/specimen-jar-firewall.json) | Blocked Kiro's own `fs_write` to a committed jar with "jars are evidence and read-only"; jars and manifest unchanged. Shell writes are outside its matcher | [`evidence/firewall-probe.md`](evidence/firewall-probe.md) (prompt [`turn-24.md`](prompts/turn-24.md)) |
| **Hooks: task** (`PreTaskExec` / `PostTaskExec`) | [`specimen-manifest-check.json`](.kiro/hooks/specimen-manifest-check.json), [`post-task-tests.json`](.kiro/hooks/post-task-tests.json) | Configured to run `specimen manifest check` (SHA-256 of every jar) before and after each Kiro spec task, and `npm test` after it | configuration only: no firing of these two is recorded in `evidence/` |
| **Custom agent** `specimen-curator` | [`.kiro/agents/specimen-curator.json`](.kiro/agents/specimen-curator.json) | `specimen file <jar>` runs it to write the prose of a bugfix spec around the repro block the CLI wrote; it filed all three specs (the first after one retry, when `check-spec` failed its draft). Tools `read` and `write` only; a permission rule allows `fs_write` in `.kiro/specs/**` and denies it everywhere else. Written by Kiro (turns 02–03) | [`01-specimen-file.md`](evidence/slice/01-specimen-file.md), [`03-file-SPC-0010.txt`](evidence/slice/03-file-SPC-0010.txt), [`04-file-SPC-0009.txt`](evidence/slice/04-file-SPC-0009.txt); the deny rule, on a probe with the curator's exact permissions: "Blocked by a permission rule … Source: agent-profile." ([`evidence/spikes/S5.md`](evidence/spikes/S5.md)) |
| **Feature specs** (requirements → Analyze Requirements → design → tasks) | [`jar-capture/`](.kiro/specs/jar-capture/), [`replay-engine/`](.kiro/specs/replay-engine/), [`cabinet-ui/`](.kiro/specs/cabinet-ui/) | Written and executed by Kiro, headless: the capture code, the replay engine and the browser cabinet. Every task line is checked (48, 38 and 45) | [`prompts/README.md`](prompts/README.md), turns 14–23, 25 and 29–32 with their credits; [`evidence/authorship.md`](evidence/authorship.md) |
| **Bug Fix workflow** | [`quote-total-total-cents/`](.kiro/specs/quote-total-total-cents/), [`search-rooms-rooms-rooms-r-08-rooms-r-09/`](.kiro/specs/search-rooms-rooms-rooms-r-08-rooms-r-09/), [`cancel-booking-missing-tool/`](.kiro/specs/cancel-booking-missing-tool/) | One spec per v2 break. The curator filed `bugfix.md`; Kiro's Bug Fix workflow wrote `design.md` and `tasks.md` and executed them into [`v2_1.ts`](servers/hollow-inn/src/v2_1.ts). Headless, with no IDE approval step; we ran the final acceptance of two (turn 43 stopped at it, turn 45 was cut by our timeout) | [`racks-vs-v2.1-ship.txt`](evidence/replay/racks-vs-v2.1-ship.txt) (SHIP · 10 jars compared); [`02-bugfix-to-v2.1.md`](evidence/slice/02-bugfix-to-v2.1.md); prompts 27–28 and 42–45 |
| **Steering** | [`.kiro/steering/`](.kiro/steering/): `product`, `tech`, `structure` (always), `specimen-bugfix` (auto) | The rules the sessions worked under; `specimen-bugfix.md` is the bugfix spec layout the curator loads (a `resources` entry in its profile). Written by Kiro (turns 01–02); `product.md` was edited by us since | [`turn-01.md`](prompts/turn-01.md), [`turn-02.md`](prompts/turn-02.md) |
| **Power** | [`power/specimen/`](power/specimen/) | `plugin.json` and one skill, `specimen-replay`, that packages the workflow. Written by Kiro (turn 49; the `power/specimen/` files in commit `82b5126`); we edited `SKILL.md` twice since (`4138798`, `ee36cff`). Not imported into the Kiro IDE, and no MCP server in it | [`turn-49.md`](prompts/turn-49.md) |
| **Every prompt, committed** | [`prompts/`](prompts/) | The 49 numbered build turns, verbatim (one local path in `turn-19.md` replaced by `<repo-root>`), with the credits Kiro reported for each (exceptions listed) | [`prompts/README.md`](prompts/README.md), [`scripts/kiro-credits.mjs`](scripts/kiro-credits.mjs) |
| **What we learned** | [`docs/DX-REPORT.md`](docs/DX-REPORT.md), [`docs/EXPERIMENT.md`](docs/EXPERIMENT.md) | 21 numbered findings, for example: `kiro-cli agent validate` accepted permission rules with undefined keys (finding 4); a trigger id we got wrong passed every test because the tests copied it (19); a Bug Fix spec executed for about 1 credit, a whole feature spec for 27–53 (11). `EXPERIMENT.md`: five experiments, among them gate ON vs OFF | [`evidence/spikes/S5.md`](evidence/spikes/S5.md) (finding 4); [`prompts/README.md`](prompts/README.md) (credits) |

## Verify it yourself (from a clone, ~2 min)

The CLI is not published to npm: run it from a clone (outside one, `npx specimen` fetches an unrelated npm package).
Node 22 or 24, the versions CI runs. None of these commands starts a Kiro session or spends credits.

```sh
git clone https://github.com/edycutjong/specimen && cd specimen && npm ci

npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2"; echo "exit $?"
# HOLD · covered · 4 rattled, 1 cracked · 10 jars compared · 4 of 6 tools · not recorded: booking_cancel, get_room
# then one line per jar, e.g. SPC-0002 · quote · rattled · /total, /total_cents · suspected rename from /total ×100
# exit 3   ("covered": every red jar already has a filed bugfix spec; an unfiled red jar makes it exit 1)

npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"; echo "exit $?"
# SHIP · replay clean on the recorded set · 10 jars compared · 5 of 6 tools · not recorded: get_room
# exit 0

scripts/stop-gate-eval.sh && git diff evidence/stop-gate/eval.md
# the real Stop hook, driven with Kiro's Stop payload in a scratch copy (about 15 s): v2 with no spec filed blocks naming
# SPC-0002, SPC-0006, SPC-0007, SPC-0009, SPC-0010; the 4th stop is allowed (3-block cap); with the quote spec filed only
# SPC-0009, SPC-0010 are named; v1 is allowed. The diff shows only timestamps and wall times changed

npm test
# Test Files  123 passed (123)
#      Tests  1093 passed (1093)      (about 40 s)
```

These outputs are from a fresh clone on 2026-11-27. Committed copies:
[`racks-vs-v2-after-filing-all.txt`](evidence/replay/racks-vs-v2-after-filing-all.txt),
[`racks-vs-v2.1-ship.txt`](evidence/replay/racks-vs-v2.1-ship.txt), [`eval.md`](evidence/stop-gate/eval.md),
[`tests.txt`](evidence/tests.txt). Each replay also writes a new file under `replays/`. Everything else, with its expected
output: [`DEMO.md`](DEMO.md).

## Honest limits

- **Our server, our breaks.** hollow-inn is our demo MCP server and its three v2 breaks were planted on purpose
  ([`servers/hollow-inn/CHANGES.md`](servers/hollow-inn/CHANGES.md)); the 10 jars come from two Kiro sessions we prompted.
  SHIP means replay clean on the recorded set (10 jars, 5 of 6 tools: the agent never called `get_room`), nothing more.
- **No outside user has run it yet.**
- **Outside the fixture, a null result.** The one run against a server we did not write,
  `@modelcontextprotocol/server-memory` 1.0.0 → 2.2.1, found no break: HOLD · 3 preserved · 2 unsealed. The 2 unsealed
  calls also return a `structuredContent` that a text-only jar cannot compare, a limit of our jar format
  ([`evidence/field/server-memory.md`](evidence/field/server-memory.md)).
- **Kiro CLI only, headless.** The Kiro IDE, Spec Correctness and the IDE's bugfix approval steps were not used. The Bug
  Fix workflow ran with no human approval step, and two of its three executions stopped before their final acceptance
  task, which we ran ([`prompts/README.md`](prompts/README.md)).
- **The Stop gate is observed, not rated.** One retained live run per variant. On the CLI a prompt gets one block, so the
  3-block cap is exercised only by the scripted evals. The uncoached break arm ended with no accepted spec: the curator's
  draft failed `check-spec`, and the agent stopped to ask whether to keep or revert the rename
  ([`live-break-on.md`](evidence/stop-gate/live-break-on.md)). The committed hook replays v2.1, which is SHIP, so in this
  repository as committed it allows every stop.
- **Not the first MCP record/replay tool.** mcp-recorder, AgentVCR and mcpsnoop exist (linked in the README). What differs
  is capture inside the agent through Kiro hooks, and the loop into a Kiro bugfix spec.
- axe-core still reports `color-contrast` on 25–28 nodes per width; we do not claim 0 axe violations (README, Honest
  limits 5).

## Links

- Repository (MIT): <https://github.com/edycutjong/specimen>
- Judge page: <https://specimen.edycu.dev/judge> · live cabinet: <https://specimen.edycu.dev/> · landing: <https://specimen.edycu.dev/landing/> · deck: <https://specimen.edycu.dev/deck/>
- Video: <https://youtu.be/41UlOy2X318>
- Write-up on dev.to: <https://dev.to/edycutjong/our-schema-diff-saw-2-changes-replaying-the-agents-real-calls-found-5-that-came-back-different-2jlh>
- Full reproduction: [`DEMO.md`](DEMO.md) · how it is built: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Kiro friction and credits: [`docs/DX-REPORT.md`](docs/DX-REPORT.md)
