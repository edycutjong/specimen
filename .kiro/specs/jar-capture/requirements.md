# Requirements Document

## Introduction

Jar capture records the MCP tool calls a Kiro agent makes against a configured MCP server into a "jar": an append-only JSONL file of real recorded calls that is later replayed against a new server version. No proxy sits between Kiro and the server. Kiro's own PreToolUse and PostToolUse shell hooks are the only capture point. The hooks run the `specimen hook` commands, which pair each pre event with its post event and write one jar line per call.

The jar line schema and the pure logic (canonical hashing, pairing, redaction, server resolution, firewall decision, manifest) live in `packages/core` as TypeScript with no `node:` imports. File and STDIN access live in `packages/cli`. All external input (hook payloads, jar lines, pending entries, config files) is parsed with zod at the boundary. Judging code stays deterministic. Timestamps are stamped only by the hook processes, never by core judging code.

## Glossary

- **Jar**: An append-only file `jars/<session_id>.jsonl` holding one Jar_Line per recorded call.
- **Jar_Line**: One JSON object on one line of a Jar, in format "specimen v1".
- **Jar_Schema**: The zod schema in `packages/core` that validates a Jar_Line.
- **Capture_Hook**: The `specimen hook pre` and `specimen hook post` commands.
- **Pre_Hook**: The `specimen hook pre` command, run by Kiro on PreToolUse.
- **Post_Hook**: The `specimen hook post` command, run by Kiro on PostToolUse.
- **Firewall_Hook**: The `specimen hook firewall` command, run by Kiro on PreToolUse with matcher `write`.
- **Pre_Payload**: The JSON object Kiro writes to STDIN on PreToolUse: `{session_id, hook_event_name, cwd, tool_name, tool_input}`.
- **Post_Payload**: The JSON object Kiro writes to STDIN on PostToolUse: the Pre_Payload fields plus `tool_response`, a string.
- **Pending_File**: `.specimen/pending.jsonl`, holding Pending_Entries.
- **Pending_Entry**: A JSON object `{session_id, seq, tool_id, input_sha256, t0}` in the Pending_File.
- **Orphan**: A Pending_Entry that no Post_Payload ever paired with.
- **Unpaired_Post**: A Jar_Line written for a Post_Payload that matched no Pending_Entry.
- **Canonical_JSON**: The JSON text of a parsed value with object keys sorted recursively and no whitespace.
- **Input_Hash**: The lowercase hex SHA-256 of the Canonical_JSON of `tool_input`.
- **Accession_ID**: An identifier of the form `SPC-` followed by a zero-padded counter, such as `SPC-0001`.
- **Counter_File**: `.specimen/counter`, holding the last assigned Accession_ID number.
- **Server_Key**: A key of the `mcpServers` object in `.kiro/settings/mcp.json`.
- **Tool_ID**: The raw `tool_name` that Kiro reported, such as `mcp_hollowinn_quote`.
- **Tool_Name**: The Tool_ID without the `mcp_<Server_Key>_` prefix.
- **Redact_Config**: The zod-validated content of `.specimen/redact.json`: `{"keys": string[], "patterns": string[], "text": "redact" | "hash"}`.
- **Redaction_Marker**: The string `[REDACTED]`.
- **Value_Span**: The exact character range of one JSON value inside raw JSON text.
- **Hook_Log**: `.specimen/hook.log`, the diagnostics file for all hook commands.
- **Manifest**: `jars/MANIFEST.sha256`, a file in `sha256sum` format listing the SHA-256 of every file in `jars/` except the Manifest itself.
- **Manifest_Command**: The `specimen manifest write` and `specimen manifest check` commands.
- **Hook_File**: A JSON file in `.kiro/hooks/` of shape `{"version":"v1","hooks":[{"name","trigger","matcher","action":{"type":"command","command"}}]}`.
- **Manifest_Check_Hook_File**: The Hook_File `.kiro/hooks/specimen-manifest-check.json`.
- **Demo_Server**: The `hollow-inn` MCP server at `servers/hollow-inn/src/main.ts`.
- **Test_Suite**: The vitest and fast-check tests under `packages/*/test/*.test.ts`.

## Requirements

### Requirement 1: Jar line format

**User Story:** As an MCP server author, I want every recorded call stored in one fixed, validated format, so that a replay can rely on each field.

#### Acceptance Criteria

1. THE Jar_Schema SHALL define a Jar_Line with the required fields `v`, `id`, `session_id`, `seq`, `server`, `tool`, `tool_id`, `input`, `response_text`, `response`, `t0`, `t1`, `duration_ms` and `redacted`.
2. THE Jar_Schema SHALL require `v` to equal the number 1.
3. THE Jar_Schema SHALL require `id` to match the pattern `SPC-` followed by at least four decimal digits.
4. THE Jar_Schema SHALL require `session_id`, `server`, `tool` and `tool_id` to be non-empty strings.
5. THE Jar_Schema SHALL require `seq` to be an integer from 1 to 2,147,483,647, so that the first call of a session has `seq` 1.
6. THE Jar_Schema SHALL require `t0` and `t1` to be ISO-8601 date-time strings that include a time zone designator.
7. THE Jar_Schema SHALL require `duration_ms` to be an integer from 0 to 2,147,483,647.
8. THE Jar_Schema SHALL require `redacted` to be an array of RFC 6901 JSON pointer strings, and SHALL accept an empty array.
9. THE Jar_Schema SHALL define `response` as a JSON value or null.
10. THE Jar_Schema SHALL define the optional boolean fields `text_redacted` and `unpaired`.
11. THE Jar_Schema SHALL define `response_text` as a string in every case, and SHALL define the optional field `response_length` as a non-negative integer.
12. WHERE the Redact_Config has `text` set to `hash` and the response is not JSON, THE Jar_Schema SHALL require `response_text` to match `sha256:` followed by 64 lowercase hexadecimal characters, SHALL require `response_length` to be present, and SHALL require `response` to be null.
13. WHEN a Jar_Line is written, THE Capture_Hook SHALL write it as one line of JSON text, containing no newline character other than the single terminating newline.
14. WHEN a Jar_Line is written, THE Post_Hook SHALL set `duration_ms` to the difference in milliseconds between `t1` and `t0`, rounded to the nearest integer.
15. IF `t1` is earlier than `t0` when the Post_Hook computes `duration_ms`, THEN THE Post_Hook SHALL set `duration_ms` to 0 and SHALL log the clock anomaly to the Hook_Log.
16. THE Jar_Schema SHALL document that `duration_ms` includes hook overhead.
17. FOR ALL valid Jar_Line objects, serialising to JSON then parsing with the Jar_Schema SHALL produce an object deep-equal to the original (round-trip property).
18. IF a line read from a Jar is not valid JSON or fails the Jar_Schema, THEN THE Jar_Schema reader SHALL return an error that names the 1-based line number and the failing field, or names the line number and states that the line is not valid JSON, and SHALL NOT return a Jar_Line for that line.
19. IF a Jar_Line contains a field not defined in the Jar_Schema, THEN THE Jar_Schema reader SHALL return an error that names the line number and the unknown field.

### Requirement 2: Accession IDs

**User Story:** As an MCP server author, I want each jar line to carry a stable accession ID, so that a later report can cite one specific recorded call.

#### Acceptance Criteria

1. WHEN the Post_Hook writes a Jar_Line, THE Post_Hook SHALL assign `id` from the Counter_File by incrementing the stored number by one.
2. THE Post_Hook SHALL format the assigned number as `SPC-` followed by the number zero-padded to at least four digits.
3. IF the Counter_File does not exist, THEN THE Post_Hook SHALL treat the stored number as 0 and create the Counter_File.
4. THE Post_Hook SHALL persist the new counter value before it appends the Jar_Line.
5. IF the Post_Hook fails after persisting the counter and before appending the Jar_Line, THEN THE Post_Hook SHALL leave the counter value incremented, so that no Accession_ID is reused.
6. FOR ALL sequences of N successful Post_Hook runs starting from an empty Counter_File, THE Jar_Lines written SHALL carry N distinct `id` values.
7. IF the Counter_File content is not a non-negative integer, THEN THE Post_Hook SHALL log the problem to the Hook_Log, SHALL scan the files in `jars/` for the highest existing Accession_ID, and SHALL continue from the greater of that value and 0.

### Requirement 3: Pre hook

**User Story:** As an MCP server author, I want the pre hook to note each call before it runs, so that the post hook can time it and pair it with its response.

#### Acceptance Criteria

1. WHEN the Pre_Hook receives a Pre_Payload on STDIN, THE Pre_Hook SHALL parse it with a zod schema.
2. WHEN the Pre_Hook parses a Pre_Payload, THE Pre_Hook SHALL append a Pending_Entry to the Pending_File.
3. THE Pre_Hook SHALL set `t0` in the Pending_Entry to the ISO-8601 time at which the Pre_Hook process read the payload.
4. THE Pre_Hook SHALL set `seq` in the Pending_Entry to one more than the number of Pending_Entries and Jar_Lines already recorded for the same `session_id`, so that the first call of a session has `seq` 1.
5. THE Pre_Hook SHALL compute `input_sha256` as the Input_Hash of the parsed `tool_input`, and SHALL NOT compute it over the raw STDIN text.
6. FOR ALL JSON values, THE Canonical_JSON function SHALL produce the same text for two values that differ only in object key order.
7. FOR ALL JSON values, parsing the Canonical_JSON text SHALL produce a value deep-equal to the original (round-trip property).
8. THE Canonical_JSON function SHALL preserve array order.
9. WHERE the `--server <key>` option is given, THE Pre_Hook SHALL use that key as the Server_Key for resolving the tool.
10. WHEN the resolved tool does not belong to a Server_Key, THE Pre_Hook SHALL append nothing to the Pending_File.
11. THE Pre_Hook SHALL hash `tool_input` before redaction, so that the Input_Hash of a call is the same in the Pre_Hook and the Post_Hook.

### Requirement 4: Post hook pairing and writing

**User Story:** As an MCP server author, I want each response joined to the call that produced it, so that the jar holds complete input and response pairs.

#### Acceptance Criteria

1. WHEN the Post_Hook receives a Post_Payload on STDIN, THE Post_Hook SHALL parse it with a zod schema that requires `tool_response` to be a string.
2. IF the Post_Payload fails the zod schema, THEN THE Post_Hook SHALL write a diagnostic entry naming the failing field to the Hook_Log, SHALL append nothing to any Jar, SHALL leave the Pending_File and the Counter_File unchanged, and SHALL exit with status 0 so that Kiro's tool call is not blocked.
3. WHEN the Post_Hook parses a Post_Payload, THE Post_Hook SHALL compute the Input_Hash of `tool_input` with the Canonical_JSON function.
4. WHEN the Post_Hook has an Input_Hash, THE Post_Hook SHALL select the oldest Pending_Entry in the Pending_File that has the same `session_id`, the same `tool_id` and the same `input_sha256`.
5. WHEN the Post_Hook selects a Pending_Entry, THE Post_Hook SHALL write a Jar_Line that takes `seq` and `t0` from that Pending_Entry and takes `t1` from the Post_Hook process clock at the time the payload is read.
6. WHEN the Post_Hook writes a Jar_Line from a Pending_Entry, THE Post_Hook SHALL remove that Pending_Entry from the Pending_File and leave all other Pending_Entries unchanged and in their original order.
7. IF the Post_Hook finds no matching Pending_Entry, THEN THE Post_Hook SHALL write a Jar_Line with `unpaired` set to true, with `t0` equal to `t1`, with `duration_ms` equal to 0, and with `seq` set to one more than the number of Pending_Entries and Jar_Lines already recorded for that `session_id`.
8. THE Post_Hook SHALL NOT drop a Post_Payload that parses against the zod schema in criterion 1.
9. THE Post_Hook SHALL leave every Pending_Entry that no Post_Payload pairs with in the Pending_File as an Orphan.
10. WHEN the Post_Hook writes a Jar_Line, THE Post_Hook SHALL append it to `jars/<session_id>.jsonl`, creating the file and the `jars/` directory if they do not exist.
11. THE Post_Hook SHALL only append to a Jar and SHALL NOT rewrite or truncate an existing Jar_Line.
12. WHEN the Post_Hook builds a Jar_Line, THE Post_Hook SHALL validate it with the Jar_Schema before appending it.
13. IF the Jar_Line fails Jar_Schema validation, THEN THE Post_Hook SHALL append nothing to the Jar, SHALL leave the matched Pending_Entry in the Pending_File, SHALL write a diagnostic entry naming the failing field to the Hook_Log, and SHALL exit with status 0.
14. IF appending the Jar_Line to the Jar fails, THEN THE Post_Hook SHALL leave the matched Pending_Entry in the Pending_File, SHALL write a diagnostic entry describing the failure to the Hook_Log, and SHALL exit with status 0.
15. THE Post_Hook SHALL set `tool_id` to the raw `tool_name` of the Post_Payload.
16. THE Post_Hook SHALL set `tool` to the `tool_name` without the `mcp_<Server_Key>_` prefix.
17. THE Post_Hook SHALL set `input` to `tool_input` after redaction.
18. THE Post_Hook SHALL set `response_text` to the `tool_response` string exactly as Kiro handed it to the hook, apart from redaction.
19. WHEN `tool_response` parses as JSON, THE Post_Hook SHALL set `response` to the result of `JSON.parse` on the stored `response_text`.
20. IF `tool_response` does not parse as JSON, THEN THE Post_Hook SHALL set `response` to null.
21. FOR ALL sequences of Pending_Entries that share `session_id`, `tool_id` and `input_sha256`, Post_Payloads that match them SHALL pair in the same order as the Pending_Entries were appended (FIFO property).

### Requirement 5: Server resolution

**User Story:** As an MCP server author, I want each call attributed to the right configured server, so that a replay starts the matching server.

#### Acceptance Criteria

1. WHERE the `--server <key>` option is given to a Capture_Hook, THE Capture_Hook SHALL use that key as `server`.
2. WHERE the `--server <key>` option is not given, THE Capture_Hook SHALL read the Server_Keys from `.kiro/settings/mcp.json` and SHALL set `server` to the longest Server_Key `s` for which `tool_name` starts with `mcp_<s>_`.
3. WHEN two Server_Keys are both prefixes of `tool_name`, THE Capture_Hook SHALL choose the longer Server_Key.
4. THE Capture_Hook SHALL parse `.kiro/settings/mcp.json` with a zod schema.
5. IF no Server_Key matches `tool_name` and no `--server` option is given, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log and SHALL record nothing for that call.
6. IF `.kiro/settings/mcp.json` is missing or fails its zod schema and no `--server` option is given, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log and SHALL record nothing for that call.
7. WHERE the `--server <key>` option is given and `tool_name` does not start with `mcp_<key>_`, THE Capture_Hook SHALL set `tool` to the full `tool_name`.

### Requirement 6: Hook contract

**User Story:** As a Kiro user, I want capture to never disturb my agent, so that recording a call cannot break or alter it.

#### Acceptance Criteria

1. THE Capture_Hook SHALL exit with code 0 on every run.
2. THE Capture_Hook SHALL write nothing to STDOUT on every run.
3. IF STDIN is empty, is not valid JSON, or fails the payload zod schema, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log, SHALL exit with code 0, and SHALL write nothing to STDOUT.
4. IF a file read, a file write or an uncaught exception fails inside a Capture_Hook, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log, SHALL exit with code 0, and SHALL write nothing to STDOUT.
5. THE Capture_Hook SHALL append every diagnostic to the Hook_Log as one line that includes the hook name, the `session_id` when known, and the error message.
6. IF the Hook_Log cannot be written, THEN THE Capture_Hook SHALL exit with code 0 and write nothing to STDOUT.
7. THE Capture_Hook SHALL NOT write the unredacted `tool_input` or the unredacted `tool_response` to the Hook_Log.
8. THE Capture_Hook SHALL NOT wait for input beyond end-of-file on STDIN.
9. FOR ALL byte sequences supplied on STDIN, THE Capture_Hook SHALL exit with code 0 and write nothing to STDOUT (error-condition property).

### Requirement 7: Redaction

**User Story:** As an MCP server author, I want secrets removed before anything is stored, so that a jar can be committed and shared.

#### Acceptance Criteria

1. THE Redact_Config reader SHALL parse `.specimen/redact.json` with a zod schema that requires `keys` and `patterns` to be arrays of strings and `text` to be `"redact"` or `"hash"`.
2. IF `.specimen/redact.json` is missing, THEN THE Post_Hook SHALL apply a default Redact_Config whose `keys` and `patterns` are empty and whose `text` is `"redact"`.
3. IF `.specimen/redact.json` exists and fails its zod schema, THEN THE Post_Hook SHALL log the problem to the Hook_Log, SHALL append no Jar_Line for that call, SHALL leave the Counter_File and the Jar unchanged, and SHALL exit with code 0, so that an unvalidated configuration never lets a secret through.
4. IF a pattern in the Redact_Config is not a valid regular expression, THEN THE Post_Hook SHALL log the problem, naming the failing pattern's index in `patterns`, to the Hook_Log, SHALL append no Jar_Line for that call, SHALL leave the Counter_File and the Jar unchanged, and SHALL exit with code 0.
5. WHEN the Post_Hook builds a Jar_Line, THE Post_Hook SHALL apply the Redact_Config to `tool_input` and to the response before anything is written to disk.
6. WHEN a value at any nesting depth in `tool_input` sits under an object key that equals an entry in `keys` (exact, case-sensitive string match), THE Post_Hook SHALL replace that value, whatever its JSON type, with the Redaction_Marker and SHALL add its RFC 6901 JSON pointer to `redacted`.
7. WHEN a string value at any nesting depth in `tool_input`, including a string element of an array, contains a match for a pattern in `patterns`, THE Post_Hook SHALL replace the whole string value with the Redaction_Marker and SHALL add its JSON pointer to `redacted`.
8. WHEN `tool_response` parses as JSON, THE Post_Hook SHALL locate, as a Value_Span in the raw `tool_response` text, each value that sits under an object key equal to an entry in `keys` (exact, case-sensitive) and each string value that contains a match for a pattern in `patterns`.
9. WHEN the Post_Hook has located Value_Spans in a JSON response, THE Post_Hook SHALL replace each Value_Span in the raw text with the JSON string literal of the Redaction_Marker, SHALL add the JSON pointer of each replaced value to `redacted`, and SHALL list the pointers in the order in which the values occur in the text.
10. THE Post_Hook SHALL NOT re-serialise the parsed response object to produce `response_text`.
11. WHEN a JSON response contains no value to redact, THE Post_Hook SHALL store `response_text` byte-identical to `tool_response` and SHALL set `redacted` to an empty array for the response.
12. WHEN a JSON response contains a number literal such as `425.00` outside every Value_Span, THE Post_Hook SHALL keep that literal unchanged in `response_text`, so that `"total":425.00` is stored as `"total":425.00` and not as `"total":425`.
13. FOR ALL JSON response texts, the characters of `response_text` outside the replaced Value_Spans SHALL equal the characters of `tool_response` outside the same spans (invariant property).
14. FOR ALL JSON response texts and Redact_Configs, THE Post_Hook SHALL produce `response_text` that parses as JSON (round-trip property).
15. THE default Redact_Config shipped in `.specimen/redact.json` SHALL include at least one pattern each that matches a bearer token (the word `Bearer` followed by a token), an API-key shape (a prefixed key such as `sk-` followed by at least 20 alphanumeric characters), and an e-mail address.
16. WHEN `tool_response` does not parse as JSON and `text` is `"redact"`, THE Post_Hook SHALL replace each match of each pattern in `patterns` in the response text with the Redaction_Marker.
17. WHEN the Post_Hook applies the patterns to a non-JSON response, THE Post_Hook SHALL set `text_redacted` to true on the Jar_Line, whether or not any pattern matched.
18. WHERE the Redact_Config has `text` set to `"hash"` and the response is not JSON, THE Post_Hook SHALL set `response_text` to the string `sha256:` followed by the lowercase hex SHA-256 of the response text, SHALL set `response_length` to the length of the response text in characters, SHALL set `response` to null, and SHALL store no other form of that text on the Jar_Line.
19. WHEN `tool_response` is JSON, THE Post_Hook SHALL leave `text_redacted` unset or false.
20. THE Post_Hook SHALL redact a value before it computes anything stored on the Jar_Line from that value, other than `input_sha256` in the Pending_Entry.
21. FOR ALL inputs, applying redaction twice SHALL produce the same result as applying it once (idempotence property).
22. WHEN the Post_Hook redacts a value, THE Post_Hook SHALL NOT write the original value to the Jar, the Pending_File, the Counter_File or the Hook_Log.

### Requirement 8: Firewall

**User Story:** As an MCP server author, I want the agent blocked from editing recorded jars, so that jars stay trustworthy evidence.

#### Acceptance Criteria

1. WHEN the Firewall_Hook receives a PreToolUse payload for a write whose target path resolves to a location under `jars/` in the workspace, THE Firewall_Hook SHALL exit with code 2 and SHALL write `jars are evidence and read-only` to STDERR.
2. WHEN the Firewall_Hook receives a PreToolUse payload for a write whose target path does not resolve to a location under `jars/`, THE Firewall_Hook SHALL exit with code 0.
3. THE Firewall_Hook SHALL resolve the target path against the payload `cwd`, and SHALL collapse `.` and `..` segments, before it compares the path with `jars/`.
4. IF the Firewall_Hook cannot parse its STDIN payload or cannot find a target path, THEN THE Firewall_Hook SHALL exit with code 0 and write a diagnostic to the Hook_Log.
5. THE Firewall_Hook SHALL write nothing to STDOUT.
6. THE Manifest_Command `specimen manifest write` SHALL write the Manifest in `sha256sum` format, one line per file under `jars/` other than the Manifest, sorted by path.
7. THE Manifest SHALL be verifiable with `sha256sum -c` run from the `jars/` directory.
8. WHEN `specimen manifest check` runs and every listed file has its recorded SHA-256, THE Manifest_Command SHALL exit with code 0.
9. IF `specimen manifest check` finds a missing file, a file whose SHA-256 differs, or a file under `jars/` that the Manifest does not list, THEN THE Manifest_Command SHALL list each such file on STDERR and exit with a non-zero code.
10. THE Manifest_Check_Hook_File SHALL run `specimen manifest check` on PreTaskExec and on PostTaskExec, so that a shell write to `jars/` is detected even though shell writes are outside the write category.
11. THE Firewall_Hook SHALL NOT treat a write to the Manifest file path as an exception to the `jars/` rule.
12. FOR ALL paths, THE firewall decision function in `packages/core` SHALL return the same decision for a path and for the same path written with extra `.` segments or `dir/..` segments (invariant property).

### Requirement 9: Kiro wiring

**User Story:** As an MCP server author, I want the repository to ship ready-made Kiro configuration, so that capture works as soon as I open the project in Kiro.

#### Acceptance Criteria

1. THE repository SHALL contain `.kiro/settings/mcp.json` that registers the Demo_Server under the key `hollowinn` with the command `npx` and the arguments `tsx servers/hollow-inn/src/main.ts v1`.
2. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-jar-pre.json` with trigger `PreToolUse`, matcher `@hollowinn`, and an action of type `command` that runs `specimen hook pre --server hollowinn`.
3. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-jar-post.json` with trigger `PostToolUse`, matcher `@hollowinn`, and an action of type `command` that runs `specimen hook post --server hollowinn`.
4. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-jar-firewall.json` with trigger `PreToolUse`, matcher `write`, and an action of type `command` that runs `specimen hook firewall`.
5. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-manifest-check.json` containing two hooks, one with trigger `PreTaskExec` and one with trigger `PostTaskExec`, each with an action of type `command` that runs `specimen manifest check`.
6. THE repository SHALL contain the Hook_File `.kiro/hooks/post-task-tests.json` whose hook on trigger `PostTaskExec` has an action of type `command` that runs `npm test`, in addition to the Manifest_Check_Hook_File hook on the same trigger.
7. THE Test_Suite SHALL parse every Hook_File with a zod schema for the shape `{"version":"v1","hooks":[{"name","trigger","matcher","action":{"type":"command","command"}}]}`.
8. WHERE a hook has trigger `PreTaskExec` or `PostTaskExec`, THE Hook_File schema SHALL allow `matcher` to be absent.
9. THE Hook_Files for capture SHALL contain no command that writes to STDOUT.

### Requirement 10: Boundaries and determinism

**User Story:** As a maintainer, I want the capture logic to follow the repository rules, so that the cabinet can bundle it and judging stays reproducible.

#### Acceptance Criteria

1. THE capture logic in `packages/core` SHALL contain no `node:` imports.
2. THE capture logic in `packages/core` SHALL take the current time, file contents and STDIN text as arguments and SHALL NOT read a clock, the file system or the network itself.
3. THE `packages/cli` hook commands SHALL perform all file, STDIN, STDOUT, STDERR and clock access and SHALL pass the results to `packages/core` functions.
4. THE Capture_Hook SHALL parse every external input (STDIN payloads, `.specimen/pending.jsonl`, `.specimen/redact.json`, `.kiro/settings/mcp.json`, Jar_Lines) with a zod schema before using it.
5. THE Capture_Hook SHALL NOT write to any path under `jars/` other than `jars/<session_id>.jsonl`.
6. IF a Pending_File line fails its zod schema, THEN THE Pre_Hook and THE Post_Hook SHALL log the line number to the Hook_Log and SHALL keep the line unchanged in the Pending_File.
7. THE Capture_Hook SHALL make no network call and SHALL use no font or CDN resource.
8. THE Capture_Hook SHALL perform no mocking of the MCP protocol.
9. IF `session_id` contains a path separator or a `..` segment, THEN THE Capture_Hook SHALL log the problem to the Hook_Log and SHALL record nothing for that call, so that a payload cannot write outside `jars/`.

### Requirement 11: Tests

**User Story:** As a maintainer, I want automated tests for the capture behaviour, so that a regression in recording is caught before it corrupts evidence.

#### Acceptance Criteria

1. THE Test_Suite SHALL run under `npm test` at the repository root with vitest.
2. THE Test_Suite SHALL include a fast-check property that the Input_Hash is equal for any two JSON values that differ only in object key order.
3. THE Test_Suite SHALL include a test that pairs several Post_Payloads FIFO against Pending_Entries that share `session_id`, `tool_id` and `input_sha256`.
4. THE Test_Suite SHALL include a test that a Post_Payload with no matching Pending_Entry yields a Jar_Line with `unpaired` set to true, and that an unmatched Pending_Entry remains in the Pending_File.
5. THE Test_Suite SHALL include a fast-check property that a JSON response with nothing to redact is stored byte-identical.
6. THE Test_Suite SHALL include a test that redacting a response containing `"total":425.00` under a redacted sibling key stores `"total":425.00` unchanged.
7. THE Test_Suite SHALL include a test that a non-JSON response with a matching pattern is stored with the Redaction_Marker and `text_redacted` set to true.
8. THE Test_Suite SHALL include a test that `"text": "hash"` stores a non-JSON response as `response_text` equal to `sha256:<hex>`, with `response_length` set and `response` null, and no other form of the text.
9. THE Test_Suite SHALL include tests of the firewall decision for a path under `jars/`, a path outside `jars/`, and a path with `..` segments that resolves into `jars/`.
10. THE Test_Suite SHALL include a test that each Capture_Hook, run as a child process on invalid STDIN, exits with code 0 and writes zero bytes to STDOUT.
11. THE Test_Suite SHALL include a test that `specimen manifest write` followed by `sha256sum -c` succeeds on a temporary copy of a jar directory, and that `specimen manifest check` fails after one byte of a jar file changes in that copy.
12. THE Test_Suite SHALL include a test that the longest matching Server_Key wins in server resolution.
13. THE Test_Suite SHALL include a test that a Jar_Line round-trips through the Jar_Schema.
14. THE Test_Suite SHALL include a test that the first call of a session gets `seq` 1.
15. THE Test_Suite SHALL write jar and pending files only under a temporary directory and SHALL NOT modify files in the repository `jars/` directory.
