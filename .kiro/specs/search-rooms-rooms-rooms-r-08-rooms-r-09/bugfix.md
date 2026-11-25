# Bugfix Requirements Document

## Introduction

The server `npx-tsx-servers-hollow-inn-src-main.ts-v2` changed its answer for the tool `search_rooms`, and jar SPC-0010 is RATTLED. Replaying the recorded call returned a `rooms` array that no longer contains items `r-08` and `r-09`. This replay result is clean or broken only on the recorded set.

<!-- specimen:repro:start -->
```json specimen-repro
[
  {
    "id": "SPC-0010",
    "input": {
      "check_in": "2026-12-04",
      "guests": 3,
      "nights": 2
    },
    "response_text": "{\"check_in\":\"2026-12-04\",\"nights\":2,\"guests\":3,\"rooms\":[{\"id\":\"r-02\",\"name\":\"Moth Room\",\"beds\":2,\"max_guests\":3,\"fireplace\":false,\"nightly\":142.00},{\"id\":\"r-03\",\"name\":\"Candle Room\",\"beds\":2,\"max_guests\":3,\"fireplace\":false,\"nightly\":156.75},{\"id\":\"r-04\",\"name\":\"Hearth Room\",\"beds\":2,\"max_guests\":4,\"fireplace\":true,\"nightly\":212.50},{\"id\":\"r-06\",\"name\":\"Cellar Room\",\"beds\":2,\"max_guests\":3,\"fireplace\":false,\"nightly\":131.25},{\"id\":\"r-07\",\"name\":\"Ember Suite\",\"beds\":3,\"max_guests\":4,\"fireplace\":true,\"nightly\":236.00},{\"id\":\"r-08\",\"name\":\"Gallery Room\",\"beds\":2,\"max_guests\":3,\"fireplace\":false,\"nightly\":168.40},{\"id\":\"r-09\",\"name\":\"Raven Loft\",\"beds\":3,\"max_guests\":5,\"fireplace\":true,\"nightly\":289.00}]}",
    "replayed": {
      "check_in": "2026-12-04",
      "nights": 2,
      "guests": 3,
      "rooms": [
        {
          "id": "r-02",
          "name": "Moth Room",
          "beds": 2,
          "max_guests": 3,
          "fireplace": false,
          "nightly": 142
        },
        {
          "id": "r-03",
          "name": "Candle Room",
          "beds": 2,
          "max_guests": 3,
          "fireplace": false,
          "nightly": 156.75
        },
        {
          "id": "r-04",
          "name": "Hearth Room",
          "beds": 2,
          "max_guests": 4,
          "fireplace": true,
          "nightly": 212.5
        },
        {
          "id": "r-06",
          "name": "Cellar Room",
          "beds": 2,
          "max_guests": 3,
          "fireplace": false,
          "nightly": 131.25
        },
        {
          "id": "r-07",
          "name": "Ember Suite",
          "beds": 3,
          "max_guests": 4,
          "fireplace": true,
          "nightly": 236
        }
      ]
    },
    "changed_paths": [
      "/rooms",
      "/rooms/r-08",
      "/rooms/r-09"
    ]
  }
]
```

| jar | path | kind | note |
|---|---|---|---|
| SPC-0010 | /rooms | length | - |
| SPC-0010 | /rooms/r-08 | removed | - |
| SPC-0010 | /rooms/r-09 | removed | - |

<!-- specimen:repro:end -->

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `search_rooms` is called with `{"check_in":"2026-12-04","guests":3,"nights":2}` THEN the system returns a `/rooms` array whose length changed from the recorded one (SPC-0010)

1.2 WHEN the same call is replayed THEN the system omits the array item `r-08` at `/rooms/r-08` (SPC-0010)

1.3 WHEN the same call is replayed THEN the system omits the array item `r-09` at `/rooms/r-09` (SPC-0010)

### Expected Behavior (Correct)

2.1 WHEN `search_rooms` is called with `{"check_in":"2026-12-04","guests":3,"nights":2}` THEN the system SHALL return the array item `r-08` in `/rooms`, as recorded in SPC-0010

2.2 WHEN the same call is made THEN the system SHALL return the array item `r-09` in `/rooms`, as recorded in SPC-0010

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `search_rooms` is called with `{"check_in":"2026-12-04","guests":3,"limit":50,"nights":2}` THEN the system SHALL CONTINUE TO return the recorded response (SPC-0001)

3.2 WHEN `search_rooms` is called with `{"check_in":"2026-12-11","guests":2,"limit":3,"nights":1}` THEN the system SHALL CONTINUE TO return the recorded response (SPC-0005)

