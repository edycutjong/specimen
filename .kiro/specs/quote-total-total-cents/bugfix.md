# Bugfix Requirements Document

## Introduction

The server `npx-tsx-servers-hollow-inn-src-main.ts-v2` changed the response of its `quote` tool. Replay left the jars SPC-0002, SPC-0006 and SPC-0007 in the RATTLED state, because `/total` was removed and `/total_cents` was added.

<!-- specimen:repro:start -->
```json specimen-repro
[
  {
    "id": "SPC-0002",
    "input": {
      "room_id": "r-04",
      "nights": 2
    },
    "response_text": "{\"room_id\":\"r-04\",\"nights\":2,\"nightly\":212.50,\"total\":425.00,\"currency\":\"USD\"}",
    "replayed": {
      "room_id": "r-04",
      "nights": 2,
      "nightly": 212.5,
      "total_cents": 42500,
      "currency": "USD"
    },
    "changed_paths": [
      "/total",
      "/total_cents"
    ]
  },
  {
    "id": "SPC-0006",
    "input": {
      "room_id": "r-01",
      "nights": 1
    },
    "response_text": "{\"room_id\":\"r-01\",\"nights\":1,\"nightly\":98.00,\"total\":98.00,\"currency\":\"USD\"}",
    "replayed": {
      "room_id": "r-01",
      "nights": 1,
      "nightly": 98,
      "total_cents": 9800,
      "currency": "USD"
    },
    "changed_paths": [
      "/total",
      "/total_cents"
    ]
  },
  {
    "id": "SPC-0007",
    "input": {
      "room_id": "r-02",
      "nights": 1
    },
    "response_text": "{\"room_id\":\"r-02\",\"nights\":1,\"nightly\":142.00,\"total\":142.00,\"currency\":\"USD\"}",
    "replayed": {
      "room_id": "r-02",
      "nights": 1,
      "nightly": 142,
      "total_cents": 14200,
      "currency": "USD"
    },
    "changed_paths": [
      "/total",
      "/total_cents"
    ]
  }
]
```

| jar | path | kind | note |
|---|---|---|---|
| SPC-0002 | /total | removed | - |
| SPC-0002 | /total_cents | added | suspected rename from /total ×100 |
| SPC-0006 | /total | removed | - |
| SPC-0006 | /total_cents | added | suspected rename from /total ×100 |
| SPC-0007 | /total | removed | - |
| SPC-0007 | /total_cents | added | suspected rename from /total ×100 |

<!-- specimen:repro:end -->

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `quote` is called with room_id "r-04" and nights 2 (SPC-0002) THEN the system omits `/total` and returns `/total_cents` instead
1.2 WHEN `quote` is called with room_id "r-01" and nights 1 (SPC-0006) THEN the system omits `/total` and returns `/total_cents` instead
1.3 WHEN `quote` is called with room_id "r-02" and nights 1 (SPC-0007) THEN the system omits `/total` and returns `/total_cents` instead

### Expected Behavior (Correct)

2.1 WHEN `quote` is called with room_id "r-04" and nights 2 (SPC-0002) THEN the system SHALL return `/total` with the recorded value 425.00, and `/total_cents`
2.2 WHEN `quote` is called with room_id "r-01" and nights 1 (SPC-0006) THEN the system SHALL return `/total` with the recorded value 98.00, and `/total_cents`
2.3 WHEN `quote` is called with room_id "r-02" and nights 1 (SPC-0007) THEN the system SHALL return `/total` with the recorded value 142.00, and `/total_cents`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the repro block is checked for preserved jars of `quote` THEN the system SHALL CONTINUE TO have no preserved jar to cite, because no preserved jar of quote was recorded

