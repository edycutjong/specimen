// tools/list is paginated in MCP: a server may return its tools across several pages, joined by
// `nextCursor`. A real SDK Server pages its tools one per page here, over InMemoryTransport, and
// the real SDK Client reads it. Nothing mocks the protocol.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACT_CONFIG,
  MAX_LIST_PAGES,
  SHIPPED_VOLATILE_POLICY,
  compileRedact,
  listAllTools,
  replay,
  serializeJarLine,
  type ClientFactory,
  type JarLine,
} from "../src/index.js";

const T0 = "2026-01-01T00:00:00.000Z";
const TOOLS = ["alpha", "beta", "gamma"];

/** A server that returns one tool per tools/list page. `cursorFor` chooses each page's nextCursor. */
function pagedFactory(cursorFor: (page: number) => string | undefined = (page) =>
  page + 1 < TOOLS.length ? String(page + 1) : undefined): ClientFactory {
  return async () => {
    const server = new Server({ name: "paged", version: "0.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const page = Number(request.params?.cursor ?? "0");
      const name = TOOLS[page % TOOLS.length] as string;
      const next = cursorFor(page);
      return {
        tools: [{ name, inputSchema: { type: "object" as const } }],
        ...(next === undefined ? {} : { nextCursor: next }),
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [{ type: "text" as const, text: JSON.stringify({ tool: request.params.name }) }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "specimen-test", version: "0.0.0" });
    await client.connect(clientTransport);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  };
}

function jarOf(id: string, tool: string): JarLine {
  const text = JSON.stringify({ tool });
  return {
    v: 1,
    id,
    session_id: "s1",
    seq: Number(id.slice(-1)),
    server: "paged",
    tool,
    tool_id: tool,
    input: {},
    response_text: text,
    response: JSON.parse(text),
    t0: T0,
    t1: T0,
    duration_ms: 1,
    redacted: [],
  };
}

describe("tools/list pagination", () => {
  it("follows nextCursor to the last page", async () => {
    const session = await pagedFactory()();
    try {
      const tools = await listAllTools(session.client, 10_000);
      expect(tools.map((tool) => tool.name)).toEqual(TOOLS);
    } finally {
      await session.close();
    }
  });

  it("rejects a cursor the server repeats instead of looping", async () => {
    const session = await pagedFactory(() => "1")();
    try {
      await expect(listAllTools(session.client, 10_000)).rejects.toThrow(/repeated the cursor/);
    } finally {
      await session.close();
    }
  });

  it("rejects after MAX_LIST_PAGES distinct pages", async () => {
    const session = await pagedFactory((page) => String(page + 1))();
    try {
      await expect(listAllTools(session.client, 10_000)).rejects.toThrow(`after ${MAX_LIST_PAGES} pages`);
    } finally {
      await session.close();
    }
  });

  it("replays a jar whose tool is on a later page instead of cracking it", async () => {
    const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
    if (!compiled.ok) throw new Error("default redact config does not compile");
    let tick = 0;
    const jars = [jarOf("SPC-0001", "alpha"), jarOf("SPC-0003", "gamma")];
    const outcome = await replay({
      jarFiles: [{ file: "jars/paged.jsonl", text: jars.map((jar) => serializeJarLine(jar)).join("") }],
      pendingText: "",
      replayPolicy: { allow: TOOLS, watch: [] },
      volatilePolicy: SHIPPED_VOLATILE_POLICY,
      redactConfig: compiled.value,
      strict: false,
      clientFactory: pagedFactory(),
      baselineFactory: pagedFactory(),
      clock: () => tick++,
      serverLabel: "paged",
      startedAt: T0,
      timeoutMs: 10_000,
    });
    expect(outcome.resultEntries.map((entry) => [entry.id, entry.state])).toEqual([
      ["SPC-0001", "preserved"],
      ["SPC-0003", "preserved"],
    ]);
    expect(outcome.toolsListed).toEqual(TOOLS);
    expect(outcome.schemaDiff).toEqual({ tools_removed: [], tools_added: [], input_schema_changed: [] });
  });
});
