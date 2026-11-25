# Bugfix Requirements Document

## Introduction

Replaying the jarred calls against server npx-tsx-servers-hollow-inn-src-main.ts-v2 left the tool `cancel_booking` CRACKED (jar SPC-0009). The replay returned no response for the recorded call.

<!-- specimen:repro:start -->
```json specimen-repro
[
  {
    "id": "SPC-0009",
    "input": {
      "booking_id": "BK-0001"
    },
    "response_text": "{\"booking_id\":\"BK-0001\",\"status\":\"cancelled\"}",
    "replayed": null,
    "changed_paths": []
  }
]
```

| jar | path | kind | note |
|---|---|---|---|

<!-- specimen:repro:end -->

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `cancel_booking` is called with `{"booking_id":"BK-0001"}` THEN the system returns no replayed response (`replayed` is null) and the tool is missing (SPC-0009)

### Expected Behavior (Correct)

2.1 WHEN `cancel_booking` is called with `{"booking_id":"BK-0001"}` THEN the system SHALL restore the missing tool `cancel_booking` and return the recorded response `{"booking_id":"BK-0001","status":"cancelled"}` (SPC-0009)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN any other `cancel_booking` call is made THEN the system SHALL CONTINUE TO behave as recorded; no preserved jar of `cancel_booking` was recorded, so none is cited

