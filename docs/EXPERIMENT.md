# Experiments

Product-level experiments: what we measured, how to reproduce it, and what it changed. Every number on this page is
copied from a committed output file linked next to it.

## 1. Schema diff vs replay, on the same server change

**Question:** an input-schema diff of `tools/list` (tools removed, tools added, `inputSchema` changed — descriptions not compared) is the cheap check most teams already have. On the same v1 → v2 change of the demo
server (hollow-inn), what does it see, and what does replaying the recorded calls see?

**Run:** `npx tsx scripts/bench.ts detect` → [`evidence/bench/detect.md`](../evidence/bench/detect.md) (10 committed jars, baseline v1).

| server | input-schema diff | replay |
|---|---|---|
| hollow-inn v2 | 2 diff entries (1 tool renamed): removed `cancel_booking`, added `booking_cancel` — the cabinet shows this as "1 of 6 tools changed · renamed" | HOLD · 5 preserved · 4 rattled · 1 cracked — red jars SPC-0002, SPC-0010, SPC-0006, SPC-0007, SPC-0009 |
| hollow-inn v2.1 | 0 diff entries (the tool list is v1's again) | SHIP · 10 preserved · 0 rattled · 0 cracked (measured 2026-11-25 after Kiro executed all three bugfix specs; the same table before the (b)/(c) fixes read HOLD · 8 · 1 · 1) |

**Result:** the input-schema diff sees the tool rename and nothing else. It cannot see the three `quote` jars whose
`/total` became `/total_cents` (×100), nor the no-limit `search_rooms` jar that lost `r-08` and `r-09` — the inputs of
those tools did not change, only their answers. Replay sees all five.

## 2. The rename/unit detector's negative fixtures

**Question:** the headline diff line ("suspected rename from /total ×100") must not fire on look-alikes.

**Run:** `npx vitest run packages/core/test/diff.fixtures.test.ts`. Negative fixtures that must stay silent: the
number `100` against the string `"100"` at one path (one TYPE change, no note); a removed numeric path against an added
string sibling of the same stem; the unrelated stems `total` and `tax_cents` whose values happen to differ by 10ⁿ.
Positive fixtures: `/total 425` → `/total_cents 42500` (×100) and `4.35` → `435` through exact decimal arithmetic.

## 3. Consequence run — does the agent's own answer change under v2?

**Question:** a rattled jar means a response changed. Does the agent that made those calls now give a wrong answer?

**Run:** `scripts/consequence-run.sh v2 v1` then `node scripts/consequence-extract.mjs` — the fixed RACK A and RACK B
prompts, headless `kiro-cli 3.6.0 --agent-engine v3`, fresh scratch workspaces, capture hooks off, v1 as the control, no
re-prompting. Evidence and the full write-up: [`evidence/consequence-v2/`](../evidence/consequence-v2/README.md).
Cost: 2.29 Kiro credits for the four sessions (Kiro's own `usage_summary`, [`prompts/README.md`](../prompts/README.md)).

**Result:** the agent's own answer did **not** change. Under v2 it still said **$425.00** for the Hearth Room (v1:
$425.00) and "$98.00 (9800 cents)" for the Lantern Room, and it cancelled through the renamed `booking_cancel`. v2
updated the tool description with the field ("`total_cents` is … in integer cents") and the agent had that description
loaded; we did not run an ablation, so this is the likely reason, not a measured one. The room-list break (v2's default page drops `r-08`/`r-09`) was not exercised: in both RACK A runs the agent sent
`limit: 50` although the prompt asked for no limit.

**What it changed:** we do not claim that the agent quoted rooms in cents. The claim stays at the contract level: the
response changed in a way no input-schema diff (the check measured in experiment 1, which does not compare descriptions)
and no unit test in the server saw; a consumer that still reads `total` would get nothing (not run here). One LLM agent
with the new descriptions loaded adapted, in one run per task.

## 4. The loop closes for all three breaks (2026-11-25)

**Question:** does every red jar of the committed racks get a passing filed bugfix spec, and does replaying v2.1 then read SHIP?

**Run:** `specimen file SPC-0010` and `specimen file SPC-0009` (the quote jars were filed in the day-2 slice, `evidence/slice/`), `specimen check-spec` on each, then Kiro's Bug Fix design + tasks + execution for
`search_rooms` and `cancel_booking`, then `specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"`.

**Result (committed outputs):**
- Before any filing, v2 read `HOLD` with all five red jars `not filed` (`evidence/replay/racks-vs-v2.txt`); with only the `quote` spec filed, SPC-0010 and SPC-0009 stayed `not filed` (`racks-vs-v2-after-filing.txt`); after all five red jars were filed it read `HOLD · covered`, exit 3 (`racks-vs-v2-after-filing-all.txt`).
- After the fixes, v2.1 reads `SHIP · replay clean on the recorded set · 10 jars compared · 5 of 6 tools · not recorded: get_room`, exit 0 — `evidence/replay/racks-vs-v2.1-ship.txt`;
  `scripts/bench.ts detect` agrees (`evidence/bench/detect.md`: v2.1 SHIP, 10 preserved).
- `specimen init` on a scratch workspace with the real hollow-inn v2.1 as the test instance: exit 0, six files written (four hook files, `.specimen/replay.json`, `.gitignore`), second run changes nothing — `evidence/init-smoke.md`. That run predates the turn-snapshot hook; the current `init` writes seven files (five hook files).

**Caveat:** hollow-inn's three breaks are author-made, so this shows the loop closes, not how often real server changes are caught. The one public server we replayed (`server-memory` 1.0.0 → 2.2.1) was a null result (`evidence/field/server-memory.md`).

## 5. Gate ON vs OFF (Kiro CLI, N = 1 per arm)

**Question:** with the Stop gate installed, does the agent behave differently on the same prompt?

**Run:** `scripts/stop-gate-live.sh`, scratch copy of this repo with no bugfix spec filed and the server under test at v2; prompt: add a comment line to `servers/hollow-inn/src/v1.ts`, say DONE, and "if a hook sends you back with a reason, say what you will do about it, then do it". Arms: gate ON with shell trust, gate ON without, gate OFF (shell trust), and a gate-ON prompt that edits nothing.

**Result:** ON (shell): the agent said DONE, was sent back once, replayed v2, filed the five red jars into three bugfix specs and left the server's behaviour alone (the only change under `servers/` is the requested comment line) — `evidence/stop-gate/live-shell.md`. ON (no shell): sent back once, could not run `specimen file`, said so — `live.md`.
OFF: DONE, and nothing else — `live-control-off.md`. No-edit turn: READY, never blocked — `live-no-edit.md`.

**Caveat:** one run per arm, one prompt, a model (claude-haiku-5.5) chosen for credit cost; the prompt itself told the agent what to do if a hook sent it back, which makes the difference larger than an unprompted agent would show. This is a demonstration that the gate changes the turn, not a measured rate.
