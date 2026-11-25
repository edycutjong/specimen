import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_REDACT_CONFIG,
  SHIPPED_VOLATILE_POLICY,
  buildReplayResultFields,
  canonicalJson,
  compileRedact,
  isJsonResponse,
  redactText,
  replay,
  replayResultSchema,
  schemaDiffOf,
  serializeJarLine,
  verdict,
  type ClientFactory,
  type Compiled,
  type EngineOutcome,
  type JarLine,
  type Json,
  type ListedTool,
  type RedactConfig,
  type ReplayEngineArgs,
} from "../src/index.js";
import { makeScriptedClientFactory, type ScriptedTool } from "./support/scripted.js";

const T0 = "2026-01-01T00:00:00.000Z";

function compiled(config: RedactConfig): Compiled {
  const result = compileRedact(config);
  if (!result.ok) throw new Error(`redact pattern ${result.patternIndex} does not compile`);
  return result.value;
}

const REDACT = compiled(DEFAULT_REDACT_CONFIG);
const HASH = compiled({ ...DEFAULT_REDACT_CONFIG, text: "hash" });

/** A `sk-` key with 20 to 30 alphanumeric characters, which the default config redacts. */
const secretArb = fc
  .tuple(fc.constant("sk-"), fc.stringMatching(/^[A-Za-z0-9]{20,30}$/))
  .map(([prefix, body]) => prefix + body);

/** Lower-case words and spaces. No pattern of the default config can match them. */
const plainArb = fc.stringMatching(/^[a-z ]{0,20}$/);

type JarSpec = {
  tool: string;
  response_text: string;
  seq?: number;
  input?: Json;
  redacted?: string[];
  text_redacted?: boolean;
  response_length?: number;
};

/**
 * A Jar_Line for one recorded call. `response` is parsed from the text when the text is a
 * JSON_Response, and is null for a hashed response.
 */
function jarOf(spec: JarSpec, id: string): JarLine {
  const hashed = spec.response_length !== undefined;
  const response = !hashed && isJsonResponse(spec.response_text) ? (JSON.parse(spec.response_text) as Json) : null;
  const line: JarLine = {
    v: 1,
    id,
    session_id: "s1",
    seq: spec.seq ?? 1,
    server: "hollow-inn",
    tool: spec.tool,
    tool_id: spec.tool,
    input: spec.input ?? {},
    response_text: spec.response_text,
    response,
    t0: T0,
    t1: T0,
    duration_ms: 1,
    redacted: spec.redacted ?? [],
  };
  if (spec.text_redacted !== undefined) line.text_redacted = spec.text_redacted;
  if (spec.response_length !== undefined) line.response_length = spec.response_length;
  return line;
}

/** A tool that returns one fixed text and no error. */
function tool(name: string, text: string): ScriptedTool {
  return { name, reply: { text } };
}

type RunOptions = { strict?: boolean; baseline?: ClientFactory; redact?: Compiled };

/** Replays the jars as one session against the factory, with every jar's tool allowed. */
async function runReplay(
  jars: JarLine[],
  factory: ClientFactory,
  options: RunOptions = {},
): Promise<EngineOutcome> {
  const allow = [...new Set(jars.map((jar) => jar.tool))];
  let tick = 0;
  const args: ReplayEngineArgs = {
    jarFiles: [{ file: "jars/test.jsonl", text: jars.map((jar) => serializeJarLine(jar)).join("") }],
    pendingText: undefined,
    replayPolicy: { allow, watch: [] },
    volatilePolicy: SHIPPED_VOLATILE_POLICY,
    redactConfig: options.redact ?? REDACT,
    strict: options.strict ?? false,
    clientFactory: factory,
    ...(options.baseline === undefined ? {} : { baselineFactory: options.baseline }),
    clock: () => tick++,
    serverLabel: "scripted",
    startedAt: T0,
    timeoutMs: 10_000,
  };
  return replay(args);
}

/** The Replay_Result that packages/cli would write, built from the engine outcome. */
function assemble(outcome: EngineOutcome, strict: boolean) {
  const fields = buildReplayResultFields({ serverLabel: "scripted", startedAt: T0, strict }, outcome);
  const judged = verdict({
    entries: outcome.resultEntries,
    spoiledCount: outcome.spoiled.length,
    toolsListed: outcome.toolsListed,
    filedIds: new Set<string>(),
  });
  return {
    ...fields,
    verdict: judged.verdict,
    red: judged.red,
    filed: judged.filed,
    covered: judged.covered,
    reason: judged.reason,
    coverage: judged.coverage,
  };
}

describe("Hashed_Jar and text_redacted comparisons", () => {
  const recorded = "Booked. Key sk-ABCDEFGHIJKLMNOPQRSTUV, mail ops@inn.example";

  it("preserves a Hashed_Jar whose replayed text hashes to the jarred value", async () => {
    const captured = redactText(recorded, HASH);
    const jar = jarOf(
      {
        tool: "note",
        response_text: captured.responseText,
        response_length: captured.responseLength,
        text_redacted: true,
      },
      "SPC-0001",
    );
    const outcome = await runReplay([jar], makeScriptedClientFactory([tool("note", recorded)]));
    const [entry] = outcome.resultEntries;
    expect(entry?.state).toBe("preserved");
    expect(entry?.changes).toEqual([]);
    expect(entry?.replayed_text).toBe(redactText(recorded, REDACT).responseText);
  });

  it("rattles a Hashed_Jar with one value Change at /response_text otherwise", async () => {
    const captured = redactText(recorded, HASH);
    const jar = jarOf(
      {
        tool: "note",
        response_text: captured.responseText,
        response_length: captured.responseLength,
        text_redacted: true,
      },
      "SPC-0001",
    );
    const replayed = "Booked. Room 4";
    const outcome = await runReplay([jar], makeScriptedClientFactory([tool("note", replayed)]));
    const [entry] = outcome.resultEntries;
    expect(entry?.state).toBe("rattled");
    expect(entry?.changes).toEqual([
      {
        path: "/response_text",
        kind: "value",
        was: captured.responseText,
        now: redactText(replayed, HASH).responseText,
      },
    ]);
  });

  it("compares a text_redacted jar after pattern redaction of the replayed text", async () => {
    const captured = redactText(recorded, REDACT);
    const jar = jarOf({ tool: "note", response_text: captured.responseText, text_redacted: true }, "SPC-0001");

    // Same words, different secret and e-mail values: the redacted texts are equal.
    const sameWords = "Booked. Key sk-ZZZZZZZZZZZZZZZZZZZZZZ, mail other@inn.example";
    const same = await runReplay([jar], makeScriptedClientFactory([tool("note", sameWords)]));
    expect(same.resultEntries[0]?.state).toBe("preserved");
    expect(same.resultEntries[0]?.changes).toEqual([]);

    // A different word is a real difference.
    const changed = "Cancelled. Key sk-ZZZZZZZZZZZZZZZZZZZZZZ, mail other@inn.example";
    const different = await runReplay([jar], makeScriptedClientFactory([tool("note", changed)]));
    expect(different.resultEntries[0]?.state).toBe("rattled");
    expect(different.resultEntries[0]?.changes.map((change) => [change.path, change.kind])).toEqual([
      ["/line/1", "value"],
    ]);
  });
});

describe("secrets in a replayed response", () => {
  it("redacts a secret in replayed_text, replayed, the now of a Change and error", async () => {
    const secret = "sk-ABCDEFGHIJKLMNOPQRSTUVWX";
    const quote = JSON.stringify({ total: secret, password: "hunter2" });
    const jars = [
      jarOf({ tool: "quote", response_text: JSON.stringify({ total: 425 }) }, "SPC-0001"),
      jarOf({ tool: "boom", response_text: "ok", seq: 2 }, "SPC-0002"),
    ];
    const factory = makeScriptedClientFactory([
      tool("quote", quote),
      { name: "boom", reply: { text: `Error: ${secret}`, isError: true } },
    ]);
    const outcome = await runReplay(jars, factory, { strict: true });

    const [quoteEntry, boomEntry] = outcome.resultEntries;
    expect(quoteEntry?.replayed_text).toBe('{"total":"[REDACTED]","password":"[REDACTED]"}');
    expect(quoteEntry?.replayed).toEqual({ total: "[REDACTED]", password: "[REDACTED]" });
    expect(quoteEntry?.changes).toEqual([
      { path: "/password", kind: "added", now: "[REDACTED]" },
      { path: "/total", kind: "type", was: 425, now: "[REDACTED]" },
    ]);
    expect(boomEntry?.state).toBe("cracked");
    expect(boomEntry?.error).toBe("Error: [REDACTED]");

    const written = JSON.stringify(outcome.resultEntries);
    expect(written).not.toContain(secret);
    expect(written).not.toContain("hunter2");
  });
});

describe("ignored response pointers", () => {
  it("excludes the path after /response is stripped and lists that stripped path as ignored", async () => {
    const jar = jarOf(
      {
        tool: "quote",
        response_text: JSON.stringify({ total: 425, x: 1 }),
        redacted: ["/response/total"],
      },
      "SPC-0001",
    );
    const factory = makeScriptedClientFactory([tool("quote", JSON.stringify({ total: 999, x: 1 }))]);
    const outcome = await runReplay([jar], factory);
    const [entry] = outcome.resultEntries;
    expect(entry?.state).toBe("preserved");
    expect(entry?.changes).toEqual([]);
    expect(entry?.ignored).toEqual(["/total"]);
  });
});

describe("schema_diff", () => {
  const shapeX = { x: z.string() };

  it("lists removed, added and input-changed tools from the two tools/list results", async () => {
    const jar = jarOf({ tool: "alpha", response_text: "{}" }, "SPC-0001");
    const target = makeScriptedClientFactory([
      { name: "alpha", reply: { text: "{}" }, inputSchema: { x: z.number() } },
      tool("gamma", "{}"),
    ]);
    const baseline = makeScriptedClientFactory([
      { name: "alpha", reply: { text: "{}" }, inputSchema: shapeX },
      tool("beta", "{}"),
    ]);
    const outcome = await runReplay([jar], target, { baseline });
    expect(outcome.schemaDiffError).toBeUndefined();
    expect(outcome.schemaDiff).toEqual({
      tools_removed: ["beta"],
      tools_added: ["gamma"],
      input_schema_changed: ["alpha"],
    });
  });

  it("reports a failed baseline through the outcome and leaves the jar states unchanged", async () => {
    const jar = jarOf({ tool: "quote", response_text: "{}" }, "SPC-0001");
    const factory = makeScriptedClientFactory([tool("quote", "{}")]);
    const alone = await runReplay([jar], factory);
    const failing: ClientFactory = () => Promise.reject(new Error("baseline refused to start"));
    const withFailure = await runReplay([jar], factory, { baseline: failing });

    expect(withFailure.schemaDiffError).toBe("baseline failed: baseline refused to start");
    expect(withFailure.schemaDiff).toEqual({ tools_removed: [], tools_added: [], input_schema_changed: [] });
    expect(withFailure.resultEntries).toEqual(alone.resultEntries);
  });
});

// Feature: replay-engine, Property 11: Redacted-at-capture jars compare the re-redacted replayed text, not the raw text
describe("Property 11: Redacted-at-capture jars compare the re-redacted replayed text", () => {
  it("a Hashed_Jar is preserved exactly when the replayed text hashes to the jarred value", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), async (recorded, replayed) => {
        const captured = redactText(recorded, HASH);
        const jar = jarOf(
          {
            tool: "note",
            response_text: captured.responseText,
            response_length: captured.responseLength,
            text_redacted: true,
          },
          "SPC-0001",
        );
        const outcome = await runReplay([jar], makeScriptedClientFactory([tool("note", replayed)]));
        const [entry] = outcome.resultEntries;
        const now = redactText(replayed, HASH).responseText;
        if (now === captured.responseText) {
          expect(entry?.state).toBe("preserved");
          expect(entry?.changes).toEqual([]);
        } else {
          expect(entry?.state).toBe("rattled");
          expect(entry?.changes).toEqual([
            { path: "/response_text", kind: "value", was: captured.responseText, now },
          ]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("a text_redacted jar never rattles over a secret value that differs between the runs", async () => {
    await fc.assert(
      fc.asyncProperty(plainArb, secretArb, secretArb, async (base, first, second) => {
        const captured = redactText(`${base} ${first}`, REDACT);
        const jar = jarOf(
          { tool: "note", response_text: captured.responseText, text_redacted: true },
          "SPC-0001",
        );
        const outcome = await runReplay(
          [jar],
          makeScriptedClientFactory([tool("note", `${base} ${second}`)]),
        );
        const [entry] = outcome.resultEntries;
        // A text that is nothing but the marker compared two markers: unsealed, never preserved (a2a round 06).
        const onlyMarker = captured.responseText.split("[REDACTED]").join("").trim() === "";
        expect(entry?.state).toBe(onlyMarker ? "unsealed" : "preserved");
        expect(entry?.changes).toEqual([]);
        expect(entry?.replayed_text).not.toContain(second);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: replay-engine, Property 12: Excluded pointers never produce a Change and are always listed as ignored
describe("Property 12: Excluded pointers never produce a Change and are always listed as ignored", () => {
  const KEYS = ["a", "b", "total"];
  const scalarArb = fc.oneof(fc.integer({ min: -99, max: 99 }), fc.string({ maxLength: 3 }), fc.boolean());
  const objectArb = fc.dictionary(fc.constantFrom(...KEYS), scalarArb, { minKeys: 1, maxKeys: 3 });

  it("no Change lies at or below an excluded path, and each excluded path is listed once", async () => {
    await fc.assert(
      fc.asyncProperty(objectArb, objectArb, fc.subarray(KEYS, { minLength: 1 }), async (recorded, replayed, excluded) => {
        const jar = jarOf(
          {
            tool: "note",
            response_text: JSON.stringify(recorded),
            redacted: excluded.map((key) => `/response/${key}`),
          },
          "SPC-0001",
        );
        const outcome = await runReplay(
          [jar],
          makeScriptedClientFactory([tool("note", JSON.stringify(replayed))]),
          { strict: true },
        );
        const [entry] = outcome.resultEntries;
        const underExcluded = (path: string): boolean =>
          excluded.some((key) => path === `/${key}` || path.startsWith(`/${key}/`));
        expect([...(entry?.changes ?? []), ...(entry?.compatible ?? [])].filter((c) => underExcluded(c.path))).toEqual([]);
        for (const key of excluded) {
          expect(entry?.ignored.filter((pointer) => pointer === `/${key}`)).toHaveLength(1);
        }
        expect(entry?.ignored.some((pointer) => pointer.startsWith("/response"))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: replay-engine, Property 17: Written Replay_Results carry no unredacted secret and round-trip through their schema
describe("Property 17: Written Replay_Results carry no unredacted secret and round-trip through their schema", () => {
  it("no secret appears in the serialised result, and the result parses back equal", async () => {
    await fc.assert(
      fc.asyncProperty(
        secretArb,
        fc.stringMatching(/^[A-Za-z0-9]{8,12}$/),
        async (secret, token) => {
          const quote = JSON.stringify({
            total: secret,
            token: `t-${secret}`,
            note: `used Bearer ${token}`,
            password: `pw-${token}`,
          });
          const jars = [
            jarOf({ tool: "quote", response_text: JSON.stringify({ total: 425 }) }, "SPC-0001"),
            jarOf({ tool: "boom", response_text: "ok", seq: 2 }, "SPC-0002"),
          ];
          const factory = makeScriptedClientFactory([
            tool("quote", quote),
            { name: "boom", reply: { text: `Error: auth ${secret}`, isError: true } },
          ]);
          const outcome = await runReplay(jars, factory, { strict: true });
          const result = assemble(outcome, true);

          const serialised = JSON.stringify(result);
          expect(serialised).not.toContain(secret);
          expect(serialised).not.toContain(token);
          expect(replayResultSchema.parse(JSON.parse(serialised))).toEqual(result);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: replay-engine, Property 18: schema_diff is computed from two tool lists and never influences state or verdict
describe("Property 18: schema_diff is computed from two tool lists and never influences state or verdict", () => {
  const nameArb = fc.constantFrom("alpha", "beta", "gamma", "delta", "Zeta");
  const schemaArb = fc.dictionary(
    fc.constantFrom("x", "y"),
    fc.oneof(fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.constant(null)),
    { maxKeys: 2 },
  );
  const listArb: fc.Arbitrary<ListedTool[]> = fc.uniqueArray(
    fc.record({ name: nameArb, inputSchema: schemaArb }),
    { selector: (listed) => listed.name, maxLength: 5 },
  );

  it("the names and the canonical input schemas of two tool lists determine the diff", () => {
    fc.assert(
      fc.property(listArb, listArb, (baseline, target) => {
        const before = new Map(baseline.map((listed) => [listed.name, listed.inputSchema] as const));
        const after = new Map(target.map((listed) => [listed.name, listed.inputSchema] as const));
        const changed = (name: string): boolean =>
          after.has(name) && canonicalJson(before.get(name) ?? null) !== canonicalJson(after.get(name) ?? null);

        expect(schemaDiffOf(baseline, target)).toEqual({
          tools_removed: [...before.keys()].filter((name) => !after.has(name)).sort(),
          tools_added: [...after.keys()].filter((name) => !before.has(name)).sort(),
          input_schema_changed: [...before.keys()].filter(changed).sort(),
        });
      }),
      { numRuns: 100 },
    );
  });

  it("a baseline never changes the jar results or the Verdict", async () => {
    const shapes = [undefined, { x: z.string() }, { x: z.number() }, { y: z.boolean() }] as const;
    const baselineArb = fc.uniqueArray(
      fc.record({ name: fc.constantFrom("quote", "search", "book"), shape: fc.integer({ min: 0, max: 3 }) }),
      { selector: (picked) => picked.name, maxLength: 3 },
    );
    await fc.assert(
      fc.asyncProperty(baselineArb, async (picks) => {
        const baselineTools: ScriptedTool[] = picks.map((picked) => {
          const scripted: ScriptedTool = { name: picked.name, reply: { text: "{}" } };
          const shape = shapes[picked.shape];
          if (shape !== undefined) scripted.inputSchema = shape;
          return scripted;
        });
        const jars = [jarOf({ tool: "quote", response_text: "{}" }, "SPC-0001")];
        const target = makeScriptedClientFactory([tool("quote", "{}")]);

        const alone = await runReplay(jars, target);
        // A server with no tools does not advertise tools/list, so the baseline always keeps one tool.
        const withBaseline = await runReplay(jars, target, {
          baseline: makeScriptedClientFactory([tool("keep", "{}"), ...baselineTools]),
        });
        expect(withBaseline.schemaDiffError).toBeUndefined();

        expect(withBaseline.resultEntries).toEqual(alone.resultEntries);
        const verdictOf = (outcome: EngineOutcome) => {
          const judged = verdict({
            entries: outcome.resultEntries,
            spoiledCount: outcome.spoiled.length,
            toolsListed: outcome.toolsListed,
            filedIds: new Set<string>(),
          });
          return { verdict: judged.verdict, reason: judged.reason, red: judged.red, covered: judged.covered };
        };
        expect(verdictOf(withBaseline)).toEqual(verdictOf(alone));
        expect(withBaseline.schemaDiff.tools_removed).toEqual(
          ["keep", ...picks.map((picked) => picked.name).filter((name) => name !== "quote")].sort(),
        );
        // The target always lists "quote", so it is added unless the baseline lists it too.
        const baselineHasQuote = picks.some((picked) => picked.name === "quote");
        expect(withBaseline.schemaDiff.tools_added).toEqual(baselineHasQuote ? [] : ["quote"]);
      }),
      { numRuns: 100 },
    );
  });
});
