# Demo video — what each take is (2026-11-26)

The demo video shows two kinds of footage. This file records where each one came from, so every number on screen can be
checked.

## Live cabinet (scenes 2, 6a, 6c)
The production page `https://specimen.edycu.dev/`, opened in Chrome at 1920×1080 and recorded with no edits to the page.
The video adds a camera (zoom and pan on the real page), a cursor, click rings, two caption chips and two lens vignettes
(beside the open drawer, around the verdict plate). The verdict plates read at recording time:

| Take | Action | Verdict plate |
|---|---|---|
| cold open | fresh load, v2 replays in the browser | `HOLD v2 · 5 preserved · 4 rattled · 1 cracked` |
| fix | open jar A2 (SPC-0002) → read the drawer → switch to v2.1 → Replay | `SHIP v2.1 · 10 preserved · 0 rattled · 0 cracked` |

The caption chip in the fix take ("3 of 10 came back with one new field, total_cents · --strict would say HOLD") restates
`replay/racks-vs-v2.1-ship.txt` (SPC-0002, SPC-0006, SPC-0007: `preserved · +1 field`) and
`replay/racks-vs-v2.1-strict.txt` (`HOLD · 3 rattled`).

## Terminal takes (scenes 1, 4, 5, 6b)
Real commands typed into a real bash in a pseudo-terminal, every byte recorded with its time and played back as recorded.
All four ran in scratch copies under `/tmp` (a clone of this repo at commit 831bc0a, and a scratch Kiro workspace). Nothing
they wrote was committed: the committed jars, specs and replays are the ones in this repo. Times are WIB.

| Take | Finished (WIB) | Commands | What it printed (decisive lines) |
|---|---|---|---|
| T1 tests | 2026-11-26 00:58 | `npx vitest run servers/hollow-inn/test/v2.test.ts --reporter=verbose` | `quote returns total_cents as an integer: r-04 × 2 nights = 42500` · `Tests 5 passed (5)` |
| T2 capture | 2026-11-26 00:59 | `kiro-cli chat --no-interactive --agent-engine v3 --trust-workspace --trust-tools=@hollowinn "<prompts/rack-b.md>"` in a scratch workspace set up by `specimen init` (hollow-inn v1, the capture hooks), then `cat .kiro/hooks/specimen-jar-post.json` | 5 calls sealed by the PostToolUse hook as scratch jars SPC-0011 `search_rooms`, SPC-0012 `quote`, SPC-0013 `quote`, SPC-0014 `book`, SPC-0015 `cancel_booking` (14.6 s to 22.4 s into the take) |
| T3 file | 2026-11-26 01:00 | `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2"` · `npx specimen file SPC-0002` (the committed quote spec removed in the scratch copy first) · `grep -E 'WHEN\|SHALL' .kiro/specs/quote-*/bugfix.md \| head -4` · `npx specimen check-spec .kiro/specs/quote-*/bugfix.md --jar SPC-0002` | `HOLD · 4 rattled, 1 cracked · 10 jars compared · 4 of 6 tools` · `filed .kiro/specs/quote-total-total-cents/bugfix.md · PASS SPC-0002, SPC-0006, SPC-0007` · `PASS SPC-0002` |
| T4 fix | 2026-11-26 01:54 | `ls .kiro/specs/quote-total-total-cents/` · `grep -- '- \[x\]' …/tasks.md` · `git log -1 --format='%h %s' d663eea \| fold -s -w 96` · the same for a1fb952 | `bugfix.md design.md tasks.md tasks.meta.json` · 10 `[x]` lines · both commit subjects in full |

The bugfix spec the curator filed in T3 is a new filing. It words the WHEN clause of lines 1.1 and 2.1 (and the 1.1 THEN
clause) differently from the committed `.kiro/specs/quote-total-total-cents/bugfix.md` (filed 2026-11-25); the 2.1 THEN
clause is identical. It passed `check-spec` on the CLI's one retry: the first curator run failed the check (shall_continue,
unchanged_jar) and `specimen file` re-prompted it, the same retry the committed filing needed (`prompts/README.md`). The
×12 stretch in scene 5 contains both curator runs. Scene 5 shows lines 1.1 and 2.1 as the take printed them.

## Sped-up stretches (labelled on screen)
| Scene | Stretch | Real time | Shown at |
|---|---|---|---|
| 4 | the Kiro CLI session, from Enter to the prompt returning (5.6 s → 26.0 s into T2) | 20.4 s | ×3 |
| 5 | `specimen file SPC-0002`, from Enter to the prompt returning (8.9 s → 45.5 s into T3; two curator runs) | 36.5 s | ×12 |

Everything else plays at real speed. Where a terminal waits at an idle prompt between two commands, the video may hold
that frame; it never speeds it up without a label.

Kiro credits for these takes: 1.20 (T2 0.58, T3 0.62 — two curator sessions), summed from each session's `usage_summary`
by `scripts/kiro-credits.mjs`.
