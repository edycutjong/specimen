# Bugfix Requirements Document

## Introduction

The probe server's `get_weather` tool is RATTLED in v2 for jars SPC-0001, SPC-0002 and SPC-0005. The replayed response drops `/temp_c` and adds `/temperature_c` with the value as a string.

<!-- specimen:repro:start -->
**Jars with this change signature:** SPC-0001, SPC-0002, SPC-0005 (tool `get_weather`; signature: `/temp_c` removed, `/temperature_c` added)
**Preserved jars of the same server:** SPC-0003, SPC-0004 (tool `add_numbers`)
**Source:** day-0 kill-test capture (a real headless Kiro session against a 2-tool probe server), replayed against the probe server's v2. Spike S5 input, not hollow-inn.

Recorded call (SPC-0001): `get_weather {"city": "Jakarta"}`

Recorded response (v1):
```json
{"city": "Jakarta", "temp_c": 21, "conditions": "clear"}
```

Replayed response (v2):
```json
{"city": "Jakarta", "temperature_c": "21", "conditions": "clear"}
```

| Path | Kind | Recorded | Replayed |
|---|---|---|---|
| `/temp_c` | removed | `21` (number) | — |
| `/temperature_c` | added | — | `"21"` (string) |
<!-- specimen:repro:end -->

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `get_weather` is called with `{"city": "Jakarta"}` THEN the system omits `/temp_c` from the response.

1.2 WHEN `get_weather` is called with `{"city": "Jakarta"}` THEN the system returns `/temperature_c` as the string `"21"`, a field that was not in the recorded response.

### Expected Behavior (Correct)

2.1 WHEN `get_weather` is called with `{"city": "Jakarta"}` THEN the system SHALL return `/temp_c` with the recorded value `21` (number).

2.2 WHEN `get_weather` is called with `{"city": "Jakarta"}` THEN the system SHALL NOT return `/temperature_c`, which is absent from the recorded response.

### Unchanged Behavior (Regression Prevention)

3.1 The repro block lists no PRESERVED jars for `get_weather`, so none are cited here.

3.2 WHEN `get_weather` is called with `{"city": "Jakarta"}` THEN the system SHALL CONTINUE TO return `/city` as `"Jakarta"` and `/conditions` as `"clear"`, as in the recorded response (SPC-0001).
