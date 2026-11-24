# Implementation Plan: Jar Capture

## Overview

The plan builds `packages/core` (pure logic, no `node:` imports) and `packages/cli` (the `specimen` bin) in TypeScript. The order is fixed by the user: workspace setup first, then the firewall, then the manifest, and only then the pieces that record a jar (schema, redaction, pairing, and the pre and post hooks). Kiro wiring files for recording and the end-to-end tests come last.

Rules for every task:

- Tests live in `<package>/test/*.test.ts`. Tests that write jar or pending files use a temporary directory with its own `.kiro` folder. No task edits, creates or deletes anything under the repository `jars/` directory (Requirement 11.15).
- Each top-level task ends with `npm test` at the repository root passing. Optional (`*`) test sub-tasks that are skipped do not break that, because the remaining tests still pass.
- Property tests use `fast-check` with `numRuns >= 100` and carry the comment `Feature: jar-capture, Property N: <title>`.

## Tasks

- [ ] 1. Workspace setup and core foundations
  - [ ] 1.1 Create the two workspace packages and install dependencies
    - Create `packages/core` (`@specimen/core`, `exports "." -> ./src/index.ts`, `"type": "module"`, dependency `zod`) and `packages/cli` (`@specimen/cli`, `"bin": {"specimen": "./bin/specimen.mjs"}`, dependencies `@specimen/core`, `commander`, `zod`, `tsx`).
    - Add `fast-check` to the root `devDependencies`. Keep the existing root `workspaces` (`packages/*`) and vitest `include`.
    - Write `packages/cli/bin/specimen.mjs` (node shebang, `process.removeAllListeners("warning")`, `register()` from `tsx/esm/api`, then import `../src/main.ts`) and a minimal `src/main.ts` with a `commander` program named `specimen` and an exported `hook` command group.
    - Run `npm install` at the repo root so npm links `node_modules/@specimen/*` and `node_modules/.bin/specimen`. Confirm `npx --no-install specimen --help` runs from the repo root.
    - Add `packages/core/src/index.ts` as an empty re-export file and a trivial smoke test in each package so `npm test` stays green.
    - _Requirements: 10.1, 10.3, 10.7, 11.1_
  - [ ] 1.2 Implement `json.ts`, `sha256.ts` and `payload.ts` in core
    - `json.ts`: `Json` type, `canonicalJson` (builds text by concatenation so `__proto__` and `constructor` are ordinary keys), `isJsonResponse`, `inputHash`.
    - `sha256.ts`: `sha256Hex` over `TextEncoder` bytes or `Uint8Array`, with no `node:` import.
    - `payload.ts`: `sessionIdRe`, `validSessionId`, `prePayloadSchema`, `postPayloadSchema` (requires the `tool_input` key and, for post, a string `tool_response`), and `fieldPaths` (never uses zod or `JSON.parse` messages).
    - Re-export from `src/index.ts`.
    - _Requirements: 1.4, 3.1, 3.5, 3.6, 3.7, 3.8, 4.1, 6.7, 10.1, 10.2, 10.11_
  - [ ]* 1.3 Write property test for Canonical_JSON
    - **Property 4: Canonical JSON invariants**
    - **Validates: Requirements 3.6, 3.7, 3.8**
  - [ ]* 1.4 Write property test for SHA-256
    - **Property 5: SHA-256 agrees with a reference**
    - Compare against `node:crypto` inside the test only.
    - **Validates: Requirements 10.11**
  - [ ]* 1.5 Write property test for session id validation and a static boundary check
    - **Property 21: Session id validation**
    - Add a test that no file under `packages/core/src` imports `node:` or reads a clock, file system or network.
    - **Validates: Requirements 1.4, 10.1, 10.2, 10.9, 11.19**

- [ ] 2. Firewall
  - [ ] 2.1 Implement `firewall.ts` in core
    - `lexicalResolve` (absolute path, `.` and `..` collapsed, `\` treated as `/`), `candidatePaths` (iterative walk, every string at any depth), `decideFirewall` (case-insensitive equal-or-under comparison on both the lexical and the real path).
    - Re-export from `src/index.ts`.
    - _Requirements: 8.1, 8.2, 8.3, 8.12, 8.13, 8.14, 10.1, 10.2_
  - [ ] 2.2 Implement the CLI firewall hook
    - `src/io/root.ts` (`findWorkspaceRoot`), `src/io/fsx.ts` (read, `realpath` of the longest existing ancestor), `src/io/stdin.ts`, `src/io/log.ts` (one-line diagnostics with ISO time, hook name, session id or `-`, fixed message, never input text).
    - `src/hooks/firewall.ts`: parse STDIN loosely, compute lexical and real paths, call `decideFirewall`, on `block` write `jars are evidence and read-only` to STDERR with `fs.writeSync(2, ...)` and exit 2, otherwise exit 0 with nothing on STDOUT. Parse failure, no candidate path or an unexpected error logs and exits 0.
    - Register `specimen hook firewall` in `src/main.ts`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.11, 8.13, 8.14, 10.3, 10.4, 10.10_
  - [ ]* 2.3 Write property test for the firewall decision
    - **Property 17: Firewall decision**
    - Cover extra `.` segments, `dir/..` pairs, letter-case changes and strings nested at depth in `tool_input`.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.11, 8.12, 8.13, 8.14**
  - [ ]* 2.4 Write firewall example tests in `packages/cli/test/firewall.test.ts`
    - A path under `jars/`, a path outside, and a `..` path that resolves into `jars/`.
    - Case variants, a symbolic link into `jars/`, a target held in a nested string field, and a write to `jars/MANIFEST.sha256`.
    - Child process on invalid STDIN and on an unknown argument: zero bytes on STDOUT and exit 0.
    - _Requirements: 8.1, 8.4, 8.5, 8.11, 11.9, 11.10, 11.24_

- [ ] 3. Manifest
  - [ ] 3.1 Implement `manifest.ts` in core
    - `formatManifest` (lines `<64 hex>  <path>`, sorted by code point, rejects `\n` or `\` in a path), `parseManifest`, `diffManifest` (missing, changed, unlisted, plus `extraUnlisted` for symbolic links).
    - Re-export from `src/index.ts`.
    - _Requirements: 8.6, 8.7, 8.15, 8.17, 10.1_
  - [ ] 3.2 Implement `specimen manifest write|check` in the CLI
    - `src/manifest.ts`: `lstat` walk of `jars/`, hash regular files other than the Manifest, skip symlinks and report them as unlisted. `write` replaces `jars/MANIFEST.sha256`. `check` exits 0 when nothing differs, 2 after listing each `MISSING`, `CHANGED` or `UNLISTED` path on STDERR, and 1 with a STDERR diagnostic on an operational error. A missing Manifest with files present exits 2, with no files exits 0. `check` never modifies `jars/`.
    - Register the `manifest` command group in `src/main.ts`. Capture hooks never call these functions.
    - _Requirements: 8.6, 8.7, 8.8, 8.9, 8.15, 8.16, 8.17, 8.18, 8.19, 10.3_
  - [ ] 3.3 Add the firewall and manifest Kiro hook files
    - `.kiro/hooks/specimen-jar-firewall.json` (PreToolUse, matcher `write`, command `npx --no-install specimen hook firewall`).
    - `.kiro/hooks/specimen-manifest-check.json` (two hooks, PreTaskExec and PostTaskExec, no matcher, command `npx --no-install specimen manifest check`).
    - _Requirements: 8.10, 9.4, 9.5, 9.8, 9.9_
  - [ ]* 3.4 Write property test for the manifest format and diff
    - **Property 18: Manifest format and diff**
    - **Validates: Requirements 8.6, 8.8, 8.9, 8.15, 8.17, 8.18**
  - [ ]* 3.5 Write manifest tests in `packages/cli/test/manifest.test.ts`
    - On a temporary copy of a jar directory: `manifest write` then `sha256sum -c` (or `shasum -a 256 -c`) succeeds, and one changed byte makes `manifest check` exit 2.
    - Exit codes 0, 1 and 2, the missing-Manifest rules, and a symbolic link counted as unlisted.
    - _Requirements: 8.7, 8.8, 8.9, 8.16, 8.17, 8.18, 11.11, 11.23_

- [ ] 4. Jar schema, reader and accession ids
  - [ ] 4.1 Implement `jar.ts` and `accession.ts` in core
    - `jar.ts`: `jarLineSchema` (strict object, all rules of Requirement 1 including the `response_length` refinement and pointer validation), `serializeJarLine`, `readJar` with the error kinds `json`, `schema`, `unknown_field`, `blank`, `incomplete`, and `readJarTolerant`. Add schema comments that document `seq` uniqueness, start order versus completion order, and that `duration_ms` includes hook overhead.
    - `accession.ts`: `formatAccession`, `parseAccession`, `parseCounter`, `maxAccession` (tolerant, ignores values above `Number.MAX_SAFE_INTEGER`).
    - Re-export from `src/index.ts`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.16, 1.18, 1.19, 1.20, 1.21, 1.22, 1.23, 2.2, 2.3, 2.7, 2.8_
  - [ ]* 4.2 Write property test for the Jar_Line round trip
    - **Property 1: Jar_Line round trip and single-line form**
    - Include a plain example test that a Jar_Line round-trips (Requirement 11.13).
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.17, 11.13**
  - [ ]* 4.3 Write property test for the Jar reader
    - **Property 2: Jar reader locates every defect**
    - **Validates: Requirements 1.18, 1.19, 1.20, 1.21**
  - [ ]* 4.4 Write property test for accession ids
    - **Property 11: Accession ids**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.7, 2.8, 11.17**

- [ ] 5. Redaction
  - [ ] 5.1 Implement `scan.ts` and `redact.ts` in core and ship the default config
    - `scan.ts`: strict RFC 8259 `scanJson` that returns the character span of every value and keeps duplicate keys in text order. Errors carry no text excerpt.
    - `redact.ts`: `redactConfigSchema` (strict), `MARKER`, `DEFAULT_REDACT_CONFIG`, `compileRedact` (returns the failing pattern index for an invalid source or an empty match), `redactInput` (uses `Object.defineProperty` so `__proto__` stays a data property), `redactResponse` (span splice for a JSON_Response, pattern replacement for text, `hash` mode with `response_length`).
    - Create `.specimen/redact.json` equal to `DEFAULT_REDACT_CONFIG`, with the keys and the three patterns from the design.
    - Re-export from `src/index.ts`.
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.17, 7.18, 7.19, 7.20, 7.21, 7.22, 7.24_
  - [ ]* 5.2 Write property test for input redaction
    - **Property 12: Input redaction**
    - **Validates: Requirements 7.6, 7.7, 7.8, 7.24**
  - [ ]* 5.3 Write property test for raw-text fidelity of response redaction
    - **Property 13: Raw-text fidelity of response redaction**
    - **Validates: Requirements 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.21, 11.5, 11.6**
  - [ ]* 5.4 Write property test for text response redaction and hash mode
    - **Property 14: Text response redaction and hash mode**
    - **Validates: Requirements 7.18, 7.19, 7.20**
  - [ ]* 5.5 Write property test for redaction idempotence
    - **Property 15: Redaction idempotence**
    - **Validates: Requirements 7.23**
  - [ ]* 5.6 Write property test for redact config validation
    - **Property 16: Redact config validation**
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5**
  - [ ]* 5.7 Write redaction example tests
    - `"total":425.00` under a redacted sibling key is stored unchanged.
    - A non-JSON response with a matching pattern gets the marker and `text_redacted` true.
    - `"text": "hash"` stores `sha256:<hex>`, sets `response_length`, `response` null and `text_redacted` true, and no other form of the text.
    - The shipped `.specimen/redact.json` equals `DEFAULT_REDACT_CONFIG`, contains the bearer, `sk-` and e-mail patterns and the five required keys.
    - _Requirements: 7.14, 7.17, 7.18, 7.19, 7.20, 11.6, 11.7, 11.8, 11.26_

- [ ] 6. Server resolution, pairing and process I/O primitives
  - [ ] 6.1 Implement `server.ts` and `pairing.ts` in core
    - `server.ts`: `mcpConfigSchema`, `sanitiseKey`, `resolveServer` (flag, unique prefix match, `ambiguous`, `no_match`, keys outside `[A-Za-z0-9_-]` never match).
    - `pairing.ts`: `pendingEntrySchema`, `parsePending` (keeps every line, 1-based), `selectPending` (lowest matching line), `removeLine`, `nextSeq`, `durationMs`, `buildJarLine` (fixed field order, sorted and deduplicated `redacted`, unpaired variant).
    - Re-export from `src/index.ts`.
    - _Requirements: 1.14, 1.15, 3.4, 3.9, 3.10, 4.4, 4.5, 4.6, 4.7, 4.15, 4.16, 4.17, 4.18, 4.19, 4.20, 4.21, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 10.6_
  - [ ] 6.2 Implement the CLI I/O primitives for recording
    - `src/io/lock.ts`: `withLock` with exclusive create (`wx`), 10 s staleness, 2 s timeout that throws `LockTimeout`, nonce check on release.
    - `src/io/jars.ts` (read-only jar listing and reads), counter and pending read and write helpers in `src/io/fsx.ts` (temp file plus `rename`), and `src/io/redactConfig.ts` (missing file gives the default, invalid file or bad pattern returns a failure).
    - _Requirements: 2.3, 2.4, 7.2, 7.3, 7.4, 10.3, 10.4, 10.10, 12.1, 12.2, 12.3, 12.4, 12.5_
  - [ ]* 6.3 Write property test for server resolution
    - **Property 7: Server resolution**
    - Add example tests: nested-prefix keys are ambiguous, a hyphenated key resolves through its sanitised form, a plain key resolves.
    - **Validates: Requirements 3.9, 3.10, 5.1, 5.2, 5.3, 5.5, 5.7, 5.8, 11.12**
  - [ ]* 6.4 Write property test for sequence numbers
    - **Property 8: Sequence numbers never collide**
    - **Validates: Requirements 3.4, 4.7, 11.14, 11.18**
  - [ ]* 6.5 Write property test for FIFO pairing and verbatim removal
    - **Property 9: FIFO pairing and verbatim removal**
    - **Validates: Requirements 4.4, 4.6, 4.9, 4.21, 10.6**
  - [ ]* 6.6 Write property test for Jar_Line field mapping and duration
    - **Property 10: Jar_Line field mapping**
    - **Property 3: Duration is the clamped difference**
    - **Validates: Requirements 1.14, 1.15, 4.5, 4.7, 4.15, 4.16, 4.17, 4.18, 4.19, 4.20**
  - [ ]* 6.7 Write lock tests in `packages/cli/test/lock.test.ts`
    - A fresh held lock times out after 2 s, a stale lock older than 10 s is removed and the retry succeeds, and the lock is released after both success and failure.
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 11.21_

- [ ] 7. Capture hooks (pre and post)
  - [ ] 7.1 Implement `hook pre` and `hook post`
    - `src/hooks/run.ts`: `runCapture` with the `HookIO` seam (STDIN, clock, file system), a catch-all wrapper that logs `err.name` and errno code only and always exits 0, no-op replacements for `process.stdout.write` and `process.stderr.write`, and `commander` with `exitOverride()` and silenced output so a bad argument logs `invalid argument` and exits 0.
    - `src/hooks/pre.ts`: parse, check session id, load redact config, resolve server (flag or workspace `.kiro/settings/mcp.json`), redact and hash the input, then under the lock append the Pending_Entry with `seq` from `nextSeq` (writing a newline first when the pending file lacks one).
    - `src/hooks/post.ts`: the same preparation plus `redactResponse`, then under the lock select the oldest match, persist the counter before building the line (recover from `maxAccession` when the counter is missing or garbled), build and validate the Jar_Line, refuse to append to a jar that lacks a final newline, append to `jars/<session_id>.jsonl` only, then remove the matched Pending_Entry. Failures keep the pending entry and log. Unpaired posts use `unpaired`, `t0 = t1`, `duration_ms` 0.
    - Register `hook pre` and `hook post` with `--server <key>` in `src/main.ts`. Neither hook touches the Manifest.
    - _Requirements: 1.13, 1.14, 1.15, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.10, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10, 4.11, 4.12, 4.13, 4.14, 4.22, 4.23, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 7.2, 7.3, 7.4, 7.6, 8.19, 10.3, 10.4, 10.5, 10.6, 10.9, 10.10, 12.1, 12.4, 12.5_
  - [ ]* 7.2 Write property test for silent capture hooks
    - **Property 19: Capture hooks are silent and exit 0**
    - Run the in-process runner with an in-memory `FsPort` over arbitrary STDIN bytes and argument lists.
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.8, 6.9, 6.10, 11.10**
  - [ ]* 7.3 Write property test that diagnostics never quote input
    - **Property 20: Diagnostics never quote input**
    - **Validates: Requirements 6.5, 6.7, 7.24**
  - [ ]* 7.4 Write hook behaviour tests in `packages/cli/test/hooks.test.ts`
    - FIFO pairing of several posts, an unpaired post gives `unpaired` true and an unmatched pending entry stays, first call of a session gets `seq` 1, `seq` stays unique with an Orphan present.
    - A missing counter continues from the highest id in `jars/`, a `session_id` containing `/`, `..` or `\` records nothing, a jar ending in a torn line is not appended to, a lock timeout records nothing and changes no file.
    - Pre and post compute equal Input_Hash when inputs differ only in key order or only in a redacted value. An invalid redact config or bad pattern records nothing.
    - Child processes on invalid STDIN and unknown arguments: zero bytes on STDOUT and STDERR, exit 0.
    - Parallel real child processes yield distinct `id` values and distinct `seq` values.
    - _Requirements: 2.3, 2.6, 3.5, 3.11, 4.4, 4.7, 4.9, 4.21, 4.22, 6.1, 6.2, 6.3, 6.10, 7.3, 7.4, 10.9, 12.4, 12.6, 11.3, 11.4, 11.10, 11.14, 11.16, 11.17, 11.18, 11.19, 11.20, 11.21, 11.22_

- [ ] 8. Kiro wiring and end-to-end tests
  - [ ] 8.1 Add the remaining Kiro configuration files
    - `.kiro/settings/mcp.json` registering `hollowinn` with command `npx` and args `tsx servers/hollow-inn/src/main.ts v1`.
    - `.kiro/hooks/specimen-jar-pre.json` (PreToolUse, matcher `@hollowinn`, `npx --no-install specimen hook pre --server hollowinn`), `.kiro/hooks/specimen-jar-post.json` (PostToolUse, matcher `@hollowinn`, `npx --no-install specimen hook post --server hollowinn`), and `.kiro/hooks/post-task-tests.json` (PostTaskExec, command `npm test`).
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.9_
  - [ ]* 8.2 Write the Hook_File tests in `packages/cli/test/wiring.test.ts`
    - Parse every file in `.kiro/hooks/` with a zod `hookFileSchema` (`matcher` optional for `PreTaskExec` and `PostTaskExec`), assert the command strings of the pre, post, firewall and manifest-check files equal the exact strings of Requirement 9, assert none of the pre, post or firewall commands contains `&&`, `||`, `|`, `;`, `>` or `<`, and assert `.kiro/settings/mcp.json` registers `hollowinn` as specified.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 11.25_
  - [ ]* 8.3 Write the hollow-inn end-to-end test in `packages/cli/test/e2e-quote.test.ts`
    - Start hollow-inn v1 through the real MCP SDK `Client` over stdio (no protocol mock), call `quote`, feed the returned text through `specimen hook pre` then `specimen hook post` as real child processes in a temporary workspace, and assert the Jar_Line keeps `425.00` and `212.50` byte-identical in `response_text`.
    - _Requirements: 4.18, 7.13, 7.14, 10.8, 11.27_
  - [ ]* 8.4 Write the measured-payload end-to-end test in `packages/cli/test/e2e-s3.test.ts`
    - Feed the exact Pre_Payload and Post_Payload shapes recorded in `evidence/spikes/S3.md` through the pre and post hooks in a temporary workspace and assert one valid Jar_Line results. Run `npm test` at the repo root and make sure it passes.
    - _Requirements: 4.1, 4.5, 4.8, 11.15, 11.28_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The core, CLI and wiring implementation tasks are required.
- Order check: the firewall (task 2) and the manifest (task 3) exist before any hook that writes a jar (task 7). Task 7 is the first place a jar line is written, and it writes only to temporary directories in tests.
- No task edits, creates or deletes files under `jars/`.
- Each property sub-task names its design property and the requirement clauses it checks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4", "4.1"] },
    { "id": 6, "tasks": ["3.5", "4.2", "4.3", "4.4", "5.1"] },
    { "id": 7, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "6.1", "6.2"] },
    { "id": 8, "tasks": ["6.3", "6.4", "6.5", "6.6", "6.7"] },
    { "id": 9, "tasks": ["7.1", "8.1"] },
    { "id": 10, "tasks": ["7.2", "7.3", "7.4", "8.2", "8.3", "8.4"] }
  ]
}
```
