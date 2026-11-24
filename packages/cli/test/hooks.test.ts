import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHILD_TIMEOUT,
  SESSION,
  TOOL_INPUT,
  createWorkspace,
  fire,
  fireRaw,
  postPayload,
  prePayload,
  readJsonl,
  runChild,
  snapshot,
  type Workspace,
} from "./support/capture.js";

/**
 * Behaviour of the capture hooks across several calls. The single pre and post pair and the
 * invalid session id cases live in hook-capture.test.ts, which shares the helpers in support/.
 * Every workspace is a fresh temporary directory. The repository jars/ and .specimen/ are not used.
 */

const MULTI_CALL_TIMEOUT = CHILD_TIMEOUT * 3;
const PRE_ARGS = ["hook", "pre", "--server", "hollowinn"];
const POST_ARGS = ["hook", "post", "--server", "hollowinn"];
const HOOK_LOG = join(".specimen", "hook.log");

let ws: Workspace;

beforeEach(() => {
  ws = createWorkspace();
});

afterEach(() => {
  ws.remove();
});

describe("capture hooks: pairing", () => {
  it("pairs several posts with several pres first in, first out", () => {
    const first = { room_id: "r-01" };
    const second = { room_id: "r-02" };

    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, first)).status).toBe(0);
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, second)).status).toBe(0);
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, first)).status).toBe(0);

    const pending = readJsonl(ws.specimenFile("pending.jsonl"));
    expect(pending.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    const t0s = pending.map((entry) => entry.t0);

    for (const input of [first, second, first]) {
      const post = fire(ws.root, "post", postPayload(ws.root, SESSION, input));
      expect(post.status).toBe(0);
      expect(post.stdout).toBe("");
      expect(post.stderr).toBe("");
    }

    const lines = readJsonl(ws.jarFile());
    expect(lines.map((line) => line.seq)).toEqual([1, 2, 3]);
    expect(lines.map((line) => line.input)).toEqual([first, second, first]);
    expect(lines.map((line) => line.t0)).toEqual(t0s);
    expect(lines.some((line) => line.unpaired === true)).toBe(false);
    expect(readFileSync(ws.specimenFile("pending.jsonl"), "utf8")).toBe("");
  }, MULTI_CALL_TIMEOUT);

  it("records an unpaired post and leaves an unmatched pending entry untouched", () => {
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, { room_id: "r-01" })).status).toBe(0);
    const pendingBefore = readFileSync(ws.specimenFile("pending.jsonl"), "utf8");

    const post = fire(ws.root, "post", postPayload(ws.root, SESSION, { room_id: "r-99" }));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    const [line] = readJsonl(ws.jarFile());
    expect(line).toMatchObject({ seq: 2, unpaired: true, duration_ms: 0, input: { room_id: "r-99" } });
    expect(line?.t0).toBe(line?.t1);

    expect(readFileSync(ws.specimenFile("pending.jsonl"), "utf8")).toBe(pendingBefore);
  }, MULTI_CALL_TIMEOUT);

  it("gives the first call of a session seq 1 in both the pending entry and the Jar_Line", () => {
    expect(fire(ws.root, "pre", prePayload(ws.root)).status).toBe(0);
    expect(readJsonl(ws.specimenFile("pending.jsonl"))[0]?.seq).toBe(1);

    expect(fire(ws.root, "post", postPayload(ws.root)).status).toBe(0);
    expect(readJsonl(ws.jarFile())[0]?.seq).toBe(1);
  }, MULTI_CALL_TIMEOUT);

  it("keeps seq unique when an orphan pending entry is present", () => {
    // The orphan is a pre whose post never arrives. It keeps seq 1 in the pending file.
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, { room_id: "orphan" })).status).toBe(0);
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, TOOL_INPUT)).status).toBe(0);
    expect(fire(ws.root, "post", postPayload(ws.root, SESSION, TOOL_INPUT)).status).toBe(0);
    expect(fire(ws.root, "post", postPayload(ws.root, SESSION, { room_id: "stray" })).status).toBe(0);

    const lines = readJsonl(ws.jarFile());
    expect(lines.map((line) => line.seq)).toEqual([2, 3]);
    expect(lines[1]).toMatchObject({ unpaired: true });

    const pending = readJsonl(ws.specimenFile("pending.jsonl"));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ seq: 1, session_id: SESSION });
  }, MULTI_CALL_TIMEOUT);
});

describe("capture hooks: counter and jar state", () => {
  it("continues the accession counter from the highest id in jars/ when the counter is missing", () => {
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION)).status).toBe(0);
    expect(fire(ws.root, "post", postPayload(ws.root, SESSION)).status).toBe(0);

    // Seed the jar with a higher id, then remove the counter so only the jar holds the history.
    const [seeded] = readJsonl(ws.jarFile());
    writeFileSync(ws.jarFile(), `${JSON.stringify({ ...seeded, id: "SPC-0042" })}\n`);
    rmSync(ws.specimenFile("counter"));

    expect(fire(ws.root, "post", postPayload(ws.root, "s-2", { room_id: "other" })).status).toBe(0);

    const [line] = readJsonl(join(ws.root, "jars", "s-2.jsonl"));
    expect(line?.id).toBe("SPC-0043");
    expect(readFileSync(ws.specimenFile("counter"), "utf8")).toBe("43\n");
  }, MULTI_CALL_TIMEOUT);

  it("does not append to a jar that ends in a torn line", () => {
    mkdirSync(join(ws.root, "jars"));
    const torn = '{"v":1,"id":"SPC-0007"';
    writeFileSync(ws.jarFile(), torn);

    expect(fire(ws.root, "pre", prePayload(ws.root)).status).toBe(0);
    const jarBefore = readFileSync(ws.jarFile(), "utf8");
    const pendingBefore = readFileSync(ws.specimenFile("pending.jsonl"), "utf8");

    const post = fire(ws.root, "post", postPayload(ws.root));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    expect(readFileSync(ws.jarFile(), "utf8")).toBe(jarBefore);
    expect(readFileSync(ws.specimenFile("pending.jsonl"), "utf8")).toBe(pendingBefore);
    expect(existsSync(ws.specimenFile("counter"))).toBe(false);
    expect(readFileSync(ws.specimenFile("hook.log"), "utf8")).toContain("jar does not end with a newline");
  }, MULTI_CALL_TIMEOUT);
});

describe("capture hooks: session id boundary", () => {
  it.each([
    ["a slash", "a/b"],
    ["dot-dot", ".."],
    ["a backslash", "a\\b"],
  ])("records nothing for a session id containing %s", (_label, sessionId) => {
    const pre = fire(ws.root, "pre", prePayload(ws.root, sessionId));
    expect(pre.status).toBe(0);
    expect(pre.stdout).toBe("");
    expect(pre.stderr).toBe("");

    const post = fire(ws.root, "post", postPayload(ws.root, sessionId));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    expect(existsSync(join(ws.root, "jars"))).toBe(false);
    expect(existsSync(ws.specimenFile("pending.jsonl"))).toBe(false);
  }, MULTI_CALL_TIMEOUT);
});

describe("capture hooks: lock timeout", () => {
  it("records nothing and changes no file when pre cannot take the lock", () => {
    mkdirSync(join(ws.root, ".specimen"), { recursive: true });
    writeFileSync(ws.specimenFile("lock"), "held-by-another-process");
    const before = snapshot(ws.root, [HOOK_LOG]);

    const pre = fire(ws.root, "pre", prePayload(ws.root));
    expect(pre.status).toBe(0);
    expect(pre.stdout).toBe("");
    expect(pre.stderr).toBe("");

    expect(snapshot(ws.root, [HOOK_LOG])).toEqual(before);
    expect(readFileSync(ws.specimenFile("hook.log"), "utf8")).toContain("LockTimeout");
  }, MULTI_CALL_TIMEOUT);

  it("records nothing and changes no file when post cannot take the lock", () => {
    expect(fire(ws.root, "pre", prePayload(ws.root)).status).toBe(0);
    // The pre hook has released its lock. A fresh lock file now blocks the post hook.
    writeFileSync(ws.specimenFile("lock"), "held-by-another-process");
    const before = snapshot(ws.root, [HOOK_LOG]);

    const post = fire(ws.root, "post", postPayload(ws.root));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    expect(snapshot(ws.root, [HOOK_LOG])).toEqual(before);
    expect(existsSync(join(ws.root, "jars"))).toBe(false);
    expect(readFileSync(ws.specimenFile("hook.log"), "utf8")).toContain("LockTimeout");
  }, MULTI_CALL_TIMEOUT);
});

describe("capture hooks: input hash", () => {
  it("pairs pre and post when the inputs differ only in key order", () => {
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, { nights: 2, room_id: "r-04" })).status).toBe(0);

    const post = fire(ws.root, "post", postPayload(ws.root, SESSION, { room_id: "r-04", nights: 2 }));
    expect(post.status).toBe(0);

    const [line] = readJsonl(ws.jarFile());
    expect(line).not.toHaveProperty("unpaired");
    expect(line?.seq).toBe(1);
    expect(readFileSync(ws.specimenFile("pending.jsonl"), "utf8")).toBe("");
  }, MULTI_CALL_TIMEOUT);

  it("pairs pre and post when the inputs differ only in a redacted value", () => {
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, { room_id: "r-04", token: "first-secret" })).status).toBe(0);

    const post = fire(ws.root, "post", postPayload(ws.root, SESSION, { room_id: "r-04", token: "second-secret" }));
    expect(post.status).toBe(0);

    const [line] = readJsonl(ws.jarFile());
    expect(line).not.toHaveProperty("unpaired");
    expect(line?.input).toEqual({ room_id: "r-04", token: "[REDACTED]" });
    expect(line?.redacted).toEqual(["/input/token"]);
  }, MULTI_CALL_TIMEOUT);

  it("does not pair when an unredacted value differs (control for the two cases above)", () => {
    expect(fire(ws.root, "pre", prePayload(ws.root, SESSION, { room_id: "r-04" })).status).toBe(0);
    expect(fire(ws.root, "post", postPayload(ws.root, SESSION, { room_id: "r-05" })).status).toBe(0);

    const [line] = readJsonl(ws.jarFile());
    expect(line).toMatchObject({ unpaired: true });
    expect(readJsonl(ws.specimenFile("pending.jsonl"))).toHaveLength(1);
  }, MULTI_CALL_TIMEOUT);
});

describe("capture hooks: redact config failures", () => {
  it.each([
    ["invalid JSON", "{not json"],
    ["an unknown key", '{"keys":[],"patterns":[],"text":"redact","extra":1}'],
    ["a pattern that does not compile", '{"keys":[],"patterns":["("],"text":"redact"}'],
    ["a pattern that matches the empty string", '{"keys":[],"patterns":["a*"],"text":"redact"}'],
  ])("records nothing when the redact config has %s", (_label, config) => {
    // A valid config first records one pending entry, so the failure is seen against real state.
    expect(fire(ws.root, "pre", prePayload(ws.root)).status).toBe(0);
    const pendingBefore = readFileSync(ws.specimenFile("pending.jsonl"), "utf8");

    writeFileSync(ws.specimenFile("redact.json"), config);

    const pre = fire(ws.root, "pre", prePayload(ws.root, SESSION, { room_id: "r-09" }));
    expect(pre.status).toBe(0);
    expect(pre.stdout).toBe("");
    expect(pre.stderr).toBe("");
    expect(readFileSync(ws.specimenFile("pending.jsonl"), "utf8")).toBe(pendingBefore);

    const post = fire(ws.root, "post", postPayload(ws.root));
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");
    expect(existsSync(ws.jarFile())).toBe(false);
    expect(readFileSync(ws.specimenFile("pending.jsonl"), "utf8")).toBe(pendingBefore);
  }, MULTI_CALL_TIMEOUT);
});

describe("capture hooks: silence on bad input (child processes)", () => {
  it("writes nothing to STDOUT or STDERR and exits 0 for invalid STDIN", () => {
    const pre = fireRaw(ws.root, PRE_ARGS, "this is not json");
    expect(pre.status).toBe(0);
    expect(pre.stdout).toBe("");
    expect(pre.stderr).toBe("");

    const post = fireRaw(ws.root, POST_ARGS, "{\"session_id\":");
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stderr).toBe("");

    expect(existsSync(join(ws.root, "jars"))).toBe(false);
    expect(existsSync(ws.specimenFile("pending.jsonl"))).toBe(false);
  }, CHILD_TIMEOUT * 2);

  it("writes nothing to STDOUT or STDERR and exits 0 for an unknown argument", () => {
    const result = fireRaw(ws.root, [...PRE_ARGS, "--no-such-option"], JSON.stringify(prePayload(ws.root)));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(existsSync(ws.specimenFile("pending.jsonl"))).toBe(false);
  }, CHILD_TIMEOUT);
});

describe("capture hooks: concurrent child processes", () => {
  it("gives distinct id and seq values to concurrent pre and post runs", async () => {
    const inputs = [1, 2, 3, 4].map((n) => ({ room_id: `r-0${n}` }));

    const pres = await Promise.all(
      inputs.map((input) => runChild(ws.root, PRE_ARGS, JSON.stringify(prePayload(ws.root, SESSION, input)))),
    );
    for (const pre of pres) {
      expect(pre.status).toBe(0);
      expect(pre.stdout).toBe("");
      expect(pre.stderr).toBe("");
    }
    const pending = readJsonl(ws.specimenFile("pending.jsonl"));
    expect(pending.map((entry) => entry.seq).sort()).toEqual([1, 2, 3, 4]);

    // Four posts match the pending entries. Two more have no match and are recorded unpaired.
    const posts = [
      ...inputs.map((input) => postPayload(ws.root, SESSION, input)),
      postPayload(ws.root, SESSION, { room_id: "r-90" }),
      postPayload(ws.root, SESSION, { room_id: "r-91" }),
    ];
    const results = await Promise.all(posts.map((p) => runChild(ws.root, POST_ARGS, JSON.stringify(p))));
    for (const post of results) {
      expect(post.status).toBe(0);
      expect(post.stdout).toBe("");
      expect(post.stderr).toBe("");
    }

    const lines = readJsonl(ws.jarFile());
    expect(lines).toHaveLength(6);
    expect(new Set(lines.map((line) => line.id)).size).toBe(6);
    expect(new Set(lines.map((line) => line.seq)).size).toBe(6);
    expect(lines.filter((line) => line.unpaired === true)).toHaveLength(2);
    expect(readJsonl(ws.specimenFile("pending.jsonl"))).toEqual([]);
  }, MULTI_CALL_TIMEOUT * 2);
});
