# Implementation Plan: Cabinet UI

## Overview

The plan proves the real data path first (core move, then `browser-replay.ts` against the committed evidence), then builds the pure view model, then the visual layer, then wiring, motion, deploy config and the final production-build checks. The implementation language is TypeScript, as in the design. Each task names its files and the tests that sit next to it.

Constraints for every task:
- Never edit anything under `jars/`. Jar files are imported as raw text only.
- `.design-input/**/jar-drawing.js` is read-only reference. Never import it, link to it or commit it. Retype the geometry in `apps/cabinet/src/jar-art.tsx`.
- No `node:` imports in any module the browser bundle includes.
- No mocks of the MCP SDK on any tested path.
- Tests live in `apps/cabinet/test/*.test.ts(x)` or `packages/<name>/test/*.test.ts`. Files that need a DOM start with `// @vitest-environment jsdom`.

## Tasks

- [x] 1. Move the filed-ids rule into `packages/core`
  - [x] 1.1 Create the shared module and keep the CLI re-exporting it
    - Create `packages/core/src/bugfix-spec.ts` with `BugfixSpec`, `citesId` and `filedJarIds`, moved verbatim from `packages/cli/src/replay/spec-files.ts` (no `node:` import).
    - Export them from `packages/core/src/index.ts`.
    - In `packages/cli/src/replay/spec-files.ts` keep `readBugfixSpecs` and re-export the three names from `@specimen/core`, so no CLI call site changes.
    - _Requirements: 5.2, 5.4_
  - [x] 1.2 Test the moved code and confirm the CLI suite is unchanged
    - Add `packages/core/test/bugfix-spec.test.ts`: whole-token matching of `citesId` (for example `SPC-0002` does not match `SPC-00021`), `filedJarIds` ignores null ids and non-red entries, and a spec that fails `checkSpec()` does not file a jar.
    - Run the existing `packages/cli/test/*.test.ts` unchanged and keep them green.
    - _Requirements: 5.3, 5.5, 5.7, 5.9_

- [x] 2. Prove the real browser data path with `browser-replay.ts`
  - [x] 2.1 Scaffold the `apps/cabinet` workspace (minimum for the data path)
    - Create `apps/cabinet/package.json` (name `@specimen/cabinet`, deps `react`, `react-dom`, `@specimen/core`, `@modelcontextprotocol/sdk`, `zod`; dev deps `vite`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`; scripts `dev`, `build`), `apps/cabinet/tsconfig.json` extending `tsconfig.base.json`, and `apps/cabinet/vite.config.ts` with the React plugin.
    - Create a placeholder `apps/cabinet/index.html` and `apps/cabinet/src/main.tsx` that render an empty root.
    - Run `npm install` at the root so the workspace links.
    - Add the `@fontsource` packages later, in 4.1.
    - _Requirements: 17.1, 1.6_
  - [x] 2.2 Implement `apps/cabinet/src/browser-replay.ts`
    - Port `spikes/s1-browser/src/s1-real.ts`: `?raw` imports of the Jar_Files listed in `jars/racks.json`, JSON imports of `.specimen/replay.json`, `volatile.json` and `redact.json`, and `import.meta.glob` for `.kiro/specs/*/bugfix.md` into `getBugfixSpecs()`.
    - Export `HollowInnVersion`, `runReplay(version, opts)`, `JAR_FILES`, and the policy constants.
    - Parse every input with the `@specimen/core` zod schemas. Baseline factory is always `createServer("v1")`. Pass `performance.now` as `clock`, `timeoutMs` 10000. Measure Replay_Time around the single `replay()` call.
    - Compute `filedIds` with `filedJarIds` before calling `verdict()`, and pass them in. Close all clients and servers in `finally`. Accept an `AbortSignal` so callers can drop stale results.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.11, 5.1, 5.5, 15.6_
  - [x] 2.3 Test `browser-replay.ts` against the committed evidence
    - Add `apps/cabinet/test/browser-replay.test.ts` (Node environment, no jsdom). Run `runReplay` for `v1`, `v2` and `v2.1` with the real hollow-inn modules and the real jars.
    - Compare the core report text with `evidence/replay/racks-vs-v1.txt`, `racks-vs-v2-after-filing.txt` and `racks-vs-v2.1.txt`. Run `v2` with an empty spec list and compare with `racks-vs-v2.txt`.
    - Assert the verdict and counts of 1.7 to 1.9 and the Filed_Ids of 5.6 and 5.8 as literals in the test only.
    - _Requirements: 1.7, 1.8, 1.9, 5.6, 5.8, 16.1_

- [x] 3. Pure view model in `cabinet-model.ts`
  - [x] 3.1 Implement `apps/cabinet/src/cabinet-model.ts` and `apps/cabinet/src/rack-meta.ts`
    - `rack-meta.ts`: read `jars/racks.json` key order, the rack prompts from `prompts/rack-a.md` and `prompts/rack-b.md` (first-line HTML comment removed, `rack-a-followup.md` ignored), the shortened `sess_` plus 8 characters session id, and the call count of valid lines.
    - `cabinet-model.ts`: the types of the design, `buildViewModel`, `jarTiltDeg`, `jarAccessibleName`, `revealOrder`, and a `pluralise(count, singular, plural)` helper. A `null` result gives every jar `not replayed` and an empty plate and counts.
    - Position codes come from the rack code's last letter plus the 1-based `seq` position. CountsPair figures use the formulas of 6.1 and 6.3. The coverage line is `coverageString()` passthrough.
    - No clock, randomness or DOM access in the file.
    - _Requirements: 3.4, 4.1 to 4.15, 6.1 to 6.4, 6.8, 6.9, 6.10, 7.1 to 7.6, 8.2, 8.7, 8.10_
  - [x] 3.2 Unit tests for the view model
    - Add `apps/cabinet/test/cabinet-model.test.ts` (Node environment): the SPC-0002 accessible name in `v2`, SPC-0002 in `v2.1` ("1 field added"), SPC-0009 cracked name, `not replayed` state when `result` is null, CountsPair literals for `v1`, `v2` and `v2.1`, the position codes A1 to B5 with SPC-0010 at A5, and the rack prompt text without its header comment.
    - Feed it real `runReplay` results from 2.2.
    - _Requirements: 6.5, 6.6, 6.7, 7.3, 7.5, 7.6, 16.2, 16.3_
  - [x] 3.3 Property test: plate counts equal the core verdict
    - Add `apps/cabinet/test/properties/p1-plate-counts.test.ts` with `fast-check`, at least 100 runs, generators built from the core zod schemas.
    - **Property 1: View-model counts always equal the core verdict's counts**
    - **Validates: Requirements 1.10, 4.4, 4.5, 4.6, 4.11, 4.15, 6.3**
  - [x] 3.4 Property test: CountsPair arithmetic
    - Add `apps/cabinet/test/properties/p2-counts-pair.test.ts`.
    - **Property 2: CountsPair arithmetic matches its source fields**
    - **Validates: Requirements 6.1, 6.3, 6.4**
  - [x] 3.5 Property test: pluralisation
    - Add `apps/cabinet/test/properties/p3-pluralisation.test.ts`.
    - **Property 3: Count-formatting pluralisation is consistent**
    - **Validates: Requirements 6.10**
  - [x] 3.6 Property test: accessible names
    - Add `apps/cabinet/test/properties/p4-accessible-name.test.ts`.
    - **Property 4: Jar accessible name always names accession, tool and state**
    - **Validates: Requirements 8.7**
  - [x] 3.7 Property test: reveal order
    - Add `apps/cabinet/test/properties/p6-reveal-order.test.ts`.
    - **Property 6: Reveal order is rack order then seq order**
    - **Validates: Requirements 2.3, 7.1, 7.5**
  - [x] 3.8 Property test: filed ids are always red
    - Add `apps/cabinet/test/properties/p7-filed-ids.test.ts`, including specs that cite an id inside a longer token.
    - **Property 7: Filed ids never include a jar that is not red**
    - **Validates: Requirements 5.5, 5.7, 5.9**

- [x] 4. Tokens, fonts and base CSS
  - [x] 4.1 Create the Token_File and font setup
    - Add `@fontsource` dependencies for Grenze Gotisch 900, Atkinson Hyperlegible Next 400 and 700, and Azeret Mono 500 and 700 to `apps/cabinet/package.json`, and import only those weights in `apps/cabinet/src/main.tsx`.
    - Create `apps/cabinet/src/styles/tokens.css` with exactly the custom properties of 9.1, and `apps/cabinet/src/styles/cabinet.css` with base type sizes (verdict 56 px and 36 px below 600 px, shelf title 28, tool name 16 bold, body 18, data 15), `overflow-x` handling and the breakpoints at 600, 1024 and 1280.
    - Use no pumpkin, bat, ghost, cobweb or purple.
    - _Requirements: 9.1 to 9.7, 9.11, 9.12, 4.1_
  - [x] 4.2 Test the Token_File
    - Add `apps/cabinet/test/tokens.test.ts`: the file defines exactly the 14 custom properties of 9.1, every allowed text colour pair of 9.8 reaches 4.5:1, `--storm` appears only in window and lightning rules, no `font-size` below 14 px after rem and em conversion, and no purple hue.
    - _Requirements: 9.1, 9.2, 9.7, 9.8, 9.9, 9.12, 16.9, 16.10_

- [x] 5. Jar SVG components
  - [x] 5.1 Implement `apps/cabinet/src/jar-art.tsx`
    - Retype the geometry, paths, gradients, mote generator, iron lid with rivets and neck bolts, specimen, `CrackLine`, `RattleOverlay`, `StormWindow` and `Suture` from the design-input reference. Do not import or copy the `.design-input` file into the repo.
    - Use `useId()` for gradient and clip ids, `var(--token)` instead of hex values, and a deterministic seed for the motes.
    - Support the states `not replayed`, `preserved`, `rattled`, `cracked`, `unsealed` and `skipped`, each with a printed word or shape.
    - _Requirements: 8.1, 8.3, 8.11, 9.10, 2.6 to 2.9, 2.12_
  - [x] 5.2 Implement `apps/cabinet/src/components/Jar.tsx`
    - A `button` wrapping `<JarArt>`, with the HTML toe-tag overlay at 14 px accession and 16 px bold tool name, wrapping after an underscore, the ABNORMAL and CRACKED strips, the decorative barcode with `aria-hidden`, `aria-expanded`, `aria-controls`, the tooltip with Escape-to-close, the `--ink` focus ring of at least 3 px, and the "not replayed" accessible name while not revealed.
    - Add `apps/cabinet/test/Jar.test.tsx` (jsdom): accessible name per state, `aria-expanded`, tooltip closes on Escape, toe-tag text present as HTML.
    - _Requirements: 2.16, 8.4 to 8.9, 8.12, 8.13, 7.8_
  - [x] 5.3 Property test: jar tilt
    - Add `apps/cabinet/test/properties/p5-jar-tilt.test.ts` (Node environment).
    - **Property 5: Jar tilt is deterministic and bounded**
    - **Validates: Requirements 8.2, 16.6**

- [x] 6. Layout components
  - [x] 6.1 Implement the local markdown renderer
    - Create `apps/cabinet/src/markdown/render-markdown.ts` for headings, lists, inline code and fences. Raw HTML and HTML comments render as text or are omitted. No third-party library and no `dangerouslySetInnerHTML`.
    - Add `apps/cabinet/test/render-markdown.test.ts`, including an input with `<script>` and an HTML comment.
    - _Requirements: 12.2_
  - [x] 6.2 Implement `VerdictPlate.tsx` and `CountsPair.tsx`
    - Create `apps/cabinet/src/components/VerdictPlate.tsx` (verdict word colours, counts, coverage, filed counter, optional S, Q and L lines, HOLD reason, SHIP wording, the paced-reveal timing line, `role="status"` announced once) and `apps/cabinet/src/components/CountsPair.tsx` (schema half in `--muted`, replay half in `--after`, the added names, the `schemaDiffError` text).
    - Add `apps/cabinet/test/VerdictPlate.test.tsx` and `apps/cabinet/test/CountsPair.test.tsx` (jsdom) rendering real view models: no verdict before a replay, no "safe" wording, singular forms.
    - _Requirements: 2.5, 2.17, 4.1 to 4.15, 6.1 to 6.10_
  - [x] 6.3 Implement `ServerSwitch.tsx` and `ReplayButton.tsx`
    - Create `apps/cabinet/src/components/ServerSwitch.tsx` (segmented control at 600 px and above, native `select` below, arrow-key selection, selected version exposed) and `apps/cabinet/src/components/ReplayButton.tsx` (`aria-disabled` while running, live millisecond display).
    - Create `apps/cabinet/src/changes.ts` to split `servers/hollow-inn/CHANGES.md` (`?raw`) at its `## v<version>` headings, and show the entry plus the v2.1 wording of 3.9 and 3.10.
    - Add `apps/cabinet/test/ServerSwitch.test.tsx` (jsdom): exactly three versions, arrow keys, switch stays enabled during a running replay.
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.7, 3.8, 3.9, 3.10, 3.11, 3.13_
  - [x] 6.4 Implement `GuideStrip.tsx`
    - Three steps with CSS or SVG numerals, in-memory ticks with a visible "done" text, one pulse after the cold open, static highlight under Reduced_Motion, no cookie and no storage write.
    - Add `apps/cabinet/test/GuideStrip.test.tsx` (jsdom): each tick transition, and no `localStorage` or `document.cookie` writes.
    - _Requirements: 13.1 to 13.8_
  - [x] 6.5 Implement `CabinetFrame.tsx` and `HowJarsWereMade.tsx`
    - Create `apps/cabinet/src/components/CabinetFrame.tsx` (stone wall in CSS and an inline SVG grain filter, riveted frame, three-bar arched storm window, stamp "KIROWEEN 2026 · FRANKENSTEIN", organs MCP, HOOKS, REPLAY and SPEC with sutures and bolts), and `apps/cabinet/src/components/HowJarsWereMade.tsx` (the two hook JSON files via `?raw`, the `/.kiro` GitHub link, the interactive-demo line with `<your test instance>` as literal text, the SHIP wording).
    - Add `apps/cabinet/test/HowJarsWereMade.test.tsx` (jsdom): both hook files shown, literal placeholder text, link rel attributes.
    - _Requirements: 14.1, 14.2, 14.3, 14.8, 14.9, 14.10, 14.11_
  - [x] 6.6 Implement `ShelfRow.tsx`, `Legend.tsx` and `SpoiledTray.tsx`
    - Create `apps/cabinet/src/components/ShelfRow.tsx` (rack code 28 px, task, session id, call count, iron shelf, stencilled position codes, grid `minmax(140px, 1fr)`), `apps/cabinet/src/components/Legend.tsx` (SKIPPED only when present) and `apps/cabinet/src/components/SpoiledTray.tsx` (omitted when empty).
    - Add `apps/cabinet/test/ShelfRow.test.tsx` (jsdom): jars in `seq` order not accession order, position codes, tray omitted when empty, shown with `file:line` and reason when not.
    - _Requirements: 7.1 to 7.9, 14.4 to 14.7, 15.4_
  - [x] 6.7 Implement `LabReportTable.tsx`
    - Ruled paper with a red margin line, columns Path, Replayed, Flag and Reference (jarred), strike-through plus red ink paired with the printed flag word, rename annotation row, `referenceOf()` literal, ignored volatile paths, "compatible additions" section, the no-diff statement, the cracked reason, `table` with column headers.
    - Add `apps/cabinet/test/LabReportTable.test.tsx` (jsdom): SPC-0002 in `v2` shows the literal `425.00` and the rename note, SPC-0002 in `v2.1` shows the compatible addition without strike-through, SPC-0009 shows "tool not in tools/list".
    - _Requirements: 11.1 to 11.12, 16.4_
  - [x] 6.8 Implement `SpecViewer.tsx`
    - Pick the passing citing spec, otherwise the first citing spec by code-unit path order. Render it with the markdown renderer. Show the provenance line with the date parsed from the `evidence/slice/01-specimen-file.md` heading and no Kiro version. Show the PASS badge only when a live `checkSpec()` against the current browser result passes. Show the GitHub link with `rel="noopener noreferrer"`, "not filed", and "not red in this replay".
    - Add `apps/cabinet/test/SpecViewer.test.tsx` (jsdom): SPC-0002 in `v2` shows a PASS badge, SPC-0002 in `v2.1` shows no badge and "not red in this replay", SPC-0010 shows "not filed".
    - _Requirements: 12.1 to 12.8_
  - [x] 6.9 Implement `JarDrawer.tsx`
    - Right panel at 480 px (1280 and above) and 420 px (1024 to 1279), bottom sheet at 70% height (600 to 1023), full-screen sheet below 600. Modal with focus trap and inert background for the sheet forms, non-modal for the panel. Header with mini jar, accession, tool, rack and position, flag word. Jarred input, "Jarred" and "Replayed" tabs (arrow keys, Home, End), the not-replayed state with the "Replayed" tab disabled, `LabReportTable`, `SpecViewer`. Focus moves to the heading on open, Escape and Close restore focus to the last activated jar, and a new replay result updates the entry without losing focus.
    - Add `apps/cabinet/test/JarDrawer.test.tsx` (jsdom): tab roles and keys, the not-replayed content, focus on the heading, entry refresh keeping focus.
    - _Requirements: 10.1 to 10.15, 3.12_

- [x] 7. App wiring, cold open and motion
  - [x] 7.1 Implement `App.tsx` and `main.tsx`
    - Wire `runReplay`, `getBugfixSpecs`, `buildViewModel`, the request token that discards stale results, the thrown-replay path (message in the plate slot, all jars `not replayed`, Retry control with focus, HOLD is never shown as an error), the guide flags, and every component of group 6 in the layout of the design. Version switch resets jars and hides figures.
    - Add `apps/cabinet/test/App.test.tsx` (jsdom) using the real replay: page load selects `v2`, switching version clears figures, a forced rejection from the Replay_Module shows the message and Retry.
    - _Requirements: 2.1, 3.4, 3.6, 3.11, 15.1, 15.2, 15.3, 15.7_
  - [x] 7.2 Implement the cold-open timeline and motion
    - Create `apps/cabinet/src/reveal.ts` (a `useReveal` hook with the `REVEAL_INTERVAL_MS = 250` constant, reveal in `revealOrder`, instant completion on any user action, VerdictPlate hidden until it completes, one lightning flash at the start, the "IT'S MOVING" stamp once per page load with `aria-hidden` and `pointer-events: none`).
    - Create `apps/cabinet/src/styles/motion.css` (rattle 540 ms, flood 700 ms, ABNORMAL ink in `steps(4)` 320 ms, one 6 s bubble) and a `useReducedMotion` hook that subscribes to `matchMedia` changes. Under Reduced_Motion the interval is 0, no animation or transition above 0 ms runs, and the window glow is static.
    - Connect both hooks in `App.tsx`.
    - _Requirements: 2.2 to 2.17, 13.5, 13.6_
  - [x] 7.3 Test motion and reveal behaviour
    - Add `apps/cabinet/test/motion.test.tsx` (jsdom): a mocked `matchMedia` toggles the no-motion class, the interval becomes 0, a live media change is honoured, the reveal order and 250 ms interval with fake timers, completion on user action, the total cold-open time stays within the design's 4.5 s bound.
    - _Requirements: 2.3, 2.13, 2.14, 2.15, 16.5_
  - [x] 7.4 Test keyboard behaviour
    - Add `apps/cabinet/test/a11y-keyboard.test.ts` (jsdom): Escape closes the drawer and restores focus, a modal drawer keeps Tab inside, a non-modal drawer leaves jars, ServerSwitch and ReplayButton reachable.
    - _Requirements: 10.8, 10.10, 10.11, 16.11_
  - [x] 7.5 Test that the page makes no network calls
    - Add `apps/cabinet/test/network-guard.test.ts` (jsdom): replace `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` with recorders, run a full replay and Reveal, and fail if any recorder is called. Leave the MCP SDK untouched.
    - _Requirements: 16.8, 17.2_

- [x] 8. Deploy configuration
  - [x] 8.1 Create `vercel.json` at the repository root
    - Set `buildCommand` to `npm run build -w apps/cabinet`, `outputDirectory` to `apps/cabinet/dist`, `framework` to `null`. No functions and no Pro-only feature.
    - Add `apps/cabinet/test/vercel-config.test.ts` that parses the file and checks those fields and the absence of a `functions` key.
    - _Requirements: 17.4, 17.5_

- [x] 9. Checkpoint - Root test and typecheck
  - Run `npm test` and `npm run typecheck` at the repository root. Both must include `apps/cabinet` and pass. If the root `vitest.config.ts` glob or `tsconfig.json` include misses the new workspace, adjust them minimally.
  - Confirm `git status` shows no change under `jars/` and that `jars/MANIFEST.sha256` still matches.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 16.12, 16.13, 16.14_

- [x] 10. Production build and final scans
  - [x] 10.1 Add the Dist scan test and run the production build
    - Add `apps/cabinet/test/build-scan.test.ts`. It runs `npm run build -w apps/cabinet`, then scans `dist/`: HTML and CSS have no `src`, `href`, `url()` or `@import` with an absolute URL other than a `github.com` anchor; JavaScript hosts are limited to `github.com`, the own site host and the Namespace_Hosts `www.w3.org`, `json-schema.org`, `react.dev`; no font below 14 px; the three font families are present as local files; social and icon metadata name only Dist files; `jars/` hashes still match `jars/MANIFEST.sha256`.
    - _Requirements: 16.7, 16.9, 16.12, 17.1, 17.2, 17.3, 17.6_
  - [x] 10.2 Add the 375 px and 320 px no-horizontal-scroll check
    - Add `apps/cabinet/test/no-hscroll.test.ts`. jsdom does not compute layout, so this test asserts the built CSS structurally: the jar grid uses `minmax(140px, 1fr)`, no rule sets a fixed width above 320 px outside a `min-width` media query of 600 px or more, the narrow-viewport header stacks, and `html` and `body` have no horizontal overflow rule that hides content. Note the limit in the test's header comment: it does not measure real layout.
    - Run it together with 10.1 against the fresh Dist and confirm `npm test` still passes.
    - _Requirements: 7.7, 7.10, 10.5_

## Notes

- All tests, including property tests, are required sub-tasks because the user asked for tests next to the code. None is marked optional.
- Each property test lives in its own file under `apps/cabinet/test/properties/`, so the property sub-tasks can run in parallel.
- Browser-only measurements such as a real 375 px layout cannot run in jsdom. Task 10.2 checks the CSS rules that cause overflow. A manual check in a real browser at 375 px is still advisable before submission, and is outside this plan.
- Rule files under `.kiro/` and fixtures under `jars/`, `evidence/` and `prompts/` are read-only inputs for this feature.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "4.1"] },
    { "id": 7, "tasks": ["4.2", "5.1", "6.1"] },
    { "id": 8, "tasks": ["5.2", "5.3", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 9, "tasks": ["6.6", "6.7", "6.8"] },
    { "id": 10, "tasks": ["6.9"] },
    { "id": 11, "tasks": ["7.1"] },
    { "id": 12, "tasks": ["7.2"] },
    { "id": 13, "tasks": ["7.3", "7.4", "7.5", "8.1"] },
    { "id": 14, "tasks": ["9"] },
    { "id": 15, "tasks": ["10.1", "10.2"] }
  ]
}
```
