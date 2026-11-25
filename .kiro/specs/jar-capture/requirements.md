# Requirements Document

## Introduction

Jar capture records the MCP tool calls a Kiro agent makes against a configured MCP server into a "jar": an append-only JSONL file of real recorded calls that is later replayed against a new server version. No proxy sits between Kiro and the server. Kiro's own PreToolUse and PostToolUse shell hooks are the only capture point. The hooks run the `specimen hook` commands, which pair each pre event with its post event and write one jar line per call.

The jar line schema and the pure logic (canonical hashing, SHA-256, pairing, redaction, server resolution, firewall decision, manifest) live in `packages/core` as TypeScript with no `node:` imports. File, lock, clock and STDIN access live in `packages/cli`. All external input (hook payloads, jar lines, pending entries, config files) is parsed with zod at the boundary. Judging code stays deterministic. Timestamps are stamped only by the hook processes, never by core judging code.

Capture appends new files to `jars/` and never writes the Manifest. After a recording session the author runs `specimen manifest write` to seal the jars, and `specimen manifest check` then detects any later change.

Known limitations of this feature:

- The Jar_Line carries no error flag, because Kiro's PostToolUse payload exposes only a string. The hollow-inn demo reports errors only as `{"error":"..."}` text inside `response_text`.
- The Firewall_Hook covers only Kiro's write tool category. Shell writes to `jars/` are caught afterwards by the manifest check.
- A redacted input is replayed with the Redaction_Marker in place of the original value. Consumers use `redacted` to recognise such values.
- A JSON-valid but very large response, hook timeouts and Hook_Log growth are not bounded by this feature.

## Glossary

- **Jar**: An append-only file `jars/<session_id>.jsonl` holding one Jar_Line per recorded call.
- **Jar_Line**: One JSON object on one line of a Jar, in format "specimen v1".
- **Jar_Schema**: The zod schema in `packages/core` that validates a Jar_Line.
- **Jar_Reader**: The function in `packages/core` that takes the text of a Jar and returns its Jar_Lines or errors.
- **Capture_Hook**: The `specimen hook pre` and `specimen hook post` commands. The Firewall_Hook is not a Capture_Hook.
- **Pre_Hook**: The `specimen hook pre` command, run by Kiro on PreToolUse.
- **Post_Hook**: The `specimen hook post` command, run by Kiro on PostToolUse.
- **Firewall_Hook**: The `specimen hook firewall` command, run by Kiro on PreToolUse with matcher `write`.
- **Pre_Payload**: The JSON object Kiro writes to STDIN on PreToolUse: `{session_id, hook_event_name, cwd, tool_name, tool_input}`, where `cwd` is a string and `tool_input` is any JSON value whose key is present.
- **Post_Payload**: The JSON object Kiro writes to STDIN on PostToolUse: the Pre_Payload fields plus `tool_response`, a string.
- **Workspace_Root**: The nearest ancestor directory of the payload `cwd`, including `cwd` itself, that contains a `.kiro` directory, otherwise `cwd`.
- **Pending_File**: `.specimen/pending.jsonl`, holding Pending_Entries.
- **Pending_Entry**: A JSON object `{session_id, seq, tool_id, input_sha256, t0}` in the Pending_File.
- **Orphan**: A Pending_Entry that no Post_Payload ever paired with.
- **Unpaired_Post**: A Jar_Line written for a Post_Payload that matched no Pending_Entry.
- **Canonical_JSON**: The JSON text of a parsed value in which object keys are sorted ascending by UTF-16 code unit order at every depth, strings and numbers are written as `JSON.stringify` writes them, there is no whitespace, array order is preserved, and keys named `__proto__` or `constructor` are treated as ordinary keys.
- **Input_Hash**: The lowercase hex SHA-256 of the UTF-8 bytes of the Canonical_JSON of `tool_input` after redaction.
- **Accession_ID**: An identifier of the form `SPC-` followed by a zero-padded counter, such as `SPC-0001`.
- **Counter_File**: `.specimen/counter`, holding the last assigned Accession_ID number.
- **Server_Key**: A key of the `mcpServers` object in the workspace `.kiro/settings/mcp.json`.
- **Sanitised_Key**: The Server_Key with each `-` replaced by `_`, which is how Kiro writes the key inside `tool_name`.
- **Tool_ID**: The raw `tool_name` that Kiro reported, such as `mcp_hollowinn_quote`.
- **Tool_Name**: The Tool_ID without the `mcp_<Sanitised_Key>_` prefix.
- **JSON_Response**: A `tool_response` string that `JSON.parse` turns into an object or an array. A string that parses to a scalar is non-JSON text.
- **Redact_Config**: The zod-validated content of `.specimen/redact.json`: `{"keys": string[], "patterns": string[], "text": "redact" | "hash"}`.
- **Redaction_Marker**: The string `[REDACTED]`.
- **Value_Span**: The exact character range of one JSON value inside raw JSON text.
- **Hook_Log**: `.specimen/hook.log`, the diagnostics file for all hook commands.
- **Lock_File**: `.specimen/lock`, the file whose exclusive creation grants a hook process access to the Pending_File, the Counter_File and the Jars.
- **Manifest**: `jars/MANIFEST.sha256`, a file in `sha256sum` format listing the SHA-256 of every file under `jars/` except the Manifest itself.
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
4. THE Jar_Schema SHALL require `server`, `tool` and `tool_id` to be non-empty strings, and SHALL require `session_id` to match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and to contain no `..` segment.
5. THE Jar_Schema SHALL require `seq` to be an integer from 1 to 2,147,483,647, so that the first call of a session has `seq` 1.
6. THE Jar_Schema SHALL require `t0` and `t1` to be ISO-8601 date-time strings that include a time zone designator, and the Capture_Hooks SHALL write them in UTC with millisecond precision in the form `YYYY-MM-DDTHH:mm:ss.sssZ`.
7. THE Jar_Schema SHALL require `duration_ms` to be an integer from 0 to 2,147,483,647.
8. THE Jar_Schema SHALL require `redacted` to be an array of RFC 6901 JSON pointer strings that point into the Jar_Line itself, such as `/input/guest` and `/response/token`, with `~` and `/` escaped per RFC 6901, and SHALL accept an empty array.
9. THE Jar_Schema SHALL define `response` as a JSON value or null.
10. THE Jar_Schema SHALL define the optional boolean fields `text_redacted` and `unpaired`.
11. THE Jar_Schema SHALL define `response_text` as a string in every case, and SHALL define the optional field `response_length` as a non-negative integer that counts UTF-16 code units.
12. WHERE `response_length` is present, THE Jar_Schema SHALL require `response_text` to match `sha256:` followed by 64 lowercase hexadecimal characters and SHALL require `response` to be null.
13. WHEN a Jar_Line is written, THE Capture_Hook SHALL write it as one line of JSON text, containing no newline character other than the single terminating newline.
14. WHEN a Jar_Line is written, THE Post_Hook SHALL set `duration_ms` to the difference in milliseconds between `t1` and `t0`.
15. IF `t1` is earlier than `t0` when the Post_Hook computes `duration_ms`, THEN THE Post_Hook SHALL set `duration_ms` to 0 and SHALL log the clock anomaly to the Hook_Log.
16. THE Jar_Schema SHALL document that `duration_ms` includes hook overhead.
17. FOR ALL valid Jar_Line objects, serialising to JSON then parsing with the Jar_Schema SHALL produce an object deep-equal to the original (round-trip property).
18. IF a line read from a Jar is not valid JSON or fails the Jar_Schema, THEN THE Jar_Reader SHALL return an error that names the 1-based line number and the failing field, or names the line number and states that the line is not valid JSON, and SHALL NOT return a Jar_Line for that line.
19. IF a Jar_Line contains a field not defined in the Jar_Schema, THEN THE Jar_Reader SHALL return an error that names the line number and the unknown field.
20. IF a Jar contains a blank line before its final line, THEN THE Jar_Reader SHALL return an error that names the 1-based line number of the blank line.
21. IF the final line of a Jar has no terminating newline, THEN THE Jar_Reader SHALL return an error that names that line number and states that the line is incomplete.
22. THE Jar_Schema SHALL document that `seq` is unique within a Jar.
23. THE Jar_Schema SHALL document that `seq` gives the order in which calls started while Jar_Lines are appended in the order calls completed, so that file order may differ from `seq` order and consumers order Jar_Lines by `seq`.

### Requirement 2: Accession IDs

**User Story:** As an MCP server author, I want each jar line to carry a stable accession ID, so that a later report can cite one specific recorded call.

#### Acceptance Criteria

1. WHEN the Post_Hook writes a Jar_Line, THE Post_Hook SHALL assign `id` from the Counter_File by incrementing the stored number by one.
2. THE Post_Hook SHALL format the assigned number as `SPC-` followed by the number zero-padded to at least four digits.
3. IF the Counter_File does not exist, THEN THE Post_Hook SHALL scan the files in `jars/` for the highest existing Accession_ID, SHALL treat that value as the stored number (0 when `jars/` holds no Accession_ID), and SHALL create the Counter_File from it.
4. THE Post_Hook SHALL persist the new counter value before it appends the Jar_Line.
5. IF the Post_Hook fails after persisting the counter and before appending the Jar_Line, THEN THE Post_Hook SHALL leave the counter value incremented, so that no Accession_ID is reused.
6. FOR ALL sequences of N successful Post_Hook runs starting from an empty Counter_File and an empty `jars/`, THE Jar_Lines written SHALL carry N distinct `id` values.
7. IF the Counter_File content is not a non-negative integer, THEN THE Post_Hook SHALL log the problem to the Hook_Log, SHALL scan the files in `jars/` for the highest existing Accession_ID, and SHALL continue from the greater of that value and 0.
8. WHEN the Post_Hook scans `jars/` for the highest Accession_ID, THE Post_Hook SHALL read Jar_Lines tolerantly, SHALL ignore every invalid line, and SHALL NOT modify any file under `jars/`.

### Requirement 3: Pre hook

**User Story:** As an MCP server author, I want the pre hook to note each call before it runs, so that the post hook can time it and pair it with its response.

#### Acceptance Criteria

1. WHEN the Pre_Hook receives a Pre_Payload on STDIN, THE Pre_Hook SHALL parse it with a zod schema that requires `cwd` to be a string and requires the `tool_input` key to be present.
2. WHEN the Pre_Hook parses a Pre_Payload, THE Pre_Hook SHALL append a Pending_Entry to the Pending_File.
3. THE Pre_Hook SHALL set `t0` in the Pending_Entry to the time at which the Pre_Hook process read the payload, in the format of Requirement 1 criterion 6.
4. THE Pre_Hook SHALL set `seq` in the Pending_Entry to one more than the highest `seq` among the valid Pending_Entries and the valid Jar_Lines of the same `session_id`, or to 1 when there are none.
5. THE Pre_Hook SHALL compute `input_sha256` as the Input_Hash of the parsed `tool_input` after redaction, and SHALL NOT compute it over the raw STDIN text or over unredacted input.
6. FOR ALL JSON values, THE Canonical_JSON function SHALL produce the same text for two values that differ only in object key order.
7. FOR ALL JSON values, parsing the Canonical_JSON text SHALL produce a value deep-equal to the original (round-trip property).
8. THE Canonical_JSON function SHALL preserve array order.
9. WHERE the `--server <key>` option is given, THE Pre_Hook SHALL use that key as the Server_Key for resolving the tool.
10. WHEN server resolution under Requirement 5 yields no server, THE Pre_Hook SHALL append nothing to the Pending_File.
11. THE Pre_Hook SHALL redact `tool_input` before it hashes it, so that the Input_Hash of a call is the same in the Pre_Hook and the Post_Hook and the Pending_File holds no hash derived from unredacted input.
12. WHEN the Pre_Hook redacts `tool_input`, THE Pre_Hook SHALL read and validate the Redact_Config exactly as the Post_Hook does, and IF the Redact_Config meets a condition of Requirement 7 criterion 3 or criterion 4, THEN THE Pre_Hook SHALL log the problem to the Hook_Log and SHALL append nothing to the Pending_File.

### Requirement 4: Post hook pairing and writing

**User Story:** As an MCP server author, I want each response joined to the call that produced it, so that the jar holds complete input and response pairs.

#### Acceptance Criteria

1. WHEN the Post_Hook receives a Post_Payload on STDIN, THE Post_Hook SHALL parse it with a zod schema that requires `tool_response` to be a string, requires `cwd` to be a string, and requires the `tool_input` key to be present.
2. IF the Post_Payload fails the zod schema, THEN THE Post_Hook SHALL write a diagnostic entry naming the failing field to the Hook_Log, SHALL append nothing to any Jar, SHALL leave the Pending_File and the Counter_File unchanged, and SHALL exit with status 0 so that Kiro's tool call is not blocked.
3. WHEN the Post_Hook parses a Post_Payload, THE Post_Hook SHALL compute the Input_Hash of `tool_input` after redaction with the Canonical_JSON function.
4. WHEN the Post_Hook has an Input_Hash, THE Post_Hook SHALL select the oldest Pending_Entry in the Pending_File that has the same `session_id`, the same `tool_id` and the same `input_sha256`, where oldest means the lowest line number in the Pending_File.
5. WHEN the Post_Hook selects a Pending_Entry, THE Post_Hook SHALL write a Jar_Line that takes `seq` and `t0` from that Pending_Entry and takes `t1` from the Post_Hook process clock at the time the payload is read.
6. WHEN the Post_Hook writes a Jar_Line from a Pending_Entry, THE Post_Hook SHALL first append the Jar_Line to the Jar, then remove that Pending_Entry from the Pending_File, and SHALL leave all other Pending_Entries unchanged and in their original order.
7. IF the Post_Hook finds no matching Pending_Entry, THEN THE Post_Hook SHALL write a Jar_Line with `unpaired` set to true, with `t0` equal to `t1`, with `duration_ms` equal to 0, and with `seq` set to one more than the highest `seq` among the valid Pending_Entries and the valid Jar_Lines of that `session_id`, or to 1 when there are none.
8. THE Post_Hook SHALL write a Jar_Line for every Post_Payload that parses against the zod schema in criterion 1, except where criterion 13, criterion 14, criterion 22, Requirement 5 criterion 5, Requirement 5 criterion 6, Requirement 5 criterion 8, Requirement 5 criterion 9, Requirement 7 criterion 3, Requirement 7 criterion 4, Requirement 10 criterion 9 or Requirement 12 criterion 4 states that the Post_Hook records nothing.
9. THE Post_Hook SHALL leave every Pending_Entry that no Post_Payload pairs with in the Pending_File as an Orphan, and Capture_Hooks SHALL NOT delete or modify an Orphan, so that a later identical call may pair with an Orphan and this behaviour is accepted.
10. WHEN the Post_Hook writes a Jar_Line, THE Post_Hook SHALL append it to `jars/<session_id>.jsonl`, creating the file and the `jars/` directory if they do not exist.
11. THE Post_Hook SHALL only append to a Jar and SHALL NOT rewrite or truncate an existing Jar_Line.
12. WHEN the Post_Hook builds a Jar_Line, THE Post_Hook SHALL validate it with the Jar_Schema before appending it.
13. IF the Jar_Line fails Jar_Schema validation, THEN THE Post_Hook SHALL append nothing to the Jar, SHALL leave the matched Pending_Entry in the Pending_File, SHALL write a diagnostic entry naming the failing field to the Hook_Log, and SHALL exit with status 0, and the Counter_File MAY already have advanced as stated in Requirement 2 criterion 5.
14. IF appending the Jar_Line to the Jar fails, THEN THE Post_Hook SHALL leave the matched Pending_Entry in the Pending_File, SHALL write a diagnostic entry describing the failure to the Hook_Log, and SHALL exit with status 0, and the Counter_File MAY already have advanced as stated in Requirement 2 criterion 5.
15. THE Post_Hook SHALL set `tool_id` to the raw `tool_name` of the Post_Payload.
16. THE Post_Hook SHALL set `tool` to the `tool_name` without the `mcp_<Sanitised_Key>_` prefix.
17. THE Post_Hook SHALL set `input` to `tool_input` after redaction.
18. THE Post_Hook SHALL set `response_text` to the `tool_response` string exactly as Kiro handed it to the hook, apart from redaction.
19. WHEN `tool_response` is a JSON_Response, THE Post_Hook SHALL set `response` to the result of `JSON.parse` on the stored `response_text`.
20. IF `tool_response` is not a JSON_Response, THEN THE Post_Hook SHALL set `response` to null.
21. FOR ALL sequences of Pending_Entries that share `session_id`, `tool_id` and `input_sha256`, Post_Payloads that match them SHALL pair in the same order as the Pending_Entries were appended (FIFO property).
22. IF the Jar is non-empty and does not end with a newline, THEN THE Post_Hook SHALL append nothing to the Jar, SHALL leave the Jar untouched, SHALL keep the matched Pending_Entry in the Pending_File, SHALL write a diagnostic entry to the Hook_Log, and SHALL exit with status 0.
23. IF removing the matched Pending_Entry from the Pending_File fails after the Jar_Line was appended, THEN THE Post_Hook SHALL keep the Jar_Line, SHALL write a diagnostic entry to the Hook_Log, and SHALL exit with status 0.

### Requirement 5: Server resolution

**User Story:** As an MCP server author, I want each call attributed to the right configured server, so that a replay starts the matching server.

#### Acceptance Criteria

1. WHERE the `--server <key>` option is given to a Capture_Hook, THE Capture_Hook SHALL use that key as `server`.
2. WHERE the `--server <key>` option is not given, THE Capture_Hook SHALL read the Server_Keys from the workspace `.kiro/settings/mcp.json`, SHALL compute the Sanitised_Key of each Server_Key, and SHALL set `server` to the single Server_Key `s` for which `tool_name` starts with `mcp_<Sanitised_Key of s>_`.
3. IF two or more Sanitised_Keys are prefixes of `tool_name`, or two Server_Keys share one Sanitised_Key, and no `--server` option is given, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log stating that the server boundary is ambiguous and SHALL record nothing for that call, so that a wrong `server` never starts the wrong server on replay.
4. THE Capture_Hook SHALL parse the workspace `.kiro/settings/mcp.json` located under the Workspace_Root with a zod schema, and SHALL NOT consult any user-level MCP configuration.
5. IF no Server_Key matches `tool_name` and no `--server` option is given, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log and SHALL record nothing for that call.
6. IF the workspace `.kiro/settings/mcp.json` is missing or fails its zod schema and no `--server` option is given, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log and SHALL record nothing for that call.
7. WHERE the `--server <key>` option is given and `tool_name` does not start with `mcp_<Sanitised_Key of key>_`, THE Capture_Hook SHALL set `tool` to the full `tool_name`.
8. IF a Server_Key contains a character outside `[A-Za-z0-9_-]` and no `--server` option is given, THEN THE Capture_Hook SHALL treat that Server_Key as unmatchable by name, so that no call is attributed to it.

### Requirement 6: Hook contract

**User Story:** As a Kiro user, I want capture to never disturb my agent, so that recording a call cannot break or alter it.

#### Acceptance Criteria

1. THE Capture_Hook SHALL exit with code 0 on every run.
2. THE Capture_Hook SHALL write nothing to STDOUT and nothing to STDERR on every run.
3. IF STDIN is empty, is not valid JSON, or fails the payload zod schema, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log, SHALL exit with code 0, and SHALL write nothing to STDOUT or STDERR.
4. IF a file read, a file write or an uncaught exception fails inside a Capture_Hook, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log, SHALL exit with code 0, and SHALL write nothing to STDOUT or STDERR.
5. THE Capture_Hook SHALL append every diagnostic to the Hook_Log as one line that includes an ISO-8601 time, the hook name, the `session_id` when known, and the error message.
6. IF the Hook_Log cannot be written, THEN THE Capture_Hook SHALL exit with code 0 and write nothing to STDOUT or STDERR.
7. THE Capture_Hook SHALL compose every diagnostic from a field path or a fixed description, and SHALL NOT include any substring of STDIN in a diagnostic, including text taken from `JSON.parse` or zod error messages, because those messages can quote input.
8. THE Capture_Hook SHALL NOT wait for input beyond end-of-file on STDIN.
9. FOR ALL byte sequences supplied on STDIN, THE Capture_Hook SHALL exit with code 0 and write nothing to STDOUT or STDERR (error-condition property).
10. IF a Capture_Hook receives an invalid or unknown command-line argument, THEN THE Capture_Hook SHALL write a diagnostic to the Hook_Log, SHALL exit with code 0, and SHALL write nothing to STDOUT or STDERR.
11. THE requirements of this Requirement 6 SHALL NOT apply to the Firewall_Hook, which Requirement 8 governs.

### Requirement 7: Redaction

**User Story:** As an MCP server author, I want secrets removed before anything is stored, so that a jar can be committed and shared.

#### Acceptance Criteria

> **Amendment, 2026-11-25 (agent review round 05; `claude-direct:` — this note is not Kiro's text, Kiro's wording below is unchanged):** criteria 7 and 9 match keys "exact, case-sensitive", which left the canonical HTTP header `Authorization`, `accessToken`, `x-api-key` and `client_secret` unredacted in jars that are committed to git. The code now applies the sensitive-key rule of `keyMatcher` in `packages/core/src/redact.ts`: a key is sensitive when it equals a configured key, or when its words (split on case changes and separators, lowercased) contain the configured key's words as a contiguous run (`token` covers `X-Auth-Token`, not `max_tokens`). Tests: `packages/core/test/redact-keys.test.ts`.

1. THE Redact_Config reader SHALL parse `.specimen/redact.json` with a strict zod schema that requires `keys` and `patterns` to be arrays of strings and `text` to be `"redact"` or `"hash"`, and that treats an unknown key as invalid.
2. IF `.specimen/redact.json` is missing, THEN THE Post_Hook SHALL apply a built-in default Redact_Config equal to the content of the shipped `.specimen/redact.json`, so that a missing file does not store secrets.
3. IF `.specimen/redact.json` exists and fails its zod schema, THEN THE Post_Hook SHALL log the problem to the Hook_Log, SHALL append no Jar_Line for that call, SHALL leave the Counter_File and the Jar unchanged, and SHALL exit with code 0, so that an unvalidated configuration never lets a secret through.
4. IF a pattern in the Redact_Config is not a valid JavaScript regular expression source, or matches the empty string, THEN THE Post_Hook SHALL log the problem, naming the failing pattern's index in `patterns`, to the Hook_Log, SHALL append no Jar_Line for that call, SHALL leave the Counter_File and the Jar unchanged, and SHALL exit with code 0.
5. THE Redact_Config reader SHALL compile each pattern as a case-sensitive JavaScript RegExp with no flag other than the global flag used for replacement.
6. WHEN the Post_Hook builds a Jar_Line, THE Post_Hook SHALL apply the Redact_Config to `tool_input` and to the response before anything is written to disk.
7. WHEN a value at any nesting depth in `tool_input` sits under an object key that equals an entry in `keys` (exact, case-sensitive string match), THE Post_Hook SHALL replace that value, whatever its JSON type, with the Redaction_Marker and SHALL add its RFC 6901 JSON pointer, prefixed with `/input`, to `redacted`.
8. WHEN a string value at any nesting depth in `tool_input`, including a string element of an array, contains a match for a pattern in `patterns` tested against the decoded string value, THE Post_Hook SHALL replace the whole string value with the Redaction_Marker and SHALL add its JSON pointer, prefixed with `/input`, to `redacted`.
9. WHEN `tool_response` is a JSON_Response, THE Post_Hook SHALL locate, as a Value_Span in the raw `tool_response` text, every occurrence, including every duplicate key in the raw text, of each value that sits under an object key equal to an entry in `keys` (exact, case-sensitive) and of each string value whose decoded content contains a match for a pattern in `patterns`.
10. WHEN a located value contains another located value, THE Post_Hook SHALL replace and list only the outermost value.
11. WHEN the Post_Hook has located Value_Spans in a JSON_Response, THE Post_Hook SHALL replace each Value_Span in the raw text with the JSON string literal of the Redaction_Marker, SHALL add the JSON pointer of each replaced value, prefixed with `/response`, to `redacted`, and SHALL sort the pointers of `redacted` ascending by code-unit order with duplicates removed.
12. THE Post_Hook SHALL NOT re-serialise the parsed response object to produce `response_text`.
13. WHEN a JSON_Response contains no value to redact, THE Post_Hook SHALL store `response_text` byte-identical to `tool_response` and SHALL add no `/response` pointer to `redacted`.
14. WHEN a JSON_Response contains a number literal such as `425.00` outside every Value_Span, THE Post_Hook SHALL keep that literal unchanged in `response_text`, so that `"total":425.00` is stored as `"total":425.00` and not as `"total":425`.
15. FOR ALL JSON_Response texts, the characters of `response_text` outside the replaced Value_Spans SHALL equal the characters of `tool_response` outside the same spans (invariant property).
16. FOR ALL JSON_Response texts and Redact_Configs, THE Post_Hook SHALL produce `response_text` that parses as JSON (round-trip property).
17. THE shipped `.specimen/redact.json` SHALL include at least one pattern each that matches a bearer token (the word `Bearer` followed by a token), an API-key shape (a prefixed key such as `sk-` followed by at least 20 alphanumeric characters), and an e-mail address, SHALL list in `keys` at least `authorization`, `password`, `secret`, `token` and `api_key`, SHALL set `text` to `"redact"`, and SHALL equal the built-in default Redact_Config.
18. WHEN `tool_response` is not a JSON_Response and `text` is `"redact"`, THE Post_Hook SHALL replace each match of each pattern in `patterns` in the response text with the Redaction_Marker.
19. WHEN the Post_Hook applies the patterns to a response that is not a JSON_Response, THE Post_Hook SHALL set `text_redacted` to true on the Jar_Line, whether or not any pattern matched.
20. WHERE the Redact_Config has `text` set to `"hash"` and the response is not a JSON_Response, THE Post_Hook SHALL first replace each pattern match with the Redaction_Marker, SHALL set `response_text` to `sha256:` followed by the lowercase hex SHA-256 of the UTF-8 bytes of the replaced text, SHALL set `response_length` to the UTF-16 length of the replaced text, SHALL set `response` to null, SHALL set `text_redacted` to true, and SHALL store no other form of that text on the Jar_Line.
21. WHEN `tool_response` is a JSON_Response, THE Post_Hook SHALL leave `text_redacted` unset or false.
22. THE Post_Hook SHALL redact a value before it computes anything from that value, including the Input_Hash, the `response_text`, the `response_length` and the hash of a hashed response.
23. WHERE the Redact_Config has `text` set to `"redact"`, FOR ALL inputs, applying redaction twice SHALL produce the same result as applying it once (idempotence property).
24. WHEN the Post_Hook redacts a value, THE Post_Hook SHALL NOT write the original value to the Jar, the Pending_File, the Counter_File or the Hook_Log.

### Requirement 8: Firewall

**User Story:** As an MCP server author, I want the agent blocked from editing recorded jars, so that jars stay trustworthy evidence.

#### Acceptance Criteria

1. WHEN the Firewall_Hook receives a PreToolUse payload for a write whose target path resolves to a location under `<Workspace_Root>/jars`, THE Firewall_Hook SHALL exit with code 2 and SHALL write `jars are evidence and read-only` to STDERR.
2. WHEN the Firewall_Hook receives a PreToolUse payload for a write whose target paths do not resolve to a location under `<Workspace_Root>/jars`, THE Firewall_Hook SHALL exit with code 0.
3. THE Firewall_Hook SHALL resolve each candidate path against the payload `cwd`, and SHALL collapse `.` and `..` segments, before it compares the path with `<Workspace_Root>/jars`.
4. IF the Firewall_Hook cannot parse its STDIN payload or cannot find a candidate path, THEN THE Firewall_Hook SHALL exit with code 0 and write a diagnostic to the Hook_Log, because a parse failure cannot identify a target and must not block unrelated writes, and the manifest check of criterion 10 is the backstop.
5. THE Firewall_Hook SHALL write nothing to STDOUT.
6. THE Manifest_Command `specimen manifest write` SHALL write the Manifest in `sha256sum` format.
7. THE Manifest SHALL be verifiable with `sha256sum -c` run from the `jars/` directory.
8. WHEN `specimen manifest check` runs and every listed file has its recorded SHA-256 and no unlisted file exists, THE Manifest_Command SHALL exit with code 0.
9. IF `specimen manifest check` finds a missing file, a file whose SHA-256 differs, or a file under `jars/` that the Manifest does not list, THEN THE Manifest_Command SHALL list each such file on STDERR and exit with code 2, so that Kiro blocks the task and forwards STDERR.
10. THE Manifest_Check_Hook_File SHALL run `specimen manifest check` on PreTaskExec and on PostTaskExec, so that a shell write to `jars/` is detected even though shell writes are outside the write category.
11. THE Firewall_Hook SHALL NOT treat a write to the Manifest file path as an exception to the `jars/` rule.
12. FOR ALL paths, THE firewall decision function in `packages/core` SHALL return the same decision for a path, for the same path written with extra `.` segments or `dir/..` segments, and for the same path written with different letter case (invariant property).
13. THE Firewall_Hook SHALL treat every string value at any depth of `tool_input` as a candidate path.
14. THE firewall decision function SHALL block a candidate path that is equal to or under `<Workspace_Root>/jars`, comparing case-insensitively, both on the lexically collapsed path and on the path after the cli has resolved the symbolic links of its longest existing ancestor, and `packages/cli` SHALL perform the file system access and pass both results to the decision function.
15. THE Manifest_Command `specimen manifest write` SHALL write one line per regular file found recursively under `jars/`, other than the Manifest, in the form `<lowercase hex>  <path>` (two spaces, text mode), with each path relative to `jars/` using `/` separators and the lines sorted by byte order of the path.
16. WHEN `specimen manifest check` meets an operational error, THE Manifest_Command SHALL write a diagnostic to STDERR and exit with code 1.
17. THE Manifest_Command SHALL count a symbolic link under `jars/` as a file that the Manifest does not list.
18. IF the Manifest is missing and `jars/` holds at least one file, THEN `specimen manifest check` SHALL treat every file as unlisted and exit with code 2, and IF the Manifest is missing and `jars/` holds no file, THEN `specimen manifest check` SHALL exit with code 0.
19. THE Capture_Hook SHALL NOT write the Manifest.

### Requirement 9: Kiro wiring

**User Story:** As an MCP server author, I want the repository to ship ready-made Kiro configuration, so that capture works as soon as I open the project in Kiro.

#### Acceptance Criteria

1. THE repository SHALL contain `.kiro/settings/mcp.json` that registers the Demo_Server under the key `hollowinn` with the command `npx` and the arguments `tsx servers/hollow-inn/src/main.ts v1`.
2. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-jar-pre.json` with trigger `PreToolUse`, matcher `@hollowinn`, and an action of type `command` that runs exactly `npx --no-install specimen hook pre --server hollowinn`.
3. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-jar-post.json` with trigger `PostToolUse`, matcher `@hollowinn`, and an action of type `command` that runs exactly `npx --no-install specimen hook post --server hollowinn`.
4. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-jar-firewall.json` with trigger `PreToolUse`, matcher `write`, and an action of type `command` that runs exactly `npx --no-install specimen hook firewall`.
5. THE repository SHALL contain the Hook_File `.kiro/hooks/specimen-manifest-check.json` containing two hooks, one with trigger `PreTaskExec` and one with trigger `PostTaskExec`, each with an action of type `command` that runs exactly `npx --no-install specimen manifest check`.
6. THE repository SHALL contain the Hook_File `.kiro/hooks/post-task-tests.json` whose hook on trigger `PostTaskExec` has an action of type `command` that runs `npm test`, in addition to the Manifest_Check_Hook_File hook on the same trigger.
7. THE Test_Suite SHALL parse every Hook_File with a zod schema for the shape `{"version":"v1","hooks":[{"name","trigger","matcher","action":{"type":"command","command"}}]}` whose `trigger` values include `PreToolUse`, `PostToolUse`, `PreTaskExec` and `PostTaskExec`.
8. WHERE a hook has trigger `PreTaskExec` or `PostTaskExec`, THE Hook_File schema SHALL allow `matcher` to be absent.
9. THE commands in the pre, post and firewall Hook_Files SHALL contain no shell operator (`&&`, `||`, `|`, `;`, `>`, `<`), so that the exit code and the output are exactly those of the specimen command.

### Requirement 10: Boundaries and determinism

**User Story:** As a maintainer, I want the capture logic to follow the repository rules, so that the cabinet can bundle it and judging stays reproducible.

#### Acceptance Criteria

1. THE capture logic in `packages/core` SHALL contain no `node:` imports.
2. THE capture logic in `packages/core` SHALL take the current time, file contents and STDIN text as arguments and SHALL NOT read a clock, the file system or the network itself.
3. THE `packages/cli` hook commands SHALL perform all file, lock, STDIN, STDOUT, STDERR and clock access and SHALL pass the results to `packages/core` functions.
4. THE Capture_Hook SHALL parse every external input (STDIN payloads, `.specimen/pending.jsonl`, `.specimen/redact.json`, the workspace `.kiro/settings/mcp.json`, Jar_Lines) with a zod schema before using it.
5. THE Capture_Hook SHALL NOT write to any path under `jars/` other than `jars/<session_id>.jsonl`.
6. IF a Pending_File line fails its zod schema, THEN THE Pre_Hook and THE Post_Hook SHALL log the line number to the Hook_Log and SHALL keep the line unchanged in the Pending_File.
7. THE Capture_Hook SHALL make no network call and SHALL use no font or CDN resource.
8. THE Capture_Hook SHALL perform no mocking of the MCP protocol.
9. IF `session_id` does not match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` or contains `..`, THEN THE Capture_Hook SHALL log the problem to the Hook_Log and SHALL record nothing for that call, so that a payload cannot write outside `jars/`.
10. THE Capture_Hook and THE Firewall_Hook SHALL resolve every relative path of this specification (`jars/`, `.specimen/`, `.kiro/settings/mcp.json`) against the Workspace_Root.
11. THE SHA-256 function in `packages/core` SHALL contain no `node:` import and SHALL return the lowercase hex of the SHA-256 of the UTF-8 bytes of its input.

### Requirement 11: Tests

**User Story:** As a maintainer, I want automated tests for the capture behaviour, so that a regression in recording is caught before it corrupts evidence.

#### Acceptance Criteria

1. THE Test_Suite SHALL run under `npm test` at the repository root with vitest.
2. THE Test_Suite SHALL include a fast-check property that the Input_Hash is equal for any two JSON values that differ only in object key order.
3. THE Test_Suite SHALL include a test that pairs several Post_Payloads FIFO against Pending_Entries that share `session_id`, `tool_id` and `input_sha256`.
4. THE Test_Suite SHALL include a test that a Post_Payload with no matching Pending_Entry yields a Jar_Line with `unpaired` set to true, and that an unmatched Pending_Entry remains in the Pending_File.
5. THE Test_Suite SHALL include a fast-check property that a JSON_Response with nothing to redact is stored byte-identical.
6. THE Test_Suite SHALL include a test that redacting a response containing `"total":425.00` under a redacted sibling key stores `"total":425.00` unchanged.
7. THE Test_Suite SHALL include a test that a non-JSON response with a matching pattern is stored with the Redaction_Marker and `text_redacted` set to true.
8. THE Test_Suite SHALL include a test that `"text": "hash"` stores a non-JSON response as `response_text` equal to `sha256:<hex>`, with `response_length` set, `response` null and `text_redacted` true, and no other form of the text.
9. THE Test_Suite SHALL include tests of the firewall decision for a path under `jars/`, a path outside `jars/`, and a path with `..` segments that resolves into `jars/`.
10. THE Test_Suite SHALL include a test that each of the Pre_Hook, the Post_Hook and the Firewall_Hook, run as a child process on invalid STDIN and on invalid or unknown arguments, writes zero bytes to STDOUT, and that the Pre_Hook and the Post_Hook also write zero bytes to STDERR and exit with code 0.
11. THE Test_Suite SHALL include a test that `specimen manifest write` followed by `sha256sum -c` (or `shasum -a 256 -c` where `sha256sum` is unavailable) succeeds on a temporary copy of a jar directory, and that `specimen manifest check` fails with exit code 2 after one byte of a jar file changes in that copy.
12. THE Test_Suite SHALL include a test of server resolution that shows nested-prefix Server_Keys are ambiguous and record nothing without `--server`, a hyphenated Server_Key resolves through its Sanitised_Key, and a plain Server_Key resolves.
13. THE Test_Suite SHALL include a test that a Jar_Line round-trips through the Jar_Schema.
14. THE Test_Suite SHALL include a test that the first call of a session gets `seq` 1.
15. THE Test_Suite SHALL write jar and pending files only under a temporary directory and SHALL NOT modify files in the repository `jars/` directory.
16. THE Test_Suite SHALL include a test that the Pre_Hook and the Post_Hook compute an equal Input_Hash when the inputs differ only in key order or only in a redacted value.
17. THE Test_Suite SHALL include a test that a missing Counter_File while `jars/` holds Accession_IDs continues from the highest Accession_ID.
18. THE Test_Suite SHALL include a test that `seq` values stay unique when an Orphan is present.
19. THE Test_Suite SHALL include a test that a `session_id` containing `/`, `..` or `\` records nothing.
20. THE Test_Suite SHALL include a test that parallel hook runs, executed as real child processes, yield distinct `id` values and distinct `seq` values.
21. THE Test_Suite SHALL include a test that a lock timeout records nothing and leaves all files unchanged.
22. THE Test_Suite SHALL include a test that a Jar ending in a torn line is not appended to.
23. THE Test_Suite SHALL include tests of the `specimen manifest check` exit codes 0, 1 and 2 and of the missing-Manifest rules of Requirement 8 criterion 18.
24. THE Test_Suite SHALL include firewall tests for case variants, for a symbolic link into `jars/`, and for a target path held in a nested string field of `tool_input`.
25. THE Test_Suite SHALL include a test that the Hook_File commands of Requirement 9 criteria 2 to 5 equal the exact strings given there.
26. THE Test_Suite SHALL include a test that the shipped `.specimen/redact.json` equals the built-in default Redact_Config.
27. THE Test_Suite SHALL include an end-to-end test in `packages/cli`, using real child processes, that obtains the `tool_response` text from a real hollow-inn v1 `quote` call made with the real MCP SDK Client and no protocol mocks, feeds it through the Pre_Hook and then the Post_Hook, and asserts that the Jar_Line keeps money literals such as `425.00` byte-identical.
28. THE Test_Suite SHALL include an end-to-end test that feeds the exact Pre_Payload and Post_Payload shapes measured in `evidence/spikes/S3.md` through the Pre_Hook and the Post_Hook.

### Requirement 12: Concurrent hook runs

**User Story:** As a Kiro user, I want parallel tool calls recorded without corrupting each other, so that ids and sequence numbers stay unique.

#### Acceptance Criteria

1. WHILE a Pre_Hook or a Post_Hook reads or writes the Pending_File, the Counter_File or a Jar, THE hook SHALL hold the Lock_File exclusively.
2. THE hook SHALL obtain the Lock_File by creating it exclusively, so that creation fails when the file already exists.
3. WHEN the Lock_File is older than 10 seconds, THE hook SHALL treat it as stale, remove it, and retry.
4. IF the hook does not obtain the Lock_File within 2 seconds, THEN THE hook SHALL write a diagnostic to the Hook_Log, SHALL record nothing, SHALL leave all files unchanged, and SHALL exit with code 0.
5. WHEN a hook run ends, whether it succeeded or failed, THE hook SHALL release the Lock_File it holds.
6. FOR ALL sets of Pre_Hook and Post_Hook processes that run in parallel, THE Jar_Lines written SHALL carry distinct `id` values and, within one session, distinct `seq` values.
