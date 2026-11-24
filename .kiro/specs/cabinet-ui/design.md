# Design Document

## Overview

The Cabinet is a new npm workspace, `apps/cabinet`, built with Vite + React 19 + TypeScript. It
runs the real `@specimen/core` replay engine in the browser against the real `hollow-inn` server
modules over the MCP SDK's `InMemoryTransport` — the exact wiring already proven by
`spikes/s1-browser/src/s1-real.ts` — and renders the result as a Frankenstein specimen-jar lab.

Two pure TypeScript modules carry all the logic; React only renders their output:

- **`browser-replay.ts`** — owns the `InMemoryTransport` / `ClientFactory` wiring, the raw-text
  imports of the jar files and the three `.specimen` policy files, and the single call into
  `replay()` / `verdict()` from `@specimen/core`. This is the module ported from
  `spikes/s1-browser/src/s1-real.ts`.
- **`cabinet-model.ts`** — a pure function `buildViewModel(replayResult, bugfixSpecs, rackMeta) =>
  CabinetViewModel` that derives every jar's state, accessible name, tooltip and flag, the
  VerdictPlate fields, the CountsPair fields and the GuideStrip fields from the `ReplayResult` and
  the committed `.kiro/specs/*/bugfix.md` texts. It has no DOM dependency and is unit- and
  property-tested without jsdom.

React components (`Jar`, `ShelfRow`, `VerdictPlate`, `CountsPair`, `JarDrawer`, `GuideStrip`,
`CabinetFrame`, …) take `CabinetViewModel` slices as props and render them; they perform no
derivation of their own. This split is what lets Requirement 1 criterion 10 ("no figure that is
not computed from a Replay_Result or a committed file") be enforced by code shape rather than by
convention: every number a component shows is a prop that traces back to `cabinet-model.ts`.

The jar artwork is ported from the design input `jar-drawing.js` — a hand-built SVG string
generator for the "night-lab-specimen" direction — into typed React SVG components that take the
same geometry and colour constants but are state-driven and use React's `useId()` for gradient and
clip-path ids instead of a module-level counter, so server-rendered or re-rendered jars never
collide.

## Architecture

```mermaid
graph TD
  subgraph Build time
    JF["jars/*.jsonl (?raw)"]
    POL[".specimen/*.json"]
    BF[".kiro/specs/*/bugfix.md (?raw)"]
    CH["servers/hollow-inn/CHANGES.md (?raw)"]
    PR["prompts/rack-a.md, rack-b.md (?raw)"]
    HK[".kiro/hooks/specimen-jar-*.json (?raw)"]
    PROV["evidence/slice/01-specimen-file.md (?raw)"]
  end

  subgraph "apps/cabinet/src"
    BR[browser-replay.ts]
    CM[cabinet-model.ts]
    APP[App.tsx]
    JAR[Jar.tsx + jar-art.tsx]
    SHELF[ShelfRow.tsx]
    PLATE[VerdictPlate.tsx]
    COUNTS[CountsPair.tsx]
    DRAWER[JarDrawer.tsx]
    GUIDE[GuideStrip.tsx]
    FRAME[CabinetFrame.tsx]
  end

  subgraph "@specimen/core (no node: imports)"
    REPLAY[replay / verdict / buildReplayResultFields]
    FILED[citesId / filedJarIds / BugfixSpec]
    CHECK[checkSpec / referenceOf]
  end

  subgraph "servers/hollow-inn/src (no node: imports)"
    CREATE[createServer(version)]
  end

  SDK["@modelcontextprotocol/sdk Client + InMemoryTransport"]

  JF --> BR
  POL --> BR
  BR --> REPLAY
  BR --> SDK
  SDK --> CREATE
  BF --> CM
  BR -->|ReplayResult| CM
  CM --> FILED
  CM --> CHECK
  PR --> SHELF
  CH --> SHELF
  HK --> FRAME
  PROV --> DRAWER
  CM --> APP
  APP --> JAR
  APP --> SHELF
  APP --> PLATE
  APP --> COUNTS
  APP --> DRAWER
  APP --> GUIDE
  APP --> FRAME
```

### Why this split

- **Replay isolation.** `browser-replay.ts` is the only module that touches the SDK, the clock
  (`performance.now()`) and the raw-text build imports. Everything downstream takes plain data.
  This mirrors Requirement 1 criterion 5: no clock, randomness or network reaches diff,
  normalise, verdict or `checkSpec()` — those all live inside `@specimen/core` already; the
  Cabinet adds nothing that could violate it.
- **Pure view model.** `cabinet-model.ts` is unit- and property-tested in plain Node/Vitest with
  no jsdom, the same way `packages/core` is tested. It is also the single place `filedIds` are
  computed, so the "page and CLI never disagree" requirement (Requirement 5) is enforced by
  calling the same `filedJarIds`/`citesId` functions `packages/cli` calls, now hosted in
  `packages/core`.
- **Dumb components.** Every visual element (jar, shelf, plate, counts, drawer, guide strip,
  frame) is a function of props drawn from `CabinetViewModel`. No component reads a replay
  result, a bugfix spec or a policy file directly.

### Package layout

```
apps/cabinet/
  package.json            # vite, react, react-dom, @specimen/core, @fontsource/*
  vite.config.ts          # @vitejs/plugin-react, ?raw imports, no server externals needed
  index.html
  src/
    main.tsx
    App.tsx
    browser-replay.ts
    cabinet-model.ts
    cabinet-model.test-helpers.ts     # (test only, see below)
    jar-art.tsx            # ported geometry/paths/gradients as typed constants + <JarArt>
    components/
      Jar.tsx
      ShelfRow.tsx
      VerdictPlate.tsx
      CountsPair.tsx
      GuideStrip.tsx
      JarDrawer.tsx
      LabReportTable.tsx
      SpecViewer.tsx
      SpoiledTray.tsx
      Legend.tsx
      HowJarsWereMade.tsx
      CabinetFrame.tsx       # wall, iron frame, barred storm window, suture, crack
      ServerSwitch.tsx
      ReplayButton.tsx
    markdown/
      render-markdown.ts     # local, no-HTML markdown renderer (Requirement 12.2)
    styles/
      tokens.css              # the Token_File
      cabinet.css             # layout, wall/frame, breakpoints
      motion.css               # keyframes, state classes, prefers-reduced-motion
  test/
    cabinet-model.test.ts
    cabinet-model.property.test.ts
    browser-replay.test.ts          # Node, no jsdom, against evidence/replay/*.txt
    jar-art.property.test.ts        # fast-check tilt property
    a11y-keyboard.test.ts           # jsdom
    build-scan.test.ts              # Dist scan, Requirement 16.7/16.9/16.10/17.2
    network-guard.test.ts           # jsdom fetch/XHR/WS/EventSource recorders, Requirement 16.8
```

`apps/cabinet` is added to the root `workspaces` array (already `"apps/*"`), so `npm test` and
`npm run typecheck` at the repo root pick it up through the existing `vitest.config.ts` glob
(`{packages,servers,apps,spikes}/**/test/**/*.test.ts`) and `tsconfig.json`'s `apps/**/*.ts(x)`
include — no change to either file is needed beyond the new directory existing. `vitest.config.ts`
runs jsdom-dependent suites by setting `// @vitest-environment jsdom` at the top of those specific
test files, keeping the root config's default Node environment for every other suite (including
`cabinet-model.test.ts` and `browser-replay.test.ts`, which must run without a DOM).

### Moving the filed-ids rule into `packages/core`

`packages/cli/src/replay/spec-files.ts` currently owns `BugfixSpec`, `citesId` and `filedJarIds`
together with `readBugfixSpecs` (a `node:fs` reader). The design splits this file along its
existing internal seam:

- `packages/core/src/bugfix-spec.ts` (new): the `BugfixSpec` type, `citesId`, and `filedJarIds`,
  moved verbatim — none of the three touches `node:fs` or `node:path` today, so the move is
  mechanical. Re-exported from `packages/core/src/index.ts`.
  `packages/cli/src/replay/spec-files.ts` keeps `readBugfixSpecs` (the only part that needs
  `node:fs`) and re-exports `BugfixSpec`, `citesId`, `filedJarIds` from `@specimen/core` so every
  existing `packages/cli` import path (`from "./spec-files.js"` or equivalent) keeps resolving
  without a call-site change anywhere in `packages/cli`.
- Existing `packages/cli` tests that exercise `citesId`/`filedJarIds` continue to pass unchanged,
  because the re-export preserves identity and behaviour; this is verified directly by running the
  existing CLI test suite as part of this feature's acceptance (Requirement 5 criterion 3).

`cabinet-model.ts` imports `citesId`, `filedJarIds` and the `BugfixSpec` type from
`@specimen/core`, builds `BugfixSpec[]` from the Vite `?raw` imports (file path + text, no
`readdirSync`), and calls `filedJarIds` with the same semantics the CLI uses — so the two can never
diverge on logic, only on which specs are compiled in at build time.

## Components and Interfaces

### `browser-replay.ts`

```ts
export type HollowInnVersion = "v1" | "v2" | "v2.1";

export type CabinetReplayResult = ReplayResult; // from @specimen/core, re-exported for clarity

export type RunReplay = (
  version: HollowInnVersion,
  opts?: { signal?: AbortSignal },
) => Promise<CabinetReplayResult>;

/** Built once at module load from the `?raw` jar/policy imports; exported for browser-replay.test.ts. */
export const JAR_FILES: { file: string; text: string }[];
export const REPLAY_POLICY: unknown; // raw parsed JSON, validated inside runReplay
export const VOLATILE_POLICY: unknown;
export const REDACT_CONFIG: unknown;

export const runReplay: RunReplay;
```

`runReplay` is the direct port of `replayIn()` in `s1-real.ts`:

- Builds a `ClientFactory` per version with `InMemoryTransport.createLinkedPair()`,
  `createServer(version)` from `servers/hollow-inn/src/index.ts`, and the real SDK `Client`.
- Always uses `createServer("v1")` as the `baselineFactory`, regardless of the selected version
  (schema diff is always against the recorded baseline, matching Requirement 1 criterion 4 and the
  CLI's behaviour).
- Parses `replay.json`, `volatile.json`, `redact.json` with the zod schemas from `@specimen/core`
  (`replayPolicySchema`, `volatilePolicySchema`, `redactConfigSchema`) before use (Requirement 1.3).
- Passes `performance.now` as `clock`, and `10000` as `timeoutMs` (Requirement 1.1, 15.6).
- Computes `filedIds` by calling `filedJarIds(bugfixSpecs, outcome.resultEntries)` **before**
  calling `verdict()`, then calls `verdict({ entries, spoiledCount, toolsListed, filedIds })`
  (Requirement 1.11) — mirroring the only change from `s1-real.ts`, which passed an empty set.
- Closes every client/server it created in a `finally`, even when `replay()` throws (Requirement
  1.4); accepts an `AbortSignal` so `App.tsx` can mark a result stale when the user switches
  Version mid-flight (Requirement 3.11) — the signal only affects which `Promise` resolution the
  caller trusts, not the already-running replay, since `replay()` itself is not cancellable.
- `runReplay` measures `Replay_Time` as `performance.now()` immediately before and after the
  single call into `replay()` and returns it as a field alongside the parsed result, so `App.tsx`
  never computes a time of its own (Requirement 1.1's "Replay_Time" definition in the glossary is
  implemented exactly here, not reconstructed at the call site).

`getBugfixSpecs(): BugfixSpec[]` lives in the same module, built from
`import.meta.glob("../../../.kiro/specs/*/bugfix.md", { query: "?raw", import: "default" })`
(Vite's eager glob import), keeping each file's repository-relative path as `BugfixSpec.name`.

### `cabinet-model.ts`

```ts
export type JarState = "not replayed" | "preserved" | "rattled" | "cracked" | "unsealed" | "skipped";

export type JarViewModel = {
  id: string | null;            // accession, or `${session_id}#${seq}` for an orphan
  tool: string;
  rackCode: string;             // "RACK A" | "RACK B" from racks.json
  positionCode: string;         // e.g. "A5"
  seq: number;
  state: JarState;
  isRed: boolean;
  flagWord: "ABNORMAL" | "CRACKED" | null;
  tilt: number;                 // degrees, 0.5–1.5, deterministic from id
  accessibleName: string;       // Requirement 8.7 format
  tooltip: string;
  filed: boolean;                // only meaningful when isRed
  changes: Change[];
  compatible: Change[];
  ignored: string[];
  reason?: string;
  input: Json | null;
  responseText: string | null;
  replayedText: string | null;
};

export type VerdictPlateViewModel = {
  verdict: "SHIP" | "HOLD" | null;  // null while not replayed
  version: HollowInnVersion;
  countsLine: string;                 // "P preserved · R rattled · C cracked[, U unsealed]"
  coverageLine: string;               // coverageString() passthrough, Requirement 4.5
  filedLine: string;                  // "R red · F filed as Kiro bugfix specs[, all red jars filed]"
  skippedLine?: string;
  quarantinedLine?: string;
  spoiledLine?: string;
  reason: string;
  replayTimeMs: number | null;
  compared: number;
};

export type CountsPairViewModel = {
  schemaChanged: number;        // A
  schemaTotal: number;          // B
  addedToolNames: string[];
  schemaDiffError?: string;
  replayToolCount: number;      // C
  redJarCount: number;          // D
};

export type GuideStepState = { label: string; done: boolean };

export type CabinetViewModel = {
  version: HollowInnVersion;
  replayed: boolean;
  racks: { code: string; task: string; sessionId: string; shortSessionId: string; callCount: number; jars: JarViewModel[] }[];
  plate: VerdictPlateViewModel;
  counts: CountsPairViewModel;
  guide: GuideStepState[];
  spoiled: { file: string; line: number; reason: string }[];
  skippedToolsPresent: boolean;
};

export function buildViewModel(input: {
  result: CabinetReplayResult | null;   // null before the first replay of the selected Version
  version: HollowInnVersion;
  bugfixSpecs: BugfixSpec[];
  racks: { code: string; sessionId: string; task: string }[];   // from racks.json + prompts
  guideFlags: { openedRedJar: boolean; viewedSpec: boolean; replayedFixedVersion: boolean };
}): CabinetViewModel;

export function jarTiltDeg(id: string): number;             // Requirement 8.2 / 16.6
export function jarAccessibleName(jar: JarViewModel): string; // Requirement 8.7
export function revealOrder(viewModel: CabinetViewModel): JarViewModel[]; // Requirement "Reveal"
```

`buildViewModel` is the single derivation point:

- When `result` is `null` (Version just changed, no replay yet), every jar gets state
  `"not replayed"`, `plate.verdict` is `null`, and `counts`/`plate` figures are all empty strings
  — satisfying Requirement 3.4, 4.12 and 6.8 from one code path instead of three ad hoc checks.
- Position codes (`positionCode`) come from the last letter of the rack code plus the 1-based
  index in `seq` order (Requirement 7.6); `revealOrder` sorts by rack order (the key order of
  `racks.json`, preserved by reading it with `Object.entries`) then by `seq` (the "Reveal" and
  "ShelfRow" glossary entries, and Requirement 2.3/7.5).
- `CountsPair` figures: `schemaChanged = schema_diff.tools_removed.length +
  schema_diff.input_schema_changed.length`; `schemaTotal = coverage.tools_listed.length -
  schema_diff.tools_added.length + schema_diff.tools_removed.length`; `replayToolCount` is the
  size of the distinct-`tool` set over Red_Jars; `redJarCount` is `verdict().red` directly, so
  criterion 6.3's "D equals red of verdict()" holds by construction, not by coincidence.
- `jarAccessibleName` builds the exact string form of Requirement 8.7, including the "N fields
  added" suffix for a preserved jar with `compatible.length > 0`, and the changed-paths/notes
  suffix for a rattled jar and the failure reason for cracked/unsealed/skipped.
- `filed` per red jar comes from `filedJarIds(bugfixSpecs, result.jars).has(jar.id)` computed once
  per `buildViewModel` call, not once per jar.

### Jar artwork (`jar-art.tsx`)

The design input's geometry, palette and path data are the literal source of truth. They are
ported, not redrawn:

| `jar-drawing.js` constant / fragment | Ported as |
|---|---|
| `C` (colour map) | `tokens.css` custom properties (`--bg`, `--glass`, … `--storm`), consumed via `var(--x)` in the SVG rather than inline hex, so the Token_File (Requirement 9.1) is the single source |
| `BRACE`, `BODY`, `INNER` path strings | exported `const` strings in `jar-art.tsx`, used verbatim in `<path d={BODY}>` etc. |
| `viewBox="-26 -16 172 222"` | `<JarArt>`'s `<svg viewBox="-26 -16 172 222">` |
| gradients (`id+'g'`, `'f'`, `'r'`, `'d'`, `'l'`, `'b'`) and the clip path (`id+'c'`) | `<radialGradient id={gradId}>` etc., where `gradId = `${useId()}-fluid`` and similar — stable per `<JarArt>` instance across re-renders, never colliding between sibling jars |
| `motes(seed, …)` deterministic particulate | ported as a pure function of the same linear-congruential generator, called with `seed = accession.length*97 + tool.length*13 + 7` exactly as today, so mote layout is still a pure function of the jar's own data and therefore identical on every render (needed for the tilt/determinism property and for stable snapshots) |
| iron lid, 4 rivets, 2 neck bolts (shaft + hex nut each side) | `<IronLid>` subcomponent: `<rect>` lid, `<circle>`×4 rivets, `<g>`×2 bolts (shaft `<rect>` + nut `<rect>`), geometry copied 1:1 |
| toe-tag path + eyelet circle + string `<path>` + flag `<rect>`/`<text>` | `<ToeTag tool accession pos flagWord state>`; font-size selection (`tool.length > 12 ? 6.4 : …`) is kept as the base SVG-space sizing, but see the toe-tag scaling rule below |
| shake doubles (`translate(±7 0) rotate(∓3 60 190)`) + rattle arcs | `<RattleOverlay>`, rendered only `when state === "rattled"`, driven by a CSS class rather than always-on opacity, so Reduced_Motion can disable the shake independently of the red flood (Requirement 2.13) |
| crack path (`crack()`) | `<CrackLine>`, rendered for `cracked` |
| `labWindow()` | ported as `<StormWindow flash>` inside `CabinetFrame.tsx` |
| `suture()` | ported as `<Suture w>` used by `GuideStrip` and `CabinetFrame`'s organ sutures |

**Toe-tag legibility (Requirement 8.4).** The design-input SVG draws tag text in SVG user-space
units (`font-size="9.6"` etc.) inside a `viewBox` that is then scaled to whatever CSS box the
`<svg>` element occupies — at a 140 px `Jar_Cell` the whole jar (172 user units wide) renders at
roughly 0.8–1× scale, which can put a `font-size="9.6"` tool name below 16 px CSS pixels. The port
fixes this by **not** scaling the toe-tag text with the jar body: the toe-tag's `<text>` elements
are rendered as ordinary HTML (`<figcaption>`/`<span>` positioned absolutely over the SVG tag
shape, in `--font-data` at the required 16 px / 14 px) rather than as SVG `<text>` inside the
scaled viewBox — matching Requirement 8.4's "render as HTML text or as SVG text at a scale of 1:1".
The tag's background shape (manila rect, eyelet, barcode, flag strip) stays SVG and scales with the
jar; only the two text runs are HTML, absolutely positioned at the tag's fixed fraction of the
jar's rendered box, recomputed from the jar's CSS size via a `ResizeObserver`-free approach: the
`Jar_Cell` has a fixed minimum width (140 px) and the jar's SVG is never scaled below 1:1 for its
own 172×222 viewBox (`min-width` on the `<svg>` wrapper equal to 172px × the chosen base scale),
so the HTML overlay's position is a constant percentage offset, not a runtime measurement.

### React components

- **`Jar.tsx`** — `<button>` wrapping `<JarArt>` plus the HTML toe-tag overlay. Owns no state;
  takes a `JarViewModel`, `revealed: boolean`, `onActivate`, `drawerOpenFor: string | null`. Sets
  `aria-expanded`, `aria-controls`, the accessible name (`aria-label`) directly from
  `jar.accessibleName`, and the tooltip (native `title`-free custom tooltip, so Escape-to-close and
  hover-persistence from Requirement 8.8 are implementable). While `!revealed` the accessible name
  is forced to `"<accession> <tool> — not replayed"` regardless of the jar's real state
  (Requirement 2.16), by passing `revealed` through to a thin wrapper around
  `jarAccessibleName` rather than by mutating the view model.
- **`ShelfRow.tsx`** — one rack: rack plate (`RACK A`, task quote, session id, call count) plus a
  CSS grid of `Jar_Cell`s (`grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`), laid
  on an SVG/CSS "iron shelf lip" with stencilled position codes along the bottom edge.
- **`VerdictPlate.tsx`** — cast-iron plaque: verdict word (56 px / 36 px below 600 px), version,
  counts line, coverage line, filed line, HOLD `reason`, all taken verbatim from
  `VerdictPlateViewModel`. Wrapped in a `role="status"` region that is only populated — and thus
  only announced — once per completed Reveal (Requirement 2.17).
- **`CountsPair.tsx`** — one line, two visual weights: the schema half in `--muted` at the body
  size, the replay half in `--after` at a larger size, so the size/colour gap itself is the
  argument the requirements describe ("the visual gap is the argument").
- **`ServerSwitch.tsx`** — segmented control ≥600 px, native `<select>` below 600 px; arrow-key
  roving tabindex for the segmented form (Requirement 3.13).
- **`ReplayButton.tsx`** — `aria-disabled` + live millisecond counter while running (Requirement
  3.7); the counter is purely a `setInterval`-driven display value in the component, not a replay
  input — it never feeds back into `Replay_Time`.
- **`JarDrawer.tsx`** — torn-notebook-page panel/sheet (breakpoint-dependent per Requirement 10.2–
  10.5); houses `LabReportTable`, the "Jarred"/"Replayed" tabs, and `SpecViewer`. Modal
  (`role="dialog" aria-modal="true"`, focus trap, `inert` background) for the bottom/full-screen
  sheet forms; non-modal region for the right-panel form (Requirement 10.10/10.11).
- **`LabReportTable.tsx`** — a `<table>` on ruled paper (CSS repeating-linear-gradient for the
  rules, a `--after`-coloured left margin rule, a `<CrackLine>` at one corner for red jars) with
  columns Path / Replayed / Flag / Reference; struck-through + red-ink rows for `changes`, neutral
  rows under a "compatible additions" subheading for `compatible`, and the no-diff / cracked-reason
  states of Requirement 11.9/11.10.
- **`SpecViewer.tsx`** — uses `render-markdown.ts` (headings, lists, inline code, fences; raw HTML
  and comments stripped to text, never `dangerouslySetInnerHTML`), the provenance line (date parsed
  at build time from the `evidence/slice/01-specimen-file.md` heading via a small regex over the
  `?raw` import), the PASS badge gated on a live `checkSpec()` call against the *current* browser
  `ReplayResult` (not a cached CLI result), and the GitHub link with
  `rel="noopener noreferrer"`.
- **`GuideStrip.tsx`** — three `<Suture>`-joined steps, in-memory-only tick state passed down from
  `App.tsx` (no storage write, Requirement 13.7); exposes each tick as visible text ("done") plus a
  mark.
- **`CabinetFrame.tsx`** — stone wall (CSS `conic-gradient`/`linear-gradient` layers plus one
  inline `<svg><filter><feTurbulence>` grain overlay — no network request, satisfying "no image
  request" while still giving organic noise), riveted iron frame border, `<StormWindow>` high on
  the wall, the four organs (MCP/HOOKS/REPLAY/SPEC) joined by `<Suture>`s and bolts, the
  "KIROWEEN 2026 · FRANKENSTEIN" stamp.
- **`Legend.tsx`**, **`SpoiledTray.tsx`**, **`HowJarsWereMade.tsx`** — straightforward renderers of
  `CabinetViewModel` fields and the remaining `?raw` imports (`.kiro/hooks/specimen-jar-{pre,post}.json`).

### Layout and composition

**Desktop baseline, 1440×900 (Requirement 14, "a wall, not a dashboard"):**

```
┌───────────────────────────── sticky header (iron crossbar) ─────────────────────────────┐
│ SPECIMEN JAR   [ v1 | v2 | v2.1 ]   [ Replay cabinet ]        ┌ VerdictPlate (cast-iron) ┐│
│ (wordmark)      ServerSwitch         ReplayButton             │ HOLD   v2                ││
│                                                                │ 5 preserved·4 rattled·1… ││
└────────────────────────────────────────────────────────────────└──────────────────────────┘
  CountsPair: schema diff: 1 of 6 tools changed, added booking_cancel      replay: 3 tools · 5 jars changed
  GuideStrip: ⓪──suture──① Open a red jar ──suture── ② Read the filed spec ──suture── ③ Switch to v2.1 and replay

┌───────────────────────── barred arched storm window (behind/above top shelf) ─────────────┐
│                               (lightning fires here on Cold_Open)                          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
  RACK A  "book two nights at Hollow Inn for a weekend getaway…"      sess_2e9b7313 · 5 calls
  ┌ shelf lip ───────────────────────────────────────────────────────────────────────────────┐
  │ [Jar A1][Jar A2][Jar A3][Jar A4][Jar A5]                                                  │
  └ A1   A2   A3   A4   A5 ───────────────────────────────────────────────────────────────────┘
  RACK B  "…follow-up to cancel one of the bookings"                   sess_854a0f71 · 5 calls
  ┌ shelf lip ───────────────────────────────────────────────────────────────────────────────┐
  │ [Jar B1][Jar B2][Jar B3][Jar B4][Jar B5]                                                  │
  └ B1   B2   B3   B4   B5 ───────────────────────────────────────────────────────────────────┘

  Legend: ● PRESERVED  ▲ RATTLED  ✕ CRACKED  ░ UNSEALED  ○ NOT REPLAYED
  How the jars were made … / jars/ hook JSON / GitHub link
```

No rounded floating cards: the shelf, header crossbar and drawer are all drawn with square or
chamfered-rivet corners, flat iron colours and the ruled/torn-paper motifs instead of shadowed
rounded rectangles.

**Breakpoints** (CSS `min-width`, inclusive edges per the glossary):

| Band | ServerSwitch | JarDrawer | Jar_Cell grid | Verdict size |
|---|---|---|---|---|
| ≥ 1280 px | segmented | right panel, 480 px | `minmax(140px, 1fr)`, non-modal, shrinks beside drawer | 56 px |
| 1024–1279 px | segmented | right panel, 420 px | same, narrower available width | 56 px |
| 600–1023 px | segmented | bottom sheet, 70vh, modal | same grid, full width (drawer is below, not beside) | 56 px |
| < 600 px | native `<select>` | full-screen sheet, modal | same `minmax(140px,1fr)` — still ≥ 2 columns at 320 px (320 / 140 ≈ 2.28) | 36 px |

At 375 px and 320 px the grid still fits at least two 140 px cells without horizontal scroll
(Requirement 7.10); the header stacks the wordmark above the ServerSwitch/ReplayButton row below
600 px and the VerdictPlate drops under both, still full width, no horizontal overflow.

## Data Models

```ts
// Build-time raw-text imports (all read-only, never written)
type JarFileImport = { file: string; text: string };      // jars/*.jsonl via ?raw
type PolicyImport = unknown;                                // .specimen/*.json via default JSON import
type BugfixSpecImport = { path: string; text: string };     // .kiro/specs/*/bugfix.md via ?raw glob
type ChangesMdImport = string;                               // servers/hollow-inn/CHANGES.md via ?raw
type RackPromptImport = string;                               // prompts/rack-a.md, rack-b.md via ?raw
type HookJsonImport = string;                                 // .kiro/hooks/specimen-jar-{pre,post}.json via ?raw
type ProvenanceMdImport = string;                             // evidence/slice/01-specimen-file.md via ?raw

// Racks metadata derived at build/run time, never hand-maintained beyond racks.json + prompts
type RackMeta = { code: string; sessionId: string; task: string };
```

`@specimen/core` already defines `ResultEntry`, `ReplayResult`, `VerdictResult`, `Change`,
`BugfixSpec` (after the move), and these are imported, not redefined, by `cabinet-model.ts` and
`browser-replay.ts`. The only new types are the `*ViewModel` shapes in "Components and
Interfaces" above — all derived, none independently authoritative.

`racks.json`'s shape (`Record<"RACK A" | "RACK B", string>` today, but read generically as
`Record<string, string>` so a future third rack needs no code change) is the source of rack
order (`Object.keys` preserves insertion/key order for string keys in this file, matching
Requirement 7.1's "key order of that file").

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of
a system — essentially, a formal statement about what the system should do. Properties serve as
the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

PBT applies here: `cabinet-model.ts` is a pure, input-varying transformation (`ReplayResult` →
view model), exactly the kind of logic property-based testing is built for. The fixed-fixture
expectations against the real hollow-inn versions (Requirement 1 criteria 7–9, 16.1) and the
visual/typographic/content checks (fonts, colours, CSS scans, markdown rendering, GuideStrip tick
transitions) are covered instead by example-based, snapshot and build-scan tests in the Testing
Strategy below, per the prework analysis.

### Property 1: View-model counts always equal the core verdict's counts

For any `ReplayResult`-shaped value produced by `@specimen/core`'s `verdict()` together with any
set of jar entries, the `VerdictPlateViewModel` built by `buildViewModel` SHALL report `red`,
`filed`, `coverage.compared`, `tools_compared.length`, `tools_listed.length` and the HOLD `reason`
text that are byte-identical to the corresponding fields of that `VerdictResult`, and the
`CountsPairViewModel`'s `redJarCount` SHALL equal `verdict().red`.

**Validates: Requirements 1.10, 4.4, 4.5, 4.6, 4.11, 4.15, 6.3**

### Property 2: CountsPair arithmetic matches its source fields

For all `schema_diff` and `coverage` values of a `ReplayResult`, the `CountsPairViewModel`'s
`schemaChanged` SHALL equal `schema_diff.tools_removed.length + schema_diff.input_schema_changed.length`,
`schemaTotal` SHALL equal `coverage.tools_listed.length - schema_diff.tools_added.length +
schema_diff.tools_removed.length`, and `replayToolCount` SHALL equal the number of distinct `tool`
values among the entries whose state is `rattled` or `cracked`.

**Validates: Requirements 6.1, 6.3, 6.4**

### Property 3: Count-formatting pluralisation is consistent

For any non-negative integer count rendered by the VerdictPlate or CountsPair, the rendered phrase
SHALL use the singular noun form when the count equals 1 and the plural form otherwise.

**Validates: Requirements 6.10**

### Property 4: Jar accessible name always names accession, tool and state

For any jar entry (of any `JarState`, with or without `changes`/`compatible`/`reason`), the
accessible name produced by `jarAccessibleName` SHALL contain that jar's accession id, its tool
name and its state word, and SHALL additionally contain the changed-paths/notes text when the jar
is rattled, the failure reason when the jar is cracked, unsealed or skipped, and the
"N fields added" phrase when the jar is preserved with one or more `compatible` changes.

**Validates: Requirements 8.7**

### Property 5: Jar tilt is deterministic and bounded

For any accession id string, `jarTiltDeg(id)` SHALL return a value between 0.5 and 1.5 degrees
inclusive, and calling it twice with the same id SHALL return the same value.

**Validates: Requirements 8.2, 16.6**

### Property 6: Reveal order is rack order then seq order

For any set of racks (in any key order from `racks.json`) each containing any set of jars (in any
`seq` values), `revealOrder` SHALL return the jars grouped by rack in the racks' key order, and
within each rack in ascending `seq` order, regardless of the jars' accession numbers.

**Validates: Requirements 2.3, 7.1, 7.5**

### Property 7: Filed ids never include a jar that is not red

For any `ReplayResult` entries and any set of `BugfixSpec`s, the set of filed ids computed by
`cabinet-model.ts` (via `filedJarIds` from `@specimen/core`) SHALL be a subset of the ids of
entries whose state is `rattled` or `cracked`, and SHALL never contain an entry whose `id` is
`null`.

**Validates: Requirements 5.5, 5.7, 5.9**

### Reflection on redundancy

- A property stating "CountsPair's `redJarCount` equals `verdict().red`" and a property stating
  "`VerdictPlateViewModel.red` equals `verdict().red`" would be redundant; both are folded into
  Property 1, which asserts byte-identity against the core `VerdictResult` for every field the
  Cabinet shows, including the one `CountsPair` also uses.
- A property for "schemaTotal is derived correctly" and a property for "schemaChanged is derived
  correctly" are combined into Property 2, since both are pure arithmetic over the same
  `schema_diff`/`coverage` input and are naturally checked by one generator and one assertion
  function with several sub-assertions.
- "Accessible name contains the accession" and "accessible name contains the state word" were
  considered as separate properties but combined into Property 4, since they are asserted from the
  same generated jar and the same call to `jarAccessibleName` — splitting them would just run the
  same generator twice.
- A fixed-fixture property such as "v2 produces exactly 4 rattled and 1 cracked jar" is **not**
  listed here: it is a single concrete input, not a "for all", and belongs in the example-based
  integration suite (Requirement 16.1) against `evidence/replay/racks-vs-*.txt`, not in
  property-based testing.

## Error Handling

- **Thrown replay** (`runReplay` rejects): `App.tsx` catches the rejection, calls
  `buildViewModel({ result: null, … })` to force every jar back to `not replayed` and clear plate
  and counts figures (Requirement 15.2), renders the thrown error's message in the VerdictPlate's
  slot in place of a verdict (15.1), shows a Retry control, and moves focus to it (15.3). A
  `HOLD` result is never routed through this path — only a thrown `Promise` rejection is (15.7).
- **Per-call timeout**: handled entirely inside `@specimen/core`'s `replay()` via the `timeoutMs`
  argument the Cabinet passes (10000 ms); the Cabinet does not catch or special-case a timed-out
  call, it just renders whatever `ResultEntry.state`/`reason` `replay()` produced for that jar
  (15.6).
- **Zod parse failure on a Jar_File line**: already handled inside `@specimen/core`'s loader,
  which reports it as a `SpoiledLine`; `cabinet-model.ts` surfaces `result.spoiled` into
  `SpoiledTray` and the VerdictPlate's spoiled count, and a non-empty `spoiled` array makes
  `verdict()` return HOLD already (core's own invariant) — the Cabinet adds no extra logic here
  beyond displaying the field (15.4, 15.5).
- **`schemaDiffError`** from the engine outcome: `cabinet-model.ts` passes it straight through as
  `CountsPairViewModel.schemaDiffError`; `CountsPair.tsx` renders "schema diff: unavailable — …"
  and still renders the replay figure from the same `ReplayResult` (6.9).
- **Version switch mid-replay**: `App.tsx` keeps a request token (an incrementing counter or the
  `AbortSignal` from `runReplay`); when a new replay starts, the previous request's eventual
  resolution is compared against the latest token and discarded if stale (3.11). The ServerSwitch
  itself is never disabled during a replay (3.11), only the ReplayButton is (3.7).
- **Build-time raw-text import failures** (a missing `.kiro/specs/*/bugfix.md`, a malformed
  `racks.json`) are build failures, not runtime errors — Vite fails the build, which is acceptable
  because these are all committed, versioned inputs the maintainer controls, not user input.

## Testing Strategy

**Dual approach.** `cabinet-model.ts`'s pure derivations are covered by the seven correctness
properties above, implemented as `fast-check` property tests (minimum 100 iterations each, tagged
with the property number and text) plus a smaller set of unit tests for concrete fixed-fixture
examples and edge cases. Everything that is fixed-fixture, visual, content-sourced, or
infrastructure-shaped is covered by example-based, snapshot, jsdom or build-scan tests instead —
following the PBT-applicability assessment above.

**Property tests** (`apps/cabinet/test/cabinet-model.property.test.ts`,
`jar-art.property.test.ts`), using `fast-check`, ≥100 iterations each:

- **Feature: cabinet-ui, Property 1: View-model counts always equal the core verdict's counts**
- **Feature: cabinet-ui, Property 2: CountsPair arithmetic matches its source fields**
- **Feature: cabinet-ui, Property 3: Count-formatting pluralisation is consistent**
- **Feature: cabinet-ui, Property 4: Jar accessible name always names accession, tool and state**
- **Feature: cabinet-ui, Property 5: Jar tilt is deterministic and bounded**
- **Feature: cabinet-ui, Property 6: Reveal order is rack order then seq order**
- **Feature: cabinet-ui, Property 7: Filed ids never include a jar that is not red**

Generators build arbitrary but schema-valid `ResultEntry`/`ReplayResult` fragments (reusing the
zod schemas from `@specimen/core` with `fast-check`'s `fc.record`/`fc.constantFrom` over the
`JAR_STATES` enum, `ChangeKind` enum, and arbitrary accession-like strings), arbitrary rack/seq
layouts, and arbitrary `BugfixSpec` text fixtures (including ones that do and do not cite a given
id as a whole token, to exercise `citesId`'s boundary rule).

**Unit / example tests:**

- `browser-replay.test.ts` (Node, no jsdom): runs `runReplay("v1" | "v2" | "v2.1")` for real
  against the real `hollow-inn` modules and the real committed jars, and asserts `buildReport()`
  output (from `@specimen/core`) matches `evidence/replay/racks-vs-v1.txt`,
  `racks-vs-v2-after-filing.txt` and `racks-vs-v2.1.txt`; a separate case runs `v2` with an empty
  `BugfixSpec[]` and compares against `racks-vs-v2.txt` (Requirement 16.1). This is also where
  Requirement 1 criteria 7–9's fixed expected counts live, as literal assertions, never embedded
  in product code (16.1, 16.2).
- `cabinet-model.test.ts`: the view-model mapping for SPC-0002 (rattled, `v2`, with the ×100
  rename note), SPC-0002 in `v2.1` (preserved with one `compatible` addition → "1 field added"),
  and SPC-0009 (cracked, "tool not in tools/list") accessible names (16.3); CountsPair literal
  figures for `v1`/`v2`/`v2.1` (6.5–6.7, 16.2).
- `LabReportTable.test.tsx` (jsdom): renders the SPC-0002 entry and asserts the reference column
  shows the literal `425.00`, not `425` (16.4, 11.6).
- `motion.test.tsx` (jsdom): toggles a mocked `matchMedia('(prefers-reduced-motion: reduce)')` and
  asserts the Cabinet's no-motion class is applied, the Reveal_Interval constant used by `App.tsx`
  becomes 0, and a live change (not just initial load) is honoured (16.5, 2.13, 2.14).
  `jar-art.property.test.ts` additionally covers Property 5 (tilt).
- `a11y-keyboard.test.ts` (jsdom): Escape closes the JarDrawer and restores focus to the
  last-activated Jar; Tab stays inside a modal (bottom-sheet/full-screen) drawer; Tab reaches the
  Jars, ServerSwitch and ReplayButton around a non-modal (right-panel) drawer (16.11).
- `build-scan.test.ts`: after `vite build`, scans `dist/`'s HTML/CSS for any `src`/`href`/`url()`/
  `@import` holding an absolute URL other than a `github.com` anchor, and scans the JS for host
  names outside `github.com`, the site's own host, and the three Namespace_Hosts (`www.w3.org`,
  `json-schema.org`, `react.dev`) (16.7, 17.2); also checks no CSS rule/inline style sets a font
  below 14 px after rem/em conversion and that the toe-tag HTML overlay text is never scaled below
  its minimum (16.9); checks the Token_File defines exactly the custom properties of Requirement
  9.1 and that every allowed colour pair reaches 4.5:1 contrast (16.10); checks every file under
  `jars/` is unchanged and its SHA-256 still matches `jars/MANIFEST.sha256` after the build (16.12,
  never editing `jars/`).
- `network-guard.test.ts` (jsdom): replaces `fetch`, `XMLHttpRequest`, `WebSocket` and
  `EventSource` with recorders (not mocks of the MCP SDK — the SDK's in-memory client/server are
  untouched) around a full `runReplay` call, and fails if any recorder is invoked (16.8).

**Not property-tested, and why:** GuideStrip tick transitions (small enumerable boolean state,
13.x) — example tests per transition; markdown rendering and provenance text (fixed content
sources) — example/snapshot tests; CSS token/contrast values (finite fixed set) — a single
computed check per pair (16.10); Cold-open timeline pacing (fixed millisecond constants, not an
algorithm over varying input) — example test asserting the constants and total duration ≤ 4.5 s
and the reduced-motion variant's near-zero duration.

**Repository-wide gates:** `npm test` at the root (Requirement 16.13) runs every suite above
through the existing `vitest.config.ts` glob; `npm run typecheck` (16.14) picks up
`apps/cabinet/src/**/*.ts(x)` through the existing `tsconfig.json` include. Both scripts already
match `apps/*`; no script changes are required, only the new files.

**`vercel.json`** (repo root, new file):

```json
{
  "buildCommand": "npm run build -w apps/cabinet",
  "outputDirectory": "apps/cabinet/dist",
  "framework": null
}
```

No `functions` entry and no Vercel Pro-only feature (Requirement 17.4, 17.5); `apps/cabinet`'s own
`vite build` emits the static `dist/` whose `index.html` serves at `/` (17.1), self-hosts the
three `@fontsource` families (17.3), and `build-scan.test.ts` is what actually enforces "no
third-party host at runtime" (17.2) rather than this file.
