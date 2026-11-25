// A clean text compare must not vouch for what the text does not carry (a2a round 05). A real SDK
// Server answers over InMemoryTransport with a chosen tools/call result; nothing mocks the protocol.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACT_CONFIG,
  FULLY_REDACTED_REASON,
  SHIPPED_VOLATILE_POLICY,
  UNCOMPARED_CONTENT_REASON,
  compileRedact,
  replay,
  serializeJarLine,
  verdict,
  type ClientFactory,
  type EngineOutcome,
  type JarLine,
} from "../src/index.js";

const T0 = "2026-01-01T00:00:00.000Z";
const TEXT = JSON.stringify({ total: 425 });

type Reply = Record<string, unknown>;

/** A server with one tool, `quote`, that always returns `reply`. */
function serverReturning(reply: Reply): ClientFactory {
  return async () => {
    const server = new Server({ name: "uncovered", version: "0.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: "quote", inputSchema: { type: "object" as const } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => reply as never);
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

function jar(responseText: string, redacted: string[] = []): JarLine {
  return {
    v: 1,
    id: "SPC-0001",
    session_id: "s1",
    seq: 1,
    server: "uncovered",
    tool: "quote",
    tool_id: "quote",
    input: {},
    response_text: responseText,
    response: JSON.parse(responseText),
    t0: T0,
    t1: T0,
    duration_ms: 1,
    redacted,
  };
}

async function run(line: JarLine, factory: ClientFactory): Promise<EngineOutcome> {
  const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
  if (!compiled.ok) throw new Error("default redact config does not compile");
  let tick = 0;
  return replay({
    jarFiles: [{ file: "jars/t.jsonl", text: serializeJarLine(line) }],
    pendingText: "",
    replayPolicy: { allow: ["quote"], watch: [] },
    volatilePolicy: SHIPPED_VOLATILE_POLICY,
    redactConfig: compiled.value,
    strict: false,
    clientFactory: factory,
    clock: () => tick++,
    serverLabel: "uncovered",
    startedAt: T0,
    timeoutMs: 10_000,
  });
}

function holdOf(outcome: EngineOutcome) {
  return verdict({ entries: outcome.resultEntries, spoiledCount: 0, toolsListed: outcome.toolsListed, filedIds: new Set() });
}

describe("result content the text does not cover", () => {
  it("preserves a structuredContent that the text mirrors", async () => {
    const outcome = await run(jar(TEXT), serverReturning({ content: [{ type: "text", text: TEXT }], structuredContent: { total: 425 } }));
    expect(outcome.resultEntries[0]?.state).toBe("preserved");
  });

  it("unseals a structuredContent that differs from the text, and the verdict names why", async () => {
    const outcome = await run(jar(TEXT), serverReturning({ content: [{ type: "text", text: TEXT }], structuredContent: { total_cents: 42500 } }));
    const entry = outcome.resultEntries[0];
    expect(entry?.state).toBe("unsealed");
    expect(entry?.reason).toBe(`${UNCOMPARED_CONTENT_REASON} (structuredContent)`);
    const result = holdOf(outcome);
    expect(result.verdict).toBe("HOLD");
    expect(result.reason).toBe(`1 unsealed: ${UNCOMPARED_CONTENT_REASON} (structuredContent)`);
    expect(result.red).toBe(0);
  });

  it("unseals a result with an image item next to unchanged text", async () => {
    const outcome = await run(
      jar(TEXT),
      serverReturning({ content: [{ type: "text", text: TEXT }, { type: "image", data: "AAAA", mimeType: "image/png" }] }),
    );
    expect(outcome.resultEntries[0]?.state).toBe("unsealed");
    expect(outcome.resultEntries[0]?.reason).toBe(`${UNCOMPARED_CONTENT_REASON} (image content)`);
  });

  it("keeps a text change rattled even when other content is uncovered", async () => {
    const outcome = await run(
      jar(TEXT),
      serverReturning({ content: [{ type: "text", text: JSON.stringify({ total_cents: 42500 }) }, { type: "image", data: "AAAA", mimeType: "image/png" }] }),
    );
    expect(outcome.resultEntries[0]?.state).toBe("rattled");
  });
});

describe("a fully redacted response", () => {
  it("is unsealed, never preserved, whatever the server now returns", async () => {
    const recorded = JSON.stringify("[REDACTED]");
    const outcome = await run(jar(recorded, ["/response"]), serverReturning({ content: [{ type: "text", text: JSON.stringify("anything at all") }] }));
    const entry = outcome.resultEntries[0];
    expect(entry?.state).toBe("unsealed");
    expect(entry?.reason).toBe(FULLY_REDACTED_REASON);
    expect(holdOf(outcome).reason).toBe(`1 unsealed: ${FULLY_REDACTED_REASON}`);
  });
});

describe("a malformed tools/call result on a live connection", () => {
  it("cracks only its own jar: the SDK rejects it with code -32602 and the session goes on", async () => {
    const factory: ClientFactory = async () => {
      const server = new Server({ name: "malformed", version: "0.0.0" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: ["bad", "quote"].map((name) => ({ name, inputSchema: { type: "object" as const } })),
      }));
      server.setRequestHandler(CallToolRequestSchema, async (request) =>
        (request.params.name === "bad" ? { content: "not an array" } : { content: [{ type: "text", text: TEXT }] }) as never,
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "specimen-test", version: "0.0.0" });
      await client.connect(clientTransport);
      return { client, close: async () => { await client.close(); await server.close(); } };
    };
    const bad = { ...jar(TEXT), id: "SPC-0001", tool: "bad", tool_id: "bad", seq: 1 };
    const good = { ...jar(TEXT), id: "SPC-0002", seq: 2 };
    const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
    if (!compiled.ok) throw new Error("default redact config does not compile");
    let tick = 0;
    const outcome = await replay({
      jarFiles: [{ file: "jars/t.jsonl", text: serializeJarLine(bad) + serializeJarLine(good) }],
      pendingText: "",
      replayPolicy: { allow: ["bad", "quote"], watch: [] },
      volatilePolicy: SHIPPED_VOLATILE_POLICY,
      redactConfig: compiled.value,
      strict: false,
      clientFactory: factory,
      clock: () => tick++,
      serverLabel: "malformed",
      startedAt: T0,
      timeoutMs: 10_000,
    });
    expect(outcome.resultEntries.map((entry) => entry.state)).toEqual(["cracked", "preserved"]);
    expect(outcome.resultEntries[0]?.error).toContain("-32602");
  });
});
