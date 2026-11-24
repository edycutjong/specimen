import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createToyInn, type ToyVersion } from "./toy-inn";

export type Call = { tool: string; args: Record<string, unknown> };
export type Result = { tool: string; args: Record<string, unknown>; isError: boolean; body: unknown };

/** One replay session = one FRESH server process-equivalent, calls replayed in order over real JSON-RPC. */
export async function runSession(version: ToyVersion, calls: Call[]): Promise<Result[]> {
  const server = createToyInn(version);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "specimen-spike", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const out: Result[] = [];
  for (const c of calls) {
    const res = await client.callTool({ name: c.tool, arguments: c.args });
    const first = (res.content as { type: string; text?: string }[])[0];
    let body: unknown = first?.text;
    try {
      body = JSON.parse(first?.text ?? "");
    } catch {
      /* plain text body stays a string */
    }
    out.push({ tool: c.tool, args: c.args, isError: res.isError === true, body });
  }
  await client.close();
  await server.close();
  return out;
}

/** Flatten JSON into pointer → value, then report removed / added / changed pointers. */
export function flatten(value: unknown, prefix = "", into: Record<string, unknown> = {}): Record<string, unknown> {
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, `${prefix}/${k}`, into);
    if (Object.keys(value).length === 0) into[prefix] = value;
  } else {
    into[prefix] = value;
  }
  return into;
}

export type FieldDiff = { removed: string[]; added: string[]; changed: { path: string; before: unknown; after: unknown }[] };

export function fieldDiff(before: unknown, after: unknown): FieldDiff {
  const a = flatten(before);
  const b = flatten(after);
  const removed = Object.keys(a).filter((k) => !(k in b));
  const added = Object.keys(b).filter((k) => !(k in a));
  const changed = Object.keys(a)
    .filter((k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((path) => ({ path, before: a[path], after: b[path] }));
  return { removed, added, changed };
}
