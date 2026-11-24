# Requirements Document

## Introduction

The Cabinet is the browser page a judge opens at https://specimen.edycu.dev/. It lives in `apps/cabinet` and runs the real replay engine from `packages/core` in the browser against the real hollow-inn server modules (`createServer("v1" | "v2" | "v2.1")`) over the MCP SDK `InMemoryTransport`. The inputs are the committed jars (`jars/racks.json`, RACK A and RACK B files imported as raw text at build time), `.specimen/replay.json`, `.specimen/volatile.json` and `.specimen/redact.json`. This is the wiring proven by `spikes/s1-browser/src/s1-real.ts`.

Every state, count, path and value on the page comes from that replay or from a committed file. The page mocks nothing and requests no third-party host. The visual direction is "night-lab-specimen": a Frankenstein specimen lab at night, with jars of preserving fluid on iron shelves, a barred storm window whose lightning is the replay firing, and a lab notebook where diffs are written.

Known measured results the Cabinet must reproduce (from `evidence/replay/racks-vs-*.txt`, 10 jars, 4 or 5 of 6 listed tools compared). These figures are test expectations only (Requirement 16). The page itself never contains them as typed values.

- v1: SHIP, all 10 jars preserved. Schema diff 0 of 6 tools changed. Replay 0 tools · 0 jars changed.
- v2: HOLD, 5 preserved, 4 rattled (SPC-0002, SPC-0006, SPC-0007 on `quote`; SPC-0010 on `search_rooms`), 1 cracked (SPC-0009 `cancel_booking`). Schema diff 1 of 6 tools changed (`cancel_booking` removed, `booking_cancel` added, no `inputSchema` changed). Replay 3 tools · 5 jars changed.
- v2.1: HOLD, 8 preserved, 1 rattled (SPC-0010), 1 cracked (SPC-0009). The three `quote` jars are preserved with one added field (`total_cents`). Schema diff 1 of 6 tools changed. Replay 2 tools · 2 jars changed. The Cabinet reports this HOLD as measured and never presents v2.1 as clean.

Bugfix-filing facts apply to the Cabinet's filed counter. The committed spec `.kiro/specs/quote-total-total-cents/bugfix.md` lists SPC-0002, SPC-0006 and SPC-0007. No committed spec lists SPC-0010 or SPC-0009. The counter therefore reads 5 red · 3 filed for v2 and 2 red · 0 filed for v2.1 (`evidence/replay/racks-vs-v2-after-filing.txt` and `racks-vs-v2.1.txt`). `evidence/replay/racks-vs-v2.txt` predates filing and lists all five red jars as not filed.

The CLI replay report and the Cabinet disagree in one place by design: the Cabinet derives the schema-diff count from `schema_diff`, which holds names only, so the tool total of the baseline is derived as defined in Requirement 6.

## Glossary

- **Cabinet**: The static React page in `apps/cabinet` that this document specifies.
- **Replay_Module**: The Cabinet module that wires the Jar_Files, the three `.specimen` policy files, `createServer(version)` and `InMemoryTransport` into `replay()` and `verdict()` from `packages/core`, and returns one Replay_Result.
- **Replay_Result**: The object built from `replay()`, `verdict()` and `buildReplayResultFields()`, holding the verdict, counts, per-jar entries, coverage, `schema_diff`, quarantined and spoiled lines, and the Replay_Time.
- **Replay_Time**: The elapsed milliseconds between two `performance.now()` readings taken immediately before and after the single `replay()` call, including baseline and target start-up and `tools/list`, and excluding the Filed_Ids computation, `verdict()` and the Reveal.
- **Jar_File**: A committed `jars/*.jsonl` file listed in `jars/racks.json`, imported as raw text at build time.
- **Rack**: One recorded Kiro session. RACK A and RACK B are the two Racks.
- **Jar**: One recorded MCP tool call with an accession number (`SPC-NNNN`), drawn as an SVG jar. Accession numbers are not ordered by shelf position (SPC-0010 sits at A5).
- **Jar_State**: One of `not replayed`, `preserved`, `rattled`, `cracked`, `unsealed`, `skipped`.
- **Red_Jar**: A Jar whose state is rattled or cracked.
- **Version**: One of `v1`, `v2`, `v2.1`, the hollow-inn server versions.
- **Cold_Open**: The automatic v2 replay and animated reveal that runs when the page loads.
- **Reveal**: The paced, left-to-right, row-by-row appearance of jar states after a replay. Jars appear in Rack order of `racks.json`, then in `seq` order within a Rack.
- **Reveal_Interval**: The fixed delay of 250 ms between one Jar's reveal and the next, defined once as a constant of the Cabinet.
- **ServerSwitch**: The control that selects a Version.
- **ReplayButton**: The control labelled "Replay cabinet".
- **VerdictPlate**: The header plate showing verdict, version, counts, coverage and the filed counter.
- **CountsPair**: The line that sets the schema-diff count beside the replay-impact count.
- **ShelfRow**: One Rack drawn as a titled iron shelf with its Jars.
- **Jar_Cell**: The grid cell of one Jar on a ShelfRow, with a minimum width of 140 px.
- **JarDrawer**: The panel opened by activating a Jar.
- **LabReportTable**: The ruled-paper diff table inside the JarDrawer.
- **SpecViewer**: The JarDrawer section that renders the bugfix spec for a Jar.
- **Bugfix_Spec**: A committed `.kiro/specs/<slug>/bugfix.md` file imported as raw text at build time, held as a pair of repository path and text.
- **Filed_Ids**: The set of Red_Jar ids cited by at least one Bugfix_Spec that passes `checkSpec()` for that id, computed by the same rule as `filedJarIds` in `packages/cli/src/replay/spec-files.ts`.
- **GuideStrip**: The three-step "60-second judge path" strip.
- **CabinetFrame**: The wall, iron frame, barred window and organ sutures around the page content.
- **Legend**: The key that draws each Jar_State small with its word.
- **SpoiledTray**: The list of quarantined and spoiled jar lines.
- **HowJarsWereMade**: The footer section explaining how the jars were captured.
- **Reduced_Motion**: The `prefers-reduced-motion: reduce` media condition, observed live so that a change takes effect without a reload.
- **Token_File**: The single CSS file of custom properties for colours, faces and sizes.
- **Dist**: The static output directory of `npm run build -w apps/cabinet`.
- **Breakpoint**: A viewport width band in CSS pixels, implemented with `min-width` media queries at 600, 1024 and 1280: ≥ 1280 px, 1024–1279 px, 600–1023 px, < 600 px.
- **Namespace_Host**: A host name that appears in bundled code only as an identifier and is never requested: `www.w3.org`, `json-schema.org`, `react.dev`.

## Requirements

### Requirement 1: Real in-browser replay

**User Story:** As a judge, I want the page to run the actual replay engine in my browser, so that every number I see is measured and not staged.

#### Acceptance Criteria

1. THE Replay_Module SHALL run `replay()` and `verdict()` from `@specimen/core` against `createServer(version)` from `servers/hollow-inn` over `InMemoryTransport` using the real `@modelcontextprotocol/sdk` `Client` and server.
2. THE Replay_Module SHALL read its inputs only from the Jar_Files listed in `jars/racks.json`, `.specimen/replay.json`, `.specimen/volatile.json`, `.specimen/redact.json` and the committed Bugfix_Specs.
3. THE Replay_Module SHALL parse `replay.json`, `volatile.json`, `redact.json` and each Jar_File line with the zod schemas of `@specimen/core` before use.
4. THE Replay_Module SHALL create the baseline client from `createServer("v1")` and the client under test from `createServer(version)` for the selected Version, with a fresh server per recorded session, and SHALL close every client and server it created when the replay ends or fails.
5. THE Replay_Module SHALL pass `performance.now()` only as the `clock` argument of `replay()` and as the source of the Replay_Time, and SHALL pass no clock, randomness or network call into diff, normalise, verdict or `checkSpec()`.
6. THE Replay_Module SHALL avoid `node:` imports in every module that the browser bundle includes.
7. WHEN the Replay_Module replays `v1`, THE Cabinet SHALL produce verdict SHIP with 10 preserved jars.
8. WHEN the Replay_Module replays `v2`, THE Cabinet SHALL produce verdict HOLD with 5 preserved, 4 rattled and 1 cracked jars.
9. WHEN the Replay_Module replays `v2.1`, THE Cabinet SHALL produce verdict HOLD with 8 preserved, 1 rattled and 1 cracked jars.
10. THE Cabinet SHALL display no jar state, count, path, value, time or filed figure that is not computed from a Replay_Result or read from a committed file, and the expected figures of criteria 7 to 9 SHALL appear only in the test suite.
11. THE Replay_Module SHALL compute Filed_Ids from the entries of the Replay_Result before it calls `verdict()`, and SHALL pass them to `verdict()` as `filedIds`.

### Requirement 2: Cold open

**User Story:** As a judge, I want the cabinet to replay v2 and animate the breakage as soon as I open it, so that I see the product work without a click.

#### Acceptance Criteria

1. WHEN the page loads, THE Cabinet SHALL select Version `v2` in the ServerSwitch and SHALL start a replay of Version `v2` without any user action.
2. WHEN the Cold_Open replay starts, THE CabinetFrame SHALL show one lightning flash across the barred window using `--storm`.
3. WHEN a replay result arrives, THE Cabinet SHALL reveal the Jars in Reveal order with the Reveal_Interval of 250 ms between one Jar and the next.
4. THE Replay_Module SHALL run the replay at full speed, and THE Cabinet SHALL pace only the Reveal. The Reveal SHALL NOT be counted in the Replay_Time.
5. WHEN the Reveal completes, THE VerdictPlate SHALL state the line "N jars replayed in T ms · in this browser · hollow-inn <version> in memory · reveal paced at 250 ms per jar", where N is `coverage.compared` of the Replay_Result and T is its Replay_Time.
6. WHEN a preserved jar is revealed, THE Jar SHALL settle with fluid in `--before`.
7. WHEN a rattled jar is revealed, THE Jar SHALL play a rattle of translateX ±3 px and rotate ±2.5° for 3 cycles with an animation duration of 540 ms and ease-out timing.
8. WHEN a rattled jar is revealed, THE Jar SHALL twitch its specimen, flood its fluid from `--before` to `--after` bottom-up with an animation duration of 700 ms using a mask, and ink a red ABNORMAL strip across its toe-tag in `steps(4)` with an animation duration of 320 ms.
9. WHEN a cracked jar is revealed, THE Jar SHALL show a crack line, dimmed low fluid in `--cracked`, and a torn label carrying the word CRACKED.
10. WHEN the first rattled jar finishes its animation, THE Cabinet SHALL slam one rubber stamp "IT'S MOVING" in the display face, in `--after`, rotated, beside that jar, once per page load, and the stamp SHALL NOT intercept pointer events or cover a Jar's toe-tag.
11. THE stamp "IT'S MOVING" SHALL carry `aria-hidden="true"`.
12. WHILE a Jar is preserved or not replayed, THE Jar SHALL animate only one bubble, with a CSS animation duration of 6 s.
13. WHILE Reduced_Motion is active, THE Cabinet SHALL omit shake, bubbles and the lightning flash, SHALL show a static window glow, SHALL set the Reveal_Interval to 0 ms so that all Jars take their state at once, SHALL switch fluid colour and the ABNORMAL strip instantly, SHALL show the stamp without motion, and SHALL run no CSS animation or transition of a duration above 0 ms.
14. WHEN Reduced_Motion changes while the page is open, THE Cabinet SHALL apply the new setting to the next animation without a reload.
15. WHEN the user activates a Jar, the ReplayButton or the ServerSwitch while a Reveal is running, THE Cabinet SHALL complete the Reveal at once, so that every Jar shows its final state before the action takes effect.
16. WHILE the Reveal is running, THE Cabinet SHALL name each Jar not yet revealed in its accessible name as "not replayed", and THE VerdictPlate SHALL stay hidden until the Reveal completes.
17. WHEN the Reveal completes, THE VerdictPlate SHALL announce the verdict, counts and filed counter once through a polite live region (`role="status"`), and SHALL announce no per-Jar reveal.

### Requirement 3: ServerSwitch and ReplayButton

**User Story:** As a judge, I want to switch between v1, v2 and v2.1 and replay each, so that I can compare the control, the break and the fix.

#### Acceptance Criteria

1. THE ServerSwitch SHALL offer exactly the Versions `v1`, `v2` and `v2.1`.
2. WHILE the viewport is 600 px wide or more, THE ServerSwitch SHALL render as a segmented control.
3. WHILE the viewport is narrower than 600 px, THE ServerSwitch SHALL render as a select element.
4. WHEN the user selects a different Version, THE Cabinet SHALL set every Jar to `not replayed`, SHALL hide the VerdictPlate figures and the CountsPair figures, and SHALL keep that state until the next replay completes.
5. WHEN the user selects a Version, THE Cabinet SHALL show under the ServerSwitch the matching entry of `servers/hollow-inn/CHANGES.md` for that Version, imported as raw text at build time and split at its `## v<version>` headings.
6. WHEN the user activates the ReplayButton, THE Cabinet SHALL replay the selected Version.
7. WHILE a replay is running, THE ReplayButton SHALL be disabled with `aria-disabled="true"` and SHALL show the elapsed milliseconds as a display-only counter. WHEN the replay completes, THE ReplayButton SHALL show no counter and the VerdictPlate SHALL show the Replay_Time.
8. WHEN `v1` is selected and replayed, THE Cabinet SHALL label it as the control and SHALL show the verdict and version from the Replay_Result.
9. WHEN `v2.1` is selected, THE Cabinet SHALL state that v2.1 is the version Kiro fixed from the filed `quote` bugfix spec, and SHALL state nothing about the other broken jars until the replay result is shown.
10. WHEN `v2.1` has been replayed, THE VerdictPlate SHALL show the measured verdict and counts, including the remaining rattled and cracked jars.
11. WHEN the Version changes during a running replay, THE ServerSwitch SHALL stay enabled and THE Cabinet SHALL discard the unfinished result and SHALL show only the result of the most recent replay request.
12. WHEN the Version changes while the JarDrawer is open, THE JarDrawer SHALL stay open on the same Jar and SHALL show the `not replayed` content of Requirement 10 criterion 12.
13. THE ServerSwitch SHALL be operable with the keyboard: arrow keys SHALL move between Versions in the segmented control and SHALL select the Version, and the control SHALL expose the selected Version to assistive technology.

### Requirement 4: VerdictPlate

**User Story:** As a judge, I want one plate that states the verdict and how much it covers, so that I can read the outcome and its limits at once.

#### Acceptance Criteria

1. THE VerdictPlate SHALL show the verdict word and the Version in the display face at a size of 56 px, reduced to no less than 36 px WHILE the viewport is narrower than 600 px.
2. WHEN the verdict is HOLD, THE VerdictPlate SHALL colour the verdict word `--after`.
3. WHEN the verdict is SHIP, THE VerdictPlate SHALL colour the verdict word `--before`.
4. THE VerdictPlate SHALL show the counts in the form "P preserved · R rattled · C cracked", and SHALL append "U unsealed" WHEN the unsealed count is greater than zero.
5. THE VerdictPlate SHALL show the coverage line in the form "N jars compared · T of K tools · not recorded: <tool names>" using `coverage` returned by `verdict()`, where N is `coverage.compared`, T is the length of `coverage.tools_compared` and K is the length of `coverage.tools_listed`, the tools listed by the selected Version. THE VerdictPlate SHALL show "none" WHEN `coverage.tools_unrecorded` is empty, as `coverageString()` of `@specimen/core` does.
6. THE VerdictPlate SHALL show the filed counter in the form "R red · F filed as Kiro bugfix specs", where R is `red` and F is `filed` returned by `verdict()`.
7. WHEN F equals R and R is greater than zero, THE VerdictPlate SHALL show "all red jars filed".
8. WHEN the skipped count is greater than zero, THE VerdictPlate SHALL show "S skipped".
9. WHEN the quarantined count is greater than zero, THE VerdictPlate SHALL show "Q quarantined".
10. WHEN the spoiled count is greater than zero, THE VerdictPlate SHALL show "L spoiled".
11. THE VerdictPlate SHALL take the verdict, counts, coverage, R, F and the reason from `verdict()` and the Replay_Result of `@specimen/core`, and the UI SHALL derive none of them.
12. WHILE no replay has completed for the selected Version, THE VerdictPlate SHALL show no verdict word.
13. THE VerdictPlate SHALL NOT state that a SHIP verdict means the server is safe.
14. WHEN the verdict is SHIP, THE VerdictPlate SHALL state "replay clean on the recorded set".
15. WHEN the verdict is HOLD, THE VerdictPlate SHALL show the `reason` returned by `verdict()`.

### Requirement 5: Filed ids in the browser

**User Story:** As a maintainer, I want the browser to decide which red jars are filed by the same rule as the CLI, so that the page and the CLI never disagree.

#### Acceptance Criteria

1. THE Cabinet SHALL import every `.kiro/specs/*/bugfix.md` as raw text at build time, keeping its repository path.
2. THE `packages/core` package SHALL export the pure parts of `citesId` and `filedJarIds` that the browser needs, together with the `BugfixSpec` type, and THE `packages/cli` package SHALL consume them from `packages/core` and SHALL keep re-exporting them from `packages/cli/src/replay/spec-files.ts`.
3. WHEN the pure parts move into `packages/core`, THE existing `packages/cli` behaviour and the existing `packages/cli` tests SHALL stay unchanged and passing.
4. THE moved code SHALL contain no `node:` import.
5. THE Cabinet SHALL compute Filed_Ids by applying `citesId` with whole-token matching and `checkSpec()` against the entries of the same Replay_Result to each Red_Jar.
6. WHEN the v2 replay completes with the committed specs, THE Cabinet SHALL report Filed_Ids equal to SPC-0002, SPC-0006 and SPC-0007.
7. IF no Bugfix_Spec exists for a Red_Jar, THEN THE Cabinet SHALL count that Red_Jar as not filed.
8. WHEN the v2.1 replay completes with the committed specs, THE Cabinet SHALL report empty Filed_Ids, because the three `quote` jars are preserved and `checkSpec()` answers not red for them.
9. THE Cabinet SHALL ignore a Replay_Result entry whose `id` is null when it computes Filed_Ids.

### Requirement 6: CountsPair

**User Story:** As a judge, I want the schema diff and the replay result side by side, so that I can see what a schema check misses.

#### Acceptance Criteria

1. THE CountsPair SHALL show "schema diff: A of B tools changed", where A is the number of tools in `schema_diff.tools_removed` plus the number in `schema_diff.input_schema_changed`, and B is the number of tools in the baseline `tools/list`, derived as `coverage.tools_listed.length − schema_diff.tools_added.length + schema_diff.tools_removed.length`.
2. WHEN `schema_diff.tools_added` is not empty, THE CountsPair SHALL list the added tool names after the schema diff text, in the form "added <names>".
3. THE CountsPair SHALL show "replay: C tools · D jars changed", where C is the number of distinct `tool` values among the Red_Jars and D is the number of Red_Jars, so that D equals `red` of `verdict()`.
4. THE CountsPair SHALL compute both figures from `schema_diff`, `coverage` and the jar states of the same Replay_Result.
5. WHEN the Replay_Result is for `v2`, THE CountsPair SHALL show "schema diff: 1 of 6 tools changed", "added booking_cancel" and "replay: 3 tools · 5 jars changed".
6. WHEN the Replay_Result is for `v2.1`, THE CountsPair SHALL show "schema diff: 1 of 6 tools changed", "added booking_cancel" and "replay: 2 tools · 2 jars changed".
7. WHEN the Replay_Result is for `v1`, THE CountsPair SHALL show "schema diff: 0 of 6 tools changed" and "replay: 0 tools · 0 jars changed".
8. WHILE the selected Version has not been replayed, THE CountsPair SHALL show no figures.
9. IF the Replay_Module reports a `schemaDiffError`, THEN THE CountsPair SHALL show "schema diff: unavailable — <error>" and SHALL still show the replay figure.
10. WHEN a count equals 1, THE CountsPair SHALL use the singular "tool" or "jar".

### Requirement 7: Shelves

**User Story:** As a judge, I want the jars grouped by the Kiro session that recorded them, so that I can see what the agent was asked to do.

#### Acceptance Criteria

1. THE Cabinet SHALL render one ShelfRow per Rack listed in `jars/racks.json`, in the key order of that file.
2. THE ShelfRow SHALL show the rack code in the display face at a size of 28 px.
3. THE ShelfRow SHALL show the task given to the agent, taken from `prompts/<rack code in lower case, spaces replaced by hyphens>.md` (`prompts/rack-a.md`, `prompts/rack-b.md`) with its first line, the HTML header comment, removed. THE Cabinet SHALL ignore `prompts/rack-a-followup.md`.
4. THE ShelfRow SHALL show the session id shortened to `sess_` plus its first 8 characters, and the number of valid Jar lines of its Jar_File as the call count.
5. THE ShelfRow SHALL list its Jars in `seq` order on an iron shelf and SHALL NOT order them by accession number.
6. THE ShelfRow SHALL stencil position codes on the shelf lip, formed from the last letter of the rack code and the 1-based position in `seq` order (A1 to A5 and B1 to B5 for the committed Racks).
7. THE ShelfRow SHALL lay out its Jars in a grid of Jar_Cells with a minimum cell width of 140 px, so that the toe-tag text of every committed tool name fits without clipping.
8. WHERE a tool name does not fit the toe-tag width, THE toe-tag SHALL wrap the tool name after an underscore and SHALL NOT truncate or clip it.
9. WHILE the JarDrawer is open as a right panel, THE ShelfRow SHALL lay out its Jars in the width left beside the panel.
10. THE Cabinet SHALL produce no horizontal scroll at viewport widths of 375 px and 320 px.

### Requirement 8: Jar

**User Story:** As a judge, I want each jar to show its state in more than colour, so that I can read the cabinet on a projector and with a screen reader.

#### Acceptance Criteria

1. THE Jar SHALL be an SVG with a glass body, an iron lid with two neck bolts, a glowing fluid level, a floating curled "{" specimen, and a manila toe-tag on a string.
2. THE Jar SHALL tilt by an angle between 0.5° and 1.5°, derived deterministically from its accession number so that the angle is the same on every render.
3. THE Jar SHALL support the Jar_States `not replayed`, `preserved`, `rattled`, `cracked`, `unsealed` and `skipped`, each distinct by a printed word or shape in addition to colour.
4. THE toe-tag SHALL show the accession number in the data face at 14 px or larger and the tool name in the data face, bold, at 16 px or larger, written exactly as recorded, and THE toe-tag text SHALL render as HTML text or as SVG text at a scale of 1:1, so that no viewport width shrinks it below those sizes.
5. WHEN a replay has completed and the Jar is rattled, THE toe-tag SHALL carry a strip with the word ABNORMAL in the display face, in `--label-ink` on `--after`.
6. WHEN a replay has completed and the Jar is cracked, THE toe-tag SHALL be torn and SHALL carry a strip with the word CRACKED in the display face, in `--label-ink` on `--after`.
7. THE Jar SHALL be a keyboard-focusable `button` element with an accessible name in the form "<accession> <tool> — <state>[, <details>]", where details are the changed paths and notes for a rattled jar, the failure reason for a cracked, unsealed or skipped jar, and "N fields added" for a preserved jar whose entry has `compatible` changes. For example "SPC-0002 quote — rattled, /total removed, /total_cents added, suspected rename from /total ×100" and "SPC-0001 search_rooms — preserved".
8. WHEN a Jar receives focus or hover, THE Jar SHALL show a tooltip that names the broken field for a Red_Jar and the state word for every other Jar, THE tooltip SHALL stay visible while the pointer is over it, and WHEN the user presses Escape THE tooltip SHALL close before any other Escape action.
9. THE decorative barcode on the toe-tag SHALL carry `aria-hidden="true"`.
10. THE Cabinet SHALL derive each Jar's state, label, changed fields and accessible name from the Replay_Result through a pure view-model function.
11. THE Cabinet SHALL author the jar drawing in `apps/cabinet/src` and SHALL NOT import, link or reference any path outside the repository.
12. WHEN a Jar has keyboard focus, THE Jar SHALL show a focus ring in `--ink` at least 3 px wide that stays visible on every Jar_State.
13. WHILE a Jar's JarDrawer is open, THE Jar SHALL expose `aria-expanded="true"` and `aria-controls` naming the JarDrawer, and every other Jar SHALL expose `aria-expanded="false"`.

### Requirement 9: Design tokens and type

**User Story:** As a judge reading on a projector, I want legible type and a consistent palette, so that nothing important is small or ambiguous.

#### Acceptance Criteria

1. THE Token_File SHALL define exactly the custom properties `--bg #10150F`, `--glass #192219`, `--ink #ECE6D3`, `--tag #D9C49A`, `--label-ink #1E1912`, `--muted #8E978A`, `--before #A8E35F`, `--after #FF4A2E`, `--cracked #7A3B31`, `--rule #333D31` and `--storm #C9D6F2`, plus `--font-display`, `--font-body` and `--font-data`.
2. THE Cabinet SHALL use `--storm` only for the window and lightning, and never to mark a Jar_State.
3. THE Cabinet SHALL set `--font-display` to Grenze Gotisch weight 900 and use it only for the wordmark, the verdict plate, flag words, shelf titles and stamps.
4. THE Cabinet SHALL set `--font-body` to Atkinson Hyperlegible Next at weights 400 and 700 and use it for every sentence.
5. THE Cabinet SHALL set `--font-data` to Azeret Mono at weights 500 and 700 and use it only for tool names, accession numbers, JSON inputs, diff paths and values, timings and CLI commands.
6. THE Cabinet SHALL set the sizes verdict 56 px, shelf titles 28 px, toe-tag tool name 16 px bold, body 18 px and data 15 px, except the verdict reduction of Requirement 4 criterion 1.
7. THE Cabinet SHALL render no text smaller than 14 px, measured in CSS pixels after rem and em conversion.
8. THE Cabinet SHALL use only these text colour pairs: `--ink` on `--bg`, `--muted` on `--bg`, `--label-ink` on `--tag`, `--label-ink` on `--after`, `--after` on `--bg` at 18 px or larger, and `--before` on `--bg` at 18 px or larger, and every pair SHALL reach a contrast ratio of at least 4.5:1.
9. THE Cabinet SHALL NOT place `--after` text on `--tag`.
10. THE Cabinet SHALL encode every Jar_State with a printed word or shape in addition to colour.
11. THE Cabinet SHALL load the three font families from `@fontsource` packages bundled into Dist, and SHALL use only characters that those bundled subsets contain, so that no glyph falls back to a system font.
12. THE Cabinet SHALL contain no pumpkin, bat, ghost, cobweb or purple.

### Requirement 10: JarDrawer

**User Story:** As a judge, I want to open a jar and read exactly what changed, so that I can trust the verdict.

#### Acceptance Criteria

1. WHEN the user activates a Jar, THE Cabinet SHALL open the JarDrawer for that Jar, and WHEN the JarDrawer is already open THE Cabinet SHALL show that Jar in it.
2. WHILE the viewport is 1280 px wide or more, THE JarDrawer SHALL be a right panel 480 px wide.
3. WHILE the viewport is 1024–1279 px wide, THE JarDrawer SHALL be a right panel 420 px wide.
4. WHILE the viewport is 600–1023 px wide, THE JarDrawer SHALL be a bottom sheet 70% of the viewport height high.
5. WHILE the viewport is narrower than 600 px, THE JarDrawer SHALL be a full-screen sheet.
6. THE JarDrawer header SHALL show a mini jar in the Jar's state, the accession number, the tool name, the rack code with shelf position, and the flag word.
7. THE JarDrawer SHALL show the jarred JSON input in the data face.
8. WHEN the user presses Escape or activates the Close control, THE JarDrawer SHALL close and THE Cabinet SHALL return focus to the Jar that opened it, or to the most recently activated Jar WHEN several Jars were activated in turn.
9. WHEN the JarDrawer opens, THE Cabinet SHALL move keyboard focus to the JarDrawer heading.
10. WHILE the JarDrawer is a bottom sheet or a full-screen sheet, THE JarDrawer SHALL be a modal dialog (`role="dialog"`, `aria-modal="true"`), THE Cabinet SHALL keep keyboard focus inside it and SHALL make the page behind it inert.
11. WHILE the JarDrawer is a right panel, THE JarDrawer SHALL be a non-modal region, and THE Cabinet SHALL leave the Jars, the ServerSwitch and the ReplayButton operable beside it.
12. THE JarDrawer SHALL offer tabs "Jarred" and "Replayed" (`role="tablist"`, arrow keys, Home and End) that show the raw jarred `response_text` and the raw `replayed_text` of the entry, and the "Replayed" tab SHALL show the failure reason WHEN `replayed_text` is null.
13. THE JarDrawer SHALL show a Bugfix spec section for the Jar.
14. WHILE the Jar is not replayed, THE JarDrawer SHALL show the jarred input and jarred body, SHALL disable the "Replayed" tab, and SHALL state that no replay has been made for this Version.
15. WHEN the Jar's state changes because a new replay completes while the JarDrawer is open, THE JarDrawer SHALL show the new entry of the same accession number without losing focus.

### Requirement 11: LabReportTable

**User Story:** As a judge, I want a field-by-field diff on lab-notebook paper, so that I can see the broken path and the recorded value.

#### Acceptance Criteria

1. THE LabReportTable SHALL render on ruled paper with a red margin line.
2. THE LabReportTable SHALL have the columns Path, Replayed, Flag and Reference (jarred).
3. THE LabReportTable SHALL show one row per entry of `changes` in the Replay_Result entry for the Jar, with the flag REMOVED, ADDED, TYPE, VALUE or LENGTH as produced by `@specimen/core` diff.
4. WHEN a row comes from `changes`, THE LabReportTable SHALL strike through the path and replayed value and SHALL flag the row in red ink.
5. WHEN a change carries a rename note, THE LabReportTable SHALL show an annotation row with the note text, for example "suspected rename from /total ×100".
6. THE LabReportTable SHALL show the reference value as the raw jarred literal produced by `referenceOf()` of `@specimen/core`, so that `425.00` is shown as `425.00` and not `425`.
7. THE LabReportTable SHALL list the volatile paths that the normaliser ignored for the Jar, taken from `ignored`.
8. WHEN the entry has one or more `compatible` changes, THE LabReportTable SHALL show one row per such change with its flag, without strike-through and in a neutral ink, under the heading "compatible additions".
9. WHEN the entry has no `changes` and no `compatible` changes, THE LabReportTable SHALL state that no field differs after normalisation.
10. WHEN the Jar is cracked, THE LabReportTable SHALL show the failure reason from the Replay_Result (for `SPC-0009`, "tool not in tools/list").
11. THE LabReportTable SHALL set flag words in the display face and paths, values and literals in the data face.
12. THE LabReportTable SHALL be a `table` element with column headers, and the strike-through and red ink SHALL be paired with the printed flag word.

### Requirement 12: SpecViewer

**User Story:** As a judge, I want to read the bugfix spec Kiro filed for a broken jar, so that I can see the failure turned into a spec.

#### Acceptance Criteria

1. WHEN at least one Bugfix_Spec cites the Jar's accession number as a whole token, THE SpecViewer SHALL render the spec that passes `checkSpec()` for the Jar, or the first citing spec in code-unit order of its path WHEN none passes.
2. THE SpecViewer SHALL render headings, lists, inline code and code fences with a local markdown renderer, SHALL use no third-party markdown library, SHALL render raw HTML and HTML comments as text or omit them, and SHALL NOT use `dangerouslySetInnerHTML`.
3. THE SpecViewer SHALL show a provenance line stating that the spec was filed by the specimen-curator agent through `specimen file`, with the date parsed at build time from the heading of `evidence/slice/01-specimen-file.md`. THE SpecViewer SHALL show no Kiro version, because that file states none.
4. WHEN `checkSpec()` from `@specimen/core` returns pass for the Jar against the current Replay_Result in the browser, THE SpecViewer SHALL show a "check-spec PASS" badge.
5. IF `checkSpec()` does not return pass, THEN THE SpecViewer SHALL show no PASS badge.
6. THE SpecViewer SHALL show a link to the file at `https://github.com/edycutjong/specimen/blob/main/<repository path of the spec>`, opened with `rel="noopener noreferrer"`.
7. IF no Bugfix_Spec cites the Jar, THEN THE SpecViewer SHALL show the text "not filed".
8. WHERE the Jar is not a Red_Jar, THE SpecViewer SHALL show "not red in this replay" in place of a filing status, and SHALL show no PASS badge, even WHEN a Bugfix_Spec cites the Jar.

### Requirement 13: GuideStrip

**User Story:** As a judge with 60 seconds, I want a three-step path through the page, so that I see the whole story.

#### Acceptance Criteria

1. THE GuideStrip SHALL show three steps: "1 Open a red jar", "2 Read the bugfix spec filed for it", "3 Switch to v2.1 and replay", with the numerals drawn by CSS or SVG so that no glyph falls back to a system font.
2. WHEN the user opens a Red_Jar in the JarDrawer, THE GuideStrip SHALL tick step 1.
3. WHEN the SpecViewer shows a Bugfix_Spec for a Red_Jar, THE GuideStrip SHALL tick step 2.
4. WHEN a `v2.1` replay completes without error, THE GuideStrip SHALL tick step 3.
5. WHEN the Cold_Open replay and Reveal end, THE GuideStrip SHALL pulse step 1 once.
6. WHILE Reduced_Motion is active, THE GuideStrip SHALL show the pulse as a static highlight.
7. THE GuideStrip SHALL keep its ticks in memory for the page load only and SHALL write no cookie or local storage.
8. THE GuideStrip SHALL expose each tick as text (for example "done") in addition to its mark.

### Requirement 14: CabinetFrame, Legend and footer

**User Story:** As a judge, I want the frame, legend and footer to explain the page and where the jars came from, so that I know what is real.

#### Acceptance Criteria

1. THE CabinetFrame SHALL draw a green-black stone wall, a riveted iron frame and an arched window with three iron bars and a storm behind it.
2. THE CabinetFrame SHALL show the stamp "KIROWEEN 2026 · FRANKENSTEIN".
3. THE CabinetFrame SHALL show the four organs MCP, HOOKS, REPLAY and SPEC joined by surgical cross-stitch sutures and bolts.
4. THE Legend SHALL draw each Jar_State small with its word: PRESERVED, RATTLED, CRACKED, UNSEALED and NOT REPLAYED.
5. WHERE at least one Jar in the Replay_Result is skipped, THE Legend SHALL include SKIPPED.
6. WHERE the Replay_Result has at least one quarantined or spoiled line, THE SpoiledTray SHALL list each line with `file:line` and the reason.
7. WHILE the Replay_Result has no quarantined or spoiled line, THE Cabinet SHALL omit the SpoiledTray.
8. THE HowJarsWereMade section SHALL show the JSON of `.kiro/hooks/specimen-jar-pre.json` and `.kiro/hooks/specimen-jar-post.json`, imported as raw text at build time.
9. THE HowJarsWereMade section SHALL link to `/.kiro` on GitHub at `https://github.com/edycutjong/specimen/tree/main/.kiro`.
10. THE HowJarsWereMade section SHALL show the line "This page is an interactive demo over the hollow-inn server with jars captured by Kiro hooks. On your own server: capture with the hooks → specimen replay --server <your test instance>", with `<your test instance>` rendered as literal text.
11. THE HowJarsWereMade section SHALL state that SHIP means "replay clean on the recorded set" and does not mean the server is safe.

### Requirement 15: Failure states

**User Story:** As a judge, I want an honest error when something fails, so that I never see an invented result.

#### Acceptance Criteria

1. IF the in-browser replay throws, THEN THE VerdictPlate SHALL show the error message in place of a verdict.
2. IF the in-browser replay throws, THEN THE Cabinet SHALL show no jar state, count or filed figure from any earlier or assumed result for that Version, and SHALL set every Jar to `not replayed`.
3. IF the in-browser replay throws, THEN THE Cabinet SHALL show a Retry control that replays the selected Version, and SHALL move keyboard focus to that Retry control.
4. IF a Jar_File line fails zod parsing, THEN THE Cabinet SHALL list the line in the SpoiledTray with `file:line` and the reason and SHALL continue with the remaining lines.
5. IF a Jar_File line fails zod parsing, THEN THE VerdictPlate SHALL include it in the spoiled count and the verdict SHALL be HOLD.
6. IF one tool call of the replay does not answer within 10 seconds, THEN THE Replay_Module SHALL end that call through the `timeoutMs` argument of `replay()` and THE Cabinet SHALL show the resulting jar state of the Replay_Result, without a message of its own.
7. THE Cabinet SHALL show a Retry control only for a thrown replay, and a Replay_Result with HOLD SHALL NOT be presented as an error.

### Requirement 16: Tests

**User Story:** As a maintainer, I want the Cabinet's behaviour checked against committed CLI evidence, so that the page cannot drift from the CLI.

#### Acceptance Criteria

1. THE Cabinet test suite SHALL run the Replay_Module in Node against `v1`, `v2` and `v2.1` and SHALL compare the report text (verdict line, one line per jar, and the "not filed" line) produced by the core report function with `evidence/replay/racks-vs-v1.txt`, `racks-vs-v2-after-filing.txt` and `racks-vs-v2.1.txt`, and SHALL compare `v2` with an empty Bugfix_Spec list against `racks-vs-v2.txt`, which predates filing.
2. THE Cabinet test suite SHALL check the CountsPair figures of Requirement 6 criteria 5 to 7 for `v1`, `v2` and `v2.1`.
3. THE Cabinet test suite SHALL check the view-model mapping from a Replay_Result to Jar props and accessible names, including the SPC-0002 name of Requirement 8, a preserved jar with a compatible addition (SPC-0002 in `v2.1`) and the cracked name of SPC-0009.
4. THE Cabinet test suite SHALL render the JarDrawer LabReportTable for SPC-0002 in jsdom and SHALL assert that the reference column shows the literal `425.00`.
5. THE Cabinet test suite SHALL check that Reduced_Motion switches the Cabinet to its no-motion class, sets the Reveal_Interval to 0 ms and reacts to a change of the media query.
6. THE Cabinet test suite SHALL include a property-based test with `fast-check` that the Jar tilt is within 0.5° to 1.5° and is identical for equal accession numbers.
7. THE Cabinet build test SHALL scan the HTML and CSS of Dist and SHALL fail WHEN any `src`, `href`, `url()` or `@import` holds an absolute URL other than an anchor to `github.com`, AND SHALL scan the JavaScript of Dist for host names and SHALL fail WHEN a host is neither `github.com`, the own site host nor a Namespace_Host.
8. THE Cabinet test suite SHALL run a replay in jsdom with `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` replaced by recorders, and SHALL fail WHEN any of them is called, without replacing any part of the MCP SDK.
9. THE Cabinet test suite SHALL check that no CSS rule or inline style in Dist sets a font size below 14 px after rem and em conversion, and that the toe-tag text of Requirement 8 criterion 4 is not scaled below its size.
10. THE Cabinet test suite SHALL check that every text colour pair of Requirement 9 criterion 8 reaches a contrast ratio of 4.5:1 and that the Token_File defines the custom properties of Requirement 9 criterion 1.
11. THE Cabinet test suite SHALL check keyboard behaviour in jsdom: Escape closes the JarDrawer and returns focus to the opening Jar, a modal JarDrawer keeps Tab inside, and a non-modal JarDrawer leaves the Jars reachable.
12. THE Cabinet test suite SHALL check that the Cabinet performs no write to `jars/` and that the SHA-256 values in `jars/MANIFEST.sha256` still match after a build.
13. WHEN `npm test` runs at the repository root, THE test run SHALL pass.
14. WHEN `npm run typecheck` runs at the repository root, THE typecheck SHALL pass.

### Requirement 17: Static build and deploy

**User Story:** As the maintainer, I want a static build that Vercel serves unchanged, so that the live URL costs nothing and needs no server.

#### Acceptance Criteria

1. WHEN `npm run build -w apps/cabinet` runs, THE Cabinet build SHALL emit a static Dist whose `index.html` serves at the site root `/`.
2. THE Dist SHALL request no third-party host at runtime, including no CDN, Google Fonts or analytics host, and its social and icon metadata SHALL name only files of the Dist.
3. THE Dist SHALL include the three font families as self-hosted files.
4. THE repository root SHALL contain a `vercel.json` that names the build command and the output directory of the Cabinet.
5. THE deploy SHALL need no serverless function and no Vercel Pro-only feature.
6. THE Cabinet build SHALL leave every file under `jars/` unchanged and SHALL read the files outside `apps/cabinet` (`jars/`, `.specimen/`, `.kiro/`, `prompts/`, `evidence/slice/`, `servers/hollow-inn/CHANGES.md`) only for bundling.

## Analysis log

1. **Typed figures versus "every number is measured".** Criteria 1.7 to 1.9 and the introduction held expected counts next to criterion 1.10, which forbade hard-coded values. Resolution: the expected figures are test expectations only (1.10, 16.1, 16.2); the introduction now says so.
2. **Paced reveal versus measured time.** The Reveal costs 250 ms per jar (about 2.25 s for 10 jars) while the replay takes tens of milliseconds, and "N jars replayed in T ms" did not define N or T. Resolution: Replay_Time is defined around the single `replay()` call and excludes the Reveal; N is `coverage.compared`; the line also states "reveal paced at 250 ms per jar" (2.4, 2.5, 3.7). The "target interval" became the fixed Reveal_Interval, and the other animation "targets" became fixed durations.
3. **Reveal interaction gaps.** The plate timing, skip behaviour, screen-reader announcement and reduced motion for the Reveal were missing. Resolution: the VerdictPlate stays hidden until the Reveal completes, any user action completes the Reveal, one polite live region announces the result, and Reduced_Motion sets the interval to 0 (2.13 to 2.17).
4. **CountsPair K and the real v2 result.** `schema_diff` holds names only, so "tools in the v1 tools/list" was not available from the Replay_Result. Also the plate and CountsPair both used T and K with different meanings. Resolution: B is derived as `tools_listed − added + removed`; N, K, T and M were renamed to A, B, C and D in CountsPair, and to N, T, K from `coverage` only in the plate. Against the real v2 result: removed `cancel_booking`, added `booking_cancel`, `input_schema_changed` empty, so A is 1 of B 6; C is 3 (`quote`, `search_rooms`, `cancel_booking`) and D is 5. v1 and v2.1 expectations were added (0 of 6 and 0 · 0; 1 of 6 and 2 tools · 2 jars), plus the "schemaDiffError" case and singular forms (6.1 to 6.10).
5. **Filed-ids rule shared with the CLI.** The shared code needs the `BugfixSpec` type and the CLI path must keep working. Resolution: core exports `BugfixSpec`, `citesId` and `filedJarIds`; the CLI re-exports them. Filed_Ids are computed before `verdict()`, ignore null ids, and the v2.1 result has none, because the quote jars are preserved (1.11, 5.2, 5.8, 5.9). Test 16.1 now uses `racks-vs-v2-after-filing.txt` for the filed v2 case and keeps `racks-vs-v2.txt` for the empty-spec case.
6. **Keyboard and focus.** "Keep focus inside the JarDrawer" contradicted a right panel that sits beside operable Jars and a guide flow that opens several jars. Resolution: modal with an inert background and a focus trap for the bottom and full-screen sheets only; non-modal for the right panel; focus moves to the heading on open; Escape and Close return focus to the last activated Jar; Jar `aria-expanded`, tab semantics, focus ring, tooltip dismissal and ServerSwitch arrow keys were added (8.8, 8.12, 8.13, 3.13, 10.8 to 10.15). The jsdom keyboard test is 16.11.
7. **Reduced motion.** Coverage was partial: reveal pacing, transitions, live changes and the GuideStrip pulse were open. Resolution: 2.13, 2.14, 13.6 and 16.5 now cover all of them; no animation or transition above 0 ms runs.
8. **No third-party host.** The build scan "any host other than github.com" would fail on bundled namespace strings (`www.w3.org` in SVG, `json-schema.org`, `react.dev`), while GitHub links are navigation, not requests. Resolution: HTML and CSS reference rules are strict, JS hosts are checked against github.com, the own host and a Namespace_Host list, and a jsdom run records `fetch`, XHR, WebSocket and EventSource calls without mocking MCP (16.7, 16.8, 17.2). Glyph fallback to system fonts and the ① glyphs were closed in 9.11 and 13.1.
9. **Responsive breakpoints.** Fixed jars-per-row counts (8, 6, 5, 4, 3) were unreachable (each Rack has 5 jars) and the narrow cells (about 100 px at 320 px) could not hold the 16 px bold mono tool names (`cancel_booking` needs about 134 px) at the required 14 px and 16 px minimums. The drawer-open 6-per-row at 1280 px also left about 125 px. Resolution: a grid with a 140 px minimum Jar_Cell, tool-name wrapping after an underscore, toe-tag text kept at 1:1 scale, and the verdict reducible to 36 px below 600 px (4.1, 7.7 to 7.10, 8.4). `Breakpoint` now defines inclusive `min-width` edges.
10. **Preserved jars with added fields versus "no field differs".** The three v2.1 `quote` jars are preserved with `compatible` changes (`+1 field`), contradicting 11.8. Resolution: LabReportTable shows a "compatible additions" section, and the accessible name says "N fields added" (8.7, 11.8, 11.9).
11. **Reference literal.** `Change.was` is parsed JSON and loses `425.00`. Resolution: the literal comes from `referenceOf()` of core (11.6).
12. **Colour pairs.** The allowed pairs omitted `--before` on `--bg` (SHIP verdict word) and `--muted`, and no contrast ratio was set. Resolution: both added, with a 4.5:1 minimum and a test (9.8, 16.10).
13. **Nonexistent asset.** 8.11 told the builder to copy `../assets/_jar.js`, which does not exist in the repository and lies outside it. Resolution: the jar drawing is authored in `apps/cabinet/src` (8.11).
14. **Provenance.** `evidence/slice/01-specimen-file.md` states a date but no Kiro version. Resolution: the date is parsed from the heading, and no version is shown (12.3).
15. **Ambiguities in labels.** "K skipped" reused K, "N preserved" repeated N, "the counts" omitted unsealed, and the plate had no HOLD reason. Resolution: distinct symbols (S, L, P, R, C, U), the unsealed count, and the `reason` from `verdict()` (4.4, 4.8 to 4.10, 4.15). Quarantined lines cannot occur in the browser (there is no pending file), and the criterion stays conditional.
16. **SpecViewer selection.** More than one spec can cite a jar and a cited non-red jar (SPC-0002 in v2.1) is not filed. Resolution: prefer the passing spec; non-red jars never show a PASS badge (12.1, 12.8). Markdown rendering must not inject HTML (12.2).
17. **Error handling.** Retry focus, timeouts and the difference between a HOLD and an error were unspecified. Resolution: 15.2, 15.3, 15.6 and 15.7. A spoiled line forces HOLD (15.5).
18. **Rack prompts and ordering.** The rack-to-prompt filename mapping, the ignored `rack-a-followup.md`, the shortened session id format and the non-monotonic accession order (SPC-0010 at A5) were unspecified. Resolution: 7.1 to 7.6.
19. **Not changed.** `jars/` stays read-only (17.6, 16.12), judging code stays deterministic (1.5), and the page still makes no claim beyond the replay (4.13, 4.14, 14.11).
