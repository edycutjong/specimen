---
inclusion: always
---

# Structure

## Packages and apps

- `packages/core`: jar schema, pairing, redaction, normalise, diff, verdict, check-spec. Shared by everything.
- `packages/cli`: the `specimen` command with `hook`, `replay`, `file`, `check-spec`, `init`.
- `packages/mcp`: the specimen MCP server.
- `apps/cabinet`: the browser cabinet.

## Demo server

- `servers/hollow-inn/src/{v1,v2,v2_1}.ts`, with `createServer(version)`.
- Run from source: `npx tsx servers/hollow-inn/src/main.ts <version>`.

## Data and config

- `jars/`: recorded evidence. Read-only. Hashes in `jars/MANIFEST.sha256`.
- `replays/`: replay results.
- `.specimen/`: `volatile.json`, `redact.json`, `replay.json`.
- `.kiro/`: hooks, steering, specs, agents, `settings/mcp.json`.

## Project record

- `prompts/`: every Kiro prompt used to build this repo, numbered.
- `evidence/`: spike and run evidence.
- `docs/`: documentation.
- `spikes/`: day-1 spike harnesses. Not product code.

## Tests

Tests live in `<package>/test/*.test.ts`.
