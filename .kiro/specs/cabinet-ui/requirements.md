# Requirements Document

## Introduction

The Cabinet is the browser page a judge opens at https://specimen.edycu.dev/. It lives in `apps/cabinet` and runs the real replay engine from `packages/core` in the browser against the real hollow-inn server modules (`createServer("v1" | "v2" | "v2.1")`) over the MCP SDK `InMemoryTransport`. The inputs are the committed jars (`jars/racks.json`, RACK A and RACK B files imported as raw text at build time), `.specimen/replay.json`, `.specimen/volatile.json` and `.specimen/redact.json`. This is the wiring proven by `spikes/s1-browser/src/s1-real.ts`.

Every state, count, path and value on the page comes from that replay or from a committed file. The page mocks nothing and requests no third-party host. The visual direction is "night-lab-specimen": a Frankenstein specimen lab at night, with jars of preserving fluid on iron shelves, a barred storm window whose lightning is the replay firing, and a lab notebook where diffs are written.

Known measured results the Cabinet must reproduce (from `evidence/replay/racks-vs-*.txt`, 10 jars, 4 or 5 of 6 tools):

- v1: SHIP, all 10 jars preserved.
- v2: HOLD, 5 preserved, 4 rattled (SPC-0002, SPC-0006, SPC-0007 on `quote`; SPC-0010 on `search_rooms`), 1 cracked (SPC-0009 `cancel_booking`).
- v2.1: HOLD, 8 preserved, 1 rattled (SPC-0010), 1 cracked (SPC-0009). The three `quote` jars are preserved with one added field (`total_cents`). The Cabinet reports this HOLD as measured and never presents v2.1 as clean.

Three bugfix-filing facts apply to the Cabinet's filed counter. The committed spec `.kiro/specs/quote-total-total-cents/bugfix.md` lists SPC-0002, SPC-0006 and SPC-0007. No committed spec lists SPC-0010 or SPC-0009. For v2 the counter therefore reads 5 red, 3 filed.

## Glossary

- **Cabinet**: The static React page in `apps/cabinet` that this document specifies.
- **Replay_Module**: The Cabinet module that wires the Jar_Files, the three `.specimen` policy files, `createServer(version)` and `InMemoryTransport` into `replay()` and `verdict()` from `packages/core`, and returns one Replay_Result.
- **Replay_Result**: The object built from `replay()`, `verdict()` and `buildReplayResultFields()`, holding the verdict, counts, per-jar entries, coverage, `schema_diff`, quarantined and spoiled lines, and measured elapsed time.
- **Jar_File**: A committed `jars/*.jsonl` file listed in `jars/racks.json`, imported as raw text at build time.
- **Rack**: One recorded Kiro session. RACK A and RACK B are the two Racks.
- **Jar**: One recorded MCP tool call with an accession number (`SPC-NNNN`), drawn as an SVG jar.
- **Jar_State**: One of `not replayed`, `preserved`, `rattled`, `cracked`, `unsealed`, `skipped`.
- **Red_Jar**: A Jar whose state is rattled or cracked.
- **Version**: One of `v1`, `v2`, `v2.1`, the hollow-inn server versions.
- **Cold_Open**: The automatic v2 replay and animated reveal that runs when the page loads.
- **Reveal**: The paced, left-to-right, row-by-row appearance of jars after a replay.
- **ServerSwitch**: The control that selects a Version.
- **ReplayButton**: The control labelled "Replay cabinet".
- **VerdictPlate**: The header plate showing verdict, version, counts, coverage and the filed counter.
- **CountsPair**: The line that sets the schema-diff count beside the replay-impact count.
- **ShelfRow**: One Rack drawn as a titled iron shelf with its Jars.
- **JarDrawer**: The panel opened by activating a Jar.
- **LabReportTable**: The ruled-paper diff table inside the JarDrawer.
- **SpecViewer**: The JarDrawer section that renders the bugfix spec for a Jar.
- **Bugfix_Spec**: A committed `.kiro/specs/<slug>/bugfix.md` file imported as raw text at build time.
- **Filed_Ids**: The set of Red_Jar ids cited by at least one Bugfix_Spec that passes `checkSpec()` for that id, computed by the same rule as `filedJarIds` in `packages/cli/src/replay/spec-files.ts`.
- **GuideStrip**: The three-step "60-second judge path" strip.
- **CabinetFrame**: The wall, iron frame, barred window and organ sutures around the page content.
- **Legend**: The key that draws each Jar_State small with its word.
- **SpoiledTray**: The list of quarantined and spoiled jar lines.
- **HowJarsWereMade**: The footer section explaining how the jars were captured.
- **Reduced_Motion**: The `prefers-reduced-motion: reduce` media condition.
- **Token_File**: The single CSS file of custom properties for colours, faces and sizes.
- **Dist**: The static output directory of `npm run build -w apps/cabinet`.
- **Breakpoint**: A viewport width band: ≥ 1280 px, 1024–1279 px, 600–1023 px, < 600 px.

## Requirements

### Requirement 1: Real in-browser replay

**User Story:** As a judge, I want the page to run the actual replay engine in my browser, so that every number I see is measured and not staged.

#### Acceptance Criteria

1. THE Replay_Module SHALL run `replay()` and `verdict()` from `@specimen/core` against `createServer(version)` from `servers/hollow-inn` over `InMemoryTransport` using the real `@modelcontextprotocol/sdk` `Client` and server.
2. THE Replay_Module SHALL read its inputs only from the Jar_Files listed in `jars/racks.json`, `.specimen/replay.json`, `.specimen/volatile.json`, `.specimen/redact.json` and the committed Bugfix_Specs.
3. THE Replay_Module SHALL parse `replay.json`, `volatile.json`, `redact.json` and each Jar_File line with the zod schemas of `@specimen/core` before use.
4. THE Replay_Module SHALL create the baseline client from `createServer("v1")` and the client under test from `createServer(version)` for the selected Version, with a fresh server per recorded session.
5. THE Replay_Module SHALL measure elapsed time with `performance.now()` and SHALL pass no clock, randomness or network call into diff or verdict logic.
6. THE Replay_Module SHALL avoid `node:` imports in every module that the browser bundle includes.
7. WHEN the Replay_Module replays `v1`, THE Cabinet SHALL produce verdict SHIP with 10 preserved jars.
8. WHEN the Replay_Module replays `v2`, THE Cabinet SHALL produce verdict HOLD with 5 preserved, 4 rattled and 1 cracked jars.
9. WHEN the Replay_Module replays `v2.1`, THE Cabinet SHALL produce verdict HOLD with 8 preserved, 1 rattled and 1 cracked jars.
10. THE Cabinet SHALL contain no placeholder, sample or hard-coded jar state, count, path or value.

### Requirement 2: Cold open

**User Story:** As a judge, I want the cabinet to replay v2 and animate the breakage as soon as I open it, so that I see the product work without a click.

#### Acceptance Criteria

1. WHEN the page loads, THE Cabinet SHALL start a replay of Version `v2` without any user action.
2. WHEN the Cold_Open replay starts, THE CabinetFrame SHALL show one lightning flash across the barred window using `--storm`.
3. WHEN a replay result arrives, THE Cabinet SHALL reveal the jars left to right, row by row, with a target interval of 250 ms between jars.
4. THE Replay_Module SHALL run the replay at full speed, and THE Cabinet SHALL pace only the Reveal.
5. WHEN the Reveal completes, THE VerdictPlate SHALL state the measured elapsed time in the form "N jars replayed in T ms · in this browser · hollow-inn <version> in memory", where N is the jar count and T is the measured elapsed milliseconds of that replay.
6. WHEN a preserved jar is revealed, THE Jar SHALL settle with fluid in `--before`.
7. WHEN a rattled jar is revealed, THE Jar SHALL play a rattle of translateX ±3 px and rotate ±2.5° for 3 cycles over a target of 540 ms with ease-out.
8. WHEN a rattled jar is revealed, THE Jar SHALL twitch its specimen, flood its fluid from `--before` to `--after` bottom-up over a target of 700 ms using a mask, and ink a red ABNORMAL strip across its toe-tag in `steps(4)` over a target of 320 ms.
9. WHEN a cracked jar is revealed, THE Jar SHALL show a crack line, dimmed low fluid in `--cracked`, and a torn label carrying the word CRACKED.
10. WHEN the first rattled jar finishes its animation, THE Cabinet SHALL slam one rubber stamp "IT'S MOVING" in the display face, in `--after`, rotated, beside that jar, once per page load.
11. THE stamp "IT'S MOVING" SHALL carry `aria-hidden="true"`.
12. WHILE a Jar is preserved or not replayed, THE Jar SHALL animate only one slow bubble about every 6 seconds.
13. WHILE Reduced_Motion is active, THE Cabinet SHALL omit shake, bubbles and the lightning flash, SHALL show a static window glow, SHALL switch fluid colour and the ABNORMAL strip instantly, and SHALL show the stamp without motion.

### Requirement 3: ServerSwitch and ReplayButton

**User Story:** As a judge, I want to switch between v1, v2 and v2.1 and replay each, so that I can compare the control, the break and the fix.

#### Acceptance Criteria

1. THE ServerSwitch SHALL offer exactly the Versions `v1`, `v2` and `v2.1`.
2. WHILE the viewport is 600 px wide or more, THE ServerSwitch SHALL render as a segmented control.
3. WHILE the viewport is narrower than 600 px, THE ServerSwitch SHALL render as a select element.
4. WHEN the user selects a different Version, THE Cabinet SHALL set every Jar to `not replayed` and SHALL keep that state until the next replay completes.
5. WHEN the user selects a Version, THE Cabinet SHALL show under the ServerSwitch the matching entry of `servers/hollow-inn/CHANGES.md` for that Version, imported as raw text at build time.
6. WHEN the user activates the ReplayButton, THE Cabinet SHALL replay the selected Version.
7. WHILE a replay is running, THE ReplayButton SHALL be disabled and SHALL show the elapsed milliseconds.
8. WHEN `v1` is selected and replayed, THE Cabinet SHALL label it as the control and SHALL show SHIP v1.
9. WHEN `v2.1` is selected, THE Cabinet SHALL state that v2.1 is the version Kiro fixed from the filed `quote` bugfix spec.
10. WHEN `v2.1` has been replayed, THE VerdictPlate SHALL show the measured verdict and counts, including the remaining rattled and cracked jars.
11. WHEN the Version changes during a running replay, THE Cabinet SHALL discard the unfinished result and SHALL show only the result of the most recent replay request.

### Requirement 4: VerdictPlate

**User Story:** As a judge, I want one plate that states the verdict and how much it covers, so that I can read the outcome and its limits at once.

#### Acceptance Criteria

1. THE VerdictPlate SHALL show the verdict word and the Version in the display face at a target size of 56 px.
2. WHEN the verdict is HOLD, THE VerdictPlate SHALL colour the verdict word `--after`.
3. WHEN the verdict is SHIP, THE VerdictPlate SHALL colour the verdict word `--before`.
4. THE VerdictPlate SHALL show the counts in the form "N preserved · N rattled · N cracked".
5. THE VerdictPlate SHALL show the coverage line in the form "N jars compared · T of K tools · not recorded: <tool names>" using the values returned by `verdict()`.
6. THE VerdictPlate SHALL show the filed counter in the form "R red · F filed as Kiro bugfix specs", where R and F come from `verdict()` and the Filed_Ids.
7. WHEN F equals R and R is greater than zero, THE VerdictPlate SHALL show "all red jars filed".
8. WHEN the skipped count is greater than zero, THE VerdictPlate SHALL show "K skipped".
9. WHEN the quarantined count is greater than zero, THE VerdictPlate SHALL show "Q quarantined".
10. WHEN the spoiled count is greater than zero, THE VerdictPlate SHALL show "S spoiled".
11. THE VerdictPlate SHALL take the verdict, counts, coverage and R from `verdict()` of `@specimen/core`, and the UI SHALL derive none of them.
12. WHILE no replay has completed for the selected Version, THE VerdictPlate SHALL show no verdict word.
13. THE VerdictPlate SHALL NOT state that a SHIP verdict means the server is safe.
14. WHEN the verdict is SHIP, THE VerdictPlate SHALL state "replay clean on the recorded set".

### Requirement 5: Filed ids in the browser

**User Story:** As a maintainer, I want the browser to decide which red jars are filed by the same rule as the CLI, so that the page and the CLI never disagree.

#### Acceptance Criteria

1. THE Cabinet SHALL import every `.kiro/specs/*/bugfix.md` as raw text at build time.
2. THE `packages/core` package SHALL export the pure parts of `citesId` and `filedJarIds` that the browser needs, and THE `packages/cli` package SHALL consume them from `packages/core`.
3. WHEN the pure parts move into `packages/core`, THE existing `packages/cli` behaviour and the existing `packages/cli` tests SHALL stay unchanged and passing.
4. THE moved code SHALL contain no `node:` import.
5. THE Cabinet SHALL compute Filed_Ids by applying `citesId` with whole-token matching and `checkSpec()` to each Red_Jar.
6. WHEN the v2 replay completes with the committed specs, THE Cabinet SHALL report Filed_Ids equal to SPC-0002, SPC-0006 and SPC-0007.
7. IF no Bugfix_Spec exists for a Red_Jar, THEN THE Cabinet SHALL count that Red_Jar as not filed.

### Requirement 6: CountsPair

**User Story:** As a judge, I want the schema diff and the replay result side by side, so that I can see what a schema check misses.

#### Acceptance Criteria

1. THE CountsPair SHALL show "schema diff: N of K tools changed", where K is the number of tools in the v1 `tools/list` and N is the number of distinct v1 tools that are removed or have a changed `inputSchema` in the selected Version's `tools/list`.
2. WHEN tools are added in the selected Version, THE CountsPair SHALL list the added tool names after the schema diff text.
3. THE CountsPair SHALL show "replay: T tools · M jars changed", where T is the number of distinct tools among the Red_Jars and M is the number of Red_Jars.
4. THE CountsPair SHALL compute both figures from `schema_diff` and the jar states of the same Replay_Result.
5. WHEN the Replay_Result is for `v2`, THE CountsPair SHALL show "schema diff: 1 of 6 tools changed" and "replay: 3 tools · 5 jars changed".
6. WHILE the selected Version has not been replayed, THE CountsPair SHALL show no figures.

### Requirement 7: Shelves

**User Story:** As a judge, I want the jars grouped by the Kiro session that recorded them, so that I can see what the agent was asked to do.

#### Acceptance Criteria

1. THE Cabinet SHALL render one ShelfRow per Rack listed in `jars/racks.json`.
2. THE ShelfRow SHALL show the rack code in the display face at a target size of 28 px.
3. THE ShelfRow SHALL show the task given to the agent, taken from `prompts/rack-a.md` or `prompts/rack-b.md` with the header comment removed.
4. THE ShelfRow SHALL show the shortened session id and the call count.
5. THE ShelfRow SHALL list its Jars in `seq` order on an iron shelf.
6. THE ShelfRow SHALL stencil position codes A1 to A5 and B1 to B5 on the shelf lip.
7. WHILE the viewport is 1280 px wide or more and the JarDrawer is closed, THE ShelfRow SHALL show 8 Jars per row.
8. WHILE the viewport is 1280 px wide or more and the JarDrawer is open, THE ShelfRow SHALL show 6 Jars per row.
9. WHILE the viewport is 1024–1279 px wide, THE ShelfRow SHALL show 5 Jars per row.
10. WHILE the viewport is 600–1023 px wide, THE ShelfRow SHALL show 4 Jars per row.
11. WHILE the viewport is narrower than 600 px, THE ShelfRow SHALL show 3 Jars per row and SHALL wrap to further rows.
12. THE Cabinet SHALL produce no horizontal scroll at viewport widths of 375 px and 320 px.

### Requirement 8: Jar

**User Story:** As a judge, I want each jar to show its state in more than colour, so that I can read the cabinet on a projector and with a screen reader.

#### Acceptance Criteria

1. THE Jar SHALL be an SVG with a glass body, an iron lid with two neck bolts, a glowing fluid level, a floating curled "{" specimen, and a manila toe-tag on a string.
2. THE Jar SHALL tilt by an angle between 0.5° and 1.5°, derived deterministically from its accession number so that the angle is the same on every render.
3. THE Jar SHALL support the Jar_States `not replayed`, `preserved`, `rattled`, `cracked`, `unsealed` and `skipped`, each visibly distinct.
4. THE toe-tag SHALL show the accession number in the data face at 14 px or larger and the tool name in the data face, bold, at 16 px or larger, written exactly as recorded.
5. WHEN a replay has completed and the Jar is rattled, THE toe-tag SHALL carry a strip with the word ABNORMAL in the display face, in `--label-ink` on `--after`.
6. WHEN a replay has completed and the Jar is cracked, THE toe-tag SHALL be torn and SHALL carry a strip with the word CRACKED in the display face, in `--label-ink` on `--after`.
7. THE Jar SHALL be a keyboard-focusable `button` element with an accessible name in the form "<accession> <tool> — <state>, <changed paths and notes>", for example "SPC-0002 quote — rattled, /total removed, /total_cents added, suspected rename from /total ×100".
8. WHEN a Jar receives focus or hover, THE Jar SHALL show a tooltip that names the broken field.
9. THE decorative barcode on the toe-tag SHALL carry `aria-hidden="true"`.
10. THE Cabinet SHALL derive each Jar's state, label, changed fields and accessible name from the Replay_Result through a pure view-model function.
11. THE Cabinet SHALL copy the jar drawing it uses from `../assets/_jar.js` into `apps/cabinet/src` and adapt it to React, and SHALL NOT import, link or reference any path outside the repository.

### Requirement 9: Design tokens and type

**User Story:** As a judge reading on a projector, I want legible type and a consistent palette, so that nothing important is small or ambiguous.

#### Acceptance Criteria

1. THE Token_File SHALL define exactly the custom properties `--bg #10150F`, `--glass #192219`, `--ink #ECE6D3`, `--tag #D9C49A`, `--label-ink #1E1912`, `--muted #8E978A`, `--before #A8E35F`, `--after #FF4A2E`, `--cracked #7A3B31`, `--rule #333D31` and `--storm #C9D6F2`, plus `--font-display`, `--font-body` and `--font-data`.
2. THE Cabinet SHALL use `--storm` only for the window and lightning, and never to mark a Jar_State.
3. THE Cabinet SHALL set `--font-display` to Grenze Gotisch weight 900 and use it only for the wordmark, the verdict plate, flag words, shelf titles and stamps.
4. THE Cabinet SHALL set `--font-body` to Atkinson Hyperlegible Next at weights 400 and 700 and use it for every sentence.
5. THE Cabinet SHALL set `--font-data` to Azeret Mono at weights 500 and 700 and use it only for tool names, accession numbers, JSON inputs, diff paths and values, timings and CLI commands.
6. THE Cabinet SHALL set the target sizes verdict 56 px, shelf titles 28 px, toe-tag tool name 16 px bold, body 18 px and data 15 px.
7. THE Cabinet SHALL render no text smaller than 14 px.
8. THE Cabinet SHALL use only these text colour pairs: `--ink` on `--bg`, `--label-ink` on `--tag`, `--label-ink` on `--after`, and `--after` on `--bg` at 18 px or larger.
9. THE Cabinet SHALL NOT place `--after` text on `--tag`.
10. THE Cabinet SHALL encode every Jar_State with a printed word or shape in addition to colour.
11. THE Cabinet SHALL load the three font families from `@fontsource` packages bundled into Dist.
12. THE Cabinet SHALL contain no pumpkin, bat, ghost, cobweb or purple.

### Requirement 10: JarDrawer

**User Story:** As a judge, I want to open a jar and read exactly what changed, so that I can trust the verdict.

#### Acceptance Criteria

1. WHEN the user activates a Jar, THE Cabinet SHALL open the JarDrawer for that Jar.
2. WHILE the viewport is 1280 px wide or more, THE JarDrawer SHALL be a right panel 480 px wide.
3. WHILE the viewport is 1024–1279 px wide, THE JarDrawer SHALL be a right panel 420 px wide.
4. WHILE the viewport is 600–1023 px wide, THE JarDrawer SHALL be a bottom sheet 70 vh high.
5. WHILE the viewport is narrower than 600 px, THE JarDrawer SHALL be a full-screen sheet.
6. THE JarDrawer header SHALL show a mini jar in the Jar's state, the accession number, the tool name, the rack code with shelf position, and the flag word.
7. THE JarDrawer SHALL show the jarred JSON input in the data face.
8. WHEN the user presses Escape, THE JarDrawer SHALL close and THE Cabinet SHALL return focus to the Jar that opened it.
9. WHILE the JarDrawer is open, THE Cabinet SHALL keep keyboard focus inside the JarDrawer.
10. THE JarDrawer SHALL offer tabs "Jarred" and "Replayed" that show the raw jarred and raw replayed response bodies.
11. THE JarDrawer SHALL show a Bugfix spec section for the Jar.
12. WHILE the Jar is not replayed, THE JarDrawer SHALL show the jarred input and jarred body and SHALL state that no replay has been made for this Version.

### Requirement 11: LabReportTable

**User Story:** As a judge, I want a field-by-field diff on lab-notebook paper, so that I can see the broken path and the recorded value.

#### Acceptance Criteria

1. THE LabReportTable SHALL render on ruled paper with a red margin line.
2. THE LabReportTable SHALL have the columns Path, Replayed, Flag and Reference (jarred).
3. THE LabReportTable SHALL show one row per change in the Replay_Result entry for the Jar, with the flag REMOVED, ADDED, TYPE, VALUE or LENGTH as produced by `@specimen/core` diff.
4. WHEN a row is abnormal, THE LabReportTable SHALL strike through the path and replayed value and SHALL flag the row in red ink.
5. WHEN a change carries a rename note, THE LabReportTable SHALL show an annotation row with the note text, for example "suspected rename from /total ×100".
6. THE LabReportTable SHALL show the reference value as the raw jarred literal, so that `425.00` is shown as `425.00` and not `425`.
7. THE LabReportTable SHALL list the volatile paths that the normaliser ignored for the Jar.
8. WHEN the Jar has no changes, THE LabReportTable SHALL state that no field differs after normalisation.
9. WHEN the Jar is cracked, THE LabReportTable SHALL show the failure reason from the Replay_Result (for `SPC-0009`, "tool not in tools/list").
10. THE LabReportTable SHALL set flag words in the display face and paths, values and literals in the data face.

### Requirement 12: SpecViewer

**User Story:** As a judge, I want to read the bugfix spec Kiro filed for a broken jar, so that I can see the failure turned into a spec.

#### Acceptance Criteria

1. WHEN a Bugfix_Spec cites the Jar's accession number as a whole token, THE SpecViewer SHALL render that file's content.
2. THE SpecViewer SHALL render headings, lists, inline code and code fences with a local markdown renderer and SHALL use no third-party markdown library.
3. THE SpecViewer SHALL show a provenance line stating that the spec was filed by the specimen-curator agent through `specimen file`, with the date and the Kiro version taken from `evidence/slice/01-specimen-file.md`.
4. WHEN `checkSpec()` from `@specimen/core` returns pass for the Jar against the current Replay_Result in the browser, THE SpecViewer SHALL show a "check-spec PASS" badge.
5. IF `checkSpec()` does not return pass, THEN THE SpecViewer SHALL show no PASS badge.
6. THE SpecViewer SHALL show a link to the file at `https://github.com/edycutjong/specimen/blob/main/<path>`.
7. IF no Bugfix_Spec cites the Jar, THEN THE SpecViewer SHALL show the text "not filed".
8. WHERE the Jar is not a Red_Jar, THE SpecViewer SHALL show "not red in this replay" in place of a filing status.

### Requirement 13: GuideStrip

**User Story:** As a judge with 60 seconds, I want a three-step path through the page, so that I see the whole story.

#### Acceptance Criteria

1. THE GuideStrip SHALL show three steps: "① Open a red jar", "② Read the bugfix spec filed for it", "③ Switch to v2.1 and replay".
2. WHEN the user opens a Red_Jar in the JarDrawer, THE GuideStrip SHALL tick step ①.
3. WHEN the SpecViewer shows a Bugfix_Spec for a Red_Jar, THE GuideStrip SHALL tick step ②.
4. WHEN a `v2.1` replay completes, THE GuideStrip SHALL tick step ③.
5. WHEN the Cold_Open replay and Reveal end, THE GuideStrip SHALL pulse step ① once.
6. WHILE Reduced_Motion is active, THE GuideStrip SHALL show the pulse as a static highlight.

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
10. THE HowJarsWereMade section SHALL show the line "This page is an interactive demo over the hollow-inn server with jars captured by Kiro hooks. On your own server: capture with the hooks → specimen replay --server <your test instance>".

### Requirement 15: Failure states

**User Story:** As a judge, I want an honest error when something fails, so that I never see an invented result.

#### Acceptance Criteria

1. IF the in-browser replay throws, THEN THE VerdictPlate SHALL show the error message in place of a verdict.
2. IF the in-browser replay throws, THEN THE Cabinet SHALL show no jar state, count or filed figure from any earlier or assumed result for that Version.
3. IF the in-browser replay throws, THEN THE Cabinet SHALL show a Retry control that replays the selected Version.
4. IF a Jar_File line fails zod parsing, THEN THE Cabinet SHALL list the line in the SpoiledTray with `file:line` and the reason and SHALL continue with the remaining lines.
5. IF a Jar_File line fails zod parsing, THEN THE VerdictPlate SHALL include it in the spoiled count.

### Requirement 16: Tests

**User Story:** As a maintainer, I want the Cabinet's behaviour checked against committed CLI evidence, so that the page cannot drift from the CLI.

#### Acceptance Criteria

1. THE Cabinet test suite SHALL run the Replay_Module in Node against `v1`, `v2` and `v2.1` and SHALL compare verdict, per-jar state, counts and Filed_Ids with `evidence/replay/racks-vs-v1.txt`, `racks-vs-v2.txt` and `racks-vs-v2.1.txt`, accepting that `racks-vs-v2.txt` predates filing and lists the filed jars as not filed.
2. THE Cabinet test suite SHALL check the CountsPair figures for `v2` against "1 of 6" and "3 tools · 5 jars".
3. THE Cabinet test suite SHALL check the view-model mapping from a Replay_Result to Jar props and accessible names, including the SPC-0002 name of Requirement 8.
4. THE Cabinet test suite SHALL render the JarDrawer LabReportTable for SPC-0002 in jsdom and SHALL assert that the reference column shows the literal `425.00`.
5. THE Cabinet test suite SHALL check that Reduced_Motion switches the Cabinet to its no-motion class.
6. THE Cabinet test suite SHALL include a property-based test with `fast-check` that the Jar tilt is within 0.5° to 1.5° and is identical for equal accession numbers.
7. THE Cabinet test suite SHALL include a build test that scans Dist for `http://` and `https://` hosts and fails when any host other than `github.com` appears in a link.
8. THE Cabinet test suite SHALL check that no CSS rule or inline style in Dist sets a font size below 14 px.
9. WHEN `npm test` runs at the repository root, THE test run SHALL pass.
10. WHEN `npm run typecheck` runs at the repository root, THE typecheck SHALL pass.

### Requirement 17: Static build and deploy

**User Story:** As the maintainer, I want a static build that Vercel serves unchanged, so that the live URL costs nothing and needs no server.

#### Acceptance Criteria

1. WHEN `npm run build -w apps/cabinet` runs, THE Cabinet build SHALL emit a static Dist whose `index.html` serves at the site root `/`.
2. THE Dist SHALL request no third-party host at runtime, including no CDN, Google Fonts or analytics host.
3. THE Dist SHALL include the three font families as self-hosted files.
4. THE repository root SHALL contain a `vercel.json` that names the build command and the output directory of the Cabinet.
5. THE deploy SHALL need no serverless function and no Vercel Pro-only feature.
6. THE Cabinet build SHALL leave every file under `jars/` unchanged.
