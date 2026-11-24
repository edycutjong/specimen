import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realResolve, readText } from "../src/io/fsx.js";
import { describeError, logDiag } from "../src/io/log.js";
import { findWorkspaceRoot } from "../src/io/root.js";

let base: string;

beforeEach(() => {
  // realpath so that the expected values match the links the OS resolves (macOS /var -> /private/var).
  base = realpathSync(mkdtempSync(join(tmpdir(), "specimen-io-")));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("findWorkspaceRoot", () => {
  it("returns the nearest ancestor that contains a .kiro directory", () => {
    mkdirSync(join(base, ".kiro"));
    mkdirSync(join(base, "a", "b"), { recursive: true });
    expect(findWorkspaceRoot(join(base, "a", "b"))).toBe(base);
  });

  it("returns the directory itself when it holds .kiro", () => {
    mkdirSync(join(base, ".kiro"));
    expect(findWorkspaceRoot(base)).toBe(base);
  });

  it("ignores a .kiro that is a file, and falls back to the start directory", () => {
    writeFileSync(join(base, ".kiro"), "");
    expect(findWorkspaceRoot(base)).toBe(base);
  });
});

describe("realResolve", () => {
  it("resolves a symbolic link in an existing ancestor", () => {
    const target = join(base, "real");
    mkdirSync(target);
    symlinkSync(target, join(base, "alias"));
    expect(realResolve(join(base, "alias", "x.jsonl"))).toBe(join(target, "x.jsonl"));
  });

  it("appends the missing segments unchanged when nothing below the root exists", () => {
    expect(realResolve(join(base, "does", "not", "exist"))).toBe(join(base, "does", "not", "exist"));
  });

  it("returns the path itself when it exists", () => {
    mkdirSync(join(base, "jars"));
    expect(realResolve(join(base, "jars"))).toBe(join(base, "jars"));
  });
});

describe("readText", () => {
  it("returns undefined for a missing file", () => {
    expect(readText(join(base, "missing.txt"))).toBeUndefined();
  });

  it("returns the file text when it exists", () => {
    writeFileSync(join(base, "f.txt"), "hello");
    expect(readText(join(base, "f.txt"))).toBe("hello");
  });
});

describe("logDiag and describeError", () => {
  it("appends one tab-separated line with an ISO time, hook, session and message", () => {
    logDiag(base, "firewall", "s-1", "no candidate path");
    const text = readText(join(base, ".specimen", "hook.log")) ?? "";
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const [time, hook, session, message] = (lines[0] ?? "").split("\t");
    expect(new Date(time ?? "").toISOString()).toBe(time);
    expect([hook, session, message]).toEqual(["firewall", "s-1", "no candidate path"]);
  });

  it("writes '-' for an unknown or invalid session id", () => {
    logDiag(base, "firewall", "../escape", "x");
    logDiag(base, "firewall", undefined, "y");
    const lines = (readText(join(base, ".specimen", "hook.log")) ?? "").trim().split("\n");
    expect(lines.map((l) => l.split("\t")[2])).toEqual(["-", "-"]);
  });

  it("describes an error by name and errno code only", () => {
    const err = Object.assign(new Error("secret text /etc/x"), { code: "ENOENT" });
    expect(describeError(err)).toBe("Error ENOENT");
    expect(describeError("not an error")).toBe("Error");
  });
});
