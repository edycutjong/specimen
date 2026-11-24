import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACT_CONFIG,
  SHIPPED_VOLATILE_POLICY,
  compileRedact,
  replay,
  serializeJarLine,
  type JarLine,
} from "../src/index.js";
import { makeInMemoryClientFactory } from "./support/inmemory.js";

const T0 = "2026-01-01T00:00:00.000Z";

// Records one quote call against v1 through the real SDK client, then builds the jar line from
// that recording. The jar set lives in this test only and never reads the repository jars.
async function recordQuote(): Promise<JarLine> {
  const input = { room_id: "r-04", nights: 2 };
  const session = await makeInMemoryClientFactory("v1")();
  const result = await session.client.callTool({ name: "quote", arguments: input });
  await session.close();
  const text = (result.content as { type: string; text: string }[])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
  return {
    v: 1,
    id: "SPC-0001",
    session_id: "smoke-1",
    seq: 1,
    server: "hollow-inn",
    tool: "quote",
    tool_id: "quote",
    input,
    response_text: text,
    response: JSON.parse(text) as JarLine["response"],
    t0: T0,
    t1: T0,
    duration_ms: 1,
    redacted: [],
  };
}

describe("replay smoke", () => {
  it("replays a recorded quote jar against v1 and keeps it preserved", async () => {
    const line = await recordQuote();
    const redact = compileRedact(DEFAULT_REDACT_CONFIG);
    if (!redact.ok) throw new Error("default redact config must compile");

    let tick = 0;
    const outcome = await replay({
      jarFiles: [{ file: "jars/smoke.jsonl", text: serializeJarLine(line) }],
      pendingText: undefined,
      replayPolicy: { allow: [], watch: ["quote"] },
      volatilePolicy: SHIPPED_VOLATILE_POLICY,
      redactConfig: redact.value,
      strict: false,
      clientFactory: makeInMemoryClientFactory("v1"),
      serverLabel: "hollow-inn-v1",
      startedAt: "2026-01-01T00:00:00.000Z",
      clock: () => tick++,
      timeoutMs: 10_000,
    });

    expect(outcome.spoiled).toEqual([]);
    expect(outcome.toolsListed).toContain("quote");
    expect(outcome.resultEntries).toHaveLength(1);
    const [entry] = outcome.resultEntries;
    expect(entry?.id).toBe("SPC-0001");
    expect(entry?.state).toBe("preserved");
    expect(entry?.changes).toEqual([]);
    expect(entry?.replayed).toEqual(line.response);
  });
});
