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
