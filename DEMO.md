# DEMO — reproduce what SPECIMEN JAR measured

Every number below is printed by the command next to it; the outputs are committed under `evidence/`. The live cabinet,
<https://specimen.edycu.dev/>, replays the same jars in the browser on load.

## 0. Install

```sh
npm ci
npm test            # vitest: unit, property (fast-check) and end-to-end suites — 1023 tests in 117 files at the last run (evidence/tests.txt)
npm run seed:check  # the hollow-inn fixture still holds the properties the demo depends on
```

## 1. The jars are real and sealed

`jars/` holds two racks recorded from real headless Kiro sessions by specimen's own capture hooks (RACK A, RACK B; prompts in
`prompts/rack-a.md`, `prompts/rack-b.md`, `prompts/rack-a-followup.md`).

```sh
(cd jars && shasum -a 256 -c MANIFEST.sha256)
```

## 2. Replay the jars

```sh
npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v1"   # SHIP — the self-replay gate
npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2"   # HOLD — the three author-made breaks in CHANGES.md
```

Committed outputs: `evidence/replay/racks-vs-v1.txt`, `evidence/replay/racks-vs-v2.txt`.

## 3. Replay vs a schema diff, same change

```sh
npm run bench -- detect
```

Rewrites `evidence/bench/detect.md` + `.json` (so `git status` shows them changed — the wall-ms column varies run to run):
per hollow-inn version, the jar states next to what an input-schema diff of `tools/list` reports (tools removed, tools
added, `inputSchema` changed; tool descriptions are not compared).

## 4. The same engine in a browser

```sh
npm run -w spikes/s1-browser check
```

Builds a production Vite bundle that runs the committed jars through `@specimen/core` against hollow-inn over an in-memory
MCP transport, and reads the result with headless Chromium (`evidence/spikes/S1.md`).

## 5. The loop closes once: jar → bugfix spec → Kiro fix → jar calm

```sh
npx specimen file SPC-0002 --dry-run --replay replays/npx-tsx-servers-hollow-inn-src-main.ts-v2-2026-11-24T20-41-40.470Z.json    # the repro block the CLI writes for the three quote jars (no Kiro call)
npx specimen check-spec .kiro/specs/quote-total-total-cents/bugfix.md --jar SPC-0002 --replay replays/npx-tsx-servers-hollow-inn-src-main.ts-v2-2026-11-24T20-41-40.470Z.json
npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"
```

The CLI wrote each spec's repro block and diff table, Kiro's `specimen-curator` agent wrote the prose, Kiro's Bug Fix workflow wrote the design and tasks, and Kiro
executed them into `servers/hollow-inn/src/v2_1.ts` — `quote` first (`evidence/slice/`), then `search_rooms` and `cancel_booking`
(`.kiro/specs/*/`, prompts 42–45; the last execution turn was cut during its final acceptance task, which the autopilot ran itself — see `prompts/README.md`).
Every v2 break now replays preserved on v2.1: `evidence/replay/racks-vs-v2.1-ship.txt` is `SHIP · replay clean on the recorded set · 10 jars compared · 5 of 6 tools · not recorded: get_room`,
exit 0. Before filing, the same replay read HOLD with SPC-0010 and SPC-0009 `not filed` (`racks-vs-v2.1.txt`); after filing and before the fixes it read
`HOLD · covered` with exit 3 (`racks-vs-v2.1-after-filing-all.txt`). `specimen replay` also writes a new file under `replays/` each run.

## Notes — field shelf (hour 1)

One real headless Kiro session against the public `@modelcontextprotocol/server-memory@1.0.0` was captured as 5 jars
(`field/server-memory/jars/`) and replayed against 1.0.0 and 2.2.1 — see `evidence/field/server-memory.md`. Both replays are
SHIP on the recorded set, while an input-schema diff flags all 9 tools (every one changed its `$schema` dialect URI; three
also gained optional inputs — details in the evidence file). No break was found in that hour; that is the result. Reproduce:
`sh field/server-memory/replay.sh 2.2.1`.

## 6. Set it up in another repository, and the readiness gate

```sh
npx specimen init --server-key hollowinn --test-server "npx tsx servers/hollow-inn/src/main.ts v2.1" --watch 'servers/**'
npx tsx scripts/check_submission_readiness.ts --allow-pending-video
```

`specimen init` writes the capture and firewall hooks, `.specimen/replay.json` (replay allow-list pre-filled from `readOnlyHint`) and the ignore rules; a second run
changes nothing. A real run on a scratch workspace is in `evidence/init-smoke.md`. It also writes `.kiro/hooks/specimen-jar-stop.json` when a test server is given;
that hook calls `specimen hook stop` (section 7).
The readiness script checks `.kiro/` and `prompts/` are tracked, no unfinished-text markers, every spec folder complete, every bugfix spec passes `check-spec`, no third-party host in the built
cabinet and no kitchen file tracked; the demo video URL is the one field allowed to stay `PENDING` until it is uploaded.

## 7. The Stop gate

```sh
scripts/stop-gate-eval.sh                  # E1–E3 through the real hooks in a scratch copy → evidence/stop-gate/eval.md (no Kiro call)
TRUST_SHELL=1 scripts/stop-gate-live.sh    # one live headless Kiro session in a scratch copy, gate ON (costs ≈ 3 Kiro credits: the agent files specs)
GATE=off TRUST_SHELL=1 scripts/stop-gate-live.sh evidence/stop-gate/live-control-off.md   # the same prompt with no gate
```

`evidence/stop-gate/eval.md` shows the exact JSON the hook prints. In the live run the agent edited `servers/`, said DONE, was sent back with
`jars rattled or cracked: SPC-0002, SPC-0006, SPC-0007, SPC-0009, SPC-0010 …`, and ran `specimen file` for the red jars rather than change the server; with the gate off it stopped at DONE. One run per variant: that is
an observation, not a rate.
