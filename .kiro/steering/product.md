---
inclusion: always
---

# SPECIMEN JAR: product

SPECIMEN JAR is a tool for people who build MCP servers. It tells you whether a changed server still answers the way it did when real agents used it.

## How it works

1. **Capture.** A Kiro hook records every MCP tool call a Kiro agent makes, input and response, into an append-only "jar". A jar is one JSON line per call in `jars/<session>.jsonl`.
2. **Replay.** `specimen replay --server "<cmd>"` replays every jarred call against a changed version of the server. Calls run in recorded order, in a fresh server process per recorded session. Each response is diffed field by field against the recorded one.
3. **Judge.** Each jar ends in exactly one state:
   - PRESERVED: identical after normalisation, or different only by added fields (listed as compatible; `--strict` makes an added field rattle).
   - RATTLED: fields removed, changed or renamed.
   - CRACKED: the tool is gone or now errors.
   - SKIPPED: not allowed by `.specimen/replay.json`.
   - UNSEALED: not compared: an unpaired or orphaned call, a fully redacted response, or a result whose structuredContent or non-text content the text does not cover (a jar records text only).
4. **Verdict.** SHIP only when at least one jar was compared, none is rattled, cracked, unsealed or skipped, and no jar line is spoiled (unparseable). Otherwise HOLD, with the reason.

SHIP means "replay clean on the recorded set". It never means "this server is safe".

## Fixing what broke

A rattled jar is turned into a Kiro bugfix spec (Current / Expected / Unchanged behaviour) by a custom agent. Kiro then fixes the server through its own Bug Fix workflow.

Deterministic code decides what broke. Kiro decides how to fix it.

## Demo server

`hollow-inn` is a small haunted-inn booking MCP server with three versions:
- v1: the baseline that was recorded.
- v2: three deliberate breaks.
- v2.1: Kiro's fix.

## Principles

- Jars are evidence. Replay results must be reproducible from them.
- Never claim more than the replay showed.
