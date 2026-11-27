# Architecture

Regenerated from the code on 2026-11-26 at commit fcfea86 (file names below are the files in this repository). One TypeScript codebase; the
same `@specimen/core` runs in the Kiro hook, the `specimen` CLI, the demo MCP server's replay and the browser cabinet.

![SPECIMEN JAR architecture, as built: the seven .kiro/hooks files run specimen on each call to the hollow-inn MCP server; jars → replay → verdict (v2 HOLD jar by jar, v2.1 SHIP) → specimen file → Kiro curator → Kiro Bug Fix → hollow-inn v2_1.ts; the Stop gate; @specimen/core shared with the cabinet, landing and deck on Vercel](docs/architecture.png)

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
| `packages/core` (about 4,000 lines) | Pure logic: no `node:` import anywhere in `packages/core/src`, so the same code bundles for the browser. `jar.ts` (zod jar schema), `pairing.ts` (pre/post pairing), `scan.ts` (strict RFC 8259 scanner so redaction edits raw value spans instead of re-serialising), `redact.ts`, `replay.ts` (the loop), `normalize.ts`, `diff.ts` (RFC 6901 paths, keyed arrays, rename and unit detector), `verdict.ts` (SHIP/HOLD), `stop-gate.ts` (the pure `decideStop`), `firewall.ts`, `spec-check.ts` + `reference.ts` + `bugfix-spec.ts` (bugfix spec validity and the jarred reference), `policy.ts` (`.specimen/replay.json`, volatile policy) |
| `packages/cli` | The `specimen` command: `hook pre|post|firewall|prompt|stop` (stdin JSON in, jar line / turn snapshot / block decision out, fail-open on bad input), `replay`, `check-spec`, `file`, `init`, `manifest` |
| `servers/hollow-inn` | The demo MCP server (six tools: `search_rooms`, `get_room`, `quote`, `book`, `list_bookings`, `cancel_booking`). `v1.ts` baseline, `v2.ts` three author-made breaks (`CHANGES.md`), `v2_1.ts` the Kiro-written fix. Money is integer cents, written as a two-decimal literal by `money.ts` |
| `apps/cabinet` | Vite + React. `browser-replay.ts` runs the real `replay()` and `verdict()` against the real hollow-inn modules over `InMemoryTransport` in the browser; jars, policy files and the committed bugfix specs are imported at build time; it writes nothing and requests no third-party host. Components: shelf of jars, ServerSwitch (v1 / v2 / v2.1), ReplayButton, CountsPair, VerdictPlate, LabReportTable, JarDrawer, SpecViewer, SpoiledTray, GuideStrip |
| `site/` | The landing page (`/landing/`), the pitch deck (`/deck/`) and the judge page (`/judge`): static files in `site/public/`, plus `/static/replay.js` built from `site/replay-entry.ts` (the cabinet's replay module), so these pages replay the jars live in the visitor's tab (the judge page only when a version is pressed) |
| `spikes/` | Day-1 spike harnesses (S1 browser bundle). Evidence, not product code |
| `scripts/` | `bench.ts detect|hook|replay`, `seed-check.ts`, `record-sessions.sh`, `consequence-run.sh`, `consequence-extract.mjs`, `kiro-credits.mjs`, `stop-gate-eval.sh`, `stop-gate-live.sh`, `check_submission_readiness.ts` |

## Contracts that matter

- **Verdict.** `SHIP` needs at least one compared jar, no rattled, cracked, unsealed or skipped jar, and no spoiled line. Otherwise `HOLD`. `verdict()` also returns `red`, `filed` and `covered`.
  Exit codes of `specimen replay`: 0 SHIP · 1 any HOLD that is not covered · 3 HOLD with at least one red jar, every red jar filed in a passing spec, and no unsealed, skipped or spoiled entry · 2 usage or operational error.
- **Jars are evidence.** The firewall hook blocks a write to `jars/` made through Kiro's `write` tool (probed with `fs_write`, `evidence/firewall-probe.md`; shell writes are outside its matcher); the manifest hook runs `specimen manifest check` (SHA-256 of every jar against `MANIFEST.sha256`) before and after each Kiro task.
- **Replay safety.** The server under test comes only from `--server`; tools replayed are the ones allowed in `.specimen/replay.json`
  (pre-filled from `readOnlyHint` by `specimen init`); responses are redacted before they are written; a volatile-fields policy keeps ids and timestamps from
  counting as changes.
- **One server per recorded session.** A resumed Kiro session starts a new MCP server process, so `search_rooms` is a stateless catalogue lookup
  and `book` / `list_bookings` are replayed on a fresh server per session (the `BK-0001` check in `evidence/spikes/S1.md`).
- **The cabinet and the CLI share `@specimen/core`.** The cabinet's verdict for each version equals `specimen replay`'s
  (`evidence/bench/detect.md` for the CLI; the cabinet tests pin the same counts).

- **The Stop gate** (`specimen hook stop --server "<cmd>"`, Kiro `Stop` hook, 30 s timeout). It runs only when the watched paths of `.specimen/replay.json` changed since the turn snapshot
  (`.specimen/turn.json`, written by `specimen hook prompt` on `UserPromptSubmit`; a missing snapshot means "check"). `decideStop` blocks only when a red jar that `specimen file` can file (rattled, or cracked because the tool is gone or now returns an error) has no
  passing filed bugfix spec — an operational crack (start failure, timeout, dead session) is written to `.specimen/unresolved.md` instead; SHIP, empty, all-skipped, quarantined or spoiled results never block. At most 3 blocks per session (`.specimen/gate-<session>.json`), then it allows the stop and
  writes `.specimen/unresolved.md`. Any error or timeout allows the stop. `specimen file` starts the curator with `SPECIMEN_GATE=off` so the curator's own turn is not sent back.
  The committed hook's `--server` is hollow-inn v2.1 (the current, SHIP server: no block until v2.1 changes); the E1–E3 runs pass v1 or v2 to `specimen hook stop --server` directly (`scripts/stop-gate-eval.sh:26`) and the live runs rewrite the hook's `--server` to v2 or v1 in a scratch copy (`scripts/stop-gate-live.sh:26`).

## Hosting

Static output (`apps/cabinet/dist`) on Vercel at <https://specimen.edycu.dev/>. `vercel.json` runs `npm run build -w apps/cabinet`, then `npx vite build --config site/vite.config.ts`, which adds `site/public/` (the landing at `/landing/`, the deck at `/deck/`, the judge page at `/judge`) and `/static/replay.js` (`site/replay-entry.ts`: the cabinet's `browser-replay.ts` bundled on its own, so those pages run the same replay and verdict code without the React app). No server is needed on the judge path.

The judge path is tested end to end by Playwright (`e2e/judge-path.spec.ts`, 17 tests in Chromium: the cabinet's v2 / v2.1 / v1 verdicts, the keyboard server switch, the landing hero's live replay, the deck's keyboard navigation, the judge page and the links to it, the static files, no third-party request, no horizontal scroll at 320 and 375 px). CI runs it on the built output (`.github/workflows/e2e.yml`); Deployment is part of CI: once CI passes on a push to `main`, `.github/workflows/live.yml` (Deploy & Live) builds that commit on the runner with the pinned Vercel CLI (`vercel pull --environment=production` → `vercel build --prod` → `vercel deploy --prebuilt --prod`, recorded as a GitHub deployment to the `production` environment), checks that the live `index.html` is byte-identical to the build, and runs the same suite against <https://specimen.edycu.dev/>; the live checks also run every six hours. Lighthouse CI scores the four pages against floors and byte budgets (`lighthouserc.json`, `.github/workflows/quality.yml`).

## Not built

Not in this repository, and why (each is a cut for time against the Must path, not a technical blocker we found): a larger field shelf (hour 1 tried one public server, server-memory 1.0.0 → 2.2.1: no break found, HOLD · 3 preserved · 2 unsealed by structuredContent a text-only jar cannot compare, `evidence/field/server-memory.md`); `specimen seal` / `cabinet`; a gate A/B beyond N = 1 per arm; any IDE measurement of the Stop gate; and an MCP server inside the Power (`power/specimen/` ships one skill).
