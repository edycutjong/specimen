import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jarLineSchema } from "@specimen/core";
import { createWorkspace, fire, readJsonl, type Workspace } from "./support/capture.js";

/**
 * Feeds the payload shapes recorded in evidence/spikes/S3.md through `specimen hook pre` and
 * `specimen hook post` as real child processes. Every write goes to a temporary workspace.
 *
 * S3.md records the payload key sets exactly:
 *   Pre_Payload:  session_id, hook_event_name, cwd, tool_name, tool_input
 *   Post_Payload: the same keys plus tool_response (a string).
 * It also records one verbatim tool_response string and the tool_name values. It does NOT record
 * the values of session_id, cwd or tool_input. Those are placeholders below, marked PLACEHOLDER.
 */

// Recorded in S3.md (verbatim).
const RECORDED_TOOL_RESPONSE = '{"room_id":"R-101","nights":2,"total":425,"currency":"USD"}';
const RECORDED_TOOL_NAME = "mcp_hollowinn_quote"; // one of the tool_name values S3.md lists

// PLACEHOLDER: S3.md does not record these values. Chosen only so the payload matches the
// recorded key set and the schema types.
const PLACEHOLDER_SESSION_ID = "s3-measured";
const PLACEHOLDER_TOOL_INPUT = { room_id: "R-101", nights: 2 };

const SERVER_KEY = "hollowinn";

let ws: Workspace;

beforeEach(() => {
  ws = createWorkspace();
});

afterEach(() => {
  ws.remove();
});

describe("S3 measured payload shapes through the capture hooks (end to end)", () => {
  it("writes exactly one valid Jar_Line and clears the pending entry", () => {
    const pre = {
      session_id: PLACEHOLDER_SESSION_ID,
      hook_event_name: "PreToolUse",
      cwd: ws.root,
      tool_name: RECORDED_TOOL_NAME,
      tool_input: PLACEHOLDER_TOOL_INPUT,
    };
    const post = {
      ...pre,
      hook_event_name: "PostToolUse",
      tool_response: RECORDED_TOOL_RESPONSE,
    };

    const preRun = fire(ws.root, "pre", pre);
    expect(preRun.status).toBe(0);
    expect(preRun.stdout).toBe("");
    expect(preRun.stderr).toBe("");
    expect(readJsonl(ws.specimenFile("pending.jsonl"))).toHaveLength(1);

    const postRun = fire(ws.root, "post", post);
    expect(postRun.status).toBe(0);
    expect(postRun.stdout).toBe("");
    expect(postRun.stderr).toBe("");

    // Exactly one Jar_Line, in the session's jar file, and it validates with the core schema.
    const jarPath = ws.jarFile(PLACEHOLDER_SESSION_ID);
    expect(existsSync(jarPath)).toBe(true);
    const rawLines = readFileSync(jarPath, "utf8").split("\n").filter((l) => l !== "");
    expect(rawLines).toHaveLength(1);

    const parsed: unknown = JSON.parse(rawLines[0] ?? "");
    const result = jarLineSchema.safeParse(parsed);
    expect(result.success).toBe(true);

    // Field mapping from the recorded payloads.
    expect(parsed).toMatchObject({
      session_id: PLACEHOLDER_SESSION_ID,
      server: SERVER_KEY,
      tool: "quote",
      tool_id: RECORDED_TOOL_NAME,
      input: PLACEHOLDER_TOOL_INPUT,
      response_text: RECORDED_TOOL_RESPONSE,
      response: { room_id: "R-101", nights: 2, total: 425, currency: "USD" },
    });

    // The pending entry was consumed: the pending file holds no entry any more.
    const pendingLeft = existsSync(ws.specimenFile("pending.jsonl"))
      ? readFileSync(ws.specimenFile("pending.jsonl"), "utf8")
      : "";
    expect(pendingLeft.trim()).toBe("");
  }, 120_000);
});
