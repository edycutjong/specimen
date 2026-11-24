# Implementation Plan: Replay Engine

## Overview

The plan extends `packages/core` (pure logic, no `node:` imports) and `packages/cli` (the `specimen` bin) in TypeScript, reusing the jar-capture modules (`jar.ts`, `json.ts`, `sha256.ts`, `redact.ts`, `scan.ts`, `payload.ts`). The order goes from the leaves up: policies and the jar loader, then normalise and diff, then the result schema and the verdict, then the Reference and the Spec_Checker, then the replay loop, then the two CLI commands, and finally the end-to-end and boundary tests.

Rules for every task:

- Tests live in `<package>/test/*.test.ts`. Tests that write jars, replay results or quarantine files use a temporary directory with its own `.kiro` folder. No task edits, creates or deletes anything under the repository `jars/` directory (Requirement 13.20).
- Each top-level task ends with `npm test` at the repository root passing. All test sub-tasks are required, because the judging code decides SHIP or HOLD and a wrong verdict is the failure this feature exists to prevent.
- Property tests use `fast-check` with `numRuns >= 100` and carry the comment `Feature: replay-engine, Property N: <title>`.
- Every new module of `packages/core` is re-exported from `src/index.ts`. The replay loop never uses a mock of the MCP protocol: tests use the real SDK `Client` over `InMemoryTransport` against `createServer(version)` from `servers/hollow-inn/src/index.ts`, or real child processes.

## Tasks

- [ ] 1. Policies, Jar_Loader and session grouping
  - [ ] 1.1 Implement `policy.ts` in core and ship the default Volatile_Policy
    - `replayPolicySchema`, `volatilePolicySchema` (both strict zod objects), `decideTool`, `isPointerGlob`, `matchesGlob` (segment by segment, `*` matches exactly one segment, RFC 6901 unescaping), and `SHIPPED_VOLATILE_POLICY`.
    - Create `.specimen/volatile.json` with at least `/created_at` and `/bookings/*/created_at`, equal to `SHIPPED_VOLATILE_POLICY`.
    - Do not create `.specimen/replay.json`: a missing file must mean that nothing is allowed.
    - Re-export from `src/index.ts`.
    - _Requirements: 2.14, 2.15, 2.16, 2.17, 2.24, 3.2, 12.4_
  - [ ] 1.2 Implement `jar-loader.ts` in core
    - `loadJars` (calls jar-capture's `readJar` per file, prefixes the file name, then marks later duplicates as Spoiled_Lines with the reason "duplicate id" or "duplicate seq"), `loadPending` (zod-parsed Pending_File, 1-based lines, file name `.specimen/pending.jsonl`), `findOrphans`, and `groupBySession` (groups by lowest `seq`, ties by `session_id` in code-unit order, members by `seq`).
    - Re-export from `src/index.ts`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.18, 1.19, 12.4_
  - [ ] 1.3 Write tests for policies, the loader and grouping in `packages/core/test/loader.test.ts`
    - **Property 1: Jar_Loader partitions valid lines from Spoiled_Lines**
    - **Property 2: Duplicate ids and duplicate (session_id, seq) pairs are spoiled, not replayed**
    - **Property 3: Session grouping preserves membership and fixes order**
    - Example tests: a duplicate `id` and a duplicate `session_id` with `seq` yield Spoiled_Lines, an invalid Pending_File line yields a Spoiled_Line, a Pending_Entry with the same `session_id` and `seq` as a Jar_Line is not an Orphan_Entry, and the shipped `.specimen/volatile.json` equals `SHIPPED_VOLATILE_POLICY`.
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.18, 1.19, 2.17, 13.27**
  - Done when `npm test` at the repository root passes.

- [ ] 2. Normalise and diff
  - [ ] 2.1 Implement `normalize.ts` in core
    - `normalize(body, policy)` returns `{value, removed}`. A JSON Body loses every value whose pointer matches a Pointer_Glob (array removals reindex). A non-JSON Body only has `\r\n` replaced by `\n`. Use plain recursion with `Object.keys` and fresh objects built with `Object.defineProperty`, so `__proto__` and `constructor` stay ordinary keys. Stop at depth 1,000 and report it to the caller.
    - Re-export from `src/index.ts`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10, 12.8, 12.9_
  - [ ] 2.2 Implement `diff.ts` in core
    - `diff(was, now)` returns Changes sorted by path (code-unit order), then by the kind order `removed`, `added`, `value`, `type`, `length`. Cover object members, scalars, type mismatch (no descent), array `length`, Id_Key matching (`idKeyOf`, string-form uniqueness, `id` first, then the lowest `*_id` key), index-by-index fallback, the reorder `value` Change with the two key lists, non-JSON line mode (`/line/<n>` and `/line`), JSON versus non-JSON `type` Change at the empty path, and the depth-limit Change with the note "depth limit 1000".
    - Rename suspicion: removed numeric path plus added numeric sibling whose key is the removed key followed by `_`, `now` equal to `was` times 10^n for n from 1 to 3, computed in exact decimal arithmetic on the shortest decimal text (no binary multiplication). Choose the lowest n, then the lowest code-unit path. Process removed paths in code-unit order and annotate each added path at most once. Add no note when the added value is a string or the stems differ.
    - Re-export from `src/index.ts`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.20, 4.21, 4.22, 4.23, 4.24, 12.8, 12.9_
  - [ ] 2.3 Write property tests for normalisation in `packages/core/test/normalize.test.ts`
    - **Property 5: Normalisation is idempotent and a no-op under an empty policy**
    - **Property 6: Non-JSON normalisation only touches line endings**
    - Example tests: `"total":425.00` parses as the number 425, a glob that matches nothing leaves the Body unchanged, `*` matches exactly one segment, and the only Change at `/created_at` under the default policy leaves the Bodies equal.
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**
  - [ ] 2.4 Write property tests for the diff in `packages/core/test/diff.property.test.ts`
    - **Property 7: Structural diff is identity-preserving, deterministic, and locates every field-level difference**
    - **Property 9: Id_Key array matching reports stable per-element changes and one length Change**
    - **Property 26: Deeply nested bodies are bounded, not stack-overflowing**
    - Generators include `__proto__` and `constructor` keys and arrays of objects with and without a shared Id_Key.
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.17, 4.18, 4.19, 12.8, 12.9**
  - [ ] 2.5 Write the required diff fixtures in `packages/core/test/diff.fixtures.test.ts`
    - **Property 8: Rename suspicion fires only for a matching numeric stem and factor, never otherwise**
    - Negative fixture: the number 100 against the string "100" at the same path yields one `type` Change and no rename note.
    - Negative fixture: a removed numeric path with an added string sibling of the same stem yields no rename note.
    - Negative fixture: an unrelated removed and added pair with different stems (for example `total` and `tax_cents`) whose values differ by 10^n yields no rename note.
    - Positive fixtures: `/total` 425 against `/total_cents` 42500 yields the note "suspected rename from /total ×100", `was` 4.35 and `now` 435 yields ×100 through exact decimal arithmetic, and two candidates for one removed path annotate only the lowest n.
    - Unit tests: a dropped element of an array with an Id_Key is reported by its key together with one `length` Change, a reordered Id_Key-matched array yields one `value` Change with the two key lists, and the Id_Key rules hold (string-form collision of 1 and "1", lowest `*_id` key, different key names fall back to index by index, an empty array on one side).
    - **Validates: Requirements 4.8, 4.11, 4.12, 4.13, 4.14, 4.21, 4.22, 4.23, 4.24, 13.3, 13.4, 13.5, 13.28, 13.29**
  - Done when `npm test` at the repository root passes.

- [ ] 3. Replay result schema, report and verdict
  - [ ] 3.1 Implement `replay-result.ts` in core
    - `changeSchema`, `resultEntrySchema`, `replayResultSchema`, `quarantineFileSchema` (strict zod objects as in the design), `coverageString` ("N jars compared · T of K tools · not recorded: a, b", "1 jar compared", "none"), and `buildReport` (first line `SHIP · replay clean on the recorded set · <coverage>`, `HOLD · <reason> · <coverage>` or `HOLD · covered · <reason> · <coverage>`, one line per jar, `<session_id>#<seq>` for an Orphan_Entry, then one `spoiled · <file>:<line> · <reason>` line per Spoiled_Line). The text must never state or imply that the server is safe.
    - Re-export from `src/index.ts`.
    - _Requirements: 5.12, 5.14, 5.15, 6.1, 6.2, 6.3, 6.13, 6.15, 10.8, 10.9, 10.10, 12.7_
  - [ ] 3.2 Implement `verdict.ts` in core
    - `verdict({entries, spoiledCount, toolsListed, filedIds})` returns `{verdict, reason, red, filed, covered, coverage}`. SHIP only when a Compared_Jar exists, no jar is `rattled`, `cracked`, `unsealed` or `skipped`, and the spoiled count is 0. Join reason parts with "; " in the order no jars, red, not replayed (with the allow hint and distinct skipped tools in code-unit order), quarantined ("orphan pre-event" before "unpaired post-event"), spoiled (singular and plural). Compute `coverage` as defined in Requirement 5 criterion 13. No clock, randomness, network or `node:` import.
    - Re-export from `src/index.ts`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.13, 5.18, 5.19, 12.1, 12.2_
  - [ ] 3.3 Write property and fixture tests for the verdict in `packages/core/test/verdict.test.ts`
    - **Property 14: The verdict is SHIP under exactly one rule, and is deterministic**
    - **Property 15: The HOLD reason is composed from present parts in a fixed order**
    - **Property 16: Coverage is computed consistently from compared jars and the listed tools**
    - Fixture evals: E3c (an empty jar set with no Spoiled_Line gives HOLD "no jars"), E3d (every tool not allowed gives HOLD "N not replayed" with the allow hint and without "no jars"; one skipped jar among preserved jars gives "1 not replayed"), and E3e (one Orphan_Entry gives "1 quarantined: orphan pre-event", one Spoiled_Line gives "1 spoiled line", and every verdict line carries the Coverage_String).
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.13, 5.14, 5.16, 5.17, 13.2, 13.7, 13.8, 13.9**
  - [ ] 3.4 Write tests for the result schema and report in `packages/core/test/replay-result.test.ts`
    - Round trip of a `ReplayResult` through `replayResultSchema` (JSON stringify, then parse, deep-equal), a failing field is named on a bad result, and the first line of the report has the exact forms of Requirement 10 criterion 8 for SHIP, HOLD and covered HOLD.
    - Each later line holds the fields of Requirement 10 criterion 9, including `<session_id>#<seq>` for an Orphan_Entry, the rename note, the "+N field" text, and the `spoiled` lines. The text never contains "safe".
    - **Validates: Requirements 5.12, 5.15, 6.14, 6.15, 10.8, 10.9, 10.10, 13.15, 13.16**
  - Done when `npm test` at the repository root passes.

- [ ] 4. Reference and Spec_Checker
  - [ ] 4.1 Implement `reference.ts` in core
    - `referenceOf(entry)` and `referenceSubstrings(ref)`. Locate the Value_Span of a Change path in the jarred `response_text` with jar-capture's `scanJson`, so literals such as `425.00` are copied byte for byte. Resolve a path segment under an Id_Key array through `idKeyOf`. Apply every rule of Requirement 8 (value and type literals, removed literals, `key` elements collapsed under a `length` Change, tool name for cracked jars without the `error` text, the further elements of criterion 11), and return the deduplicated union.
    - Re-export from `src/index.ts`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.11, 8.12, 12.1_
  - [ ] 4.2 Implement `spec-check.ts` in core
    - `checkSpec(text, jarId, resultJars)` returns `"pass"` or every failure. Short-circuit to the single failure `jar_unknown` or `not_red`. Otherwise check `headings`, `when_then`, `shall`, `shall_continue`, `jar_id` (Whole_Token_Match), the Marker_Pair and the single `json specimen-repro` block (`repro_missing`), `repro_not_verbatim` (Canonical_JSON equality for `input`, `replayed` and `changed_paths`, and for `response_text` only when it is a JSON_Response, otherwise exact string equality), `paths`, `unchanged_jar` and `expected_reference`. Parse the Repro_Block with a zod schema. Read only the `jars` entries of the Replay_Result. No `node:` import and no clock.
    - Re-export from `src/index.ts`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.18, 7.19, 8.7, 8.8, 8.10, 12.1, 12.2, 12.4_
  - [ ] 4.3 Write tests for the Reference in `packages/core/test/reference.test.ts`
    - **Property 23: The Reference is derived only from the Result_Entry and matched only by its exact elements**
    - Example tests: `/total 425.00` accepts `425.00` and rejects `425`, `r-08` and `r-09` as `key` elements next to a `length` Change, the tool name for a missing tool and for an Error_Result without the error text, the `/line/<n>` and `/response_text` elements, and an Id_Key path segment resolves to the matching element.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.11, 8.12**
  - [ ] 4.4 Write property tests and fixture eval E4 for the Spec_Checker in `packages/core/test/spec-check.test.ts`
    - **Property 19: The Spec_Checker never reads verdict-level fields and short-circuits correctly**
    - **Property 20: Heading and keyword checks are scoped to their own Section**
    - **Property 21: The Repro_Block is required, parseable, and compared up to formatting only**
    - **Property 22: The paths and unchanged-jar checks read the right Section and the right companion entries**
    - Fixture eval E4: a missing Repro_Block fails with `repro_missing`, an edited value fails with `repro_not_verbatim`, reordered keys pass the repro check, and an Expected Behavior that does not name the Reference fails with `expected_reference`.
    - Example tests: `repro_missing` for no Marker_Pair, two Marker_Pairs, no fenced block, two fenced blocks and invalid JSON, `SPC-0004` does not match inside `SPC-00045`, `unchanged_jar` accepts "no preserved jar" only when no preserved jar of the tool exists, and the checker returns the same result when `verdict`, `red`, `filed`, `covered` and `reason` change.
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.17, 7.18, 7.19, 13.10, 13.31, 13.32, 13.33, 13.34**
  - [ ] 4.5 Write fixture eval E3b in `packages/core/test/covered.test.ts`
    - Three `rattled` quote jars and one fixture Bugfix_Spec that lists all three ids and passes the Spec_Checker give HOLD with `covered` true. A spec that omits one id gives `covered` false, and the report names the missing id. The filed ids come from running `checkSpec` per jar.
    - **Validates: Requirements 5.11, 5.12, 9.2, 9.3, 9.4, 9.5, 13.6, 13.9**
  - Done when `npm test` at the repository root passes.

- [ ] 5. Replay engine
  - [ ] 5.1 Implement the replay loop in `replay.ts` in core and the in-memory test factory
    - `replay(args)` takes the `ClientFactory`, file texts, policies, redact config, `Clock`, `startedAt`, timeout and strict flag; it takes no `node:` import. For each Session_Group with a Replayable_Jar, obtain a fresh client, call `tools/list` once, replay in `seq` order, and close the client. Build the replayed text from the `text` items of `content`, parse `replayed` for a JSON_Response, and apply the state precedence `unsealed`, `skipped`, `cracked`, then `preserved` or `rattled` (Error_Result rules, tool missing from `tools/list`, group startup failure, "session aborted after <failure text>", Rename_Suspicion as breaking, Strict_Mode, the `redacted` pointer exclusion and the Ignored_List). Start one server only for `tools/list` when no Replayable_Jar exists.
    - Create `packages/core/test/support/inmemory.ts` with `makeInMemoryClientFactory(version)`: the real SDK `Client` linked by `InMemoryTransport` to `createServer(version)` from `servers/hollow-inn/src/index.ts`. Also add a small failing-factory helper for timeout and transport-failure cases that wraps the real client.
    - Re-export from `src/index.ts`.
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.13, 2.18, 2.19, 2.20, 2.21, 2.24, 6.4, 12.2, 12.5, 12.6_
  - [ ] 5.2 Add redaction, Hashed_Jar handling and result assembly to `replay.ts`
    - Compare Hashed_Jars by applying jar-capture redaction in hash mode to the replayed text (one `value` Change at `/response_text` on mismatch), and compare `text_redacted` jars after pattern redaction of the replayed text. Compare Bodies before redaction in every other case. Redact every replayed text, `replayed` value, string in `was` and `now`, and `error` with the same Redact_Config before assembly, and replace `was` and `now` with the Redaction_Marker where a path segment equals a redacted key.
    - Build `schema_diff` from the `tools/list` of an optional baseline factory (names in code-unit order, `inputSchema` compared with Canonical_JSON), which must never change a jar state or the Verdict. Build `counts`, `coverage` inputs, the ordered `jars` list with `ms` from the Clock (0 for a jar not replayed), and the Replay_Result fields that the engine owns.
    - _Requirements: 2.22, 2.23, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 6.9, 6.16, 6.17, 12.2_
  - [ ] 5.3 Write state-assignment tests in `packages/core/test/replay.states.test.ts`
    - **Property 4: Replayed text and parsed response are derived consistently from a tools/call result**
    - **Property 10: Jar state assignment follows a fixed precedence and is total**
    - **Property 13: The replay engine never calls a tool for a jar it will not compare**
    - Tests with the real SDK client: every Session_Group gets a fresh server (two sessions that each create a booking both receive the first booking id), state precedence (an unpaired jar, a non-allowed tool absent from `tools/list` and an allowed tool absent from `tools/list` end as `unsealed`, `skipped`, `cracked`), an Error_Result against a non-error jarred response is `cracked` with no diff while one against an Error_Shaped response is diffed, a transport failure makes later jars of the group `cracked` with "session aborted after <failure text>" and they are not called, a connect timeout makes the group `cracked`, a tool in both `allow` and `watch` is replayed once, and a run with no Replayable_Jar still lists the real tool names.
    - Fixture eval E6: a diff only on `/created_at` with the default Volatile_Policy yields `preserved`.
    - **Validates: Requirements 1.5, 1.8, 1.9, 1.14, 1.15, 1.16, 1.17, 2.1, 2.7, 2.8, 2.9, 2.10, 2.11, 2.13, 2.20, 2.21, 2.24, 3.11, 13.11, 13.21, 13.22, 13.23, 13.24, 13.37**
  - [ ] 5.4 Write redaction and schema-diff tests in `packages/core/test/replay.redact.test.ts`
    - **Property 11: Redacted-at-capture jars compare the re-redacted replayed text, not the raw text**
    - **Property 12: Excluded pointers never produce a Change and are always listed as ignored**
    - **Property 17: Written Replay_Results carry no unredacted secret and round-trip through their schema**
    - **Property 18: schema_diff is computed from two tool lists and never influences state or verdict**
    - Example tests: a Hashed_Jar is `preserved` for an equal replayed text and `rattled` with one `value` Change at `/response_text` for a different one, a `text_redacted` jar is compared after pattern redaction, and a secret in a replayed response is redacted in `replayed_text`, `replayed`, the `now` of a Change and `error`.
    - **Validates: Requirements 2.18, 2.19, 2.22, 2.23, 3.5, 6.6, 6.7, 6.8, 6.9, 6.14, 6.17, 13.17, 13.25**
  - Done when `npm test` at the repository root passes.

- [ ] 6. The `specimen replay` command
  - [ ] 6.1 Implement the CLI client factory and input loading
    - `packages/cli/src/replay/client-factory.ts`: `splitCommand` (whitespace split honouring single and double quotes, error on an unterminated quote) and `makeStdioClientFactory(cmd, timeoutMs, root)` using `StdioClientTransport` without a shell, STDERR piped and discarded, the Workspace_Root as working directory, the SDK default environment, and the timeout passed as the SDK request option. The close function leaves no child process.
    - `packages/cli/src/replay/load.ts`: read `jars/*.jsonl` (or `--jars`) in code-unit order, skip `MANIFEST.sha256`, treat a missing `jars/` or Pending_File as empty, read and zod-validate `.specimen/replay.json`, `volatile.json` and `redact.json` (missing files take the defaults of Requirement 2 criteria 14 and 16, an invalid file or redact pattern gives a diagnostic naming the field or pattern index and exit code 2).
    - _Requirements: 1.1, 1.18, 2.14, 2.15, 2.16, 10.2, 10.3, 10.4, 10.13, 10.15, 10.16, 10.18, 12.3, 12.4_
  - [ ] 6.2 Implement `specimen replay`, writers and the filed computation
    - `packages/cli/src/replay/write.ts`: write `replays/<server>-<iso>.json` (label restricted to `[A-Za-z0-9._-]`, `:` replaced by `-` in the time, pretty JSON with a trailing newline, `--out` override) after validating with `replayResultSchema`, and replace `.specimen/quarantine.json` with one item per unsealed jar and Orphan_Entry (an empty `items` list when none). Write no other file.
    - `packages/cli/src/replay/spec-files.ts`: read `.kiro/specs/*/bugfix.md`, run `checkSpec` for each Red_Jar whose id has a Whole_Token_Match in the text, and return exactly the ids with at least one `pass`, before the verdict is computed. Never modify a Bugfix_Spec.
    - `packages/cli/src/replay.ts` plus registration in `src/main.ts`: options `--server`, `--jars`, `--baseline`, `--strict`, `--json`, `--out`, `--timeout`, usage errors exit 2, start the baseline only for `tools/list` (failure writes no result and exits 2), pass `Date.now`-based clock and `started_at` into core, print the report or JSON, list unfiled Red_Jar ids when `covered` is false, and exit 0 for SHIP, 1 for HOLD, 3 for covered HOLD. Take the server command only from `--server`.
    - _Requirements: 2.12, 6.5, 6.10, 6.11, 6.12, 6.13, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.11, 10.12, 10.14, 10.17, 10.19, 12.3_
  - [ ] 6.3 Write CLI tests in `packages/cli/test/replay.test.ts`
    - Real child processes of the `specimen` bin against `servers/hollow-inn` in a temporary workspace. Exit codes 0 (SHIP), 1 (HOLD), 3 (covered HOLD) and 2 (usage error, unterminated quote in `--server`, invalid `.specimen/redact.json`), the exact first line and the per-jar lines of the report, `--json` writes only the Replay_Result to STDOUT, the Quarantine_File has an empty `items` list when no jar is unsealed, the server command comes only from `--server` (a `.kiro/settings/mcp.json` naming a different server is ignored), a failing `--baseline` exits 2 and writes no result, and a working `--baseline` changes no state and not the Verdict.
    - A secret written by the server to STDERR appears in no STDOUT, STDERR or written file.
    - **Validates: Requirements 2.12, 2.15, 6.10, 6.11, 6.12, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.11, 10.12, 10.13, 10.14, 10.17, 10.19, 13.14, 13.15, 13.18, 13.26, 13.35, 13.36**
  - [ ] 6.4 Write tests for filed aggregation in `packages/cli/test/spec-files.test.ts`
    - **Property 24: Filed ids are exactly those with at least one passing spec**
    - Example tests: a spec that cites several ids and fails for one counts only the passing ids, a spec that cites no Red_Jar is ignored, and no Bugfix_Spec file is modified.
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6**
  - Done when `npm test` at the repository root passes.

- [ ] 7. The `specimen check-spec` command
  - [ ] 7.1 Implement `selectLatestReplay` in core and `specimen check-spec` in the CLI
    - `packages/core/src/select-replay.ts`: `selectLatestReplay(names)` picks the filename matching `<server>-<iso>.json` with the greatest 24-character `YYYY-MM-DDTHH-mm-ss.sssZ` suffix, ties by the greatest whole name in code-unit order, ignores non-matching names, and returns `undefined` when none match. Re-export from `src/index.ts`.
    - `packages/cli/src/check-spec.ts` plus registration in `src/main.ts`: `specimen check-spec <bugfix.md> --jar <id> [--replay <file>]`. Parse the Replay_Result with `replayResultSchema`, call `checkSpec`, print `PASS <id>` and exit 0, or one `FAIL <code>: <message>` line per failure and exit 1. A missing or unreadable file, a schema failure, a missing `--jar`, an unknown id or no matching file in `replays/` gives a diagnostic on STDERR and exit 2. Write no file and do not modify the Bugfix_Spec.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 6.15, 12.3_
  - [ ] 7.2 Write tests for `check-spec` in `packages/cli/test/check-spec.test.ts` and `packages/core/test/select-replay.test.ts`
    - **Property 25: Replay result file selection picks the greatest ISO suffix deterministically**
    - Example tests with the real bin in a temporary workspace: without `--replay` the command selects the file with the greatest `<iso>` suffix, ignores a non-matching file, exits 2 when no file matches, prints `PASS <id>` with exit 0, prints `FAIL <code>: <message>` lines with exit 1, and leaves the Bugfix_Spec and the `replays/` directory unchanged.
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 13.30**
  - Done when `npm test` at the repository root passes.

- [ ] 8. Boundary and end-to-end tests
  - [ ] 8.1 Write the boundary test in `packages/core/test/boundary.test.ts`
    - Assert that `replay.ts`, `normalize.ts`, `diff.ts`, `verdict.ts`, `spec-check.ts` and every `packages/core` module they import (followed transitively through relative imports) contain no `node:` import, and that none reads a clock, uses randomness or makes a network call outside the passed-in `Clock`.
    - **Validates: Requirements 4.20, 5.18, 7.17, 12.1, 12.2, 13.19**
  - [ ] 8.2 Write the v1 end-to-end test in `packages/cli/test/e2e-v1.test.ts`
    - Copy the repository jars into a temporary workspace together with a `replay.json` that allows all six hollow-inn tools. Run `specimen replay` as a child process against `servers/hollow-inn` v1 and assert that every jar is `preserved` and the exit code is 0. Do not touch the repository `jars/` directory and assert its files are unchanged afterwards.
    - **Validates: Requirements 13.12, 13.20**
  - [ ] 8.3 Write the v2 end-to-end test in `packages/cli/test/e2e-v2.test.ts`
    - In the same kind of temporary workspace, replay against hollow-inn v2 and assert: the quote jar is `rattled` with the note "suspected rename from /total ×100", the `search_rooms` jar with `guests` 3 and no `limit` is `rattled` with `/rooms/r-08` and `/rooms/r-09` as `removed` and one `length` Change, and the `cancel_booking` jar is `cracked` with the reason "tool not in tools/list". Create any missing jar as a fixture in the temporary directory only. Then run `npm test` at the repository root and make sure it passes.
    - **Validates: Requirements 13.13, 13.20**
  - Done when `npm test` at the repository root passes.

## Notes

- All test sub-tasks are required. The diff negative fixtures in task 2.5 (100 against "100", unrelated stems scaled by 10^n, string sibling of the same stem) are required and must stay required.
- Order check: the loader and diff (tasks 1 and 2) exist before the verdict and Spec_Checker (tasks 3 and 4), which exist before the replay loop (task 5) and the CLI (tasks 6 and 7). Nothing writes under `jars/`.
- Each property sub-task names its design property and the requirement clauses it checks.
- SHIP means "replay clean on the recorded set". No task may add text that claims the server is safe.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3", "2.4", "2.5", "3.1"] },
    { "id": 5, "tasks": ["3.2"] },
    { "id": 6, "tasks": ["3.3", "3.4", "4.1"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["4.3", "4.4", "4.5", "5.1"] },
    { "id": 9, "tasks": ["5.2"] },
    { "id": 10, "tasks": ["5.3", "5.4", "6.1"] },
    { "id": 11, "tasks": ["6.2"] },
    { "id": 12, "tasks": ["6.3", "6.4", "7.1"] },
    { "id": 13, "tasks": ["7.2", "8.1", "8.2", "8.3"] }
  ]
}
```
