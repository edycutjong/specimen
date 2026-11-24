import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACT_CONFIG,
  SHIPPED_VOLATILE_POLICY,
  compileRedact,
  isJsonResponse,
  replay,
  serializeJarLine,
  type ClientFactory,
  type Compiled,
  type EngineOutcome,
  type JarLine,
  type Json,
  type PendingEntry,
  type ReplayEngineArgs,
  type ResultEntry,
} from "../src/index.js";
import { makeFailingClientFactory, makeInMemoryClientFactory } from "./support/inmemory.js";
import { makeScriptedClientFactory, type ScriptedTool } from "./support/scripted.js";

const T0 = "2026-01-01T00:00:00.000Z";

function compiled(): Compiled {
  const result = compileRedact(DEFAULT_REDACT_CONFIG);
  if (!result.ok) throw new Error(`redact pattern ${result.patternIndex} does not compile`);
  return result.value;
}

const REDACT = compiled();

/** The concatenated text of the `text` items of a tools/call result, as the engine reads it. */
function textOf(content: unknown): string {
  const items = (content ?? []) as { type: string; text?: string }[];
  return items
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
}

/** The text that a fresh hollow-inn server of one version returns for one call. */
async function recordCall(version: "v1" | "v2", name: string, input: Json): Promise<string> {
  const session = await makeInMemoryClientFactory(version)();
  const result = await session.client.callTool({ name, arguments: input as Record<string, unknown> });
  await session.close();
  return textOf(result.content);
}

/** A Jar_Line for one call. `response` is the parsed JSON_Response, or null for other text. */
function jarOf(
  id: string,
  tool: string,
  responseText: string,
  extra: { input?: Json; session_id?: string; seq?: number; unpaired?: boolean } = {},
): JarLine {
  const line: JarLine = {
    v: 1,
    id,
    session_id: extra.session_id ?? "s1",
    seq: extra.seq ?? 1,
    server: "hollow-inn",
    tool,
    tool_id: tool,
    input: extra.input ?? {},
    response_text: responseText,
    response: isJsonResponse(responseText) ? (JSON.parse(responseText) as Json) : null,
    t0: T0,
    t1: T0,
    duration_ms: 1,
    redacted: [],
  };
  if (extra.unpaired !== undefined) line.unpaired = extra.unpaired;
  return line;
}

/** A pending entry whose session and seq match no jar unless the caller chooses them. */
function pendingOf(session_id: string, seq: number, tool_id: string): PendingEntry {
  return { session_id, seq, tool_id, input_sha256: "0".repeat(64), t0: T0 };
}

/** A scripted server with one tool that returns fixed text, optionally as an Error_Result. */
function oneTool(name: string, text: string, isError = false): ClientFactory {
  const tool: ScriptedTool = { name, reply: { text, isError } };
  return makeScriptedClientFactory([tool]);
}

type RunInput = {
  jars?: JarLine[];
  pending?: PendingEntry[];
  factory: ClientFactory;
  allow?: string[];
  watch?: string[];
};

/** Runs the replay engine on the given jars and pending entries, with the real shipped policy. */
async function run(input: RunInput): Promise<EngineOutcome> {
  let tick = 0;
  const jars = input.jars ?? [];
  const args: ReplayEngineArgs = {
    jarFiles: [{ file: "jars/test.jsonl", text: jars.map((jar) => serializeJarLine(jar)).join("") }],
    pendingText: (input.pending ?? []).map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    replayPolicy: { allow: input.allow ?? [], watch: input.watch ?? [] },
    volatilePolicy: SHIPPED_VOLATILE_POLICY,
    redactConfig: REDACT,
    strict: false,
    clientFactory: input.factory,
    clock: () => tick++,
    serverLabel: "test",
    startedAt: T0,
    timeoutMs: 10_000,
  };
  return replay(args);
}

/** Wraps a real Client_Factory so that every tools/call the engine makes is recorded by name. */
function spying(base: ClientFactory, calls: string[]): ClientFactory {
  return async () => {
    const session = await base();
    const client = new Proxy(session.client, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "callTool") {
          return (...args: Parameters<Client["callTool"]>) => {
            calls.push(args[0].name);
            return target.callTool(...args);
          };
        }
        return value.bind(target);
      },
    });
    return { client, close: session.close };
  };
}

/** A real MCP server whose one tool returns the given content items, for Property 4. */
type ContentItem = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function contentFactory(items: readonly ContentItem[]): ClientFactory {
  return async () => {
    const server = new McpServer({ name: "content", version: "0.0.0" });
    server.registerTool("emit", {}, async () => ({ content: [...items] }));
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

/** The tools of the scripted server used by Properties 10 and 13. `gone` is never registered. */
const STATE_TOOLS: ScriptedTool[] = [
  { name: "alpha", reply: { text: '{"n":1}' } },
  { name: "beta", reply: { text: '{"n":1}' } },
  { name: "skip", reply: { text: '{"n":1}' } },
];
const ALLOW = ["alpha", "gone"];
const WATCH = ["beta"];
const LISTED = new Set(STATE_TOOLS.map((tool) => tool.name));

const toolArb = fc.constantFrom("alpha", "beta", "skip", "gone", "nowhere");
const caseArb = fc.record({ tool: toolArb, unpaired: fc.boolean(), matches: fc.boolean() });
const casesArb = fc.array(caseArb, { minLength: 1, maxLength: 6 });
const orphanCountArb = fc.integer({ min: 0, max: 2 });

type Case = { tool: string; unpaired: boolean; matches: boolean };

/** Builds the jars of one generated case set. Each jar has its own session, so each is one group. */
function jarsFor(cases: readonly Case[]): JarLine[] {
  return cases.map((c, index) =>
    jarOf(`SPC-${String(index + 1).padStart(4, "0")}`, c.tool, c.matches ? '{"n":1}' : '{"n":2}', {
      session_id: `s${index}`,
      unpaired: c.unpaired,
    }),
  );
}

/** The precedence of Requirement 2 criterion 21, written as a decision table. */
function expectedState(c: Case): ResultEntry["state"] {
  if (c.unpaired) return "unsealed";
  if (!ALLOW.includes(c.tool) && !WATCH.includes(c.tool)) return "skipped";
  if (!LISTED.has(c.tool)) return "cracked";
  return c.matches ? "preserved" : "rattled";
}

describe("Property 4: replayed text and parsed response are derived consistently from a tools/call result", () => {
  // Feature: replay-engine, Property 4: Replayed text and parsed response are derived consistently from a tools/call result
  const jsonTextArb = fc
    .dictionary(
      fc.stringMatching(/^f_[a-z]{1,4}$/),
      fc.oneof(fc.integer({ min: -99, max: 99 }), fc.stringMatching(/^[a-z ]{0,8}$/)),
      { maxKeys: 3 },
    )
    .map((object) => JSON.stringify(object));
  const plainTextArb = fc.stringMatching(/^[a-z ]{0,12}$/);
  const textItemArb: fc.Arbitrary<ContentItem> = fc
    .oneof(jsonTextArb, plainTextArb)
    .map((text): ContentItem => ({ type: "text", text }));
  const imageItemArb: fc.Arbitrary<ContentItem> = fc.constant<ContentItem>({
    type: "image",
    data: "AAAA",
    mimeType: "image/png",
  });
  const itemArb: fc.Arbitrary<ContentItem> = fc.oneof(textItemArb, imageItemArb);

  it("concatenates text items, uses an empty string with none, and parses only a JSON_Response", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(itemArb, { maxLength: 5 }), async (items) => {
        const expected = items.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("");
        const outcome = await run({
          jars: [jarOf("SPC-0001", "emit", "placeholder")],
          allow: ["emit"],
          factory: contentFactory(items),
        });
        const [entry] = outcome.resultEntries;
        expect(entry?.replayed_text).toBe(expected);
        if (isJsonResponse(expected)) {
          expect(entry?.replayed).toEqual(JSON.parse(expected));
        } else {
          expect(entry?.replayed).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 10: jar state assignment follows a fixed precedence and is total", () => {
  // Feature: replay-engine, Property 10: Jar state assignment follows a fixed precedence and is total
  it("gives every jar and orphan exactly the state of the first matching condition", async () => {
    await fc.assert(
      fc.asyncProperty(casesArb, orphanCountArb, async (cases, orphanCount) => {
        const orphans = Array.from({ length: orphanCount }, (_, k) => pendingOf(`orphan${k}`, 1, "alpha"));
        const outcome = await run({
          jars: jarsFor(cases),
          pending: orphans,
          factory: makeScriptedClientFactory(STATE_TOOLS),
          allow: ALLOW,
          watch: WATCH,
        });

        expect(outcome.resultEntries).toHaveLength(cases.length + orphanCount);
        cases.forEach((c, index) => {
          const id = `SPC-${String(index + 1).padStart(4, "0")}`;
          const entry = outcome.resultEntries.find((e) => e.id === id);
          expect(entry?.state).toBe(expectedState(c));
        });
        for (let k = 0; k < orphanCount; k += 1) {
          const entry = outcome.resultEntries.find((e) => e.id === null && e.session_id === `orphan${k}`);
          expect(entry?.state).toBe("unsealed");
          expect(entry?.reason).toBe("orphan pre-event");
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 13: the replay engine never calls a tool for a jar it will not compare", () => {
  // Feature: replay-engine, Property 13: The replay engine never calls a tool for a jar it will not compare
  it("calls exactly the tools of the jars that are compared", async () => {
    await fc.assert(
      fc.asyncProperty(casesArb, async (cases) => {
        const calls: string[] = [];
        await run({
          jars: jarsFor(cases),
          factory: spying(makeScriptedClientFactory(STATE_TOOLS), calls),
          allow: ALLOW,
          watch: WATCH,
        });

        // A jar is compared, and so called, only when it is not unsealed or skipped and its tool
        // is listed by the server. Those are the preserved and rattled jars of the oracle.
        const compared = cases
          .filter((c) => {
            const state = expectedState(c);
            return state === "preserved" || state === "rattled";
          })
          .map((c) => c.tool)
          .sort();
        expect([...calls].sort()).toEqual(compared);
      }),
      { numRuns: 100 },
    );
  });
});

describe("state assignment with the real hollow-inn server", () => {
  it("gives every session a fresh server, so two first bookings both receive BK-0001", async () => {
    const input = { room_id: "r-04", check_in: "2026-03-01", nights: 1, guest: "Ann" };
    const text = await recordCall("v1", "book", input);
    const outcome = await run({
      jars: [
        jarOf("SPC-0001", "book", text, { input, session_id: "sA" }),
        jarOf("SPC-0002", "book", text, { input, session_id: "sB" }),
      ],
      allow: ["book"],
      factory: makeInMemoryClientFactory("v1"),
    });

    const [first, second] = outcome.resultEntries;
    expect(first?.state).toBe("preserved");
    expect(second?.state).toBe("preserved");
    expect(first?.replayed).toMatchObject({ booking_id: "BK-0001" });
    expect(second?.replayed).toMatchObject({ booking_id: "BK-0001" });
  });

  it("ends an unpaired jar as unsealed, a non-allowed absent tool as skipped and an allowed absent tool as cracked", async () => {
    const outcome = await run({
      jars: [
        jarOf("SPC-0001", "alpha", '{"n":1}', { session_id: "u", unpaired: true }),
        jarOf("SPC-0002", "nowhere", '{"n":1}', { session_id: "k" }),
        jarOf("SPC-0003", "gone", '{"n":1}', { session_id: "c" }),
      ],
      allow: ["alpha", "gone"],
      factory: makeScriptedClientFactory(STATE_TOOLS),
    });

    const byId = new Map(outcome.resultEntries.map((entry) => [entry.id, entry] as const));
    expect(byId.get("SPC-0001")).toMatchObject({ state: "unsealed", reason: "unpaired post-event" });
    expect(byId.get("SPC-0002")?.state).toBe("skipped");
    expect(byId.get("SPC-0003")).toMatchObject({ state: "cracked", reason: "tool not in tools/list" });
  });

  it("cracks an Error_Result against a response that is not Error_Shaped, without a diff", async () => {
    const outcome = await run({
      jars: [jarOf("SPC-0001", "quote", '{"total":425}')],
      allow: ["quote"],
      factory: oneTool("quote", "unknown room r-99", true),
    });

    const [entry] = outcome.resultEntries;
    expect(entry?.state).toBe("cracked");
    expect(entry?.error).toBe("unknown room r-99");
    expect(entry?.changes).toEqual([]);
  });

  it("diffs an Error_Result against an Error_Shaped response, preserved when equal and rattled when not", async () => {
    const same = await run({
      jars: [jarOf("SPC-0001", "quote", '{"error":"unknown room r-99"}')],
      allow: ["quote"],
      factory: oneTool("quote", '{"error":"unknown room r-99"}', true),
    });
    expect(same.resultEntries[0]?.state).toBe("preserved");

    const changed = await run({
      jars: [jarOf("SPC-0001", "quote", '{"error":"unknown room r-99"}')],
      allow: ["quote"],
      factory: oneTool("quote", '{"error":"unknown room r-98"}', true),
    });
    const [entry] = changed.resultEntries;
    expect(entry?.state).toBe("rattled");
    expect(entry?.changes.map((change) => change.path)).toEqual(["/error"]);
  });

  it("cracks later jars of a group after a transport failure, and does not call them", async () => {
    const calls: string[] = [];
    const jars = [1, 2, 3].map((seq) =>
      jarOf(`SPC-000${seq}`, "quote", "{}", { input: { room_id: "r-04", nights: seq }, seq }),
    );
    const outcome = await run({
      jars,
      allow: ["quote"],
      factory: spying(
        makeFailingClientFactory(makeInMemoryClientFactory("v1"), { at: "call", call: 1, kind: "transport-close" }),
        calls,
      ),
    });

    const [failed, later1, later2] = outcome.resultEntries;
    expect(failed?.state).toBe("cracked");
    expect(failed?.error).toBeTruthy();
    expect(later1?.state).toBe("cracked");
    expect(later1?.error).toBe(`session aborted after ${failed?.error ?? ""}`);
    expect(later2?.error).toBe(`session aborted after ${failed?.error ?? ""}`);
    expect(calls).toEqual(["quote"]);
  });

  it("cracks every jar of a group whose connection times out, and calls no tool", async () => {
    const calls: string[] = [];
    const outcome = await run({
      jars: [jarOf("SPC-0001", "quote", "{}", { seq: 1 }), jarOf("SPC-0002", "quote", "{}", { seq: 2 })],
      allow: ["quote"],
      factory: spying(makeFailingClientFactory(makeInMemoryClientFactory("v1"), { at: "connect" }), calls),
    });

    expect(outcome.resultEntries.map((entry) => entry.state)).toEqual(["cracked", "cracked"]);
    for (const entry of outcome.resultEntries) {
      expect(entry.error).toContain("Connection attempt timed out");
    }
    expect(calls).toEqual([]);
  });

  it("replays a tool named in both allow and watch once", async () => {
    const calls: string[] = [];
    const outcome = await run({
      jars: [jarOf("SPC-0001", "alpha", '{"n":1}')],
      allow: ["alpha"],
      watch: ["alpha"],
      factory: spying(makeScriptedClientFactory(STATE_TOOLS), calls),
    });

    expect(calls).toEqual(["alpha"]);
    expect(outcome.resultEntries[0]?.state).toBe("preserved");
  });

  it("lists the real tool names when no jar is replayable", async () => {
    const calls: string[] = [];
    const outcome = await run({
      jars: [jarOf("SPC-0001", "quote", "{}")],
      factory: spying(makeInMemoryClientFactory("v1"), calls),
    });

    expect(outcome.resultEntries[0]?.state).toBe("skipped");
    expect(outcome.toolsListed).toEqual([
      "book",
      "cancel_booking",
      "get_room",
      "list_bookings",
      "quote",
      "search_rooms",
    ]);
    expect(calls).toEqual([]);
  });

  it("preserves a jar whose only difference is at /created_at under the default Volatile_Policy (E6)", async () => {
    const outcome = await run({
      jars: [jarOf("SPC-0001", "quote", '{"total":425,"created_at":"2026-01-01T00:00:00.000Z"}')],
      allow: ["quote"],
      factory: oneTool("quote", '{"total":425,"created_at":"2026-02-02T00:00:00.000Z"}'),
    });

    const [entry] = outcome.resultEntries;
    expect(entry?.state).toBe("preserved");
    expect(entry?.changes).toEqual([]);
    expect(entry?.ignored).toContain("/created_at");
  });
});
