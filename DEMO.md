# DEMO — reproduce what SPECIMEN JAR measured

Work in progress (build week). Every number below is printed by the command next to it; the outputs are committed under
`evidence/`.

## 0. Install

```sh
npm ci
npm test            # vitest: unit, property (fast-check) and end-to-end suites
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

The spec was filed by Kiro's `specimen-curator` agent, Kiro's Bug Fix workflow wrote its design and tasks, and Kiro
executed them into `servers/hollow-inn/src/v2_1.ts` — `evidence/slice/`. On v2.1 the three quote jars replay preserved;
the overall verdict stays HOLD (SPC-0010 `search_rooms` rattled, SPC-0009 `cancel_booking` cracked — v2.1 fixes only
quote). `specimen replay` also writes a new file under `replays/` each run.

## Notes — field shelf (hour 1)

One real headless Kiro session against the public `@modelcontextprotocol/server-memory@1.0.0` was captured as 5 jars
(`field/server-memory/jars/`) and replayed against 1.0.0 and 2.2.1 — see `evidence/field/server-memory.md`. Both replays are
SHIP on the recorded set, while an input-schema diff flags all 9 tools (three gained optional inputs, six changed only
nested descriptions or constraints). No break was found in that hour; that is the result. Reproduce:
`sh field/server-memory/replay.sh 2.2.1`.
