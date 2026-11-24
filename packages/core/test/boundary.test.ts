import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static boundary check for packages/core. The test reads the file system, but the code it
// checks never does. Core must stay pure so the cabinet can bundle it.
//
// Each file is scanned in two forms. The `code` form blanks comments and the contents of
// string and template literals, so identifier rules see only code. The `withStrings` form
// blanks comments only, so import specifiers in real code are still visible. Comments are
// therefore never mistaken for imports, and a real `node:` import is never hidden.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");

/** The five modules named by Requirement 12 criterion 1. Their relative imports are followed. */
const ENTRY_MODULES = ["replay.ts", "normalize.ts", "diff.ts", "verdict.ts", "spec-check.ts"];

type Scanned = { code: string; withStrings: string };
type Frame = { kind: "code"; depth: number; expr: boolean } | { kind: "template" };
type Violation = { line: number; label: string };

const LINE_RULES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "require()", pattern: /\brequire\s*\(/g },
  { label: "process", pattern: /\bprocess\b/g },
  { label: "Date.now", pattern: /\bDate\s*\.\s*now\b/g },
  { label: "Date() without arguments", pattern: /\bDate\s*\(\s*\)/g },
  { label: "performance.now", pattern: /\bperformance\s*\.\s*now\b/g },
  { label: "hrtime", pattern: /\bhrtime\b/g },
  { label: "Math.random", pattern: /\bMath\s*\.\s*random\b/g },
  {
    label: "randomness API",
    pattern: /\b(?:randomUUID|getRandomValues|randomBytes|randomInt|randomFillSync)\b/g,
  },
  { label: "crypto", pattern: /\bcrypto\b/g },
  { label: "fetch", pattern: /\bfetch\b/g },
  { label: "WebSocket", pattern: /\bWebSocket\b/g },
  { label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/g },
  { label: "EventSource", pattern: /\bEventSource\b/g },
  { label: "network module", pattern: /\b(?:http|https|net|tls|dns)\s*\.|\bdgram\b/g },
];

const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*(["'])([^"'\n]+)\1/g,
  /\bimport\s*(["'])([^"'\n]+)\1/g,
  /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
];

const blankOf = (ch: string): string => (ch === "\n" ? "\n" : " ");

/** Splits one source text into the two scanned forms. Both keep every line break in place. */
export function scanSource(src: string): Scanned {
  let code = "";
  let keep = "";
  const put = (ch: string, mode: "code" | "string" | "comment"): void => {
    if (mode === "code") {
      code += ch;
      keep += ch;
    } else if (mode === "string") {
      code += blankOf(ch);
      keep += ch;
    } else {
      code += blankOf(ch);
      keep += blankOf(ch);
    }
  };

  const frames: Frame[] = [{ kind: "code", depth: 0, expr: false }];
  let prevSig = "";
  let i = 0;
  while (i < src.length) {
    const frame = frames[frames.length - 1] ?? { kind: "code", depth: 0, expr: false };
    const ch = src[i] ?? "";
    const next = src[i + 1] ?? "";

    if (frame.kind === "template") {
      if (ch === "\\") {
        put(ch, "string");
        if (i + 1 < src.length) put(next, "string");
        i += 2;
        continue;
      }
      if (ch === "`") {
        put(ch, "code");
        frames.pop();
        prevSig = "`";
        i++;
        continue;
      }
      if (ch === "$" && next === "{") {
        put("$", "code");
        put("{", "code");
        frames.push({ kind: "code", depth: 0, expr: true });
        prevSig = "{";
        i += 2;
        continue;
      }
      put(ch, "string");
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        put(src[i] ?? "", "comment");
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      put("/", "comment");
      put("*", "comment");
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        put(src[i] ?? "", "comment");
        i++;
      }
      if (i < src.length) {
        put("*", "comment");
        put("/", "comment");
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      put(ch, "code");
      i++;
      while (i < src.length && src[i] !== ch && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < src.length && src[i + 1] !== "\n") {
          put(src[i] ?? "", "string");
          put(src[i + 1] ?? "", "string");
          i += 2;
          continue;
        }
        put(src[i] ?? "", "string");
        i++;
      }
      if (i < src.length && src[i] === ch) {
        put(ch, "code");
        i++;
      }
      prevSig = ch;
      continue;
    }
    if (ch === "`") {
      put(ch, "code");
      frames.push({ kind: "template" });
      i++;
      continue;
    }
    if (ch === "/" && regexAllowed(code, prevSig)) {
      const end = regexEnd(src, i);
      if (end !== -1) {
        put("/", "code");
        for (let k = i + 1; k < end; k++) put(src[k] ?? "", "string");
        put("/", "code");
        prevSig = "a";
        i = end + 1;
        continue;
      }
    }
    if (ch === "{") frame.depth++;
    if (ch === "}") {
      if (frame.expr && frame.depth === 0) {
        frames.pop();
        put("}", "code");
        prevSig = "}";
        i++;
        continue;
      }
      frame.depth--;
    }
    put(ch, "code");
    if (!/\s/.test(ch)) prevSig = ch;
    i++;
  }
  return { code, withStrings: keep };
}

/** Whether a slash starts a regular expression literal rather than a division. */
function regexAllowed(before: string, prevSig: string): boolean {
  if (prevSig === "") return true;
  if ("(,=:[!&|?{};+-*%<>~^".includes(prevSig)) return true;
  return /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(
    before.slice(-12).trimEnd(),
  );
}

/** Index of the closing slash of a regex literal that starts at `start`, or -1 on a line break. */
function regexEnd(src: string, start: number): number {
  let inClass = false;
  for (let j = start + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\n") return -1;
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return j;
  }
  return -1;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function importsIn(withStrings: string): Array<{ spec: string; line: number }> {
  const found: Array<{ spec: string; line: number }> = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const m of withStrings.matchAll(pattern)) {
      found.push({ spec: m[2] ?? "", line: lineOf(withStrings, m.index ?? 0) });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

const BUILTINS = new Set<string>(builtinModules);

/** Every violation in one source text, by line. Rules that need a node: import check both forms. */
export function violationsIn(src: string): Violation[] {
  const { code, withStrings } = scanSource(src);
  const found: Violation[] = [];
  for (const { label, pattern } of LINE_RULES) {
    for (const m of code.matchAll(pattern)) {
      found.push({ line: lineOf(code, m.index ?? 0), label });
    }
  }
  for (const m of withStrings.matchAll(/(["'`])node:/g)) {
    found.push({ line: lineOf(withStrings, m.index ?? 0), label: "node: module specifier" });
  }
  for (const { spec, line } of importsIn(withStrings)) {
    if (!spec.startsWith(".") && BUILTINS.has(spec.split("/")[0] ?? "")) {
      found.push({ line, label: `Node built-in import "${spec}"` });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

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

function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec);
  const stem = base.endsWith(".js") ? base.slice(0, -3) : base;
  return [`${stem}.ts`, join(stem, "index.ts")].find(
    (candidate) => candidate.startsWith(srcRoot) && existsSync(candidate),
  );
}

/** The entry modules and every module reached from them through relative imports. */
function importClosure(entries: string[]): { files: string[]; broken: string[] } {
  const seen = new Set<string>();
  const broken: string[] = [];
  const queue = entries.map((name) => join(srcRoot, name));
  while (queue.length > 0) {
    const file = queue.shift() ?? "";
    if (seen.has(file)) continue;
    seen.add(file);
    const { withStrings } = scanSource(readFileSync(file, "utf8"));
    for (const { spec, line } of importsIn(withStrings)) {
      if (!spec.startsWith(".")) continue;
      const target = resolveRelative(file, spec);
      if (target === undefined) {
        broken.push(`${relative(srcRoot, file)}:${line} unresolved import "${spec}"`);
      } else {
        queue.push(target);
      }
    }
  }
  return { files: [...seen].sort(), broken };
}

function report(file: string, src: string): string[] {
  const lines = src.split("\n");
  return violationsIn(src).map(
    ({ line, label }) => `${relative(srcRoot, file)}:${line} ${label}: ${(lines[line - 1] ?? "").trim()}`,
  );
}

describe("packages/core boundary scanner", () => {
  const labels = (src: string): string[] => violationsIn(src).map((v) => v.label);

  it("flags node: imports, exports and dynamic imports in real code", () => {
    expect(labels('import { readFileSync } from "node:fs";\n')).toEqual(["node: module specifier"]);
    expect(labels('export { join } from "node:path";\n')).toEqual(["node: module specifier"]);
    expect(labels('const m = await import("node:fs");\n')).toEqual(["node: module specifier"]);
  });

  it("flags bare Node built-in specifiers and require calls", () => {
    expect(labels('import { join } from "path";\n')).toEqual(['Node built-in import "path"']);
    expect(labels('const fs = require("fs");\n')).toContain("require()");
  });

  it("ignores node: text inside comments and banned names inside string literals", () => {
    expect(labels('// import { readFileSync } from "node:fs";\n')).toEqual([]);
    expect(labels('/* import x from "node:fs"; */\nconst a = 1;\n')).toEqual([]);
    expect(labels('const s = "Date.now() and fetch(x)";\n')).toEqual([]);
  });

  it("flags a node: specifier even when it is written as a string outside an import", () => {
    expect(labels('const s = "node:fs";\n')).toEqual(["node: module specifier"]);
  });

  it("flags clock, randomness and network reads in code", () => {
    expect(labels("const t = Date.now();\n")).toEqual(["Date.now"]);
    expect(labels("const d = new Date();\n")).toEqual(["Date() without arguments"]);
    expect(labels("const d = performance.now();\n")).toEqual(["performance.now"]);
    expect(labels("const x = Math.random();\n")).toEqual(["Math.random"]);
    expect(labels("fetch(url);\n")).toEqual(["fetch"]);
    expect(labels('new WebSocket("wss://example.invalid");\n')).toEqual(["WebSocket"]);
  });

  it("allows a Date with arguments and text that only mentions a banned name", () => {
    expect(labels("const d = new Date(0);\n")).toEqual([]);
    expect(labels('const s = "fetch(x) and Date.now()";\n')).toEqual([]);
    expect(labels('import { z } from "zod";\n')).toEqual([]);
  });

  it("sees banned calls inside template expressions", () => {
    expect(labels("const t = `${Date.now()}`;\n")).toEqual(["Date.now"]);
  });

  it("does not let a regex literal hide a later banned call", () => {
    const src = 'const r = /["\']/;\nconst y = a / b;\nfetch(url);\n';
    expect(labels(src)).toEqual(["fetch"]);
  });
});

describe("packages/core/src boundary", () => {
  const files = sourceFiles(srcRoot);
  const closure = importClosure(ENTRY_MODULES);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("reaches each named module from the entry list", () => {
    for (const name of ENTRY_MODULES) {
      expect(closure.files).toContain(join(srcRoot, name));
    }
  });

  it("resolves every relative import reached from the named modules", () => {
    expect(closure.broken).toEqual([]);
  });

  it("has no node: import, clock, randomness or network use in the named modules and their imports", () => {
    const hits = closure.files.flatMap((file) => report(file, readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });

  it("has no node: import, clock, randomness or network use in any packages/core/src module", () => {
    const hits = files.flatMap((file) => report(file, readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });
});
