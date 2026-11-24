import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static boundary check for packages/core/src. The test reads the file system, but the
// code under test never does. Core must stay pure so the cabinet can bundle it.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");

const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "node: module specifier", pattern: /node:/ },
  { label: "require(", pattern: /\brequire\s*\(/ },
  { label: "Date.now", pattern: /\bDate\.now\b/ },
  { label: "new Date", pattern: /\bnew\s+Date\b/ },
  { label: "performance.now", pattern: /\bperformance\.now\b/ },
  { label: "Math.random", pattern: /\bMath\.random\b/ },
  { label: "fetch", pattern: /\bfetch\b/ },
  { label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { label: "process", pattern: /\bprocess\b/ },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out.sort();
}

describe("packages/core/src boundary", () => {
  const files = sourceFiles(srcRoot);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("has no node: imports, clock, randomness, network or process references", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const { label, pattern } of FORBIDDEN) {
          if (pattern.test(line)) {
            hits.push(`${relative(srcRoot, file)}:${i + 1} uses ${label}`);
          }
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
