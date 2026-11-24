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
npx tsx scripts/bench.ts detect
```

Writes `evidence/bench/detect.md`: per hollow-inn version, the jar states next to what a tools/list schema diff reports.

## 4. The same engine in a browser

```sh
npm run -w spikes/s1-browser check
```

Builds a production Vite bundle that runs the committed jars through `@specimen/core` against hollow-inn over an in-memory
MCP transport, and reads the result with headless Chromium (`evidence/spikes/S1.md`).

## Notes — field shelf (hour 1)

One real headless Kiro session against the public `@modelcontextprotocol/server-memory@1.0.0` was captured as 5 jars
(`field/server-memory/jars/`) and replayed against 1.0.0 and 2.2.1 — see `evidence/field/server-memory.md`. Both replays are
SHIP on the recorded set, while a tools/list schema diff reports input-schema changes on every tool (additive optional
inputs). No break was found in that hour; that is the result.
