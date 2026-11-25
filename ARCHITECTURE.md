# Architecture

Regenerated from the code on 2026-11-25 (file names below are the files in this repository). One TypeScript codebase; the
same `@specimen/core` runs in the Kiro hook, the `specimen` CLI, the demo MCP server's replay and the browser cabinet.

```
Kiro agent ──MCP call──▶ hollow-inn (stdio)
     │   PreToolUse / PostToolUse hooks (.kiro/hooks/specimen-jar-{pre,post}.json)
     ▼
specimen hook pre|post ──▶ jars/sess_<id>.jsonl      one JSON line per call, response_text byte for byte
     │                       jars/MANIFEST.sha256     (checked by `specimen manifest check`, which the manifest hook runs before and after each Kiro task)
     ▼
specimen replay --server "<cmd>"
     │   fresh server per recorded session, calls replayed in order, tools/list diffed as a baseline
     ▼
replays/<server>-<time>.json ──▶ verdict (SHIP | HOLD, red / filed / covered)
     │                                  ▲
     ▼                                  │ filed ids = jars named by a passing bugfix spec
Kiro Stop hook ──▶ specimen hook stop ──▶ replay (only if servers/ changed this turn: snapshot by `hook prompt` on UserPromptSubmit)
     └─ block + reason while a red jar is unfiled (max 3 per session; fails open)
specimen file <jar> ──▶ curator agent ──▶ .kiro/specs/<name>/bugfix.md ──▶ specimen check-spec
                                          Kiro Bug Fix workflow: design.md, tasks.md ──▶ code change ──▶ replay again
```

## Packages

| Path | Role |
|---|---|
| `packages/core` (3,900 lines) | Pure logic: no `node:` import anywhere in `packages/core/src`, so the same code bundles for the browser. `jar.ts` (zod jar schema), `pairing.ts` (pre/post pairing), `scan.ts` (strict RFC 8259 scanner so redaction edits raw value spans instead of re-serialising), `redact.ts`, `replay.ts` (the loop), `normalize.ts`, `diff.ts` (RFC 6901 paths, keyed arrays, rename and unit detector), `verdict.ts` (SHIP/HOLD), `stop-gate.ts` (the pure `decideStop`), `firewall.ts`, `spec-check.ts` + `reference.ts` + `bugfix-spec.ts` (bugfix spec validity and the jarred reference), `policy.ts` (`.specimen/replay.json`, volatile policy) |
| `packages/cli` | The `specimen` command: `hook pre|post|firewall|prompt|stop` (stdin JSON in, jar line / turn snapshot / block decision out, fail-open on bad input), `replay`, `check-spec`, `file`, `init`, `manifest` |
| `servers/hollow-inn` | The demo MCP server (six tools: `search_rooms`, `get_room`, `quote`, `book`, `list_bookings`, `cancel_booking`). `v1.ts` baseline, `v2.ts` three author-made breaks (`CHANGES.md`), `v2_1.ts` the Kiro-written fix. Money is integer cents, written as a two-decimal literal by `money.ts` |
| `apps/cabinet` | Vite + React. `browser-replay.ts` runs the real `replay()` and `verdict()` against the real hollow-inn modules over `InMemoryTransport` in the browser; jars, policy files and the committed bugfix specs are imported at build time; it writes nothing and requests no third-party host. Components: shelf of jars, ServerSwitch (v1 / v2 / v2.1), ReplayButton, CountsPair, VerdictPlate, LabReportTable, JarDrawer, SpecViewer, SpoiledTray, GuideStrip |
| `spikes/` | Day-1 spike harnesses (S1 browser bundle). Evidence, not product code |
| `scripts/` | `bench.ts detect`, `seed-check.ts`, `record-sessions.sh`, `consequence-run.sh`, `kiro-credits.mjs` |

## Contracts that matter

- **Verdict.** `SHIP` needs at least one compared jar, none skipped, and none red. Otherwise `HOLD`. `verdict()` also returns `red`,
  `filed` and `covered`. Exit codes of `specimen replay`: 0 SHIP · 1 HOLD with a red jar that has no passing filed spec · 3 HOLD with every red
  jar filed · 2 usage or operational error.
- **Jars are evidence.** The firewall hook blocks an agent write to `jars/`; the manifest hook runs `specimen manifest check` (SHA-256 of every jar against `MANIFEST.sha256`) before and after each Kiro task.
- **Replay safety.** The server under test comes only from `--server`; tools replayed are the ones allowed in `.specimen/replay.json`
  (pre-filled from `readOnlyHint` by `specimen init`); responses are redacted before they are written; a volatile-fields policy keeps ids and timestamps from
  counting as changes.
- **One server per recorded session.** A resumed Kiro session starts a new MCP server process, so `search_rooms` is a stateless catalogue lookup
  and `book` / `list_bookings` are replayed on a fresh server per session (the `BK-0001` check in `evidence/spikes/S1.md`).
- **The cabinet and the CLI share `@specimen/core`.** The cabinet's verdict for each version equals `specimen replay`'s
  (`evidence/bench/detect.md` for the CLI; the cabinet tests pin the same counts).

- **The Stop gate** (`specimen hook stop --server "<cmd>"`, Kiro `Stop` hook, 30 s timeout). It runs only when the watched paths of `.specimen/replay.json` changed since the turn snapshot
  (`.specimen/turn.json`, written by `specimen hook prompt` on `UserPromptSubmit`; a missing snapshot means "check"). `decideStop` blocks only when a red (rattled or cracked) jar has no
  passing filed bugfix spec; SHIP, empty, all-skipped, quarantined or spoiled results never block. At most 3 blocks per session (`.specimen/gate-<session>.json`), then it allows the stop and
  writes `.specimen/unresolved.md`. Any error or timeout allows the stop. `specimen file` starts the curator with `SPECIMEN_GATE=off` so the curator's own turn is not sent back.

## Hosting

Static output (`apps/cabinet/dist`) on Vercel, `vercel.json` builds `npm run build -w apps/cabinet`; no server is needed on the judge path.

## Not built

The Kiro Power, a gate A/B beyond one ON and one OFF run, and any IDE measurement of the Stop gate are not in this repository.
