# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - search_rooms default limit restored
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to calls with no `limit` where more than 5 rooms match (`guests <= 3`, for example SPC-0010 `{check_in:"2026-12-04", nights:2, guests:3}`)
  - Add to `servers/hollow-inn/test/v2_1.test.ts`: for generated `{check_in, nights, guests}` with no `limit` (fast-check, fixed seed, as in the existing file), v2.1 text equals v1 text (via `connect("v1")`) and the room count equals `min(20, matching)`
  - Add unit cases: the SPC-0010 input returns `["r-02","r-03","r-04","r-06","r-07","r-08","r-09"]`, and the `search_rooms` description contains `default 20`
  - Run the new tests on UNFIXED `servers/hollow-inn/src/v2_1.ts`
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists)
  - Document counterexamples (for example "v2.1 returns r-02..r-07 (5 rooms) where v1 returns 7; description says `default 5`")
  - Mark task complete when the tests are written, run, and the failure is documented
  - Do not edit `jars/`, `v1.ts` or `v2.ts`
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Explicit limit and other tools unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED v2.1: `{check_in:"2026-12-04", nights:2, guests:3, limit:50}` (SPC-0001 input) and `{check_in:"2026-12-11", nights:1, guests:2, limit:3}` (SPC-0005 input) return the same text as v2 and v1
  - Observe on UNFIXED v2.1: no-limit calls with 5 or fewer matching rooms (for example `guests: 8`) return the same text as v2
  - Write property-based tests: for any `{check_in, nights, guests, limit}` with `limit` in 1..50, v2.1 text equals v2 text; explicit cases for the SPC-0001 and SPC-0005 inputs; tool list is still `book, booking_cancel, get_room, list_bookings, quote, search_rooms`; `search_rooms` input schema (`limit` optional, min 1, max 50) is unchanged
  - Keep the existing quote, get_room, book, list_bookings and booking_cancel preservation tests as they are
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2_

- [x] 3. Fix for search_rooms default limit regressing from 20 to 5 in v2.1

  - [x] 3.1 Implement the fix in `servers/hollow-inn/src/v2_1.ts`
    - In `createV2_1`, tool `search_rooms`: change `.slice(0, limit ?? 5)` to `.slice(0, limit ?? 20)`
    - Change the tool description `(default 5)` to `(default 20)`; the rest of the description stays identical to v1
    - Update the header comment to say v2.1 restores both the `quote` `total` and the `search_rooms` default limit of 20
    - Leave the `limit` zod schema (`z.number().int().min(1).max(50).optional()`) and the shared `date` and `nights` imports from `v1.js` unchanged
    - Do not touch `servers/hollow-inn/src/v1.ts`, `servers/hollow-inn/src/v2.ts` or anything under `jars/`
    - _Bug_Condition: isBugCondition(input) where input.limit IS UNDEFINED AND COUNT(r IN ROOMS WHERE r.max_guests >= input.guests) > 5_
    - _Expected_Behavior: for such input, v2.1 returns the first min(20, matching) rooms in catalogue order, identical to v1 (includes r-08 and r-09 for SPC-0010)_
    - _Preservation: a supplied limit, no-limit calls with 5 or fewer matches, other tools, the booking_cancel rename and the quote total all behave as in v2.1 before the fix_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2_

  - [x] 3.2 Update the existing v2.1 tests that the fix breaks
    - File: `servers/hollow-inn/test/v2_1.test.ts`
    - Replace the unit test `search_rooms without limit returns 5 rooms` (expects `["r-02","r-03","r-04","r-06","r-07"]`) with the restored-default case: SPC-0010 input returns seven rooms ending `r-08`, `r-09`, and the description contains `default 20`
    - In the preservation test `search_rooms without limit returns the default 5 rooms, on both sides`, drop the no-limit comparison with v2 (it now differs by design) and keep the schema comparison
    - In the existing search preservation property, make `limit` required (`fc.integer({ min: 1, max: 50 })`) so v2.1 is compared with v2 only where they should agree
    - Keep the explicit-limit cases for SPC-0001 (`limit: 50`) and SPC-0005 (`limit: 3`, `guests: 2`) from task 2
    - Do not edit `v1.test.ts` or `v2.test.ts`
    - _Requirements: 2.1, 2.2, 3.1, 3.2_

  - [x] 3.3 Update the v2.1 entry in `servers/hollow-inn/CHANGES.md`
    - Rename the v2.1.0 heading to cover both changes, for example "`quote` returns `total` again, `search_rooms` default limit is 20 again"
    - Add a bullet: `search_rooms` default limit is 20 again when the caller sends no `limit`, and the description says so; this reverses change (b) from v2.0.0
    - In "Not changed in v2.1", remove item (b); keep (c) (`cancel_booking` stays renamed to `booking_cancel`) and reword the last bullet to say no bugfix spec has been filed for (c) yet
    - Leave the v2.0.0 and v1.0.0 sections unedited
    - _Requirements: 2.1, 2.2_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - search_rooms default limit restored
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - Run the bug condition exploration tests from task 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Explicit limit and other tools unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property tests from task 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2_

- [-] 4. Checkpoint - Final acceptance: real replay and full test run
  - Run `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"` (real MCP SDK client and server, no mocks)
  - Confirm SPC-0010 is PRESERVED, and SPC-0001, SPC-0005 and the quote jars (SPC-0002, SPC-0006, SPC-0007) are still PRESERVED
  - Note that the verdict may stay HOLD if another jar (for example the `booking_cancel` rename, owned by another spec) is not preserved; report that jar rather than fixing it here
  - Run `npm test` at the repo root and confirm everything passes, including `v1.test.ts` and `v2.test.ts` unchanged
  - Confirm `jars/MANIFEST.sha256` still verifies and `git status` shows no changes under `jars/`, `v1.ts` or `v2.ts`
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 2.1, 2.2, 3.1, 3.2_

## Notes

- Scope: only the `search_rooms` default limit in v2.1. The `booking_cancel` rename stays as in v2.
- `v1.ts`, `v2.ts` and everything under `jars/` must stay untouched.
- Tasks 1 and 2 are written and run before the fix. Task 1 is expected to fail, task 2 is expected to pass.
- SHIP means "replay clean on the recorded set". The acceptance run may still show HOLD because of the `booking_cancel` rename.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "3.5"] },
    { "id": 4, "tasks": ["4"] }
  ]
}
```
