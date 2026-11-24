# Implementation Plan

## Overview

Fix the `get_weather` response in `evidence/server_v2.py` so it returns `temp_c` as a number. Tests are written and run on the unfixed server first, then the fix is applied and the same tests are re-run.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - get_weather returns temp_c as a number
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: The bug is deterministic for every `get_weather` call, so scope the property to cities Jakarta, Oslo and Lima (plus arbitrary city strings)
  - Bug Condition: `isBugCondition(input)` where `input.name = "get_weather"`
  - Call `get_weather` through the stdio JSON-RPC interface of `evidence/server_v2.py` and parse the text content as JSON
  - Assert `temp_c` is present and is a JSON number, `temperature_c` is absent, and the body equals the recorded v1 response in `evidence/recorded-calls.jsonl` (for example `{"city": "Jakarta", "temp_c": 21, "conditions": "clear"}`)
  - Assert the response keys match those named in the `get_weather` description ("Returns temp_c (number) and conditions")
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (for example, "get_weather {city: Jakarta} returns `temperature_c: "21"` and no `temp_c`")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-get_weather behavior and city/conditions fields unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: `add_numbers {"a": 2, "b": 3}` returns `{"sum": 5}` and `{"a": 10, "b": -4.5}` returns `{"sum": 5.5}`
  - Observe on UNFIXED code: `tools/list` returns `get_weather` and `add_numbers` with their current descriptions and input schemas
  - Observe on UNFIXED code: an unknown tool name returns `isError: true`
  - Observe on UNFIXED code: `get_weather` echoes `city` and returns `conditions` equal to `"clear"`
  - Write property-based tests: for arbitrary numeric `a` and `b`, `add_numbers` returns `a + b`; for arbitrary unknown tool names, the result is `isError: true`; for arbitrary city strings, `city` equals the input and `conditions` is `"clear"`; `tools/list` content equals the observed baseline
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix get_weather response contract in server_v2.py

  - [ ] 3.1 Implement the fix
    - In the `get_weather` branch of `call()` in `evidence/server_v2.py`, rename the key `temperature_c` to `temp_c`
    - Change the value from the string `"21"` to the number `21`
    - Keep `city` and `conditions` as they are, with key order `city`, `temp_c`, `conditions`
    - Do not change `TOOLS`, the `add_numbers` branch, the `tools/list` handler or the error path
    - _Bug_Condition: isBugCondition(input) where input.name = "get_weather"_
    - _Expected_Behavior: result contains `temp_c` as a JSON number, no `temperature_c`, and equals the recorded v1 response_
    - _Preservation: add_numbers sums, tools/list content, unknown-tool isError, and get_weather city/conditions are unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - get_weather returns temp_c as a number
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Also replay `evidence/recorded-calls.jsonl` against the fixed server
    - **EXPECTED OUTCOME**: Test PASSES and replay reports `calls: 5, identical: 5, broken: 0` (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-get_weather behavior and city/conditions fields unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks 1 and 2 must run against the unfixed server. Task 1 is expected to fail and task 2 is expected to pass.
- Only the `get_weather` branch of `call()` changes. The tool description is already correct.
