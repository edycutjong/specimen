/**
 * Every BEM class used by the components has a rule in the cabinet's stylesheets.
 *
 * Before this test, about 45 class names in the components had no CSS rule, so the header, the
 * server switch, the replay button, the verdict plate and the counts pair rendered as browser
 * defaults. This test reads each `.tsx` file under src/, collects the class names written there,
 * and fails for any name that no `.css` file under src/ styles.
 *
 * How the names are found: the reader walks each file's string literals, skipping comments, and
 * keeps every whitespace-separated token that looks like a block, element or modifier name
 * (`block`, `block__element`, `block--modifier`, or a hyphenated block). A template literal such as
 * `cabinet-frame__rivet--${corner}` contributes its static prefix, `cabinet-frame__rivet--`, which
 * must match the start of at least one styled class. Strings that are not classes (data values,
 * ids) are listed in NOT_CLASS_NAMES with the reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Strings in the components that look like class names but are not classes. Each entry is a data
 * value, an element id or an attribute value, so no CSS class is expected for it.
 */
const NOT_CLASS_NAMES: ReadonlySet<string> = new Set([
  // data-hook attribute values in HowJarsWereMade, read by the hook tests.
  "specimen-jar-pre",
  "specimen-jar-post",
  // data-form values of JarDrawer. The CSS styles them with attribute selectors, not class selectors.
  "panel-wide",
  "panel-narrow",
  // data-badge value of the SpecViewer PASS badge.
  "check-spec-pass",
  // element ids: the "How the jars were made" heading and the spoiled-lines heading.
  "how-made-heading",
  "spoiled-tray-title",
  // a module specifier, imported in JarDrawer.
  "react-dom",
  // a value of the lab report's element kind, compared in code, not a class.
  "path-literal",
]);

/**
 * A class list is lowercase letters, digits, hyphens, underscores and spaces only. Prose with
 * punctuation (a colon, a period, a middle dot) or a mixed-case word is not a class list.
 */
const CLASS_LIST_CHARS = /^[a-z0-9_\- ]*$/;

/** A BEM-style token: a lowercase block, optionally with an element and a modifier, and at least one hyphen or `__`. */
const BEM_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, ext);
    return entry.name.endsWith(ext) ? [path] : [];
  });
}

/**
 * The contents of every string literal in a TypeScript or TSX source. Comments are skipped. A quote
 * string stops at its line end. A template literal keeps its static text, and each `${...}` becomes
 * a space, so the static prefix of a dynamic class name survives.
 */
export function stringLiterals(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      let text = "";
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === ch) break;
        if (ch !== "`" && c === "\n") break;
        if (ch === "`" && c === "$" && source.charAt(j + 1) === "{") {
          let depth = 0;
          while (j < source.length) {
            const d = source.charAt(j);
            if (d === "{") depth += 1;
            if (d === "}") {
              depth -= 1;
              if (depth === 0) break;
            }
            j += 1;
          }
          text += " ";
          j += 1;
          continue;
        }
        text += c;
        j += 1;
      }
      out.push(text);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Every class name a stylesheet selects with `.name`. */
export function styledClasses(css: string): Set<string> {
  const names = new Set<string>();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of stripped.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    names.add(match[1] ?? "");
  }
  return names;
}

/** The class-like tokens a component source writes, each with the file it came from. */
export function classTokens(source: string): { token: string; prefix: boolean }[] {
  const tokens: { token: string; prefix: boolean }[] = [];
  for (const literal of stringLiterals(source)) {
    if (!CLASS_LIST_CHARS.test(literal)) continue;
    const parts = literal.split(/\s+/).filter((part) => part !== "");
    for (const part of parts) {
      if (part.endsWith("__") || part.endsWith("--")) {
        tokens.push({ token: part, prefix: true });
      } else if (BEM_TOKEN.test(part) && (part.includes("-") || part.includes("__"))) {
        tokens.push({ token: part, prefix: false });
      }
    }
  }
  return tokens;
}

describe("every BEM class used by a component has a stylesheet rule", () => {
  const components = walk(SRC, ".tsx").map((file) => ({ file, source: readFileSync(file, "utf8") }));
  const css = walk(SRC, ".css")
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const styled = styledClasses(css);

  it("finds the components and the stylesheets it checks", () => {
    expect(components.length).toBeGreaterThan(10);
    expect(styled.size).toBeGreaterThan(100);
  });

  it("uses a class name that has a rule for every BEM class in src/**/*.tsx", () => {
    const missing = new Set<string>();
    for (const { file, source } of components) {
      for (const { token, prefix } of classTokens(source)) {
        if (NOT_CLASS_NAMES.has(token)) continue;
        const styledHere = prefix
          ? [...styled].some((name) => name.startsWith(token))
          : styled.has(token);
        if (!styledHere) {
          missing.add(`${token}  (${file.slice(SRC.length + 1)})`);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("reads a dynamic class name from its static prefix", () => {
    const tokens = classTokens("const a = `cabinet-frame__rivet--${corner}`; const b = \"jar__flag--abnormal\";");
    expect(tokens).toEqual([
      { token: "cabinet-frame__rivet--", prefix: true },
      { token: "jar__flag--abnormal", prefix: false },
    ]);
  });

  it("skips comments and reads only the literals of code", () => {
    expect(stringLiterals("// \"not-a-class\"\n/* 'also-not' */ const x = \"real-class\";")).toEqual(["real-class"]);
  });
});
