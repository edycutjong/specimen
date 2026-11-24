---
inclusion: always
---

# Tech

One TypeScript codebase.

## Stack

- TypeScript 5 strict, Node 20+, ES modules, npm workspaces.
- `@modelcontextprotocol/sdk` 1.x: `McpServer`, `Client`, stdio transports in Node, `InMemoryTransport` in the browser.
- `zod` for every external format: jar lines, replay results, hook payloads.
- `commander` for the CLI.
- Vite + React 19 for the browser cabinet: static build, SVG jars, CSS animation, self-hosted fonts.
- `vitest` + `fast-check` for tests.
- `npm test` at the repo root runs everything.

## Rules

- No mocks of the MCP protocol on any judged path. Replays use the real SDK client and server.
- No network or font CDN calls at runtime.
- Server modules have no `node:` imports, so the cabinet can bundle them.
- Every number shown to a user comes from a real run.
- Never edit files under `jars/`. They are evidence.
- Parse external input with zod at the boundary. Do not trust it past that point.
- Keep the judging code deterministic: no clocks, randomness or network in diff or verdict.
