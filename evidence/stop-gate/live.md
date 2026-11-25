# Agent Stop gate — one live headless Kiro session

Generated 2026-11-25T14:29:19Z by `scripts/stop-gate-live.sh`; `kiro-cli chat --no-interactive --agent-engine v3 --model claude-haiku-5.5`, scratch copy, gate = on; stop hook = `specimen hook stop --server "npx tsx servers/hollow-inn/src/main.ts v2"` (timeout 30 s), no bugfix spec filed, trusted tools `read_file,list_directory,fs_write,str_replace`. exit 0, 27 s.

Prompt: `Add the single comment line "// gate probe" as the first line of servers/hollow-inn/src/v1.ts, then reply with the word DONE. If a hook sends you back with a reason, read it and say in one sentence what you will do about it, then do it.`

```
[tool] Read File
[tool] status: InProgress
[tool] status: Completed
[tool] Replace in File
[tool] status: Pending
[tool] status: Completed
DONE
[tool] Inspect workspace and check for specimen CLI
[denied] tool permission approval is not supported in non-interactive mode. Use --trust-tools=run_command to auto-approve this tool, or --trust-all-tools to auto-approve every tool.
[tool] status: Failed: Inspect workspace and check for specimen CLI
[tool] List workspace root contents
[denied] tool permission approval is not supported in non-interactive mode. Use --trust-tools=run_command to auto-approve this tool, or --trust-all-tools to auto-approve every tool.
[tool] status: Failed: List workspace root contents
[tool] Read File
[tool] status: InProgress
[tool] status: Completed
I could not act on the jar hook. Shell commands are being denied before they run, so I could not run `specimen file <id>` for SPC-0002, SPC-0006, SPC-0007, SPC-0009, or SPC-0010, and I could not check whether the `specimen` CLI is installed.

The `// gate probe` line is in place at the top of `servers/hollow-inn/src/v1.ts`. I did not change any server code to restore the old contract, because that would mean editing the v2 server, which you have not asked for.

To continue, either approve shell access for this session or run `specimen file <id>` for each of the five jars yourself.
```

Turn snapshot written by the UserPromptSubmit hook (`.specimen/turn.json`): yes

Gate state after the run (`.specimen/gate-*.json`):

```
{
  "session_id": "sess_0593a391-c5d8-453f-a552-c326950fa729",
  "blocks": 1
}

```

Specs in the scratch copy after the run: `cabinet-ui jar-capture replay-engine `

File after the run (first lines of servers/hollow-inn/src/v1.ts): `// gate probe // hollow-inn v1 — the baseline the agents were recorded against. `
