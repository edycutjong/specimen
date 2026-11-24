# get_weather temp_c Field Bugfix Design

## Overview

Server v2 (`evidence/server_v2.py`) changed the `get_weather` response: the key `temp_c` (number) became `temperature_c` (string). The tool description in the same file still says "Returns temp_c (number) and conditions", so v1 clients read a missing field and the schema text contradicts the response. The replay of 5 recorded calls shows 3 BROKEN (all `get_weather`) and 2 IDENTICAL (`add_numbers`).

The fix is a minimal change to the `get_weather` branch of `call()`: return the key `temp_c` with a JSON number value, and leave everything else untouched. The description text is already correct and needs no change.

## Glossary

- **Bug_Condition (C)**: A `get_weather` call, with any city. The v2 response then has `temperature_c` (string) instead of `temp_c` (number).
- **Property (P)**: The response contains `temp_c` as a JSON number, has no `temperature_c`, and matches the recorded v1 body.
- **Preservation**: Behavior of `city`, `conditions`, `add_numbers`, `tools/list` and unknown-tool errors, which must stay unchanged.
- **call(name, args)**: Function in `evidence/server_v2.py` that builds the result object for a tool call.
- **Replay**: Comparison of recorded v1 responses in `evidence/recorded-calls.jsonl` against the server under test, producing `evidence/replay-v1-vs-v2.json`.

## Bug Details

### Bug Condition

The bug manifests on every `get_weather` call. In `call()`, the `get_weather` branch returns `{"city": city, "temperature_c": "21", "conditions": "clear"}`. The key was renamed and the value is the string `"21"` rather than the number `21`. The value is a hardcoded constant, so it is the same for every city, as in the v1 recordings (Jakarta, Oslo and Lima are all 21).

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ToolCall {name, arguments}
  OUTPUT: boolean

  RETURN input.name = "get_weather"
END FUNCTION
```

### Examples

- `get_weather {"city": "Jakarta"}`: expected `{"city": "Jakarta", "temp_c": 21, "conditions": "clear"}`; actual `{"city": "Jakarta", "temperature_c": "21", "conditions": "clear"}`.
- `get_weather {"city": "Oslo"}`: same diff, `/temp_c` removed (was `21`), `/temperature_c` added (now `"21"`).
- `get_weather {"city": "Lima"}`: same diff.
- Non-bug: `add_numbers {"a": 10, "b": -4.5}` returns `{"sum": 5.5}` in both versions (IDENTICAL).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `get_weather` still returns `city` echoing the input and `conditions` with the v1 value (`"clear"`).
- `add_numbers` still returns `{"sum": a + b}`, including for floats and negatives.
- `tools/list` still exposes `get_weather` and `add_numbers` with the same input schemas and descriptions.
- An unknown tool name still yields an `isError: true` result.

**Scope:**
All inputs that are not `get_weather` calls are unaffected. This includes:
- `add_numbers` calls
- Unknown tool names
- `initialize`, `tools/list` and other JSON-RPC methods

## Hypothesized Root Cause

1. **Intentional-looking rename in the response literal**: The `get_weather` return dict in `call()` was edited to use `temperature_c`. This is the most likely cause, since the replay diff is exactly one removed and one added key.
2. **Value stringified at the same time**: The literal is `"21"` instead of `21`. It was probably changed in the same edit, for example from a formatting or serialization step.
3. **Description not updated**: `TOOLS` still documents `temp_c (number)`. This shows the description was the source of truth and the response drifted, which supports fixing the response and not the description.
4. **No contract test**: Nothing compared responses with the documented schema, so the drift was not caught. This is a contributing factor, not a code defect.

The exploratory tests below confirm or refute the first two causes.

## Correctness Properties

Property 1: Bug Condition - get_weather returns temp_c as a number

_For any_ `get_weather` call (isBugCondition returns true), the fixed server SHALL return a result object containing the key `temp_c` with a JSON number value, no `temperature_c` key, and a body equal to the recorded v1 response (for example `{"city": "Jakarta", "temp_c": 21, "conditions": "clear"}`), so the replay diff is empty.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Other behavior unchanged

_For any_ input where the bug condition does NOT hold (isBugCondition returns false), and for the `city` and `conditions` fields of `get_weather`, the fixed server SHALL produce the same result as the original server, preserving `add_numbers` sums, the `tools/list` content, and the `isError: true` result for unknown tools.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `evidence/server_v2.py`

**Function**: `call`

**Specific Changes**:
1. **Restore key name**: In the `get_weather` branch, use `temp_c` instead of `temperature_c`.
2. **Restore value type**: Use the number `21` instead of the string `"21"`, so `json.dumps` emits `21`.
3. **Keep other fields**: `city` and `conditions` stay as they are, preserving key order `city`, `temp_c`, `conditions`.
4. **No change to `TOOLS`**: The description already says `temp_c (number)`. The `add_numbers` branch, the `tools/list` handler and the error path are not touched.

## Testing Strategy

### Validation Approach

First surface counterexamples on the unfixed server, then verify the fix and preservation, using the existing replay of `evidence/recorded-calls.jsonl` as the oracle.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples before the fix and confirm the root cause.

**Test Plan**: Call `get_weather` through the stdio JSON-RPC interface, parse the text content as JSON, and assert on the key and type. Run on the UNFIXED server.

**Test Cases**:
1. **Jakarta Key Test**: Assert `temp_c` is present (will fail on unfixed code)
2. **Type Test**: Assert `temp_c` is a number, not a string (will fail on unfixed code)
3. **Oslo/Lima Test**: Assert an empty diff against the recorded response (will fail on unfixed code)
4. **Description Consistency Test**: Assert the response keys match those named in the `get_weather` description (will fail on unfixed code)

**Expected Counterexamples**:
- Response has `temperature_c: "21"` and no `temp_c`.
- Possible causes: renamed key in the return literal, string literal for the value (the code shows both).

### Fix Checking

**Goal**: For all `get_weather` calls, the fixed server returns the expected body.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := call_fixed(input)
  ASSERT "temp_c" IN result AND "temperature_c" NOT IN result
         AND isNumber(result.temp_c)
         AND result = recordedV1Response(input)
END FOR
```

### Preservation Checking

**Goal**: For all inputs where the bug condition does not hold, the fixed server matches the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT call_original(input) = call_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing suits preservation because it generates many `add_numbers` argument pairs and tool names automatically, and it catches edge cases such as floats, negatives and unknown names.

**Test Plan**: Observe `add_numbers`, `tools/list` and unknown-tool behavior on the UNFIXED server, then write tests asserting the same after the fix.

**Test Cases**:
1. **add_numbers Preservation**: `{"a": 2, "b": 3}` gives `{"sum": 5}` and `{"a": 10, "b": -4.5}` gives `{"sum": 5.5}`.
2. **tools/list Preservation**: Tool names, descriptions and input schemas are identical before and after.
3. **Unknown Tool Preservation**: An unknown name returns `isError: true`.
4. **city/conditions Preservation**: For `get_weather`, `city` echoes the input and `conditions` is `"clear"`.

### Unit Tests

- `get_weather` for Jakarta, Oslo and Lima returns `temp_c == 21` of type number.
- `get_weather` response has no `temperature_c` key.
- `add_numbers` integer, float and negative cases.
- Unknown tool name returns `isError: true`.

### Property-Based Tests

- For arbitrary city strings, `get_weather` returns `city` equal to the input, `temp_c` as a number, and `conditions` as a string.
- For arbitrary numeric `a` and `b`, `add_numbers` returns `a + b`, identical before and after the fix.
- For arbitrary tool names outside the two known tools, the result is `isError: true`.

### Integration Tests

- Replay `evidence/recorded-calls.jsonl` against the fixed server; expect `calls: 5, identical: 5, broken: 0`.
- Run an `initialize`, `tools/list`, `tools/call` sequence over stdio and check each response shape.
- Parse the `get_weather` description and confirm every field it names appears in the response with the stated type.
