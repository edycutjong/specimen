import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// These tests run the real bin as a child process, the way a Kiro hook does. Every workspace is
// a mkdtemp directory with its own .kiro folder. The repository jars/ directory is never used.
const BIN = fileURLToPath(new URL("../bin/specimen.mjs", import.meta.url));
const CHILD_TIMEOUT = 60_000;

let root: string;
let jars: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-manifest-bin-")));
  mkdirSync(join(root, ".kiro"));
  jars = join(root, "jars");
  mkdirSync(join(jars, "nested"), { recursive: true });
  writeFileSync(join(jars, "s-1.jsonl"), '{"a":1}\n');
  writeFileSync(join(jars, "nested", "s-2.jsonl"), '{"b":2}\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function specimen(args: string[]) {
  return spawnSync(process.execPath, [BIN, "manifest", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT,
  });
}

/**
 * Picks the system checker at runtime: GNU `sha256sum` when present, otherwise `shasum -a 256`
 * (the macOS default). Returns a function that runs `-c` inside jars/, where the Manifest
 * paths are relative.
 */
function detectChecker(): () => ReturnType<typeof spawnSync> {
  const gnu = spawnSync("sha256sum", ["--version"], { encoding: "utf8" });
  const [cmd, args] =
    gnu.status === 0 && !gnu.error ? ["sha256sum", ["-c", "MANIFEST.sha256"]] : ["shasum", ["-a", "256", "-c", "MANIFEST.sha256"]];
  return () => spawnSync(cmd, args, { cwd: jars, encoding: "utf8", timeout: CHILD_TIMEOUT });
}

describe("specimen manifest write then system checksum", () => {
  it("writes a Manifest that sha256sum or shasum -a 256 verifies", () => {
    const write = specimen(["write"]);
    expect(write.status).toBe(0);
    expect(write.stdout).toBe("wrote 2 entries to jars/MANIFEST.sha256\n");
    expect(write.stderr).toBe("");

    const check = detectChecker()();
    expect(check.status).toBe(0);
    expect(check.stdout).toBe("nested/s-2.jsonl: OK\ns-1.jsonl: OK\n");
  });

  it("makes the system checksum fail after one byte changes, and manifest check exit 2", () => {
    expect(specimen(["write"]).status).toBe(0);

    const path = join(jars, "s-1.jsonl");
    const bytes = readFileSync(path);
    bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
    writeFileSync(path, bytes);

    const check = detectChecker()();
    expect(check.status).not.toBe(0);
    expect(check.stdout).toContain("s-1.jsonl: FAILED");

    const result = specimen(["check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("CHANGED s-1.jsonl\n");
    expect(result.stdout).toBe("");
  });
});

describe("specimen manifest check exit codes", () => {
  beforeEach(() => {
    expect(specimen(["write"]).status).toBe(0);
  });

  it("exits 0 with no output when nothing differs", () => {
    const result = specimen(["check"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("exits 2 and lists MISSING, CHANGED and UNLISTED paths on STDERR", () => {
    rmSync(join(jars, "s-1.jsonl"));
    writeFileSync(join(jars, "nested", "s-2.jsonl"), "other\n");
    writeFileSync(join(jars, "s-9.jsonl"), "new\n");

    const result = specimen(["check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      "MISSING s-1.jsonl\nCHANGED nested/s-2.jsonl\nUNLISTED s-9.jsonl\n",
    );
  });

  it("exits 1 with a diagnostic when the Manifest is malformed", () => {
    writeFileSync(join(jars, "MANIFEST.sha256"), "not a manifest\n");
    const result = specimen(["check"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("manifest check failed: Manifest is malformed at line 1\n");
    expect(result.stdout).toBe("");
  });

  it("exits 1 with a diagnostic when jars itself is a symbolic link", () => {
    rmSync(jars, { recursive: true, force: true });
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, jars);

    const result = specimen(["check"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("manifest check failed: jars is a symbolic link\n");
  });
});

describe("specimen manifest check with a missing Manifest", () => {
  it("exits 2 and lists every file as UNLISTED when jars holds files", () => {
    const result = specimen(["check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("UNLISTED nested/s-2.jsonl\nUNLISTED s-1.jsonl\n");
  });

  it("exits 0 when jars holds no file and no Manifest exists", () => {
    rmSync(join(jars, "nested"), { recursive: true, force: true });
    rmSync(join(jars, "s-1.jsonl"));
    const result = specimen(["check"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("exits 0 when jars does not exist", () => {
    rmSync(jars, { recursive: true, force: true });
    const result = specimen(["check"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});

describe("symbolic links under jars", () => {
  it("are listed as UNLISTED by manifest check and left out of the written Manifest", () => {
    expect(specimen(["write"]).status).toBe(0);
    symlinkSync(join(jars, "s-1.jsonl"), join(jars, "link.jsonl"));

    const result = specimen(["check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("UNLISTED link.jsonl\n");

    expect(specimen(["write"]).stdout).toBe("wrote 2 entries to jars/MANIFEST.sha256\n");
    expect(specimen(["check"]).status).toBe(2);
  });
});
