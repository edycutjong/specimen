# quote-total-total-cents Bugfix Design

## Overview

hollow-inn v2 replaced the `total` field of the `quote` response with `total_cents`. Three jars of `quote` (SPC-0002, SPC-0006, SPC-0007) recorded against v1 now replay as RATTLED, because `/total` is removed and `/total_cents` is added.

The fix ships as a new server version, `v2.1`, in `servers/hollow-inn/src/v2_1.ts`. In v2.1 the `quote` tool returns both `total` (dollars, written as a two-decimal literal such as `425.00`) and `total_cents` (integer cents). The change is additive against v1, so the diff reports only `/total_cents` as added and the three jars are PRESERVED.

Scope limits:
- `v1.ts` and `v2.ts` are not edited. Recorded jars and `CHANGES.md` describe them.
- v2.1 fixes only the `quote` regression. The `search_rooms` default limit of 5 and the `cancel_booking` to `booking_cancel` rename stay as in v2. They have their own specs.
- Files under `jars/` are not edited.

## Glossary

- **Bug_Condition (C)**: A `quote` call, with a known room and valid nights, made against a server whose `quote` response has no `total` member. Today that is v2.
- **Property (P)**: The `quote` response contains `total` equal to the nightly rate times `nights`, written as a two-decimal literal, and also contains `total_cents`.
- **Preservation**: Every behavior of v2 other than the `quote` response shape stays the same in v2.1, and v1 and v2 stay byte-for-byte unchanged.
- **Money**: The class in `servers/hollow-inn/src/money.ts`. It holds integer cents and writes a two-decimal JSON literal through `toJsonText`.
- **toJsonText**: The money-aware serialiser behind `ok()` in `inn.ts`. It writes a `Money` value as `425.00`, where `JSON.stringify` would write `425`.
- **createV2 / createV2_1**: Factory functions that build the `McpServer` for a version. `createServer(version)` in `index.ts` selects between them.
- **Additive change**: A change the replay diff reports only as an `added` member with no rename note. It does not make a jar RATTLED.

## Bug Details

### Bug Condition

The bug manifests when `quote` is called on v2. The handler in `v2.ts` returns `total_cents: nightly(room).times(nights).cents`, a plain integer, and does not return `total`. The diff sees `/total` removed and `/total_cents` added, and its rename detection attaches the change pair to each jar.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type QuoteCall { server_version, room_id, nights }
  OUTPUT: boolean

  RETURN input.server_version = "v2"
         AND findRoom(input.room_id) EXISTS
         AND input.nights IN 1..30
         AND "total" NOT IN keys(quoteResponse(input))
END FUNCTION
```

### Examples

- SPC-0002, `quote {room_id: "r-04", nights: 2}`. Recorded: `{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"currency":"USD"}`. v2 returns `total_cents: 42500` and no `total`.
- SPC-0006, `quote {room_id: "r-01", nights: 1}`. Recorded `total` is `98.00`. v2 returns `total_cents: 9800` and no `total`.
- SPC-0007, `quote {room_id: "r-02", nights: 1}`. Recorded `total` is `142.00`. v2 returns `total_cents: 14200` and no `total`.
- Expected v2.1 text for SPC-0002: `{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"total_cents":42500,"currency":"USD"}`. It contains the recorded `total` literal unchanged, plus `total_cents`.
- Edge case: `quote {room_id: "r-99", nights: 1}` has an unknown room. v2.1 returns the same error as v1 and v2 (`unknown room r-99`, `isError: true`). It is not part of the bug condition.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `v1.ts` and `v2.ts` are byte-for-byte unchanged. `createServer("v1")` and `createServer("v2")` behave exactly as before, including `quote` on v2 returning `total_cents` only.
- In v2.1, `nightly` is still written as a two-decimal literal and `currency` is still `"USD"`.
- The `quote` input schema (`room_id`, `nights`) is unchanged, so the `tools/list` schema diff for `quote` stays empty.
- v2.1 keeps v2's other behavior: `search_rooms` defaults to 5 rooms, and `booking_cancel` replaces `cancel_booking`.
- `get_room`, `book` and `list_bookings` behave as in v2, including `BK-0001` numbering per fresh server.
- Unknown-room errors and `nights` range validation for `quote` are unchanged.
- Requirement 3.1: no preserved jar of `quote` exists, so there is no preserved jar to cite. This design does not claim one.

**Scope:**
All inputs that are not `quote` calls on the new v2.1 server are unaffected. This includes:
- Every call to any tool on `v1` and `v2`.
- Every non-`quote` tool on v2.1.
- Error responses of `quote` on v2.1.

## Hypothesized Root Cause

The cause is known from the code and from CHANGES.md item (a), so it is stated rather than guessed:

1. **Deliberate field replacement in v2**: The v2 `quote` handler swapped `total: nightly(room).times(nights)` (a `Money`, serialised as `425.00`) for `total_cents: ....cents` (a plain number). The v2 suite was updated to match, so it passes while the recorded calls break.
2. **Not a serialiser fault**: `money.ts` writes `Money` values correctly. The v2 handler passes a plain number, so `toJsonText` writes `42500`.
3. **Not a schema fault**: The `quote` input schema is identical in v1 and v2. Only the output differs.

Possible but ruled out: the diff or normalise code in `packages/core`. The repro block shows the replayed JSON really lacks `total`, so the defect is in the server.

## Correctness Properties

Property 1: Bug Condition - quote returns `/total` and `/total_cents`

_For any_ `quote` call with a known room and `nights` in 1..30 (the call shape for which isBugCondition holds on v2), the v2.1 server SHALL return a response whose `total` is the nightly rate times `nights` written as a two-decimal literal (`425.00` for r-04 × 2, `98.00` for r-01 × 1, `142.00` for r-02 × 1), and whose `total_cents` is the same amount as an integer number of cents, with `total_cents` equal to `total` × 100.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - everything except the `quote` shape on v2.1 is unchanged

_For any_ input where the bug condition does NOT hold (any call on v1 or v2, any non-`quote` tool on v2.1, and any `quote` error on v2.1), the result SHALL be the same as the result of the unfixed server for that tool, preserving response text, tool list, input schemas and error behavior. `v1.ts` and `v2.ts` SHALL remain byte-for-byte identical.

**Validates: Requirements 3.1**

## Fix Implementation

### Changes Required

Assuming the root cause above:

**File**: `servers/hollow-inn/src/v2_1.ts` (new)

**Function**: `createV2_1(opts: InnOptions = {}): McpServer`

**Specific Changes**:
1. **New factory**: Follow the convention that each version is a complete module (`v2.ts` is itself a copy of `v1.ts` with changes). Copy the tool set of `v2.ts` unchanged, and set the server version to `"2.1.0"`. Import `date` and `nights` from `./v1.js` and the helpers from `./inn.js`, as v2 does. No `node:` imports.
2. **quote handler**: Return, in this order, `room_id`, `nights`, `nightly`, `total`, `total_cents`, `currency`:
   ```
   const total = nightly(room).times(nights);
   return ok({ room_id, nights, nightly: nightly(room), total, total_cents: total.cents, currency: "USD" });
   ```
   `total` is a `Money`, so `toJsonText` writes `425.00`. `total_cents` is an integer computed from the same `Money`, so the two cannot disagree.
3. **quote description**: State that `total` is in dollars and `total_cents` is the same amount in integer cents. The description is not part of the replay comparison.
4. **Everything else as v2**: `search_rooms` keeps the default of 5, and `booking_cancel` keeps its v2 name.

**File**: `servers/hollow-inn/src/index.ts`

1. Import `createV2_1` from `./v2_1.js`.
2. Change `VERSIONS` to `["v1", "v2", "v2.1"]`. `Version` and `isVersion` follow from it.
3. Add `case "v2.1": return createV2_1(opts);` to the `switch`. The switch stays exhaustive, so TypeScript strict flags a missing case.

`main.ts` needs no change. It already accepts any value in `VERSIONS`, so `npx tsx servers/hollow-inn/src/main.ts v2.1` works once `index.ts` is updated.

**File**: `servers/hollow-inn/test/v2_1.test.ts` (new)

Its own suite, using `connect("v2.1")` from `helpers.ts` (see Testing Strategy).

**File**: `servers/hollow-inn/CHANGES.md`

Add a `## v2.1.0` section above v2.0.0: `quote` returns `total` again, alongside `total_cents`. State that (b) and (c) are not changed in v2.1 and are covered by later specs. Do not edit the existing v2.0.0 and v1.0.0 text.

**Why the diff reports PRESERVED**: v2.1 has `total` with the recorded literal, and `total_cents` is an extra member. `replay.ts` treats an `added` change without a rename note as additive. Rename detection pairs a removed and an added member, and no member is removed here. This is a property of the existing replay code, so the acceptance run below verifies it rather than assuming it.

## Testing Strategy

### Validation Approach

The strategy first surfaces counterexamples on unfixed code (v2), then checks the fix on v2.1 for all buggy inputs, then checks that everything else is unchanged. All tests use the real MCP SDK client and server over `InMemoryTransport` (through `helpers.ts`), with no protocol mocks. Tests are deterministic: no clock, randomness or network outside the seeded fast-check generator.

### Exploratory Bug Condition Checking

**Goal**: Show on v2 that `total` is missing for the three jar inputs, and confirm that the cause is the handler rather than the serialiser.

**Test Plan**: Call `quote` on `connect("v2")` for the three repro inputs and assert the response has `total`. Run it on the unfixed code and expect failures.

**Test Cases**:
1. **SPC-0002 on v2**: `quote {r-04, 2}` has no `total` (will fail on unfixed code).
2. **SPC-0006 on v2**: `quote {r-01, 1}` has no `total` (will fail on unfixed code).
3. **SPC-0007 on v2**: `quote {r-02, 1}` has no `total` (will fail on unfixed code).
4. **Serialiser check**: `toJsonText({ total: new Money(42500) })` is `{"total":425.00}`. This passes on unfixed code and rules out the serialiser as the cause.

**Expected Counterexamples**:
- The response text is `{"room_id":"r-04","nights":2,"nightly":212.50,"total_cents":42500,"currency":"USD"}` with no `total`.
- Cause: the v2 handler passes a plain integer instead of `Money` under a renamed key.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed server produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := quote_v2_1(input)
  ASSERT result.total = literal(nightly(input.room_id) * input.nights)
  ASSERT result.total_cents = nightly_cents(input.room_id) * input.nights
  ASSERT result.total_cents = result.total * 100
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, v2.1 gives the same result as v2 (or v1 for unchanged parts), and that v1 and v2 are untouched.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT tool_v2_1(input) = tool_v2(input)
END FOR
```

**Testing Approach**: Property-based testing, with `fast-check`, is recommended for preservation because it covers many rooms, nights and tools automatically and catches edge cases a few hand-picked examples would miss.

**Test Plan**: Observe v2 behavior first for `get_room`, `search_rooms`, `book`, `list_bookings`, `booking_cancel` and `quote` errors, then assert the same on v2.1.

**Test Cases**:
1. **Tool list**: v2.1 lists the same six tool names as v2, and every `inputSchema` equals v2's.
2. **search_rooms default**: Without `limit`, v2.1 returns 5 rooms, as v2 does.
3. **Booking flow**: `book`, `list_bookings` and `booking_cancel` on v2.1 give the same text as v2, with `BK-0001` first.
4. **quote errors**: An unknown room gives the same error text on v2 and v2.1.
5. **Frozen sources**: `v1.ts` and `v2.ts` are unmodified (checked with `git diff --exit-code` on those two paths during review, not as a runtime test).

### Unit Tests

In `servers/hollow-inn/test/v2_1.test.ts`:
- `quote` r-04 × 2 returns the exact text `{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"total_cents":42500,"currency":"USD"}`.
- `quote` r-01 × 1 returns `total` `98.00` and `total_cents` 9800. `quote` r-02 × 1 returns `total` `142.00` and `total_cents` 14200.
- Unknown room returns `isError: true` with `unknown room r-99`.
- Tool list is `book`, `booking_cancel`, `get_room`, `list_bookings`, `quote`, `search_rooms`.
- `search_rooms` without `limit` returns 5 rooms (v2 behavior retained).

### Property-Based Tests

- For any room in `ROOMS` and any `nights` in 1..30: `total_cents` equals `nightly.cents × nights`, and the text contains `"total":<Money literal>` for the same amount. Use `fc.constantFrom(...ROOMS.map(r => r.id))` and `fc.integer({min: 1, max: 30})`.
- For any such pair: parsing the response gives `total_cents === Math.round(total * 100)`.
- For any such pair: the v2.1 response without `total` equals the v2 response (all other members equal).

### Integration Tests

- Acceptance run: `npx specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2.1"` shows SPC-0002, SPC-0006 and SPC-0007 as PRESERVED. This check is run on the real process over stdio, with the committed jars.
- Report only what the replay shows. The two other v2 changes remain, so other jars (the `search_rooms` and `cancel_booking` ones) can still be RATTLED or CRACKED on v2.1, and the overall verdict can still be HOLD. This is expected, and later specs cover them.
- Run `npm test` at the repo root to confirm the v1, v2, money and core suites still pass, including `scripts/bench.ts detect` picking up `v2_1.ts` as an existing version.
