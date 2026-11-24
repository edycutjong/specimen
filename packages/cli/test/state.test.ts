import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_REDACT_CONFIG, redactConfigSchema } from "@specimen/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readCounterText,
  readPendingText,
  writeCounter,
  writePendingText,
} from "../src/io/fsx.js";
import { jarsDirectory, listJarFiles, readJarTexts, readSessionJar } from "../src/io/jars.js";
import { loadRedactConfig } from "../src/io/redactConfig.js";

let base: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "specimen-state-")));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("counter and pending helpers", () => {
  it("returns undefined for a missing counter and writes it atomically", () => {
    expect(readCounterText(base)).toBeUndefined();
    writeCounter(base, 7);
    expect(readCounterText(base)).toBe("7\n");
    expect(existsSync(join(base, ".specimen", "counter.tmp"))).toBe(false);
  });

  it("reads an empty string for a missing pending file and replaces its content", () => {
    expect(readPendingText(base)).toBe("");
    writePendingText(base, '{"a":1}\n');
    writePendingText(base, '{"b":2}\n');
    expect(readPendingText(base)).toBe('{"b":2}\n');
    expect(existsSync(join(base, ".specimen", "pending.jsonl.tmp"))).toBe(false);
  });
});

describe("read-only jar access", () => {
  it("lists nothing and does not create jars/ when the directory is missing", () => {
    expect(listJarFiles(base)).toEqual([]);
    expect(readJarTexts(base)).toEqual([]);
    expect(existsSync(jarsDirectory(base))).toBe(false);
  });

  it("lists regular files sorted and reads them without changing them", () => {
    mkdirSync(jarsDirectory(base));
    writeFileSync(join(jarsDirectory(base), "b.jsonl"), "B\n");
    writeFileSync(join(jarsDirectory(base), "a.jsonl"), "A\n");

    expect(listJarFiles(base)).toEqual(["a.jsonl", "b.jsonl"]);
    expect(readJarTexts(base)).toEqual(["A\n", "B\n"]);
    expect(readdirSync(jarsDirectory(base)).sort()).toEqual(["a.jsonl", "b.jsonl"]);
  });

  it("returns undefined for a session jar that does not exist, and refuses an unsafe session id", () => {
    expect(readSessionJar(base, "s-1")).toBeUndefined();
    expect(() => readSessionJar(base, "../escape")).toThrow(RangeError);
  });
});

describe("loadRedactConfig", () => {
  it("gives the default config when the file is missing", () => {
    const loaded = loadRedactConfig(base);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config).toEqual(DEFAULT_REDACT_CONFIG);
  });

  it("accepts a valid file", () => {
    mkdirSync(join(base, ".specimen"));
    const config = { keys: ["pin"], patterns: ["x+"], text: "hash" };
    writeFileSync(join(base, ".specimen", "redact.json"), JSON.stringify(config));
    const loaded = loadRedactConfig(base);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config).toEqual(redactConfigSchema.parse(config));
  });

  it("fails with invalid_json for text that is not JSON", () => {
    mkdirSync(join(base, ".specimen"));
    writeFileSync(join(base, ".specimen", "redact.json"), "{not json");
    expect(loadRedactConfig(base)).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("fails with invalid_config for an unknown key", () => {
    mkdirSync(join(base, ".specimen"));
    const bad = { keys: [], patterns: [], text: "redact", extra: true };
    writeFileSync(join(base, ".specimen", "redact.json"), JSON.stringify(bad));
    expect(loadRedactConfig(base)).toEqual({ ok: false, reason: "invalid_config" });
  });

  it("fails with bad_pattern and the index of a pattern that does not compile", () => {
    mkdirSync(join(base, ".specimen"));
    const bad = { keys: [], patterns: ["ok", "("], text: "redact" };
    writeFileSync(join(base, ".specimen", "redact.json"), JSON.stringify(bad));
    expect(loadRedactConfig(base)).toEqual({ ok: false, reason: "bad_pattern", patternIndex: 1 });
  });

  it("fails with bad_pattern when a pattern matches the empty string", () => {
    mkdirSync(join(base, ".specimen"));
    const bad = { keys: [], patterns: ["a*"], text: "redact" };
    writeFileSync(join(base, ".specimen", "redact.json"), JSON.stringify(bad));
    expect(loadRedactConfig(base)).toEqual({ ok: false, reason: "bad_pattern", patternIndex: 0 });
  });
});
