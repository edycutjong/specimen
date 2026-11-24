# hollow-inn — changes

## v2.0.0 — "cleanup" release (author-made changes; this is the demo's planted break set)
Each version ships its own test suite and every suite passes. The v2 suite was updated with the refactor, so it
asserts the new behaviour — while calls that agents recorded against v1 now get different answers.

| # | Tool | Change | Input schema in `tools/list` changes? |
|---|---|---|---|
| (a) | `quote` | `total` (dollars, `425.00`) is replaced by `total_cents` (integer, `42500`) | no — output only |
| (b) | `search_rooms` | the default `limit` drops from 20 to 5 (the default lives in the description and the code, not the schema) | no |
| (c) | `cancel_booking` | renamed to `booking_cancel` | yes — one tool removed, one added |

## v1.0.0 — baseline
Six tools: `search_rooms`, `get_room`, `quote`, `book`, `list_bookings`, `cancel_booking`. Money is written as
two-decimal JSON number literals (`"total":425.00`) from integer cents.
