# Agent Stop gate — one live headless Kiro session

Generated 2026-11-25T14:28:52Z by `scripts/stop-gate-live.sh`; `kiro-cli chat --no-interactive --agent-engine v3 --model claude-haiku-5.5`, scratch copy, gate = on; stop hook = `specimen hook stop --server "npx tsx servers/hollow-inn/src/main.ts v2"` (timeout 30 s), no bugfix spec filed, trusted tools `read_file,list_directory,fs_write,str_replace`. exit 0, 7 s.

Prompt: `Reply with the single word READY and do nothing else.`

```
READY
```

Turn snapshot written by the UserPromptSubmit hook (`.specimen/turn.json`): yes

Gate state after the run (`.specimen/gate-*.json`):

```
(no gate file: the gate never blocked)

```

Specs in the scratch copy after the run: `cabinet-ui jar-capture replay-engine `

File after the run (first lines of servers/hollow-inn/src/v1.ts): `// hollow-inn v1 — the baseline the agents were recorded against. import { McpServer } from "@modelcontextprotocol/sdk/s`
