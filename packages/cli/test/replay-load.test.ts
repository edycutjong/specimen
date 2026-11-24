import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHIPPED_VOLATILE_POLICY, compileRedact, DEFAULT_REDACT_CONFIG } from "@specimen/core";
import { findWorkspaceRoot } from "../src/io/root.js";
import { makeStdioClientFactory, CommandSyntaxError, splitCommand } from "../src/replay/client-factory.js";
import { formatLoadFailure, loadReplayInputs } from "../src/replay/load.js";

/**
 * Loader and command-splitting tests. Every test works in a temporary workspace, so nothing under
 * the repository `jars/` directory is read or written. The one stdio smoke test starts hollow-inn
 * v1 as a real child process, and it is the only test here that starts a server.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("splitCommand", () => {
  it("splits on runs of whitespace and ignores leading and trailing whitespace", () => {
    expect(splitCommand("  npx   tsx\tservers/hollow-inn/src/main.ts  v1 ")).toEqual([
      "npx",
      "tsx",
      "servers/hollow-inn/src/main.ts",
      "v1",
    ]);
  });

  it("returns no words for an empty or blank command", () => {
    expect(splitCommand("")).toEqual([]);
    expect(splitCommand("   ")).toEqual([]);
  });

  it("keeps whitespace inside double and single quotes and removes the quotes", () => {
    expect(splitCommand(`node "my server.js" 'a b' c`)).toEqual(["node", "my server.js", "a b", "c"]);
  });

  it("joins adjacent quoted and unquoted text into one argument", () => {
    expect(splitCommand(`pre"fix ed"post x`)).toEqual(["prefix edpost", "x"]);
  });

  it("keeps an empty quoted argument", () => {
    expect(splitCommand(`run "" last`)).toEqual(["run", "", "last"]);
  });

  it("does not treat a quote of the other kind as a terminator", () => {
    expect(splitCommand(`echo "it's" ok`)).toEqual(["echo", "it's", "ok"]);
  });

  it("throws CommandSyntaxError naming the quote kind for an unterminated quote", () => {
    expect(() => splitCommand(`node "server.js`)).toThrow(CommandSyntaxError);
    expect(() => splitCommand(`node "server.js`)).toThrow(/unterminated double quote/);
    expect(() => splitCommand(`node 'server.js`)).toThrow(/unterminated single quote/);
  });

  it("refuses an empty command when a factory is built", () => {
    expect(() => makeStdioClientFactory("  ", 1000, REPO_ROOT)).toThrow(CommandSyntaxError);
  });
});

describe("loadReplayInputs", () => {
  let base: string;
  let counter = 0;

  /** A new temporary workspace with a `.kiro` folder, so that it is a Workspace_Root. */
  function workspace(): string {
    counter += 1;
    const dir = join(base, `ws-${counter}`);
    mkdirSync(join(dir, ".kiro"), { recursive: true });
    mkdirSync(join(dir, ".specimen"), { recursive: true });
    return dir;
  }

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "specimen-replay-load-"));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("gives the defaults when every optional file is missing", () => {
    const root = workspace();
    const result = loadReplayInputs({ root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { inputs } = result;
    expect(inputs.jarFiles).toEqual([]);
    expect(inputs.pendingText).toBe("");
    expect(inputs.replayPolicy).toEqual({ allow: [], watch: [] });
    expect(inputs.volatilePolicy).toEqual(SHIPPED_VOLATILE_POLICY);
    expect(inputs.redactConfig).toEqual(DEFAULT_REDACT_CONFIG);
    expect(compileRedact(DEFAULT_REDACT_CONFIG).ok).toBe(true);
  });

  it("reads jar files in code-unit order and skips the manifest and non-jsonl files", () => {
    const root = workspace();
    const jars = join(root, "jars");
    mkdirSync(join(jars, "folder.jsonl"), { recursive: true });
    writeFileSync(join(jars, "sess_b.jsonl"), "B\n");
    writeFileSync(join(jars, "sess_a.jsonl"), "A\n");
    writeFileSync(join(jars, "Z.jsonl"), "Z\n");
    writeFileSync(join(jars, "MANIFEST.sha256"), "abc  sess_a.jsonl\n");
    writeFileSync(join(jars, "racks.json"), "{}\n");

    const result = loadReplayInputs({ root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputs.jarFiles).toEqual([
      { file: "Z.jsonl", text: "Z\n" },
      { file: "sess_a.jsonl", text: "A\n" },
      { file: "sess_b.jsonl", text: "B\n" },
    ]);
  });

  it("reads a given jars directory instead of the default one", () => {
    const root = workspace();
    const other = join(root, "elsewhere");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "one.jsonl"), "1\n");
    const result = loadReplayInputs({ root, jarsDir: other });
    expect(result.ok && result.inputs.jarFiles.map((f) => f.file)).toEqual(["one.jsonl"]);
  });

  it("treats a missing jars directory as empty", () => {
    const root = workspace();
    const result = loadReplayInputs({ root, jarsDir: join(root, "no-such-dir") });
    expect(result.ok && result.inputs.jarFiles).toEqual([]);
  });

  it("reads the pending file when it exists", () => {
    const root = workspace();
    writeFileSync(join(root, ".specimen", "pending.jsonl"), "{\"x\":1}\n");
    const result = loadReplayInputs({ root });
    expect(result.ok && result.inputs.pendingText).toBe("{\"x\":1}\n");
  });

  it("reads a valid replay policy", () => {
    const root = workspace();
    writeFileSync(
      join(root, ".specimen", "replay.json"),
      JSON.stringify({ allow: ["quote"], watch: ["get_room"] }),
    );
    const result = loadReplayInputs({ root });
    expect(result.ok && result.inputs.replayPolicy).toEqual({ allow: ["quote"], watch: ["get_room"] });
  });

  it("fails with the field name for a replay policy whose field has the wrong type", () => {
    const root = workspace();
    writeFileSync(join(root, ".specimen", "replay.json"), JSON.stringify({ allow: "quote", watch: [] }));
    const result = loadReplayInputs({ root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.file).toBe(".specimen/replay.json");
    expect(result.problem).toBe("invalid field allow");
    expect(formatLoadFailure(result)).toBe(
      "specimen replay: .specimen/replay.json: invalid field allow",
    );
  });

  it("fails and names an unknown key in the replay policy", () => {
    const root = workspace();
    writeFileSync(
      join(root, ".specimen", "replay.json"),
      JSON.stringify({ allow: [], watch: [], extra: true }),
    );
    const result = loadReplayInputs({ root });
    expect(result.ok === false && result.problem).toBe("unknown field extra");
  });

  it("fails with a JSON diagnostic for a replay policy that is not JSON", () => {
    const root = workspace();
    writeFileSync(join(root, ".specimen", "replay.json"), "{ allow: ");
    const result = loadReplayInputs({ root });
    expect(result.ok === false && result.problem).toBe("invalid JSON");
  });

  it("fails and names the index of a volatile pointer that is not a pointer glob", () => {
    const root = workspace();
    writeFileSync(
      join(root, ".specimen", "volatile.json"),
      JSON.stringify({ volatile: ["/created_at", "created_at"] }),
    );
    const result = loadReplayInputs({ root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.file).toBe(".specimen/volatile.json");
    expect(result.problem).toBe("invalid field volatile.1");
  });

  it("uses the file given for the volatile policy when it is valid", () => {
    const root = workspace();
    writeFileSync(join(root, ".specimen", "volatile.json"), JSON.stringify({ volatile: ["/ts"] }));
    const result = loadReplayInputs({ root });
    expect(result.ok && result.inputs.volatilePolicy).toEqual({ volatile: ["/ts"] });
  });

  it("names an unknown key of the redact config", () => {
    const root = workspace();
    writeFileSync(
      join(root, ".specimen", "redact.json"),
      JSON.stringify({ keys: [], patterns: [], text: "redact", extra: true }),
    );
    const result = loadReplayInputs({ root });
    expect(result.ok === false && result.problem).toBe("unknown field extra");
  });

  it("fails with the field name for a redact config whose patterns are not a list", () => {
    const root = workspace();
    writeFileSync(
      join(root, ".specimen", "redact.json"),
      JSON.stringify({ keys: [], patterns: "x", text: "redact" }),
    );
    const result = loadReplayInputs({ root });
    expect(result.ok === false && result.problem).toBe("invalid field patterns");
  });

  it("fails and names the index of a redact pattern that is not a valid regular expression", () => {
    const root = workspace();
    writeFileSync(
      join(root, ".specimen", "redact.json"),
      JSON.stringify({ keys: [], patterns: ["ok+", "(unclosed"], text: "redact" }),
    );
    const result = loadReplayInputs({ root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.file).toBe(".specimen/redact.json");
    expect(result.problem).toMatch(/^pattern 1 is not a valid regular expression/);
  });

  it("fails and names the index of a redact pattern that matches the empty string", () => {
    const root = workspace();
    writeFileSync(
      join(root, ".specimen", "redact.json"),
      JSON.stringify({ keys: [], patterns: ["abc", "x*"], text: "redact" }),
    );
    const result = loadReplayInputs({ root });
    expect(result.ok === false && result.problem).toMatch(/^pattern 1 /);
  });

  it("finds the Workspace_Root as the nearest ancestor that holds a .kiro directory", () => {
    const root = workspace();
    const nested = join(root, "packages", "inner");
    mkdirSync(nested, { recursive: true });
    expect(findWorkspaceRoot(nested)).toBe(root);
  });
});

describe("makeStdioClientFactory", () => {
  it("starts a real server, lists its tools, and closes it", async () => {
    const factory = makeStdioClientFactory(
      "npx tsx servers/hollow-inn/src/main.ts v1",
      30_000,
      REPO_ROOT,
    );
    const session = await factory();
    try {
      const listing = await session.client.listTools(undefined, { timeout: 30_000 });
      expect(listing.tools.length).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  }, 120_000);
});
