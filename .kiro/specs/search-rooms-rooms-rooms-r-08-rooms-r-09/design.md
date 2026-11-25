# search_rooms default limit Bugfix Design

## Overview

In hollow-inn v2 (and v2.1 as it stands), `search_rooms` applies a default `limit` of 5 when the caller sends none. v1 used 20. Jar SPC-0010 recorded a call with no `limit` that returned seven rooms (`r-02`, `r-03`, `r-04`, `r-06`, `r-07`, `r-08`, `r-09`). Replay now returns five, so `/rooms` shrinks and `/rooms/r-08` and `/rooms/r-09` are removed.

The fix continues in `servers/hollow-inn/src/v2_1.ts`, the same file and the same `v2.1` version used by the earlier `quote` fix. It changes the default from 5 to 20 in the handler and in the tool description. A caller-supplied `limit` keeps its current behaviour. `v1.ts` and `v2.ts` are not touched. The `booking_cancel` rename stays as it is in v2.1 today; another spec owns it.

Scope of the change in v2.1 is two literals in `search_rooms` (`5` becomes `20` in the description and in `limit ?? 5`), plus a test update and a CHANGES.md edit.

## Glossary

- **Bug_Condition (C)**: A `search_rooms` call with no `limit` whose filtered room list (rooms with `max_guests >= guests`) has more than 5 entries.
- **Property (P)**: For such a call, v2.1 returns the same rooms as v1: the first `min(20, n)` matching rooms in catalogue order.
- **Preservation**: Calls that pass an explicit `limit`, and every other tool, behave exactly as in v2.1 today.
- **search_rooms**: Tool registered in `createV2_1` in `servers/hollow-inn/src/v2_1.ts`. It filters `ROOMS` by `max_guests`, slices to the limit, and maps with `roomView`.
- **DEFAULT_LIMIT**: The default applied when `limit` is `undefined`. v1: 20. v2 and v2.1 today: 5. After the fix: 20.
- **SPC-0010**: Jar in `jars/sess_2e9b7313-1fcc-4a05-9adc-987b528ae3b8.jsonl`, input `{check_in:"2026-12-04", nights:2, guests:3}`, no `limit`. Read-only evidence.
- **SPC-0001 / SPC-0005**: Jars with explicit `limit` 50 and `limit` 3. They are preserved today and must stay so.

## Bug Details

### Bug Condition

The bug manifests when `limit` is absent. The handler in `v2_1.ts` evaluates `.slice(0, limit ?? 5)`, so the fallback is 5 instead of v1's 20. Any guest count with more than five matching rooms loses the tail. The tool description also says "default 5", so the documentation matches the wrong behaviour.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SearchRoomsCall { check_in, nights, guests, limit? }
  OUTPUT: boolean

  matching := COUNT(r IN ROOMS WHERE r.max_guests >= input.guests)
  RETURN input.limit IS UNDEFINED
         AND matching > 5
END FUNCTION
```

### Examples

- SPC-0010 `{check_in:"2026-12-04", nights:2, guests:3}`: recorded 7 rooms ending `r-08`, `r-09`. v2.1 today returns 5 (`r-02`..`r-07`, without `r-05`, which sleeps fewer than 3). Expected: all 7.
- `{guests:1}` with no limit: v1 returns up to 20 rooms. v2.1 today returns 5. Expected: same as v1.
- `{guests:3, limit:50}` (SPC-0001): returns every matching room today and after the fix. Not buggy.
- `{guests:2, limit:3}` (SPC-0005): returns 3 rooms today and after the fix. Not buggy.
- Edge: `{guests:8}` with no limit and 5 or fewer matching rooms. Same result before and after. Not buggy.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A caller-supplied `limit` (1..50) slices exactly as before (SPC-0001 with limit 50, SPC-0005 with limit 3).
- The `search_rooms` input schema (including `limit` min 1, max 50, optional) is unchanged. The default is not part of the schema.
- Response shape and text for `search_rooms` are unchanged: `{check_in, nights, guests, rooms}` with two-decimal `nightly` literals.
- `quote` keeps `total` and `total_cents` from the earlier fix. SPC-0002, SPC-0006 and SPC-0007 stay preserved.
- `booking_cancel` stays named `booking_cancel`. The tool list stays `book, booking_cancel, get_room, list_bookings, quote, search_rooms`.
- `get_room`, `book` and `list_bookings` are unchanged.
- `v1.ts`, `v2.ts`, their tests, and everything under `jars/` are not modified.

**Scope:**
All inputs where `limit` is supplied, and all inputs where `limit` is absent but five or fewer rooms match, are unaffected. Every other tool is unaffected.

## Hypothesized Root Cause

The cause is known from reading the source and CHANGES.md, not guessed:

1. **Changed default in the handler**: v2 deliberately changed `limit ?? 20` to `limit ?? 5` (CHANGES.md item (b)). `v2_1.ts` copied v2 and still has `limit ?? 5`.
2. **Description repeats the value**: The tool description says "default 5". The default is not in the zod schema, so `tools/list` schemas do not reveal the change. Both the code and the text must change together.
3. **Tests encode the regression**: `v2_1.test.ts` asserts that no-limit returns 5 rooms (`search_rooms without limit returns 5 rooms`) and expects `["r-02","r-03","r-04","r-06","r-07"]`. Its search preservation property compares v2.1 against v2 for any optional `limit`. After the fix, those comparisons will differ whenever `limit` is undefined and more than five rooms match.

## Correctness Properties

Property 1: Bug Condition - search_rooms default limit restored

_For any_ `search_rooms` call where the bug condition holds (isBugCondition returns true), the fixed v2.1 handler SHALL return the first `min(20, matching)` rooms in catalogue order, identical to v1's response for the same input, which includes `r-08` and `r-09` for the SPC-0010 input.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - explicit limit and other tools unchanged

_For any_ input where the bug condition does NOT hold (a supplied `limit`, or no `limit` with five or fewer matches, or any other tool), the fixed v2.1 SHALL produce the same result as v2.1 before the fix, preserving the SPC-0001 (limit 50) and SPC-0005 (limit 3) responses, the quote jars, and the `booking_cancel` rename.

**Validates: Requirements 3.1, 3.2**

## Fix Implementation

### Changes Required

**File**: `servers/hollow-inn/src/v2_1.ts`

**Function**: `createV2_1`, tool `search_rooms`

**Specific Changes**:
1. **Handler default**: change `.slice(0, limit ?? 5)` to `.slice(0, limit ?? 20)`.
2. **Description**: change `(default 5)` to `(default 20)`. The rest of the description text stays identical to v1's.
3. **Header comment**: update the top comment to say v2.1 restores both the `quote` `total` and the `search_rooms` default limit of 20.
4. **No schema change**: leave `limit: z.number().int().min(1).max(50).optional()` as is. Keep the shared `date` and `nights` imports from `v1.js`.

**File**: `servers/hollow-inn/test/v2_1.test.ts`

1. Replace the `search_rooms without limit returns 5 rooms` unit test with one asserting the restored default: the SPC-0010 input returns seven rooms with ids `["r-02","r-03","r-04","r-06","r-07","r-08","r-09"]`, and the tool description contains `default 20`.
2. Add a bug-condition test that compares v2.1 with v1 (via `connect("v1")`) for generated `{check_in, nights, guests}` calls with no `limit`. Both must return identical text.
3. Add explicit-limit cases: `limit: 50` (SPC-0001 input) and `limit: 3` with `guests: 2` (SPC-0005 input) return the same text on v2.1 and v2. The recorded text of these two jars is not re-read from `jars/` in tests; the comparison is against v2 and v1, which agree on explicit limits.
4. In the existing preservation test `search_rooms without limit returns the default 5 rooms, on both sides`, drop the no-limit comparison with v2 (it now differs by design). Keep the schema comparison.
5. In the existing search preservation property, make `limit` required (`fc.integer({ min: 1, max: 50 })`) so v2.1 is still compared with v2 only where the two should agree.

**File**: `servers/hollow-inn/CHANGES.md`

1. Rename the v2.1.0 heading to cover both changes, for example "`quote` returns `total` again, `search_rooms` default limit is 20 again".
2. Add a bullet: `search_rooms` default limit is 20 again when the caller sends no `limit`; the description says so. This reverses change (b) from v2.0.0.
3. In "Not changed in v2.1", remove item (b). Keep (c) (`cancel_booking` stays renamed to `booking_cancel`). Reword the last bullet so it says no bugfix spec has been filed for (c) yet.
4. The v2.0.0 and v1.0.0 sections are not edited.

No other file changes. `index.ts` and `main.ts` already route `v2.1` to `createV2_1`.

## Testing Strategy

### Validation Approach

First surface the failure on the current v2.1, then confirm the fix and the preserved behaviour. The final acceptance check is a real replay, not a mock: `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"`, which uses the real MCP SDK client and server.

### Exploratory Bug Condition Checking

**Goal**: Show the failure on unfixed v2.1 and confirm the root cause (the `?? 5` fallback).

**Test Plan**: Run the new bug-condition tests against the current `v2_1.ts` before editing it.

**Test Cases**:
1. **SPC-0010 input**: call `search_rooms` with `{check_in:"2026-12-04", nights:2, guests:3}` and expect seven rooms (fails: returns five).
2. **Description text**: expect `default 20` in the `search_rooms` description (fails: says `default 5`).
3. **v1 parity, guests 1**: no `limit`, compare text with v1 (fails: v2.1 has 5 rooms).
4. **Few matches**: `guests: 8` with five or fewer matches, compare with v1 (may already pass; confirms the condition needs more than five matches).

**Expected Counterexamples**:
- v2.1 returns `r-02`..`r-07` (five) where v1 returns seven.
- The cause is the `limit ?? 5` literal and the matching description text, not the filter or `roomView`.

### Fix Checking

**Goal**: For every call in the bug condition, v2.1 returns what v1 returns.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := search_rooms_v2_1_fixed(input)
  ASSERT result.text = search_rooms_v1(input).text
  ASSERT result.rooms.length = MIN(20, matching(input.guests))
END FOR
```

### Preservation Checking

**Goal**: For every call outside the bug condition, fixed v2.1 equals v2.1 before the fix.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT search_rooms_v2_1_original(input) = search_rooms_v2_1_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing fits because `limit`, `guests`, `nights` and `check_in` have wide input ranges, and for supplied limits v2 is an unchanged reference to compare against.

**Test Plan**: The existing v2.1 preservation suite already compares v2.1 with v2 on `search_rooms` and the other tools. Keep it, restricted to calls with a supplied `limit` for `search_rooms`, so it observes unchanged behaviour.

**Test Cases**:
1. **Explicit limit parity**: for any `limit` 1..50 and any `guests`, v2.1 text equals v2 text.
2. **SPC-0001 and SPC-0005 inputs**: v2.1 matches v2 and v1 on `limit` 50 and `limit` 3.
3. **Other tools**: the quote, get_room, book, list_bookings and booking_cancel preservation tests pass without edits.
4. **Tool list and schemas**: still six tools with `booking_cancel`; `search_rooms` input schema unchanged.

### Unit Tests

- SPC-0010 input returns seven rooms ending `r-08`, `r-09`.
- `search_rooms` description contains `default 20`.
- `limit: 3` and `limit: 50` return the same rooms as before the fix.
- `guests: 8` with few matches returns the same rooms before and after.

### Property-Based Tests

- For any `{check_in, nights, guests}` with no `limit`, v2.1 text equals v1 text (fast-check, fixed seed, as in the existing file).
- For any `{check_in, nights, guests, limit}`, v2.1 text equals v2 text.
- For any no-limit call, the room count equals `min(20, matching)` and the ids are a prefix of the catalogue-ordered matches.

### Integration Tests

- Real replay: `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"` shows SPC-0010 PRESERVED, with SPC-0001, SPC-0005 and the quote jars (SPC-0002, SPC-0006, SPC-0007) still PRESERVED. The verdict stays HOLD only if some other jar is not preserved; the `booking_cancel` rename is owned by another spec and may still show a jar as CRACKED.
- `npm test` at the repo root passes, including `v1.test.ts` and `v2.test.ts` unchanged.
- `jars/MANIFEST.sha256` still verifies, since no jar is edited.
