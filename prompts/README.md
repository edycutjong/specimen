# Kiro prompts

Every prompt sent to Kiro while building this repository, verbatim and numbered in the order they ran. Line 1 of each file
(an HTML comment) records the date, the exact `kiro-cli` command, the engine and the working directory; the prompt is the
rest of the file. Commits that contain Kiro's output start with `kiro:`; glue, tests and harnesses written without Kiro
start with `claude-direct:`.

| Turn | What Kiro did | Credits |
|---|---|---|
| 01 | wrote `.kiro/steering/{product,tech,structure}.md` | 0.41 |
| 02 | wrote `.kiro/steering/specimen-bugfix.md` and `.kiro/agents/specimen-curator.json` | 0.54 |
| 03 | rewrote the curator's permission rules in the documented `capability`/`effect` form | 0.38 |
| 04 | spike S0/S3: three MCP calls across two server keys, capture hooks firing | 0.45 |
| 05 | spike S0 control on `--agent-engine v2` (run twice; denied before any tool ran) | not measured (v2 store) |
| 06 | spike S0 on `--agent-engine v3` | 0.21 |
| 07 | spike S2-CLI: Stop hook in `json`, `exit1` and `slow` modes (plus three runs with mangled hook arguments) | 0.07 – 0.26 each |
| 08 | spike S5: the curator files a bugfix spec from a repro block | 0.37 |
| 09 | spike S5: the curator is asked to write outside `.kiro/specs/` and refuses | 0.07 |
| 10 | spike S5: the curator's permission block with a neutral prompt; the outside write is denied | 0.15 |
| 11 | spike S4b: Bug Fix workflow writes design.md + tasks.md headless in spec mode | 3.48 |
| 12 | credit-metering probe (`--output-format stream-json`) | 0.07 |
Credits come from Kiro's own per-session `usage_summary` ([`scripts/kiro-credits.mjs`](../scripts/kiro-credits.mjs)).
Spike prompts (04–12) ran in scratch workspaces outside this repo; their outputs are copied into `evidence/spikes/`.
