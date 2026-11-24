# Implementation Plan

## Overview

Add hollow-inn v2.1, whose `quote` returns both `total` and `total_cents`, so SPC-0002, SPC-0006 and SPC-0007 replay as PRESERVED.

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - quote returns `/total` and `/total_cents`
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it validates the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `quote` has no `total`
  - **Scoped PBT Approach**: Scope the property to the three jar inputs (r-04 × 2, r-01 × 1, r-02 × 1), then widen to `fc.constantFrom(...ROOMS.map(r => r.id))` × `fc.integer({min: 1, max: 30})`
  - Create `servers/hollow-inn/test/v2_1.test.ts` using `connect("v2.1")` from `helpers.ts` (real MCP SDK client and server over `InMemoryTransport`, no mocks, no clock or network)
  - Assert: the response contains `total` written as a two-decimal literal (`425.00`, `98.00`, `142.00`), `total_cents` is an integer, and `total_cents` equals `Math.round(total * 100)`
  - Assert the exact text for SPC-0002: `{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"total_cents":42500,"currency":"USD"}`
  - Run `npx vitest run servers/hollow-inn/test/v2_1.test.ts` on UNFIXED code. `v2.1` is not registered yet, so the test fails
  - Also observe the defect on v2 itself without changing any file: `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2"` shows SPC-0002, SPC-0006 and SPC-0007 RATTLED with `/total` removed and `/total_cents` added
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples (e.g. v2 returns `{"room_id":"r-04","nights":2,"nightly":212.50,"total_cents":42500,"currency":"USD"}` with no `total`)
  - Mark task complete when the test is written, run, and the failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - everything except the `quote` shape is unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code (v2) with `connect("v2")`: tool list (`book`, `booking_cancel`, `get_room`, `list_bookings`, `quote`, `search_rooms`) and every `inputSchema`; `search_rooms` without `limit` returns 5 rooms; `get_room`, `book` (first booking is `BK-0001`), `list_bookings` and `booking_cancel` text; `quote` for unknown room `r-99` returns `isError: true` with `unknown room r-99`; `quote` `nightly` is a two-decimal literal and `currency` is `"USD"`
  - Add to `servers/hollow-inn/test/v2_1.test.ts` property-based tests (fast-check, seeded) that compare v2.1 with v2 for all non-bug-condition inputs: same tool names, same input schemas, same text for the non-`quote` tools, same `quote` error text, and for any room and `nights` in 1..30 the v2.1 `quote` response without `total` equals the v2 response
  - Observe on the real files: `git diff --exit-code -- servers/hollow-inn/src/v1.ts servers/hollow-inn/src/v2.ts jars/` is clean
  - Run the observation checks on UNFIXED code against v2 (the v2.1 comparison cannot run until the fix exists, so run the same assertions with `connect("v2")` on both sides to confirm they pass)
  - **EXPECTED OUTCOME**: Observation checks PASS on unfixed code (this confirms the baseline to preserve)
  - Mark task complete when the tests are written, run against v2, and passing
  - _Requirements: 3.1_

- [ ] 3. Fix for `quote` omitting `total` on the server (add hollow-inn v2.1)

  - [ ] 3.1 Add `servers/hollow-inn/src/v2_1.ts`
    - Export `createV2_1(opts: InnOptions = {}): McpServer`, a complete module copied from `v2.ts` with server version `"2.1.0"`
    - Import `date` and `nights` from `./v1.js` and helpers from `./inn.js`, as v2 does. No `node:` imports
    - In the `quote` handler compute `const total = nightly(room).times(nights)` and return, in this order, `room_id`, `nights`, `nightly: nightly(room)`, `total`, `total_cents: total.cents`, `currency: "USD"`
    - Update the `quote` description: `total` is in dollars, `total_cents` is the same amount in integer cents
    - Keep everything else as v2: `search_rooms` default limit of 5, `booking_cancel` name, `quote` input schema, unknown-room error, `nights` validation
    - Do NOT edit `v1.ts`, `v2.ts` or anything under `jars/`
    - _Bug_Condition: isBugCondition(input) where input.server_version = "v2" AND findRoom(input.room_id) EXISTS AND input.nights IN 1..30 AND "total" NOT IN keys(quoteResponse(input))_
    - _Expected_Behavior: result.total = literal(nightly * nights) AND result.total_cents = nightly_cents * nights AND result.total_cents = result.total * 100_
    - _Preservation: every tool except the `quote` response shape behaves as in v2; v1.ts and v2.ts stay byte-for-byte unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1_

  - [ ] 3.2 Register v2.1 in `servers/hollow-inn/src/index.ts`
    - Import `createV2_1` from `./v2_1.js`
    - Change `VERSIONS` to `["v1", "v2", "v2.1"]`
    - Add `case "v2.1": return createV2_1(opts);` to the exhaustive `switch`
    - `main.ts` needs no change: confirm `npx tsx servers/hollow-inn/src/main.ts v2.1` starts
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.3 Complete `servers/hollow-inn/test/v2_1.test.ts`
    - Unit tests: SPC-0002 exact text (r-04 × 2); r-01 × 1 gives `total` `98.00` and `total_cents` 9800; r-02 × 1 gives `total` `142.00` and `total_cents` 14200; unknown room `r-99` gives `isError: true` with `unknown room r-99`; tool list is `book`, `booking_cancel`, `get_room`, `list_bookings`, `quote`, `search_rooms`; `search_rooms` without `limit` returns 5 rooms
    - Property tests: for any room and `nights` in 1..30, `total_cents === nightly.cents × nights`, the text contains `"total":<Money literal>`, and `total_cents === Math.round(total * 100)`
    - Serialiser check: `toJsonText({ total: new Money(42500) })` is `{"total":425.00}`
    - _Requirements: 2.1, 2.2, 2.3, 3.1_

  - [ ] 3.4 Add the v2.1 entry to `servers/hollow-inn/CHANGES.md`
    - Add a `## v2.1.0` section above v2.0.0: `quote` returns `total` again, alongside `total_cents`
    - State that the `search_rooms` default limit (b) and the `cancel_booking` rename (c) are not changed in v2.1 and are covered by later specs
    - Do not edit the existing v2.0.0 and v1.0.0 text
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - quote returns `/total` and `/total_cents`
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - Run `npx vitest run servers/hollow-inn/test/v2_1.test.ts`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - everything except the `quote` shape is unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation tests, now comparing v2.1 with v2
    - Run `git diff --exit-code -- servers/hollow-inn/src/v1.ts servers/hollow-inn/src/v2.ts jars/` and confirm it is clean
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1_

- [ ] 4. Checkpoint - Acceptance replay and full test run
  - Run `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"` on the committed jars
  - Confirm SPC-0002, SPC-0006 and SPC-0007 are PRESERVED
  - Report only what the replay shows. Jars for `search_rooms` and `cancel_booking` can still be RATTLED or CRACKED on v2.1, so the overall verdict can still be HOLD. That is expected and outside this spec
  - Run `npm test` at the repo root. Confirm the v1, v2, money and core suites pass, including `scripts/bench.ts detect` finding `v2_1.ts`
  - Confirm `v1.ts`, `v2.ts` and `jars/` are untouched (`git status`, `git diff --exit-code`)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Scope: only the `quote` regression. The `search_rooms` default limit and the `cancel_booking` to `booking_cancel` rename stay as in v2.
- `v1.ts`, `v2.ts` and everything under `jars/` must stay untouched.
- Tasks 1 and 2 are written and run before the fix. Task 1 is expected to fail, task 2 is expected to pass.
- SHIP means "replay clean on the recorded set". The acceptance run may still show HOLD because of the other v2 changes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.4"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["3.5", "3.6"] },
    { "id": 5, "tasks": ["4"] }
  ]
}
```
