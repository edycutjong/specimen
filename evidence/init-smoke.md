# `specimen init` — smoke run on a scratch workspace (P1d, 2026-11-25)

Scratch workspace = a copy of this repo's `.kiro/settings/mcp.json` only (path shortened to `<scratch>` and `<repo>`). Nothing was mocked: init started the real hollow-inn v2.1 as the test instance and read its `tools/list`.

```sh
specimen init --root <scratch> --server-key hollowinn --test-server "npx tsx <repo>/servers/hollow-inn/src/main.ts v2.1" --watch 'servers/**'
```

exit 0; output:
```
kept .kiro/settings/mcp.json (has an entry for hollowinn)
wrote .kiro/hooks/specimen-jar-pre.json
wrote .kiro/hooks/specimen-jar-post.json
wrote .kiro/hooks/specimen-jar-firewall.json
wrote .kiro/hooks/specimen-jar-stop.json
wrote .specimen/replay.json
wrote .gitignore
kiro-cli 3.6.0
headless commands pin --agent-engine v3
next: restart the Kiro session, run your agent against hollowinn, then: specimen replay --server "<your test instance command>"
```

`<scratch>/.specimen/replay.json` — `allow` is the four tools whose annotations declare `readOnlyHint: true` (`search_rooms`, `get_room`, `quote`, `list_bookings`); `book` and `cancel_booking` are not allowed without `--allow` or a "y" at the prompt:
```json
{
  "allow": [
    "search_rooms",
    "get_room",
    "quote",
    "list_bookings"
  ],
  "watch": [
    "servers/**"
  ]
}
```

Second run with the same arguments: 7 `kept …` lines, no file changed (also asserted by `packages/cli/test/init.test.ts`, 33 tests now). This run predates turn 48: `specimen hook stop` was not built yet, and `init` now also writes `.kiro/hooks/specimen-jar-turn.json` (see DX-REPORT, Experiment 4).
