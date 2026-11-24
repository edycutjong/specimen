import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHILD_TIMEOUT,
  RESPONSE,
  SESSION,
  TOOL,
  TOOL_INPUT,
  createWorkspace,
  fire,
  postPayload,
  prePayload,
  type Workspace,
} from "./support/capture.js";

// Each test gets its own workspace with a .kiro folder. The repository jars/ is never used.
let ws: Workspace;

beforeEach(() => {
  ws = createWorkspace();
});

afterEach(() => {
  ws.remove();
});

describe("specimen hook pre and post (child processes)", () => {
  it("records a pre and post pair as one Jar_Line and clears the pending entry", () => {
    const pre = fire(ws.root, "pre", prePayload(ws.root));
    expect(pre.status).toBe(0);
    expect(pre.stdout).toBe("");
    expect(pre.stderr).toBe("");

    const post = fire(ws.root, "post", postPayload(ws.root));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    const jar = readFileSync(ws.jarFile(), "utf8");
    expect(jar.endsWith("\n")).toBe(true);
    const lines = jar.split("\n").slice(0, -1);
    expect(lines).toHaveLength(1);

    const line = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(line).toMatchObject({
      v: 1,
      id: "SPC-0001",
      session_id: SESSION,
      seq: 1,
      server: "hollowinn",
      tool: "quote",
      tool_id: TOOL,
      input: TOOL_INPUT,
      response_text: RESPONSE,
      redacted: [],
    });
    expect(line).not.toHaveProperty("unpaired");
    expect(Date.parse(String(line.t1))).toBeGreaterThanOrEqual(Date.parse(String(line.t0)));
    expect(line.duration_ms).toBe(Date.parse(String(line.t1)) - Date.parse(String(line.t0)));

    expect(readFileSync(ws.specimenFile("pending.jsonl"), "utf8")).toBe("");
    expect(readFileSync(ws.specimenFile("counter"), "utf8")).toBe("1\n");
  }, CHILD_TIMEOUT * 3);

  it("records an unpaired post with t0 equal to t1 and duration 0", () => {
    const post = fire(ws.root, "post", postPayload(ws.root));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    const jar = readFileSync(ws.jarFile(), "utf8");
    const line = JSON.parse(jar.trimEnd()) as Record<string, unknown>;
    expect(line).toMatchObject({
      id: "SPC-0001",
      seq: 1,
      unpaired: true,
      duration_ms: 0,
      response_text: RESPONSE,
    });
    expect(line.t0).toBe(line.t1);
    expect(existsSync(ws.specimenFile("pending.jsonl"))).toBe(false);
  }, CHILD_TIMEOUT * 2);

  it("records nothing for an invalid session id and logs the refusal", () => {
    const pre = fire(ws.root, "pre", prePayload(ws.root, "../escape"));
    expect(pre.status).toBe(0);
    expect(pre.stdout).toBe("");
    expect(pre.stderr).toBe("");

    expect(existsSync(join(ws.root, "jars"))).toBe(false);
    expect(existsSync(ws.specimenFile("pending.jsonl"))).toBe(false);
    expect(readFileSync(ws.specimenFile("hook.log"), "utf8")).toContain("session_id invalid");
  }, CHILD_TIMEOUT);
});
