import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  SESSION,
  TOOL,
  createWorkspace,
  fire,
  postPayload,
  prePayload,
  readJsonl,
  type Workspace,
} from "./support/capture.js";

/**
 * End to end: hollow-inn v1 is started as a real child process and called through the MCP SDK
 * client over stdio. The returned text is fed through `specimen hook pre` and `specimen hook post`
 * as real child processes in a temporary workspace. No protocol is mocked, and no file under the
 * repository `jars/` directory is written.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ARGS = { room_id: "r-04", nights: 2 } as const;

let client: Client;
let transport: StdioClientTransport;
let quoteText: string;
let ws: Workspace;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "servers/hollow-inn/src/main.ts", "v1"],
    cwd: REPO_ROOT,
    stderr: "pipe",
  });
  client = new Client({ name: "specimen-e2e-quote", version: "0.0.0" });
  await client.connect(transport);

  const result = await client.callTool({ name: "quote", arguments: { ...ARGS } });
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (first?.type !== "text") throw new Error("quote returned no text content");
  quoteText = first.text;
}, 120_000);

afterAll(async () => {
  // Closing the client closes the stdio transport, which terminates the hollow-inn child process.
  await client?.close();
  await transport?.close();
});

beforeEach(() => {
  ws = createWorkspace();
});

afterEach(() => {
  ws.remove();
});

describe("hollow-inn quote through specimen hooks (end to end)", () => {
  it("returns the quoted prices from the real server", () => {
    expect(quoteText).toContain("425.00");
    expect(quoteText).toContain("212.50");
  }, 60_000);

  it("keeps 425.00 and 212.50 byte-identical in the recorded response_text", () => {
    const pre = fire(ws.root, "pre", prePayload(ws.root, SESSION, ARGS, TOOL));
    expect(pre.status).toBe(0);

    const post = fire(ws.root, "post", postPayload(ws.root, SESSION, ARGS, TOOL, quoteText));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    const jars = readJsonl(ws.jarFile());
    expect(jars).toHaveLength(1);
    const line = jars[0] ?? {};
    expect(line).toMatchObject({
      session_id: SESSION,
      server: "hollowinn",
      tool: "quote",
      tool_id: TOOL,
      input: ARGS,
    });

    const recorded = String(line.response_text);
    expect(recorded).toBe(quoteText);
    expect(recorded).toContain("425.00");
    expect(recorded).toContain("212.50");
  }, 120_000);
});
