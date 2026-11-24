// Test-only Client_Factory for tools with fixed replies. A real McpServer answers tools/list and
// tools/call over InMemoryTransport, and the real SDK Client talks to it. A test chooses the text
// that a tool returns, so the replayed text is known exactly. Nothing here mocks the protocol.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { ClientFactory } from "../../src/index.js";

/** What a scripted tool returns on every call. */
export type ScriptedReply = { text: string; isError?: boolean };

/** A tool of a scripted server. `inputSchema` is a zod raw shape, and it is optional. */
export type ScriptedTool = {
  name: string;
  reply: ScriptedReply;
  inputSchema?: Record<string, z.ZodType>;
};

/** A fresh scripted server per call, linked to a connected SDK client. */
export function makeScriptedClientFactory(tools: readonly ScriptedTool[]): ClientFactory {
  return async () => {
    const server = new McpServer({ name: "scripted", version: "0.0.0" });
    for (const tool of tools) {
      const reply = tool.reply;
      const callback = async () => ({
        content: [{ type: "text" as const, text: reply.text }],
        isError: reply.isError === true,
      });
      if (tool.inputSchema === undefined) {
        server.registerTool(tool.name, {}, callback);
      } else {
        server.registerTool(tool.name, { inputSchema: tool.inputSchema }, callback);
      }
    }
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
