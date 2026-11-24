import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type Version } from "../src/index.js";

export const FIXED = () => new Date("2026-11-26T09:00:00.000Z");

export async function connect(version: Version) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(version, { now: FIXED });
  await server.connect(a);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    const text = r.content[0]?.text ?? "";
    return { text, json: JSON.parse(text) as any, isError: r.isError === true };
  };
  return { client, call, close: () => client.close() };
}
