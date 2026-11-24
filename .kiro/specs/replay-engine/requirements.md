# Requirements Document

## Introduction

The replay engine replays every jarred call (see the jar-capture spec) against a new version of an MCP server, compares each replayed response with the jarred one, assigns each jar one state, and returns one verdict, SHIP or HOLD. One deterministic verdict function serves the CLI, a later Agent Stop gate and the browser cabinet.

All logic (jar loading from text, grouping, normalisation, diff, rename detection, state assignment, verdict, coverage, repro-block checking) is TypeScript in `packages/core` with no `node:` imports, so that it also runs in a browser bundle. File, process, clock and STDIO access live in `packages/cli`. The engine is transport-agnostic: it receives a factory that returns a connected MCP SDK `Client`, and a `clock` function that returns monotonic milliseconds. The CLI builds that client with `StdioClientTransport`. The browser builds it with `InMemoryTransport` and an in-process server. No MCP protocol mock is used on any judged path. All external input (jar lines, pending lines, `.specimen/*.json` files, replay results, bugfix spec text) is parsed with zod at the boundary. Judging code (normalise, diff, state assignment, verdict, Spec_Checker) reads no clock, no randomness and no network. The replay loop measures `ms` only through the `clock` argument, and `started_at` is passed in by `packages/cli`.

The Replay_Result entries hold the recorded input and response text of each jar, so that the Spec_Checker works from the Replay_Result alone. The Spec_Checker reads only the id and the `jars` entries of a Replay_Result. The Replay_CLI runs the Spec_Checker before it computes the verdict, so that `filed` can feed the verdict without a circular dependency.

Writing the Repro_Block into a Bugfix_Spec is done by the `specimen file` command and is out of scope of this spec. This spec defines only what the Spec_Checker reads.

This feature reuses the jar-capture terms: Jar_Line, `id` (Accession_ID), `session_id`, `seq`, `tool`, `tool_id`, `input`, `response_text`, `response`, `response_length`, `text_redacted`, `redacted`, `unpaired`, Workspace_Root, Pending_File, Pending_Entry, Redaction_Marker, Redact_Config, JSON_Response, Canonical_JSON and Value_Span. The Jar_Schema, the pairing code and the redaction code of jar-capture are dependencies. This spec adds no second definition of them.

Known limitations of this feature:

- SHIP means "replay clean on the recorded set". It never means "this server is safe".
- A jar whose `input` was redacted is replayed with the Redaction_Marker in place of the original value. The call may therefore behave differently from the original, and the engine reports no difference between that effect and a server change.
- Calls that change state are replayed only when `.specimen/replay.json` allows the tool, and the author is responsible for pointing `--server` at a disposable test instance.
- A skipped call is not replayed, so later jars of the same session that depend on its state may differ from the recording. The verdict is HOLD in that case because of the skipped jar.
- The rename detector recognises a numeric rename by name stem and a power-of-ten factor only. Other renames appear as one removed path and one added path.
- The per-call timeout of Requirement 1 criterion 10 bounds connecting the client, `tools/list` and every call. A timeout while connecting or listing tools is a startup failure and makes the affected jars cracked (Requirement 2 criterion 9).
- "N jars compared" counts every Compared_Jar, including cracked ones.

## Glossary

- **Replay_Engine**: The functions in `packages/core` that load jars, drive replay, diff, assign states and compute the verdict.
- **Replay_CLI**: The `specimen replay` command in `packages/cli`.
- **Check_Spec_Command**: The `specimen check-spec` command in `packages/cli`.
- **Spec_Checker**: The function in `packages/core` that decides whether a bugfix spec text is valid for a jar.
- **Workspace_Root**: For the Replay_CLI and the Check_Spec_Command, the nearest ancestor directory of the process working directory, including that directory itself, that contains a `.kiro` directory, otherwise the working directory.
- **Jar_Loader**: The function in `packages/core` that turns the text of one jar file into Jar_Lines and Spoiled_Lines.
- **Spoiled_Line**: A line that is excluded from replay and reported with a file name, a 1-based line number and a reason. The kinds are: a jar line that is blank before the final line, is not valid JSON, fails the Jar_Schema, carries an unknown field, or is incomplete at the end of the file (jar-capture Requirement 1 criteria 18 to 21); a Pending_File line that fails its zod schema; a valid Jar_Line whose `id` equals an earlier one (reason "duplicate id"); and a valid Jar_Line whose `session_id` and `seq` equal those of an earlier one (reason "duplicate seq"). "Earlier" means earlier by file name in code-unit order, then by line number.
- **Client_Factory**: An asynchronous function that returns a connected MCP SDK `Client` for a fresh server instance, together with a close function.
- **Clock**: A function `() => number` that returns monotonic milliseconds, supplied by `packages/cli` to the Replay_Engine.
- **Target_Server**: The server version under test, started through the Client_Factory.
- **Baseline_Server**: The optional second server given with `--baseline`, used only for the schema diff.
- **Session_Group**: All Jar_Lines and Orphan_Entries of one `session_id`, ordered by `seq` ascending.
- **Replay_Policy**: The zod-validated content of `.specimen/replay.json`: `{"allow": string[], "watch": string[]}`.
- **Allowed_Tool**: A `tool` named in `allow` of the Replay_Policy. The author means that the tool may change state.
- **Watched_Tool**: A `tool` named in `watch` of the Replay_Policy. The author means that the tool only reads. The Replay_Engine replays and compares the jars of an Allowed_Tool and of a Watched_Tool in the same way. A tool named in both lists is replayed once.
- **Replayable_Jar**: A valid Jar_Line that is not `unpaired` and whose `tool` is an Allowed_Tool or a Watched_Tool.
- **Volatile_Policy**: The zod-validated content of `.specimen/volatile.json`: `{"volatile": string[]}`, a list of Pointer_Globs.
- **Pointer_Glob**: An RFC 6901 JSON pointer in which a segment equal to `*` matches exactly one segment, such as `/bookings/*/created_at`.
- **Body**: The comparable form of a response: the parsed JSON value of a JSON_Response after Volatile_Policy removal, or the text of a non-JSON response.
- **Change**: An object `{path, kind, was?, now?, note?}` where `kind` is `removed`, `added`, `value`, `type` or `length`.
- **Breaking_Change**: A Change whose `kind` is `removed`, `value`, `type` or `length`.
- **Additive_Change**: A Change whose `kind` is `added` and that is not part of a rename suspicion.
- **Compatible_List**: The list of Additive_Changes of a jar that are not in `changes`, rendered as "+N field" entries.
- **Ignored_List**: The list of pointers excluded from comparison because of the Volatile_Policy or the jar's `redacted` array.
- **Id_Key**: In an array that has at least one element and whose elements are all objects, a key that is present in every element, is `id` or ends in `_id`, and whose values are all strings or numbers that are unique by their string form (so 1 and "1" collide). If `id` qualifies, `id` is the Id_Key. Otherwise, if several `*_id` keys qualify, the Id_Key is the lowest of them in code-unit order, so that `booking_id` precedes `room_id`.
- **Rename_Suspicion**: A Change `added` that carries the note "suspected rename from <path> ×<factor>".
- **Jar_State**: One of `preserved`, `rattled`, `cracked`, `unsealed`, `skipped`.
- **Error_Result**: A `tools/call` result whose `isError` is true.
- **Error_Shaped**: A jarred `response` that is a JSON object whose only key is `error` and whose value is a string.
- **Hashed_Jar**: A Jar_Line that carries `response_length`, so that its `response_text` is `sha256:` followed by a hash and its `response` is null.
- **Orphan_Entry**: A valid Pending_Entry from the Pending_File whose `session_id` and `seq` equal those of no valid Jar_Line.
- **Quarantine_File**: `.specimen/quarantine.json`, with the content `{"v": 1, "items": [{"id", "session_id", "seq", "tool", "reason"}]}` where `id` is a string or null.
- **Compared_Jar**: A jar whose state is `preserved`, `rattled` or `cracked`.
- **Red_Jar**: A jar whose state is `rattled` or `cracked`.
- **Verdict**: `SHIP` or `HOLD`.
- **Coverage**: The object `{compared, tools_compared, tools_listed, tools_unrecorded}`.
- **Coverage_String**: The text "N jars compared · T of K tools · not recorded: …" built from the Coverage.
- **Result_Entry**: One element of `jars` in the Replay_Result, of the form `{id, session_id, seq, tool, state, input, response_text, changes, compatible, ignored, replayed_text, replayed, reason?, error?, ms}`. `changes` holds the Breaking_Changes, the Rename_Suspicion Changes and, in Strict_Mode only, the Additive_Changes. `compatible` holds the other Additive_Changes.
- **Replay_Result**: The JSON document written to `replays/<server>-<iso>.json`.
- **Bugfix_Spec**: A markdown file of the form `.kiro/specs/<name>/bugfix.md` that cites jar ids.
- **Heading**: A markdown heading line of level 1 to 6 whose text equals a given name.
- **Section**: The lines of a Bugfix_Spec from a Heading up to the next heading of the same or a higher level, or up to the end of the text. The three named Sections are "Current Behavior (Defect)", "Expected Behavior (Correct)" and "Unchanged Behavior (Regression Prevention)".
- **Whole_Token_Match**: A match of a jar id in a text that is neither preceded nor followed by an alphanumeric character or by `-`, so that `SPC-0004` does not match inside `SPC-00045`.
- **Marker_Pair**: The two lines `<!-- specimen:repro:start -->` and `<!-- specimen:repro:end -->`, in that order.
- **Repro_Block**: The single fenced code block with the info string `json specimen-repro` located between exactly one Marker_Pair of a Bugfix_Spec. The Marker_Pair may enclose other text, such as a human-readable diff table, which the Spec_Checker does not check.
- **Reference**: The deduplicated union of the Reference elements of all Changes of a jar, or the tool name for a cracked jar, derived by code as defined in Requirement 8.
- **Strict_Mode**: The mode switched on by `--strict`, in which an Additive_Change makes a jar rattled.
- **Test_Suite**: The vitest and fast-check tests under `packages/*/test/*.test.ts`.

## Requirements

### Requirement 1: Loading jars and driving the replay

**User Story:** As an MCP server author, I want every recorded session replayed in order against a fresh server, so that my new version is judged on the calls that agents really made.

#### Acceptance Criteria

1. WHEN the Replay_CLI starts, THE Replay_CLI SHALL read every file matching `jars/*.jsonl` under the Workspace_Root (or the directory given by `--jars`) in file name code-unit order, SHALL NOT read `jars/MANIFEST.sha256` as a jar, and SHALL pass the file texts to the Jar_Loader.
2. THE Jar_Loader SHALL return, for each file text, the valid Jar_Lines and a list of Spoiled_Lines that each carry the file name, the 1-based line number and the failing field or the reason.
3. IF a line is a Spoiled_Line, THEN THE Replay_Engine SHALL count it, SHALL report it in the `spoiled` field of the Replay_Result and in the text report ordered by file name and then line number, and SHALL NOT replay or skip it silently.
4. THE Replay_Engine SHALL group the valid Jar_Lines and the Orphan_Entries by `session_id` into Session_Groups, SHALL order the Session_Groups ascending by the lowest `seq` of each group with ties broken by `session_id` in code-unit order, and SHALL order the members of each group ascending by `seq`.
5. WHEN the Replay_Engine replays a Session_Group that holds at least one Replayable_Jar, THE Replay_Engine SHALL obtain a new client from the Client_Factory for that group, SHALL replay its Replayable_Jars in `seq` order on that client, and SHALL close that client when the group ends or fails, so that server state such as booking ids restarts for every session.
6. THE Replay_Engine SHALL call `tools/list` once per started Target_Server and SHALL keep the resulting list for the cracked decision and the Coverage.
7. WHEN the Replay_Engine replays a Jar_Line, THE Replay_Engine SHALL call the tool named by the `tool` field of that Jar_Line with the `input` of that Jar_Line as arguments.
8. THE Replay_Engine SHALL take the replayed text from the concatenation of the `text` items of the `content` array of the `tools/call` result, SHALL use the empty string when there is no `text` item, and SHALL keep both the jarred `response_text` and the replayed text in the Replay_Result.
9. WHEN the replayed text is a JSON_Response, THE Replay_Engine SHALL store the parsed value in `replayed`, and otherwise SHALL store null.
10. IF a connection attempt, a `tools/list` request or a `tools/call` request receives no answer within the per-call timeout (10,000 ms by default, set by `--timeout <ms>` and passed to the SDK request options), THEN THE Replay_Engine SHALL treat it as a protocol-level failure.
11. THE Replay_Engine SHALL contain no `node:` import and SHALL take the Client_Factory, the file texts, the policies, the Clock and the `started_at` value as arguments.
12. THE Replay_Engine SHALL use the real MCP SDK client and server on every judged path and SHALL use no mock of the MCP protocol.
13. THE Replay_Engine SHALL NOT write to any file under `jars/`.
14. IF a `tools/call` result is an Error_Result and the jarred `response` is not Error_Shaped, THEN THE Replay_Engine SHALL set the state to `cracked`, SHALL store the replayed error text in `error`, and SHALL NOT diff the Bodies.
15. WHEN a `tools/call` result is an Error_Result and the jarred `response` is Error_Shaped, or WHEN the result is not an Error_Result, THE Replay_Engine SHALL compare the replayed text with the jarred text like any other response.
16. IF a timeout, a transport error or a closed connection ends a call in a Session_Group, THEN THE Replay_Engine SHALL set every later Replayable_Jar of that group to `cracked` with the error "session aborted after <failure text>" and SHALL NOT call those tools, because later calls depend on earlier state.
17. WHEN the run ends and the Replay_Engine has started no Target_Server because no Replayable_Jar exists, THE Replay_Engine SHALL start one Target_Server only to call `tools/list`, so that the Coverage holds a real tool list, and IF that start or call fails, THEN THE Replay_Engine SHALL set `tools_listed` to an empty list.
18. THE Replay_CLI SHALL read the Pending_File under the Workspace_Root, SHALL treat a missing Pending_File as holding no Orphan_Entry, SHALL treat a Pending_File line that fails its zod schema as a Spoiled_Line with the file name `.specimen/pending.jsonl`, and SHALL NOT treat a valid Pending_Entry as an Orphan_Entry when a valid Jar_Line has the same `session_id` and `seq`.
19. WHEN a valid Jar_Line has an `id` equal to that of an earlier valid Jar_Line, or a `session_id` and `seq` equal to those of an earlier valid Jar_Line, THE Jar_Loader SHALL return it as a Spoiled_Line with the reason "duplicate id" or "duplicate seq" and the Replay_Engine SHALL NOT replay it, so that every `id` in the Replay_Result is unique.

### Requirement 2: Jar states

**User Story:** As an MCP server author, I want each jar to end in exactly one clear state, so that I can see which recorded calls are still safe.

#### Acceptance Criteria

1. THE Replay_Engine SHALL assign every valid Jar_Line and every Orphan_Entry exactly one Jar_State.
2. WHEN a jar was replayed and the Bodies are equal after normalisation, THE Replay_Engine SHALL set the state to `preserved`.
3. WHEN a jar was replayed and the diff holds only Additive_Changes, THE Replay_Engine SHALL set the state to `preserved` and SHALL list the Additive_Changes in the Compatible_List as "+N field", where N is the number of added paths.
4. WHERE Strict_Mode is on, WHEN the diff of a jar holds an Additive_Change, THE Replay_Engine SHALL set the state to `rattled`.
5. WHEN the diff of a jar holds at least one Breaking_Change, THE Replay_Engine SHALL set the state to `rattled`.
6. WHEN the diff of a jar holds a Rename_Suspicion, THE Replay_Engine SHALL treat the removed path of that rename as a Breaking_Change and SHALL set the state to `rattled`.
7. IF the `tool` of a Replayable_Jar is not in the `tools/list` of the Target_Server, THEN THE Replay_Engine SHALL set the state to `cracked`, SHALL NOT call the tool, and SHALL record the `reason` "tool not in tools/list".
8. IF a `tools/call` request fails at protocol level (a JSON-RPC error response, a transport error, a closed connection or the timeout of Requirement 1 criterion 10), or IF the result is an Error_Result under Requirement 1 criterion 14, THEN THE Replay_Engine SHALL set the state to `cracked` and SHALL record the failure text in `error`.
9. IF a Target_Server cannot be started, or connecting or `tools/list` fails or times out for a Session_Group, THEN THE Replay_Engine SHALL set every Replayable_Jar of that group to `cracked` with the failure text in `error`, and the jars of that group that are `skipped` or `unsealed` SHALL keep that state.
10. IF a Jar_Line has `unpaired` set to true, THEN THE Replay_Engine SHALL set the state to `unsealed` with the reason "unpaired post-event", SHALL NOT replay it and SHALL NOT compare it.
11. IF the Pending_File holds an Orphan_Entry, THEN THE Replay_Engine SHALL set one `unsealed` item for it with the reason "orphan pre-event", identified by `session_id` and `seq`, and SHALL NOT replay or compare it.
12. WHEN the Replay_CLI finishes loading, THE Replay_CLI SHALL write the Quarantine_File with one item for every unsealed jar and every Orphan_Entry, with `id` set to the jar id or to null for an Orphan_Entry, in the order of the Replay_Result, replacing the previous content, and SHALL write the Quarantine_File with an empty `items` list when there is no unsealed item.
13. IF the `tool` of a Jar_Line is not an Allowed_Tool and not a Watched_Tool, THEN THE Replay_Engine SHALL set the state to `skipped`, SHALL NOT call the tool, and SHALL count the jar as not replayed.
14. IF `.specimen/replay.json` is missing, THEN THE Replay_CLI SHALL treat `allow` and `watch` as empty lists, so that every jar is `skipped`.
15. IF `.specimen/replay.json`, `.specimen/volatile.json` or `.specimen/redact.json` exists and fails its strict zod schema, or IF a pattern of `.specimen/redact.json` is not a valid JavaScript regular expression source or matches the empty string (jar-capture Requirement 7 criteria 3 and 4), THEN THE Replay_CLI SHALL write a diagnostic naming the failing field or the failing pattern index to STDERR and SHALL exit with code 2, because replay output cannot be redacted safely.
16. IF `.specimen/volatile.json` is missing, THEN THE Replay_Engine SHALL apply the built-in default Volatile_Policy equal to the content of the shipped `.specimen/volatile.json`, and IF `.specimen/redact.json` is missing, THEN THE Replay_CLI SHALL apply the built-in default Redact_Config of jar-capture.
17. THE shipped `.specimen/volatile.json` SHALL list at least `/created_at` and `/bookings/*/created_at`.
18. WHILE a jar has a `redacted` array, THE Replay_Engine SHALL exclude every pointer of `redacted` that begins with `/response` from comparison on both Bodies (by removing the path after stripping the `/response` prefix) and SHALL add it to the Ignored_List.
19. WHEN the Replay_Engine excludes a path, THE Replay_Engine SHALL NOT report a Change at or below that path.
20. THE Replay_Engine SHALL NOT replay a jar whose state is `skipped` or `unsealed`.
21. WHEN a jar meets more than one state condition, THE Replay_Engine SHALL apply the first matching state in the order `unsealed`, `skipped`, `cracked`, then `preserved` or `rattled` by diff, so that a tool that is not allowed and not in `tools/list` is `skipped` and not `cracked`.
22. WHEN the jar is a Hashed_Jar and was replayed, THE Replay_Engine SHALL apply the jar-capture redaction in hash mode with the same Redact_Config to the replayed text, SHALL compute the `sha256:` text exactly as jar-capture Requirement 7 criterion 20 does, and SHALL set the state to `preserved` when it equals the jarred `response_text`, and otherwise to `rattled` with one `value` Change at `/response_text` whose `was` and `now` are the two `sha256:` texts.
23. WHEN the jar has `text_redacted` set to true and is not a Hashed_Jar, THE Replay_Engine SHALL apply the pattern redaction of jar-capture Requirement 7 criterion 18 to the replayed text before it compares the Bodies.
24. WHEN a tool is named in both `allow` and `watch`, THE Replay_Engine SHALL replay and compare its jars once, in the same way as for a tool named in one list.

### Requirement 3: Normalisation

**User Story:** As an MCP server author, I want volatile fields such as timestamps ignored, so that harmless run-to-run differences do not rattle a jar.

#### Acceptance Criteria

1. WHEN the Replay_Engine normalises a JSON Body, THE normalise function SHALL remove every value whose pointer matches a Pointer_Glob of the Volatile_Policy.
2. THE normalise function SHALL match a Pointer_Glob segment by segment, with `*` matching exactly one segment and every other segment matching only an equal segment after RFC 6901 unescaping.
3. WHEN a Pointer_Glob matches an array index segment, THE normalise function SHALL remove that element and SHALL reindex the remaining elements.
4. THE normalise function SHALL apply to both the jarred Body and the replayed Body, using the same Volatile_Policy.
5. WHEN the normalise function removes a path, THE Replay_Engine SHALL add the concrete pointers it removed to the Ignored_List.
6. IF a Pointer_Glob matches nothing in a Body, THEN THE normalise function SHALL leave that Body unchanged.
7. THE normalise function SHALL parse the jarred number literal `425.00` as the number 425, so that numbers are compared as numbers and not as text.
8. FOR ALL JSON values and Volatile_Policies, normalising twice SHALL produce the same value as normalising once (idempotence property).
9. FOR ALL JSON values, THE normalise function with an empty Volatile_Policy SHALL return a value deep-equal to the input (invariant property).
10. WHEN the Body is not JSON, THE normalise function SHALL return the text with line endings `\r\n` replaced by `\n` and with no other change.
11. WHEN the only Change between two Bodies lies at `/created_at` and the default Volatile_Policy is in force, THE Replay_Engine SHALL set the state `preserved`.

### Requirement 4: Structural diff

**User Story:** As an MCP server author, I want a field-by-field diff that names the exact path of each change, so that I know what my new version broke.

#### Acceptance Criteria

1. THE diff function SHALL take two normalised Bodies and SHALL return a list of Changes in code-unit order of `path`, and in `kind` order `removed`, `added`, `value`, `type`, `length` for equal paths.
2. WHEN a key exists in the jarred object and not in the replayed object, THE diff function SHALL return a Change of kind `removed` with `was` set to the jarred value.
3. WHEN a key exists in the replayed object and not in the jarred object, THE diff function SHALL return a Change of kind `added` with `now` set to the replayed value.
4. WHEN two scalar values at one path have the same JSON type and differ, THE diff function SHALL return a Change of kind `value` with `was` and `now`.
5. WHEN two values at one path have different JSON types, THE diff function SHALL return a Change of kind `type` with `was` and `now`, where the types are `null`, `boolean`, `number`, `string`, `array` and `object`, and SHALL NOT descend into either value.
6. WHEN two arrays at one path have different lengths, THE diff function SHALL return one Change of kind `length` at the path of the array with `was` and `now` set to the two lengths.
7. WHEN two arrays of objects each have an Id_Key and the Id_Key names are equal, or WHEN one of the two arrays is empty and the other has an Id_Key, THE diff function SHALL match elements by the string form of the value of that key, SHALL report an element missing from the replayed array as `removed` at the path `<array path>/<key value>`, SHALL report an extra element as `added` at the same form of path, with the key value escaped per RFC 6901, and SHALL diff matched elements field by field below that path.
8. WHEN two arrays of objects are matched by Id_Key and one array lost an element, THE diff function SHALL return both the `removed` Change of the element and one `length` Change of the array (for example `/rooms/r-08` removed together with `/rooms` length).
9. WHEN two arrays are not matched by Id_Key, including when both have an Id_Key with different names, THE diff function SHALL compare the elements present in both arrays index by index and SHALL report each Change at `<array path>/<index>`, SHALL report each element beyond the length of the shorter array as `removed` (jarred array longer) or `added` (replayed array longer) at `<array path>/<index>`, and SHALL report the `length` Change when the lengths differ.
10. THE diff function SHALL write every path as an RFC 6901 JSON pointer with `~` and `/` escaped.
11. WHEN the diff function sees a `removed` Change with a numeric `was` and an `added` Change with a numeric `now` as siblings under one parent path, where the key of the added path starts with the key of the removed path followed by `_`, and `now` equals `was` multiplied by 10^n for an integer n from 1 to 3, THE diff function SHALL add the note "suspected rename from <removed path> ×<10^n written out>" to the `added` Change, for example "suspected rename from /total ×100".
12. WHEN the Rename_Suspicion rule matches more than one candidate for one removed path, THE diff function SHALL choose the added path with the lowest n and then the lowest code-unit order, and SHALL annotate only that one.
13. WHEN a path holds the number 100 in the jarred Body and the string "100" in the replayed Body, THE diff function SHALL return one `type` Change at that path and SHALL NOT add a rename note.
14. IF a removed numeric path and an added numeric sibling path have different name stems (for example `total` and `tax_cents`), THEN THE diff function SHALL NOT add a rename note, even when `now` equals `was` multiplied by 10^n.
15. WHEN a Body is not JSON on either side, THE diff function SHALL compare the two texts as lists of lines split on `\n`, SHALL report each differing line as a `value` Change at the path `/line/<1-based line number>`, and SHALL report a difference in line count as one `length` Change at the path `/line`.
16. WHEN one Body is JSON and the other is not, THE diff function SHALL return one `type` Change at the path `` (the empty pointer, the whole Body).
17. FOR ALL JSON values, diffing a value against itself SHALL return an empty list (identity property).
18. FOR ALL JSON values, diffing the same two values twice SHALL return deep-equal lists (determinism property).
19. FOR ALL JSON objects a and b, every `removed` path of diff(a, b) SHALL be present in a and absent in b, and every `added` path SHALL be present in b and absent in a (invariant property).
20. THE diff function SHALL contain no clock, no randomness and no `node:` import.
21. IF a removed numeric path has an added sibling whose value is a string, THEN THE diff function SHALL NOT add a rename note to that added path, even when the name stem matches, because the added value is not numeric.
22. WHEN two arrays are matched by Id_Key and the keys present in both arrays appear in a different order, THE diff function SHALL return one `value` Change at the array path with `was` and `now` set to the two ordered lists of those keys.
23. THE diff function SHALL compute "`now` equals `was` multiplied by 10^n" in exact decimal arithmetic on the shortest decimal text of the two numbers and SHALL NOT use binary floating-point multiplication, so that `was` 4.35 and `now` 435 match with n equal to 2.
24. THE diff function SHALL process removed paths in code-unit order and SHALL annotate each added path with the note of at most one removed path.

### Requirement 5: Verdict

**User Story:** As an MCP server author, I want one deterministic SHIP or HOLD decision with a plain reason, so that a person or a gate can act on it.

#### Acceptance Criteria

1. THE verdict function SHALL take the list of Result_Entries, the number of Spoiled_Lines, the tools listed by the Target_Server and the filed jar ids, and SHALL return `{verdict, reason, red, filed, covered, coverage}`.
2. THE verdict function SHALL return `SHIP` if and only if at least one Compared_Jar exists, no jar is `rattled`, `cracked`, `unsealed` or `skipped`, and the number of Spoiled_Lines is 0.
3. IF the list of Result_Entries is empty and the number of Spoiled_Lines is 0, THEN THE verdict function SHALL return `HOLD` with the reason part "no jars", and the part "no jars" SHALL be present in the reason only in that case.
4. IF at least one jar is `rattled` or `cracked`, THEN THE verdict function SHALL return `HOLD` and SHALL include in the reason a part of the form "<n> rattled", "<n> cracked" or "<n> rattled, <m> cracked", listing a state only when its count is greater than 0.
5. IF at least one jar is `skipped`, THEN THE verdict function SHALL return `HOLD` and SHALL include in the reason "N not replayed: not in replay.json — allow <tool list> in .specimen/replay.json to replay them against your disposable test instance", where `<tool list>` holds the distinct skipped tools in code-unit order separated by ", ".
6. IF at least one item is `unsealed`, THEN THE verdict function SHALL return `HOLD` and SHALL include one part "N quarantined: <reason> — re-record the session" for each distinct reason that occurs, where `<reason>` is "orphan pre-event" or "unpaired post-event", N counts the items with that reason, and the part for "orphan pre-event" precedes the part for "unpaired post-event".
7. IF the number of Spoiled_Lines is at least 1, THEN THE verdict function SHALL return `HOLD` and SHALL include in the reason "N spoiled line" or "N spoiled lines".
8. WHEN more than one HOLD condition applies, THE verdict function SHALL join the reason parts with "; " in the order: no jars, red, not replayed, quarantined, spoiled.
9. THE verdict function SHALL set `red` to the number of jars that are `rattled` or `cracked`.
10. THE verdict function SHALL set `filed` to the number of Red_Jars whose `id` is in the filed jar ids.
11. THE verdict function SHALL set `covered` to true if and only if the Verdict is `HOLD`, at least one Compared_Jar exists, `red` is greater than 0, `filed` equals `red`, and no jar is `unsealed` or `skipped`, and the number of Spoiled_Lines is 0.
12. WHERE `covered` is true, THE reason SHALL be unchanged and THE Replay_CLI SHALL show the covered flag in the first line of the report as defined in Requirement 10 criterion 8.
13. THE verdict function SHALL set `coverage.compared` to the number of Compared_Jars, `coverage.tools_compared` to the distinct tools of the Compared_Jars that are in `coverage.tools_listed`, `coverage.tools_listed` to the tools of `tools/list` of the first Target_Server whose `tools/list` succeeded in Session_Group order, and `coverage.tools_unrecorded` to the listed tools that no valid Jar_Line names, each list in code-unit order.
14. THE Coverage_String SHALL read "N jars compared · T of K tools · not recorded: a, b", where N is `coverage.compared`, T is the number of `tools_compared`, K is the number of `tools_listed`, and the part after "not recorded: " lists `tools_unrecorded` or reads "none" when the list is empty. WHERE N is 1, the string SHALL read "1 jar compared".
15. WHEN the verdict is `SHIP`, THE Replay_CLI SHALL render the text "replay clean on the recorded set" next to the verdict and SHALL NOT render any text that states or implies the server is safe.
16. FOR ALL inputs, THE verdict function SHALL return `SHIP` only under the rule of criterion 2 (property over generated jar states, spoiled counts and tool lists).
17. FOR ALL inputs, THE verdict function SHALL return the same result when called twice with the same arguments (determinism property).
18. THE verdict function SHALL contain no clock, no randomness, no network access and no `node:` import.
19. THE Replay_CLI, THE Agent Stop gate and THE browser cabinet SHALL obtain the Verdict only from this verdict function.

### Requirement 6: Replay result

**User Story:** As an MCP server author, I want a complete, reproducible replay record, so that I can inspect both bodies of every call and share the result.

#### Acceptance Criteria

1. THE Replay_Result SHALL be a JSON object `{v, server, started_at, strict, jars, spoiled, counts, schema_diff, verdict, red, filed, covered, reason, coverage}` with `v` equal to 1, `strict` set to true when Strict_Mode was on and to false otherwise, and `spoiled` holding a list of `{file, line, reason}` objects, one per Spoiled_Line, ordered by file name and then line number.
2. THE Replay_Result SHALL hold in `jars` one Result_Entry per valid Jar_Line and per Orphan_Entry, in the order of the replay (Session_Groups, then `seq`, with `skipped` and `unsealed` entries placed in the position their `seq` gives), where `id` is null for an Orphan_Entry, `tool` holds the `tool_id` of the Pending_Entry for an Orphan_Entry, `input` and `response_text` are null for an Orphan_Entry, `input` and `response_text` are copied from the Jar_Line otherwise (already redacted at capture), `reason` holds the fixed reason text of an unsealed, skipped or tool-missing cracked jar, and `replayed_text` and `replayed` are null when the call got no answer or was not made.
3. THE Replay_Result SHALL set `counts` to `{preserved, rattled, cracked, unsealed, skipped}` as the number of entries in each state.
4. THE Replay_Result SHALL set `ms` to the elapsed milliseconds measured through the Clock for the call and SHALL set it to 0 for a jar that was not replayed.
5. THE Replay_Result SHALL set `started_at` to a UTC time in the form `YYYY-MM-DDTHH:mm:ss.sssZ` passed in by `packages/cli`, and SHALL set `server` to the server label derived from the `--server` command.
6. WHEN a `--baseline` server is given, THE Replay_Engine SHALL start the Baseline_Server and the Target_Server once each for `tools/list` and SHALL set `schema_diff` to `{tools_removed, tools_added, input_schema_changed}`, where the first two lists hold tool names in code-unit order and `input_schema_changed` holds the names of tools present in both whose `inputSchema` differ after canonical normalisation.
7. WHERE no `--baseline` is given, THE Replay_Engine SHALL set `schema_diff` to `{tools_removed: [], tools_added: [], input_schema_changed: []}`.
8. WHEN the Replay_Engine builds the Replay_Result, THE Replay_Engine SHALL apply the Redact_Config of jar-capture (the same redaction function) to every replayed text, every `replayed` value, every string inside `was` and `now` of every Change and every `error` before anything is written, SHALL replace `was` and `now` with the Redaction_Marker where a segment of the Change path equals an entry in `keys` of the Redact_Config, and SHALL store the redacted form in the Replay_Result.
9. WHEN the Replay_Engine redacts a replayed body, THE Replay_Engine SHALL compare the Bodies before redaction, except for the Hashed_Jar and `text_redacted` cases of Requirement 2 criteria 22 and 23, and SHALL NOT write any unredacted replayed body, Change value or error text to the Replay_Result, to STDOUT, to STDERR or to any file.
10. THE Replay_CLI SHALL write the Replay_Result to `replays/<server>-<iso>.json`, where `<server>` is the server label restricted to `[A-Za-z0-9._-]` with every other character replaced by `-`, and `<iso>` is `started_at` with `:` replaced by `-`, creating `replays/` if it does not exist.
11. WHERE `--out <file>` is given, THE Replay_CLI SHALL write the Replay_Result to that file instead of the default path.
12. THE Replay_CLI SHALL write the Replay_Result as pretty-printed JSON with a terminating newline.
13. THE Replay_Result schema SHALL be a zod schema in `packages/core`, and the Replay_CLI SHALL validate the Replay_Result with it before writing.
14. FOR ALL valid Replay_Results, serialising to JSON then parsing with the Replay_Result schema SHALL produce an object deep-equal to the original (round-trip property).
15. WHEN the Replay_CLI reads a Replay_Result from disk, THE Replay_CLI SHALL parse it with the Replay_Result schema and SHALL report a failing field on a failure.
16. THE Replay_Result SHALL be reproducible: FOR ALL pairs of runs with the same jars, the same policies, the same Target_Server behaviour and the same passed-in time values, the Replay_Results SHALL be equal.
17. THE Replay_Engine SHALL NOT let `schema_diff` change any jar state or the Verdict.

### Requirement 7: Bugfix spec check

**User Story:** As an MCP server author, I want a filed bugfix spec to count only when it is complete and quotes the real evidence, so that "filed" means the break was properly written up.

#### Acceptance Criteria

1. THE Spec_Checker SHALL take the text of a Bugfix_Spec, a jar id and the `jars` entries of a Replay_Result, SHALL NOT read the fields `verdict`, `red`, `filed`, `covered` or `reason` of the Replay_Result, and SHALL return `pass` or a list of failures that each carry a code and a message.
2. WHEN the Bugfix_Spec text lacks a Heading "Current Behavior (Defect)", "Expected Behavior (Correct)" or "Unchanged Behavior (Regression Prevention)", THE Spec_Checker SHALL fail with the code `headings` and SHALL name the missing heading, and each check that depends on the missing Section SHALL also fail with its own code.
3. WHEN no line inside the Section "Current Behavior (Defect)" matches `WHEN` followed by `THEN the system`, THE Spec_Checker SHALL fail with the code `when_then`.
4. WHEN no line inside the Section "Expected Behavior (Correct)" contains `SHALL` that is not followed by ` CONTINUE TO`, THE Spec_Checker SHALL fail with the code `shall`.
5. WHEN no line inside the Section "Unchanged Behavior (Regression Prevention)" contains `SHALL CONTINUE TO`, THE Spec_Checker SHALL fail with the code `shall_continue`.
6. WHEN the Bugfix_Spec text has no Whole_Token_Match of the accession id of the jar, THE Spec_Checker SHALL fail with the code `jar_id` and SHALL name the id.
7. IF the Bugfix_Spec has no Marker_Pair, more than one Marker_Pair, no fenced `json specimen-repro` block between the Marker_Pair, more than one such block there, a Repro_Block that is not valid JSON, or a Repro_Block that fails its zod schema, THEN THE Spec_Checker SHALL fail with the code `repro_missing`.
8. THE Repro_Block SHALL be a JSON array with one entry per jar the spec covers, each of the form `{id, input, response_text, replayed, changed_paths}`.
9. WHEN the Repro_Block holds no entry for the jar id, THE Spec_Checker SHALL fail with the code `repro_missing`.
10. WHEN the entry for the jar differs from the Result_Entry of the jar after canonical normalisation, where `changed_paths` is the list of the `path` values of `changes` of the Result_Entry in order, THE Spec_Checker SHALL fail with the code `repro_not_verbatim` and SHALL name the differing field. The comparison SHALL treat `input`, `replayed` and `changed_paths` by Canonical_JSON equality, and SHALL compare `response_text` by Canonical_JSON equality when the text is a JSON_Response and by exact string equality otherwise.
11. WHEN the entry for the jar differs from the Result_Entry only in object key order or in whitespace between JSON tokens of the Repro_Block, THE Spec_Checker SHALL NOT fail the repro check.
12. WHEN the Section "Current Behavior (Defect)" does not contain every changed path of the jar, THE Spec_Checker SHALL fail with the code `paths` and SHALL list each missing path.
13. WHEN the Section "Unchanged Behavior (Regression Prevention)" holds no Whole_Token_Match of the id of a `preserved` Result_Entry with the same `tool` as the checked jar, and the Replay_Result holds such a preserved entry, THE Spec_Checker SHALL fail with the code `unchanged_jar`, and WHEN the Replay_Result holds no preserved entry of that tool and the Section holds no line with the text "no preserved jar", THE Spec_Checker SHALL also fail with the code `unchanged_jar`.
14. WHEN the Section "Expected Behavior (Correct)" does not name the Reference of the jar (Requirement 8), THE Spec_Checker SHALL fail with the code `expected_reference`, with the message "expected does not name the reference".
15. WHEN the Spec_Checker finds no failure, THE Spec_Checker SHALL return `pass`.
16. THE Spec_Checker SHALL return every failure it finds and not only the first, except in the cases of criteria 18 and 19.
17. THE Spec_Checker SHALL contain no `node:` import and no clock.
18. IF the state of the checked jar is not `rattled` and not `cracked`, THEN THE Spec_Checker SHALL return the single failure `not_red` with the message "jar is not rattled or cracked", whatever the Sections contain.
19. IF the id is absent from the `jars` entries, THEN THE Spec_Checker SHALL return the single failure `jar_unknown` naming the id.

### Requirement 8: Reference by code

**User Story:** As an MCP server author, I want the bugfix spec to name the recorded fact that must hold again, so that Kiro fixes the defect against the evidence and not a guess.

#### Acceptance Criteria

1. THE Spec_Checker SHALL derive the Reference from the Result_Entry of the jar (its `changes`, `state`, `tool`, `response_text`), which the repro check ties to the Repro_Block, and SHALL NOT derive it from the prose of the Bugfix_Spec.
2. WHEN the jar has a `value` or `type` Change at a non-empty path, THE Reference SHALL include the Change path together with the literal text of the jarred value taken from `response_text` as a Value_Span, for example `/total 425.00`.
3. WHEN the jar has a `removed` Change that is not directly under an array path covered by criterion 4, THE Reference SHALL include the Change path together with the literal text of the jarred value taken from `response_text`.
4. WHEN the jar has a `length` Change and `removed` Changes directly under the path of that array, THE Reference SHALL include the last path segment of each such removed Change, for example `r-08` and `r-09`, and SHALL NOT include the path and the literal of those removed Changes.
5. WHEN the jar is `cracked` because the tool is missing from `tools/list`, THE Reference SHALL be the tool name.
6. WHEN the jar is `cracked` because of a protocol-level failure or because the call returned an Error_Result, and the tool is listed, THE Reference SHALL be the tool name, and the `error` text of the Result_Entry SHALL NOT be part of the Reference.
7. THE Spec_Checker SHALL accept the Section "Expected Behavior (Correct)" when it contains every element of the Reference as a substring, and SHALL accept the literal `425.00` and no other rendering of that number.
8. WHEN a Reference element is a path and a literal, THE Spec_Checker SHALL require both the path and the literal in the Section "Expected Behavior (Correct)".
9. WHEN the jar has more than one Reference element (for example `r-08` and `r-09`), THE Spec_Checker SHALL require every element, and the Reference SHALL be the deduplicated union of the elements of all Changes of the jar.
10. THE Spec_Checker SHALL locate the Section "Expected Behavior (Correct)" as defined for Section in the Glossary.
11. THE Spec_Checker SHALL use these further Reference elements: for an `added` Change (Strict_Mode) the path; for a `length` Change with no removed element under the array path the path; for a `value` Change at `/line/<n>` of a non-JSON Body the path together with the jarred line text; for a `type` Change at the depth limit the path; for a `type` Change at the empty path the tool name; and for the `value` Change at `/response_text` of a Hashed_Jar the path `/response_text` together with the jarred `sha256:` text.
12. WHEN the Spec_Checker locates the Value_Span of a Change whose path goes through an array of the jarred response that has an Id_Key, THE Spec_Checker SHALL resolve a path segment under that array as the element whose Id_Key value, in string form, equals the segment.

### Requirement 9: Filed and covered

**User Story:** As an MCP server author, I want the verdict to show how many broken jars already have a valid bugfix spec, so that I can tell "broken and written up" from "broken and unknown".

#### Acceptance Criteria

1. WHEN the Replay_CLI computes `filed`, THE Replay_CLI SHALL read every Bugfix_Spec under `.kiro/specs/*/bugfix.md`, SHALL pass the texts and the `jars` entries to the Spec_Checker for each Red_Jar whose id has a Whole_Token_Match in that text, and SHALL do so before it calls the verdict function.
2. THE Replay_CLI SHALL pass to the verdict function, as filed jar ids, exactly the ids of the Red_Jars for which at least one Bugfix_Spec returns `pass`.
3. IF a Red_Jar id is cited by no Bugfix_Spec or only by Bugfix_Specs that fail the Spec_Checker, THEN THE Replay_CLI SHALL NOT include that id in the filed jar ids.
4. WHEN `covered` is false and `red` is greater than `filed`, THE Replay_CLI SHALL list in the text report the ids of the Red_Jars that are not filed.
5. WHEN a Bugfix_Spec cites several jar ids and fails the check for one of them, THE Replay_CLI SHALL count as filed only the ids for which it passes.
6. THE Replay_CLI SHALL NOT modify any Bugfix_Spec.

### Requirement 10: Replay command

**User Story:** As an MCP server author, I want one command that replays my jars against a changed server and reports the result with a clear exit code, so that I can use it by hand and in automation.

#### Acceptance Criteria

1. THE Replay_CLI SHALL accept `specimen replay --server "<cmd>" [--jars <dir>] [--baseline "<cmd>"] [--strict] [--json] [--out <file>] [--timeout <ms>]`.
2. THE Replay_CLI SHALL take the Target_Server command only from `--server`, and SHALL NOT infer it from `.kiro/settings/mcp.json`, from the jars or from the environment.
3. THE Replay_CLI SHALL split the `--server` and `--baseline` commands into an executable and arguments by whitespace, honouring single and double quotes, SHALL start each through `StdioClientTransport` without a shell, with its STDERR piped and discarded (never forwarded to STDOUT, STDERR or any file), with the Workspace_Root as working directory, and with the SDK default environment.
4. IF `--server` is missing or empty, or an option is unknown, or `--timeout` is not a positive integer, or a quote in `--server` or `--baseline` is unterminated, THEN THE Replay_CLI SHALL write a usage message to STDERR and SHALL exit with code 2.
5. WHEN the Verdict is `SHIP`, THE Replay_CLI SHALL exit with code 0.
6. WHEN the Verdict is `HOLD` and `covered` is false, THE Replay_CLI SHALL exit with code 1.
7. WHEN the Verdict is `HOLD` and `covered` is true, THE Replay_CLI SHALL exit with code 3.
8. THE Replay_CLI SHALL write as the first line of the text report `SHIP · replay clean on the recorded set · <Coverage_String>` for a SHIP, `HOLD · <reason> · <Coverage_String>` for a HOLD with `covered` false, and `HOLD · covered · <reason> · <Coverage_String>` for a HOLD with `covered` true.
9. THE Replay_CLI SHALL write after the first line one line per jar of the form `<id> · <tool> · <state> · <changed paths> · <note>`, in the order of the Replay_Result, where `<id>` is `<session_id>#<seq>` for an Orphan_Entry, `<changed paths>` lists the paths of the Changes joined by ", " (or "-" when empty) and `<note>` holds the rename note, the "+N field" compatible text, the reason of an unsealed or skipped jar, or the error text of a cracked jar (or "-" when none applies), and SHALL write after the jar lines one line `spoiled · <file>:<line> · <reason>` per Spoiled_Line.
10. WHEN a Rename_Suspicion exists in a jar, THE Replay_CLI SHALL show its note in the `<note>` position of that jar line.
11. WHERE `--json` is given, THE Replay_CLI SHALL write the Replay_Result to STDOUT as JSON and SHALL write no text report to STDOUT.
12. THE Replay_CLI SHALL write the Replay_Result file in every run that reaches a verdict, including HOLD runs.
13. WHEN the Replay_CLI finishes, THE Replay_CLI SHALL close every client and every server process it started, and SHALL leave no child process running.
14. THE Replay_CLI SHALL NOT write any file other than the Replay_Result, the Quarantine_File and (when asked) the `--out` file.
15. THE Replay_CLI SHALL make no network call and SHALL use no font or CDN resource.
16. IF an existing `jars/` directory is unreadable, or another operational error occurs, THEN THE Replay_CLI SHALL write the error to STDERR and SHALL exit with code 2, and WHEN the `jars/` directory is missing, THE Replay_CLI SHALL treat it as empty, so that the verdict is HOLD with "no jars".
17. WHERE the `--baseline` command is given, THE Replay_CLI SHALL start it only to read `tools/list` and SHALL NOT replay any jar against it.
18. THE Replay_CLI SHALL resolve `jars/`, `.specimen/`, `replays/` and `.kiro/specs` against the Workspace_Root.
19. IF the Baseline_Server cannot start or its `tools/list` fails, THEN THE Replay_CLI SHALL write a diagnostic to STDERR, SHALL write no Replay_Result, and SHALL exit with code 2.

### Requirement 11: Check-spec command

**User Story:** As an MCP server author, I want to run the bugfix spec check myself, so that I can see why a spec does not count as filed.

#### Acceptance Criteria

1. THE Check_Spec_Command SHALL accept `specimen check-spec <bugfix.md> --jar <id> [--replay <file>]`.
2. WHERE `--replay` is not given, THE Check_Spec_Command SHALL use the file in `replays/` whose name matches `<server>-<iso>.json` and has the greatest `<iso>` suffix (the 24 characters before `.json`, in the form `YYYY-MM-DDTHH-mm-ss.sssZ`), SHALL break ties by the greatest whole name in code-unit order, and SHALL ignore files that do not match the pattern.
3. WHEN the Spec_Checker returns `pass`, THE Check_Spec_Command SHALL write "PASS <id>" to STDOUT and SHALL exit with code 0.
4. WHEN the Spec_Checker returns failures, THE Check_Spec_Command SHALL write one line per failure of the form `FAIL <code>: <message>` to STDOUT and SHALL exit with code 1.
5. IF `<bugfix.md>` or the Replay_Result is missing, unreadable or fails its zod schema, or `--jar` is missing or names an id absent from the Replay_Result, or no file in `replays/` matches the pattern of criterion 2, THEN THE Check_Spec_Command SHALL write a diagnostic to STDERR and SHALL exit with code 2.
6. THE Check_Spec_Command SHALL NOT modify the Bugfix_Spec.
7. THE Check_Spec_Command SHALL NOT write any file.

### Requirement 12: Boundaries and determinism

**User Story:** As a maintainer, I want the judging code to follow the repository rules, so that the cabinet can bundle it and every result is reproducible.

#### Acceptance Criteria

1. THE modules `replay.ts`, `normalize.ts`, `diff.ts`, `verdict.ts` and `spec-check.ts` in `packages/core`, and every module of `packages/core` that these five import, SHALL contain no `node:` import.
2. THE judging code (normalise, diff, state assignment, verdict, Spec_Checker) SHALL read no clock, use no randomness and make no network call, and the replay loop SHALL measure time only through the Clock argument.
3. THE `packages/cli` replay and check-spec commands SHALL perform all file, process, STDIN, STDOUT, STDERR and clock access and SHALL pass the results to `packages/core` functions.
4. THE Replay_Engine SHALL parse every external input (jar lines, Pending_File lines, `.specimen/replay.json`, `.specimen/volatile.json`, `.specimen/redact.json`, Replay_Results, the Repro_Block) with a zod schema before using it.
5. THE Replay_Engine SHALL NOT write to any path under `jars/`.
6. THE Replay_Engine SHALL define its public functions so that the Client_Factory is the only transport-dependent argument, so that the browser cabinet can pass an `InMemoryTransport` client and the CLI can pass a `StdioClientTransport` client without any other change.
7. THE Replay_Engine SHALL document in its Replay_Result and its report text that `SHIP` means "replay clean on the recorded set".
8. THE Replay_Engine SHALL treat object keys named `__proto__` and `constructor` as ordinary keys in the normalise and diff functions.
9. THE Replay_Engine SHALL traverse JSON values with an explicit stack or with a depth limit of 1,000, and SHALL set the state of a jar whose Bodies exceed that depth to `rattled` with a Change of kind `type` at the path where the limit was reached, carrying the note "depth limit 1000".

### Requirement 13: Tests

**User Story:** As a maintainer, I want automated tests and fixture evaluations for replay, so that a regression in judging is caught before it gives a wrong verdict.

#### Acceptance Criteria

1. THE Test_Suite SHALL run under `npm test` at the repository root with vitest, and SHALL use fast-check where a property applies.
2. THE Test_Suite SHALL include fast-check properties that diffing a value against itself returns an empty list, that normalisation is idempotent, and that the verdict is `SHIP` only under the rule of Requirement 5 criterion 2.
3. THE Test_Suite SHALL include the negative fixtures that 100 versus "100" at the same path yields a `type` Change and no rename note, that a removed numeric path with an added string sibling of the same stem yields no rename note, and that an unrelated removed and added pair with different stems whose values differ by ×10^n yields no rename note.
4. THE Test_Suite SHALL include a unit test that `"total":425.00` in a jarred text is compared as the number 425 against a replayed `425`, and yields no Change.
5. THE Test_Suite SHALL include a unit test that a dropped element of an array of objects with an Id_Key is reported by its key together with one `length` Change.
6. THE Test_Suite SHALL include fixture eval E3b: three `rattled` quote jars and one fixture Bugfix_Spec that lists all three ids and passes the Spec_Checker produce HOLD with `covered` true; and a spec that omits one id produces `covered` false and the report names the missing id.
7. THE Test_Suite SHALL include fixture eval E3c: an empty jar set with no Spoiled_Line produces HOLD with the reason "no jars".
8. THE Test_Suite SHALL include fixture eval E3d: a jar set where every tool is not allowed produces HOLD with the reason "N not replayed" and the allow hint of Requirement 5 criterion 5 and without the part "no jars", and a jar set with one skipped jar among otherwise preserved jars produces HOLD with the reason "1 not replayed".
9. THE Test_Suite SHALL include fixture eval E3e: one Orphan_Entry produces HOLD with "1 quarantined: orphan pre-event", one Spoiled_Line produces HOLD with "1 spoiled line", and every verdict line of E3b to E3e carries the Coverage_String.
10. THE Test_Suite SHALL include fixture eval E4: a spec with a missing Repro_Block fails with `repro_missing`, a spec with an edited value in the Repro_Block fails with `repro_not_verbatim`, a spec with reordered keys in the Repro_Block passes the repro check, and a spec whose Expected Behavior does not name the Reference fails with `expected_reference`.
11. THE Test_Suite SHALL include fixture eval E6: a diff only on `/created_at` with the default Volatile_Policy yields `preserved`.
12. THE Test_Suite SHALL include an end-to-end test with real child processes and the real MCP SDK that copies the repository jars into a temporary workspace together with a `replay.json` that allows all six hollow-inn tools, replays them against `servers/hollow-inn` v1, and finds every jar `preserved`, without touching the repository `jars/` directory.
13. THE Test_Suite SHALL include an end-to-end test, in the same temporary workspace, that replays the same jars against hollow-inn v2 and finds the quote jar `rattled` with the note "suspected rename from /total ×100", the `search_rooms` jar with `guests` 3 and no `limit` `rattled` with `/rooms/r-08` and `/rooms/r-09` reported as `removed` and one `length` Change, and the `cancel_booking` jar `cracked` with the reason "tool not in tools/list", and WHEN the repository jars hold no such call, THE test SHALL create the needed jar as a fixture in the temporary directory.
14. THE Test_Suite SHALL include a test that the Replay_CLI exits with 0 on SHIP, 1 on HOLD, 3 on HOLD with `covered` true, and 2 on a usage error.
15. THE Test_Suite SHALL include a test that the first line of the text report has the exact form of Requirement 10 criterion 8, and that each following line holds the fields of Requirement 10 criterion 9, including `<session_id>#<seq>` for an Orphan_Entry and the `spoiled` lines.
16. THE Test_Suite SHALL include a test that the Replay_Result round-trips through its zod schema.
17. THE Test_Suite SHALL include a test that a secret present in a replayed response is redacted in `replayed_text` and `replayed` of the written Replay_Result, in the `now` of a Change, and in `error`.
18. THE Test_Suite SHALL include a test that the Replay_CLI takes the server command only from `--server`, by running with a `.kiro/settings/mcp.json` that names a different server.
19. THE Test_Suite SHALL include a test that the modules named in Requirement 12 criterion 1, including every `packages/core` module they import, contain no `node:` import.
20. THE Test_Suite SHALL write replay results, quarantine files and jars only under a temporary directory and SHALL NOT modify files in the repository `jars/` directory.
21. THE Test_Suite SHALL include a test that every Session_Group is replayed on a fresh server, by replaying two sessions that each create a booking and finding that both bookings receive the first booking id.
22. THE Test_Suite SHALL include a test of the state precedence of Requirement 2 criterion 21, in which an unpaired jar, a non-allowed tool that is absent from `tools/list`, and an allowed tool that is absent from `tools/list` end as `unsealed`, `skipped` and `cracked`.
23. THE Test_Suite SHALL include a test that an Error_Result against a jarred non-error response yields `cracked` with the redacted error text and no diff, and that an Error_Result against an Error_Shaped jarred response is compared by diff.
24. THE Test_Suite SHALL include a test that after a transport failure in one Session_Group the later Replayable_Jars of that group are `cracked` with "session aborted after <failure text>" and are not called, and that a timeout while connecting makes the Replayable_Jars of the group `cracked`.
25. THE Test_Suite SHALL include tests that a Hashed_Jar is `preserved` for an equal replayed text and `rattled` with one `value` Change at `/response_text` for a different one, and that a `text_redacted` jar is compared after pattern redaction of the replayed text.
26. THE Test_Suite SHALL include a test that a secret written by the server to STDERR appears in no STDOUT, STDERR or written file of the Replay_CLI.
27. THE Test_Suite SHALL include tests that a duplicate `id` and a duplicate `session_id` with `seq` yield Spoiled_Lines and are not replayed, and that an invalid Pending_File line yields a Spoiled_Line.
28. THE Test_Suite SHALL include a test that a reordered Id_Key-matched array yields one `value` Change with the two key lists, and tests of the Id_Key rules (string-form collision, lowest `*_id` key, different key names falling back to index by index, an empty array on one side).
29. THE Test_Suite SHALL include a test that the rename rule uses exact decimal arithmetic, with `was` 4.35 and `now` 435 yielding the note with ×100.
30. THE Test_Suite SHALL include a test that the Check_Spec_Command without `--replay` selects the replay file with the greatest `<iso>` suffix, ignores a non-matching file, and exits with 2 when no file matches.
31. THE Test_Suite SHALL include tests of `repro_missing` for no Marker_Pair, two Marker_Pairs, no fenced block, two fenced blocks and invalid JSON.
32. THE Test_Suite SHALL include tests that a checked jar that is `preserved` yields the single failure `not_red`, and that an unknown id yields the single failure `jar_unknown`.
33. THE Test_Suite SHALL include tests that the keyword checks `when_then`, `shall` and `shall_continue` count only lines inside their own Section, that `paths` requires the changed paths inside "Current Behavior (Defect)", that `SPC-0004` does not match inside `SPC-00045`, and that `unchanged_jar` accepts the line "no preserved jar" only when the Replay_Result holds no preserved jar of the tool.
34. THE Test_Suite SHALL include tests that the Spec_Checker returns the same result when the `verdict`, `red`, `filed`, `covered` and `reason` fields of its Replay_Result input change.
35. THE Test_Suite SHALL include tests that the Replay_CLI exits with 2 for an unterminated quote in `--server` and for an invalid `.specimen/redact.json`, and that it writes the Quarantine_File with an empty `items` list when no jar is unsealed.
36. THE Test_Suite SHALL include a test that a failing `--baseline` command exits with 2 and writes no Replay_Result, and that a working `--baseline` changes no jar state and not the Verdict.
37. THE Test_Suite SHALL include a test that a run with no Replayable_Jar starts one Target_Server only to call `tools/list`, so that `tools_listed` holds the real tool names.
