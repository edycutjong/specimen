import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkManifest, runCheck, writeManifest } from "../src/manifest.js";

// Every test works in a temporary workspace with its own .kiro folder. The real jars/ is never used.
let root: string;
let jars: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-manifest-")));
  mkdirSync(join(root, ".kiro"));
  jars = join(root, "jars");
  mkdirSync(join(jars, "nested"), { recursive: true });
  writeFileSync(join(jars, "s-1.jsonl"), '{"a":1}\n');
  writeFileSync(join(jars, "nested", "s-2.jsonl"), '{"b":2}\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function manifestText(): string {
  return readFileSync(join(jars, "MANIFEST.sha256"), "utf8");
}

function collector(): { text: () => string; out: (t: string) => void } {
  let buf = "";
  return { text: () => buf, out: (t) => (buf += t) };
}

describe("manifest write", () => {
  it("writes sha256sum lines for regular files, sorted, with / separators", () => {
    expect(writeManifest(root)).toBe(2);
    expect(manifestText()).toBe(
      `${sha(join(jars, "nested", "s-2.jsonl"))}  nested/s-2.jsonl\n` +
        `${sha(join(jars, "s-1.jsonl"))}  s-1.jsonl\n`,
    );
  });

  it("replaces an existing Manifest and leaves no temporary file in jars/", () => {
    writeManifest(root);
    writeFileSync(join(jars, "s-3.jsonl"), "x\n");
    writeManifest(root);
    expect(readdirSync(jars).sort()).toEqual(["MANIFEST.sha256", "nested", "s-1.jsonl", "s-3.jsonl"]);
    expect(manifestText()).toContain("s-3.jsonl");
  });

  it("creates jars/ with an empty Manifest when jars/ is absent", () => {
    rmSync(jars, { recursive: true, force: true });
    expect(writeManifest(root)).toBe(0);
    expect(manifestText()).toBe("");
  });

  it("skips a symbolic link and does not follow it", () => {
    symlinkSync(join(jars, "s-1.jsonl"), join(jars, "link.jsonl"));
    writeManifest(root);
    expect(manifestText()).not.toContain("link.jsonl");
  });

  it("throws and leaves the Manifest unchanged when a file name cannot be recorded", () => {
    writeManifest(root);
    const before = manifestText();
    writeFileSync(join(jars, "bad\\name.jsonl"), "x\n");
    expect(() => writeManifest(root)).toThrow("a file name under jars/ cannot be recorded in the Manifest");
    expect(manifestText()).toBe(before);
  });
});

describe("manifest check", () => {
  beforeEach(() => {
    writeManifest(root);
  });

  it("exits 0 with no output when nothing differs", () => {
    const err = collector();
    expect(checkManifest(root)).toEqual({ status: 0, lines: [] });
    expect(runCheck(root, err.out)).toBe(0);
    expect(err.text()).toBe("");
  });

  it("exits 2 and lists a CHANGED path after one byte changes", () => {
    const path = join(jars, "s-1.jsonl");
    const bytes = readFileSync(path);
    bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
    writeFileSync(path, bytes);
    const err = collector();
    expect(runCheck(root, err.out)).toBe(2);
    expect(err.text()).toBe("CHANGED s-1.jsonl\n");
  });

  it("lists a MISSING path", () => {
    rmSync(join(jars, "s-1.jsonl"));
    expect(checkManifest(root)).toEqual({ status: 2, lines: ["MISSING s-1.jsonl"] });
  });

  it("lists an UNLISTED path for a new file", () => {
    writeFileSync(join(jars, "s-9.jsonl"), "new\n");
    expect(checkManifest(root)).toEqual({ status: 2, lines: ["UNLISTED s-9.jsonl"] });
  });

  it("counts a symbolic link under jars/ as UNLISTED", () => {
    symlinkSync(join(jars, "s-1.jsonl"), join(jars, "link.jsonl"));
    expect(checkManifest(root)).toEqual({ status: 2, lines: ["UNLISTED link.jsonl"] });
  });

  it("never modifies jars/", () => {
    writeFileSync(join(jars, "s-9.jsonl"), "new\n");
    const before = readdirSync(jars, { recursive: true }).map(String).sort();
    const bytes = readFileSync(join(jars, "MANIFEST.sha256"), "utf8");
    runCheck(root, () => {});
    expect(readdirSync(jars, { recursive: true }).map(String).sort()).toEqual(before);
    expect(readFileSync(join(jars, "MANIFEST.sha256"), "utf8")).toBe(bytes);
  });

  it("exits 1 with a diagnostic on a malformed Manifest", () => {
    writeFileSync(join(jars, "MANIFEST.sha256"), "not a manifest\n");
    const err = collector();
    expect(runCheck(root, err.out)).toBe(1);
    expect(err.text()).toBe("manifest check failed: Manifest is malformed at line 1\n");
  });
});

describe("manifest check with a missing Manifest", () => {
  it("exits 2 when jars/ holds files and no Manifest exists", () => {
    rmSync(join(jars, "MANIFEST.sha256"), { force: true });
    expect(checkManifest(root).status).toBe(2);
    expect(checkManifest(root).lines).toEqual([
      "UNLISTED nested/s-2.jsonl",
      "UNLISTED s-1.jsonl",
    ]);
  });

  it("exits 0 when jars/ holds no file and no Manifest exists", () => {
    rmSync(jars, { recursive: true, force: true });
    mkdirSync(jars);
    expect(checkManifest(root)).toEqual({ status: 0, lines: [] });
  });

  it("exits 0 when jars/ does not exist at all", () => {
    rmSync(jars, { recursive: true, force: true });
    expect(checkManifest(root)).toEqual({ status: 0, lines: [] });
  });
});
