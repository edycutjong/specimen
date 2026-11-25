# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - cancel_booking is missing on v2.1
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: The bug is deterministic, so scope the property to the concrete failing case: the tool name `cancel_booking` with `booking_id` `BK-0001` after a `book` call in the same session
  - Add the test to `servers/hollow-inn/test/v2_1.test.ts`, using the real MCP SDK client and server through the existing `connect` helper (no protocol mocks)
  - SPC-0009 flow: on v2.1, `book {room_id:"r-01", check_in:"2026-12-11", nights:1, guest:"Guest"}` returns `BK-0001`, then `cancel_booking {booking_id:"BK-0001"}` returns exactly `{"booking_id":"BK-0001","status":"cancelled"}`
  - Also assert: `tools/list` on v2.1 contains `cancel_booking` and does not contain `booking_cancel`; a second cancel returns `isError` with `BK-0001 is already cancelled`; `cancel_booking {booking_id:"BK-9999"}` returns `unknown booking BK-9999`
  - Run the new test on UNFIXED `v2_1.ts`
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "`cancel_booking` is rejected on v2.1 because the tool is registered as `booking_cancel`")
  - Optionally record the pre-fix replay: `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"` shows SPC-0009 CRACKED
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Other v2.1 tools and cancel semantics unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED v2.1: `quote` returns `total` and `total_cents`; `search_rooms` defaults to a limit of 20; `get_room`, `book` and `list_bookings` match v2; `book` numbers the first booking `BK-0001`
  - Observe on UNFIXED v2.1: the `booking_cancel` tool has the same `inputSchema` as v1's `cancel_booking` (`{ booking_id: string }`, required) and the same handler errors (`unknown booking <id>`, `<id> is already cancelled`)
  - Write property-based tests (seeded `fast-check`) in `servers/hollow-inn/test/v2_1.test.ts` for inputs where isBugCondition is false (any call to `book`, `get_room`, `list_bookings`, `quote`, `search_rooms`): v2.1 results equal the observed baseline; the five other `inputSchema` values equal v2's
  - Keep the existing v2.1 preservation properties passing, unchanged in meaning
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1_

- [x] 3. Fix for missing `cancel_booking` tool on hollow-inn v2.1

  - [x] 3.1 Implement the fix in `servers/hollow-inn/src/v2_1.ts`
    - In `createV2_1`, change the `server.registerTool` name from `"booking_cancel"` to `"cancel_booking"`
    - Keep the description, `inputSchema` (`{ booking_id: z.string() }`), annotations and handler unchanged
    - Update the first-line header comment to say v2.1 also restores `cancel_booking` and that the rest of the tool set is v2 unchanged
    - Add no imports and no `node:` imports; do not keep `booking_cancel` as an alias
    - Do not edit `servers/hollow-inn/src/v1.ts`, `servers/hollow-inn/src/v2.ts`, or anything under `jars/`
    - _Bug_Condition: isBugCondition(input) where input.tool = "cancel_booking" AND "cancel_booking" NOT IN toolNames(tools/list of v2.1)_
    - _Expected_Behavior: `cancel_booking` is in v2.1 `tools/list` with the v1 input schema, and v2_1_fixed(input) equals v1(input) in text and isError; SPC-0009 returns `{"booking_id":"BK-0001","status":"cancelled"}`_
    - _Preservation: other five tools, their schemas, server name and version `2.1.0`, and cancel error cases stay identical_
    - _Requirements: 2.1, 3.1_

  - [x] 3.2 Update the existing v2.1 tests in `servers/hollow-inn/test/v2_1.test.ts`
    - Change the tool-list assertions (the unit test near line 71 and the "lists the six tools" test) to expect `book, cancel_booking, get_room, list_bookings, quote, search_rooms`
    - Rework `EXPECTED_SCHEMAS` and the "lists the six v2 tools" test: the baseline for the cancel tool is v1 (v2.1 `cancel_booking` schema equals v1's), and the other five schemas still equal v2's
    - Make the cancel call name a parameter in `bookingFlow` and the booking-sequence property: v2 uses `booking_cancel`, v2.1 uses `cancel_booking`; responses must be equal
    - Add a booking-sequence property: for any sequence of `book`, `cancel_booking` (ids `BK-0001` to `BK-0004`) and `list_bookings` calls, v2.1 text equals v1 text call by call
    - Confirm the SPC-0009 case from task 1 is present: `cancel_booking` called on a booking made by `book` in the same session
    - Do not edit `v1.test.ts` or `v2.test.ts`
    - _Requirements: 2.1, 3.1_

  - [x] 3.3 Update the v2.1 entry in `servers/hollow-inn/CHANGES.md`
    - Rename the v2.1.0 heading to cover all three changes: `quote` returns `total` again, `search_rooms` default limit is 20 again, `cancel_booking` is back
    - Add a bullet: the cancel tool is registered as `cancel_booking` again, with the v1 input schema and response, and `booking_cancel` is no longer listed; this reverses change (c) from v2.0.0
    - In "Not changed in v2.1", remove item (c); if the list is then empty, remove the "Not changed in v2.1" bullet and its sub-list
    - Keep the bullet "All other tools behave as in v2.0.0"
    - Do not edit the v1.0.0 and v2.0.0 sections
    - _Requirements: 2.1_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - cancel_booking is available and answers as recorded
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - Run the bug condition exploration test from task 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Other v2.1 tools and cancel semantics unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property tests from task 2 (with the cancel name adjusted per 3.2)
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after the fix

- [ ] 4. Final acceptance
  - [ ] 4.1 Replay the jars against the fixed v2.1
    - Run `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"`
    - Confirm SPC-0009 is PRESERVED, every other jar is PRESERVED, and the verdict is SHIP
    - Report only what the replay shows; SHIP means replay clean on the recorded set, not that the server is safe
    - _Requirements: 2.1, 3.1_

  - [ ] 4.2 Run the full test suite
    - Run `npm test` at the repo root
    - Confirm `v1.test.ts` and `v2.test.ts` pass without edits
    - _Requirements: 3.1_

  - [ ] 4.3 Confirm evidence and baselines are untouched
    - Run `git status` and `git diff --stat`; confirm no changes to `servers/hollow-inn/src/v1.ts`, `servers/hollow-inn/src/v2.ts`, or anything under `jars/`
    - Confirm `jars/MANIFEST.sha256` still verifies
    - Confirm the only changed files are `servers/hollow-inn/src/v2_1.ts`, `servers/hollow-inn/test/v2_1.test.ts`, `servers/hollow-inn/CHANGES.md`, and any replay output the replay command writes under `replays/`
    - _Requirements: 3.1_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Scope: only the `cancel_booking` to `booking_cancel` rename. The `quote` and `search_rooms` fixes already in v2.1 stay as they are.
- `v1.ts`, `v2.ts` and everything under `jars/` must stay untouched.
- Tasks 1 and 2 are written and run before the fix. Task 1 is expected to fail, task 2 is expected to pass.
- SHIP means "replay clean on the recorded set". It never means "this server is safe".

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "3.5"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 5, "tasks": ["5"] }
  ]
}
```
