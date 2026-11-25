---
name: specimen-replay
description: Use SPECIMEN JAR on a project that has an MCP server. Records the MCP calls a Kiro agent makes, replays them against a changed server version, and reports SHIP or HOLD before you ship.
---

# SPECIMEN JAR: replay recorded MCP calls against a changed server

Run these steps in the project that owns the MCP server.

1. Install the CLI. It is not published to npm, so clone the SPECIMEN JAR repository (https://github.com/edycutjong/specimen, public from the submission), run `npm ci` in the clone, and run `npx specimen ...` from that clone.
   The hooks that `init` writes call `npx --no-install specimen`, so the CLI must also resolve inside the project. Check that before you rely on capture.

2. Set up the project with `npx specimen init --server-key <key>`, where `<key>` is letters and digits only.
   - `--mcp-command "<cmd>"` adds an `mcp.json` entry, only when the key has none.
   - `--test-server "<cmd>"` starts a disposable instance of the server, never production. It also installs the stop gate (step 6).
   - `--allow <tool>` and `--yes` set the replay allow list. Read-only tools are always allowed.
   - `--commit-jars` commits `jars/`. Without it, `jars/` goes into `.gitignore`.
   - `--force` rewrites hook files and `.specimen/replay.json`. Without it, existing files are kept.
   - Without a terminal, `--server-key` is required.
   Init writes the hook files `.kiro/hooks/specimen-jar-pre.json`, `specimen-jar-post.json` and `specimen-jar-firewall.json` (and, with `--test-server`, `specimen-jar-stop.json` and `specimen-jar-turn.json`), plus `.specimen/replay.json` and the ignore lines in `.gitignore`.

3. Capture happens on its own. The pre and post hooks write each MCP call the agent makes into `jars/<session>.jsonl`, one JSON line per call.
   Use the agent as usual. Never edit a jar by hand. The firewall hook blocks Kiro's `write` tool from editing jars. Shell writes are caught only by the manifest check.

4. Replay the jars against the new server version:
   `npx specimen replay --server "<command that starts the NEW server version>"`
   Add `--json` for the Replay_Result on STDOUT. The default `--timeout` is 10000 ms. The result is written under `replays/`.
   - SHIP: at least one jar was compared, and none is rattled, cracked, unsealed or skipped. SHIP means the replay was clean on the recorded set. It never means the server is safe.
   - HOLD: at least one jar is rattled (the answer changed) or cracked (the tool is gone or errors), or a jar is unsealed or skipped.
   - Exit codes: 0 for SHIP, 1 for HOLD, 3 for a HOLD in which every red jar already has a filed bugfix spec, 2 for a usage or operational error.

5. File a bugfix spec for each red jar:
   `npx specimen file <jar-id>`
   The CLI writes the repro block. The `specimen-curator` agent writes the prose through `kiro-cli`. It has only read and write tools and may write only under `.kiro/specs/`.
   Add `--dry-run` to print the skeleton and the prompt without writing. Add `--timeout <seconds>` to change the default of 300 s.
   Exit codes: 0 filed, 2 usage, 20 rejected after one retry (the draft is kept as `bugfix.rejected.md`), 21 curator timed out, 22 `kiro-cli` failed.
   Check the spec again with `npx specimen check-spec .kiro/specs/<slug>/bugfix.md --jar <jar-id>`. Exit codes: 0 PASS, 1 FAIL, 2 usage.
   Then ask Kiro's Bug Fix workflow to design and apply the fix from that spec. Replay again afterwards.

6. The stop gate, when installed with `--test-server`, runs `specimen hook stop`. When an agent turn changed the watched server and a jar is still red with no filed spec, the gate blocks the stop and sends the jar ids back to the agent. It blocks at most 3 times per session. On any error or timeout it lets the agent stop.

7. Limits. SPECIMEN JAR does not prove that a server is correct. It compares new responses with the recorded ones, and only for the calls that were recorded. A tool that no agent called in the recorded sessions is not checked.
