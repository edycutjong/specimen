# cancel-booking-missing-tool Bugfix Design

## Overview

hollow-inn v2 renamed the tool `cancel_booking` to `booking_cancel`. v2.1 inherited that rename. Jar SPC-0009 recorded `cancel_booking` with `{"booking_id":"BK-0001"}` after a `book` call in the same session. On replay the tool no longer exists, so the jar is CRACKED and `replayed` is null.

The fix continues in `servers/hollow-inn/src/v2_1.ts`, in the same file and the same `v2.1` version used by the `quote` and `search_rooms` fixes. The tool registered as `booking_cancel` is registered as `cancel_booking` again, with the v1 input schema (`{ booking_id: string }`) and the v1 handler. `v1.ts` and `v2.ts` are not touched. Nothing under `jars/` is touched.

**Decision: rename back, do not keep `booking_cancel` as an alias.** Reasons:

- No jar uses `booking_cancel`. A search of `jars/*.jsonl` finds only `cancel_booking` (SPC-0009). No recorded call depends on the v2 name, so an alias protects nothing that was recorded.
- The rename is the smallest edit: one string literal in `registerTool`. An alias needs a second registration (or a shared handler plus two registrations) and keeps one extra tool in `tools/list`.
- With the rename, v2.1's `tools/list` equals v1's (same six names, same input schemas). The schema diff against the baseline drops to 0 changed tools. With an alias it would still report one tool added.
- Two tools that do the same thing give an agent two names to choose between, and an agent could keep calling the name v1 never had.
- The cost is that a v2 client using `booking_cancel` would break against v2.1. The replay evidence only covers v1 recordings, and `CHANGES.md` already marks the v2 rename as a regression to be reversed, so this is accepted. If a real `booking_cancel` caller appears, a later spec can add the alias.

The existing v2.1 tests assert the `booking_cancel` name in several places. They are updated as part of this fix (see Testing Strategy).

## Glossary

- **Bug_Condition (C)**: A `cancel_booking` call (the v1 name). On v2.1 the name is not registered, so the call cannot run.
- **Property (P)**: `cancel_booking` is in v2.1's `tools/list` with the v1 input schema, and the call returns the v1 response `{"booking_id":"BK-0001","status":"cancelled"}`.
- **Preservation**: Behaviour of every other v2.1 tool, and of v2.1's `cancel_booking` error cases (unknown booking, already cancelled), which stay identical to v1's.
- **createV2_1**: The factory in `servers/hollow-inn/src/v2_1.ts` that builds the v2.1 server. `createServer("v2.1")` calls it.
- **booking_cancel**: The v2 name for the cancel tool. It leaves v2.1's tool list with this fix.
- **SPC-0009**: The jar for the `cancel_booking` call on `BK-0001`, recorded in `jars/sess_854a0f71-fdbf-4cea-82fb-ab61a8255115.jsonl` at seq 5, after `book` (SPC-0008) in the same session.

## Bug Details

### Bug Condition

The bug manifests whenever a client calls the tool `cancel_booking` on v2.1. `createV2_1` registers the cancel handler under the name `booking_cancel`, so the server answers that `cancel_booking` is not an available tool. The replay engine records this as no replayed response, and the jar is CRACKED.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ToolCall { tool: string, arguments: object }
  OUTPUT: boolean

  RETURN input.tool = "cancel_booking"
         AND "cancel_booking" NOT IN toolNames(tools/list of v2.1)
END FUNCTION
```

### Examples

- SPC-0009: after `book {room_id:"r-01", check_in:"2026-12-11", nights:1, guest:"Guest"}` gives `BK-0001`, `cancel_booking {booking_id:"BK-0001"}` should return `{"booking_id":"BK-0001","status":"cancelled"}`. v2.1 today returns no response (tool missing).
- `cancel_booking {booking_id:"BK-9999"}` on a fresh v2.1 server should return the error `unknown booking BK-9999`, as v1 does. Today the tool is missing.
- Calling `cancel_booking` twice on the same booking should return `BK-0001 is already cancelled` the second time, as v1 does. Today the tool is missing.
- Edge case: `tools/list` on v2.1 should list `book, cancel_booking, get_room, list_bookings, quote, search_rooms`, and not `booking_cancel`.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `search_rooms` keeps the default limit of 20 and its description from the earlier fix. SPC-0001, SPC-0005 and SPC-0010 stay preserved.
- `quote` keeps `total` and `total_cents` from the earlier fix. SPC-0002, SPC-0006 and SPC-0007 stay preserved.
- `get_room`, `book` and `list_bookings` are unchanged, including `BK-0001` numbering on a fresh server and the `created_at` value from the injected clock.
- The cancel handler body is unchanged: same lookup, same `unknown booking <id>` and `<id> is already cancelled` errors, same `{booking_id, status}` response.
- The input schema of the cancel tool is unchanged: `{ booking_id: z.string() }`, required.
- `v1.ts`, `v2.ts`, their tests, `CHANGES.md` sections for v1.0.0 and v2.0.0, and everything under `jars/` are not modified.

**Scope:**
All inputs that are not a call to the tool named `cancel_booking` are unaffected. This includes:
- Calls to the five other tools, with any arguments.
- `tools/list` entries for the five other tools.
- Server name and version (`hollow-inn`, `2.1.0`).

## Hypothesized Root Cause

The cause is known from the source and from `CHANGES.md`, not a guess:

1. **Planted v2 rename (confirmed)**: v2 changed `registerTool("cancel_booking", ...)` to `registerTool("booking_cancel", ...)`. The input schema and handler are identical to v1's.
2. **Inherited by v2.1 (confirmed)**: `v2_1.ts` was started as a copy of v2 and the earlier fixes only changed `quote` and `search_rooms`. `CHANGES.md` lists the rename as "Not changed in v2.1, item (c)".
3. **No other cause**: the handler and schema match v1 line for line, so the replayed response will equal the recorded one once the name matches. The booking state is per server process, and the replay runs `book` first in the same session, so `BK-0001` exists when the cancel call runs.

## Correctness Properties

Property 1: Bug Condition - cancel_booking is available and answers as recorded

_For any_ call where the bug condition holds (the tool is `cancel_booking`), the fixed v2.1 server SHALL list `cancel_booking` in `tools/list` with the v1 input schema, and SHALL return the v1 response for the call. For SPC-0009, after `book` returns `BK-0001` in the same session, `cancel_booking {booking_id:"BK-0001"}` returns `{"booking_id":"BK-0001","status":"cancelled"}`.

**Validates: Requirements 2.1**

Property 2: Preservation - all other behaviour is unchanged

_For any_ input where the bug condition does NOT hold (a call to any other tool, or a `tools/list` entry for another tool), the fixed v2.1 SHALL produce the same result as v2.1 before the fix, preserving the `quote` total, the `search_rooms` default of 20, and the `get_room`, `book` and `list_bookings` responses. For the cancel tool's other inputs (unknown booking, already cancelled), v2.1 SHALL produce the same result as v1.

**Validates: Requirements 3.1**

## Fix Implementation

### Changes Required

**File**: `servers/hollow-inn/src/v2_1.ts`

**Function**: `createV2_1`

**Specific Changes**:
1. **Rename the registration**: change `"booking_cancel"` to `"cancel_booking"` in the `server.registerTool` call. The description, `inputSchema` (`{ booking_id: z.string() }`), annotations and handler stay as they are.
2. **Header comment**: update the first-line comment so it says v2.1 also restores `cancel_booking`, and that the rest of the tool set is v2 unchanged.
3. **No new imports**: the file already has no `node:` imports. Input validation stays with the zod schema at the tool boundary. The handler stays deterministic (no clock or randomness beyond the injected `state.now()` used by `book`).

**File**: `servers/hollow-inn/test/v2_1.test.ts` (update; the v2.1 suite is the only test file touched)

**Specific Changes**:
1. Change the tool-list assertions (the unit test at line 71 and the "lists the six tools" test) to expect `book, cancel_booking, get_room, list_bookings, quote, search_rooms`.
2. In the preservation block, `EXPECTED_SCHEMAS` and the "lists the six v2 tools" test compare against v2, which still has `booking_cancel`. Rework them so the baseline for the cancel tool is v1: v2.1's `cancel_booking` schema equals v1's, and the other five schemas still equal v2's.
3. `bookingFlow` and the booking-sequence property call the cancel tool on both baseline and subject. Make the call name a parameter: v2 uses `booking_cancel`, v2.1 uses `cancel_booking`. Responses must be equal.
4. Add the bug-condition case: on v2.1, `book {room_id:"r-01", check_in:"2026-12-11", nights:1, guest:"Guest"}` returns `BK-0001`, then `cancel_booking {booking_id:"BK-0001"}` returns exactly `{"booking_id":"BK-0001","status":"cancelled"}`. A second call returns `isError` with `BK-0001 is already cancelled`. An unknown id returns `unknown booking BK-9999`.
5. Add a case that `tools/list` has `cancel_booking` and does not have `booking_cancel`, and that v2.1's `cancel_booking` input schema equals v1's.

**File**: `servers/hollow-inn/CHANGES.md`

**Specific Changes**:
1. Rename the v2.1.0 heading to cover all three changes, for example "`quote` returns `total` again, `search_rooms` default limit is 20 again, `cancel_booking` is back".
2. Add a bullet: the cancel tool is registered as `cancel_booking` again, with the v1 input schema and response, and `booking_cancel` is no longer listed. This reverses change (c) from v2.0.0.
3. In "Not changed in v2.1", remove item (c). If the list is then empty, remove the "Not changed in v2.1" bullet and its sub-list.
4. Keep the bullet "All other tools behave as in v2.0.0".
5. The v2.0.0 and v1.0.0 sections are not edited.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface the counterexample on the unfixed v2.1, then verify the fix and that other behaviour is unchanged. Tests use the real MCP SDK client and server through the existing `connect` helper. No protocol mocks.

### Exploratory Bug Condition Checking

**Goal**: Show the failure on the unfixed code and confirm the cause is the name, not the handler.

**Test Plan**: Add the SPC-0009 flow test to `v2_1.test.ts` and run it on the unfixed `v2_1.ts`. Also run `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"` before the fix and note SPC-0009 as CRACKED.

**Test Cases**:
1. **SPC-0009 flow**: `book` then `cancel_booking {booking_id:"BK-0001"}` on v2.1 (fails on unfixed code: tool not found).
2. **Tool list**: `cancel_booking` is in the v2.1 list (fails on unfixed code).
3. **Already cancelled**: a second `cancel_booking` call returns the already-cancelled error (fails on unfixed code).
4. **Unknown booking**: `cancel_booking {booking_id:"BK-9999"}` returns `unknown booking BK-9999` (fails on unfixed code).

**Expected Counterexamples**:
- The call is rejected because `cancel_booking` is not an available tool.
- Cause: the registration name is `booking_cancel`. If the handler or schema also differs from v1, the hypothesis is wrong; they were read and match v1.

### Fix Checking

**Goal**: For all inputs where the bug condition holds, the fixed v2.1 gives the expected behaviour.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := v2_1_fixed(input)
  ASSERT result.text = v1(input).text AND result.isError = v1(input).isError
END FOR
```

### Preservation Checking

**Goal**: For all inputs where the bug condition does NOT hold, the fixed v2.1 gives the same result as v2.1 before the fix.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT v2_1_before(input) = v2_1_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing with `fast-check` is recommended for preservation. It covers many rooms, nights and tool sequences and catches edge cases that a few hand-picked examples would miss. The existing v2.1 preservation properties already compare v2.1 with v2 (and v1 for `search_rooms`); they are kept, with the cancel tool name adjusted as described above.

**Test Plan**: Observe v2.1 behaviour first for `get_room`, `search_rooms`, `quote`, `book` and `list_bookings`, then assert the same after the fix.

**Test Cases**:
1. **Other tool schemas**: the five other `inputSchema` values equal v2's.
2. **Other tool outputs**: the existing quote, get_room, search_rooms and booking properties pass unchanged.
3. **Cancel parity with v1**: for any sequence of `book`, `cancel_booking` and `list_bookings` calls, v2.1 text equals v1 text.

### Unit Tests

- SPC-0009 flow: `book` gives `BK-0001`, then `cancel_booking` gives `{"booking_id":"BK-0001","status":"cancelled"}`.
- Already-cancelled and unknown-booking errors for `cancel_booking`.
- `tools/list` contains `cancel_booking` and not `booking_cancel`; its input schema equals v1's.

### Property-Based Tests

- For any sequence of `book`, `cancel_booking` (ids `BK-0001` to `BK-0004`) and `list_bookings` calls, v2.1 equals v1 call by call (seeded `fast-check`).
- For any `quote`, `get_room` and `search_rooms` input, v2.1 is unchanged by the fix (existing properties).

### Integration Tests

- Run `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"`. Expected: SPC-0009 PRESERVED, every other jar still PRESERVED, verdict SHIP. This is the acceptance check.
- Run `npm test` at the repo root. `v1.test.ts` and `v2.test.ts` pass without edits.
- Confirm `git status` shows no changes to `v1.ts`, `v2.ts` or `jars/`, and that `jars/MANIFEST.sha256` still verifies.
