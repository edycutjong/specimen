/**
 * Task 10.2. Requirements 7.7, 7.10, 10.5. Design: "Breakpoints" in design.md.
 *
 * This test does not measure real layout. jsdom does not compute layout, so it cannot show whether a page scrolls
 * sideways at 375 px or 320 px. It parses the production CSS and checks the rules that cause horizontal overflow:
 * - the jar grid uses minmax(140px, 1fr);
 * - no `width` above 320 px sits outside a min-width media query of 600 px or more;
 * - the narrow header (below 600 px) stacks in a column;
 * - html and body have no overflow-x or overflow rule that hides content.
 * A browser check at 375 px is still needed before submission.
 *
 * The production build runs into a temporary directory, not apps/cabinet/dist. build-scan.test.ts deletes and rebuilds
 * dist in a parallel worker, so reading dist here could read a half-written build. The temporary build uses the same
 * `npm run build -w apps/cabinet` script with NODE_ENV=production, so its CSS is the CSS that dist holds.
 *
 * Scope limits: the parser reads only the at-rules this CSS uses (@media, @supports, @layer, plus skipping others). It
 * handles min-width and max-width in px. Any other media feature counts as not matching. The width check reads the
 * `width` property only, not min-width or max-width.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BUILD_TIMEOUT_MS = 300_000;
const MAX_FIXED_WIDTH_PX = 320;
const WIDE_MIN_WIDTH_PX = 600;
const NARROW_WIDTHS_PX = [320, 375, 599] as const;
const JAR_GRID_SELECTORS = [".shelf-grid", "ol.shelf-grid"] as const;
const HEADER_SELECTOR = ".cabinet-header";

interface CssDeclaration {
  readonly prop: string;
  readonly value: string;
}

interface CssRule {
  readonly selectors: readonly string[];
  readonly declarations: readonly CssDeclaration[];
  /** The prelude of every enclosing at-rule (for example `(min-width:600px)`), outermost first. */
  readonly media: readonly string[];
}

/** Removes CSS comments. Strings in this CSS contain no `/*`, so a plain pattern is safe. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Splits text on a separator that sits outside parentheses and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of text) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function parseDeclarations(body: string): CssDeclaration[] {
  return splitTopLevel(body, ";").flatMap((declaration) => {
    const colon = declaration.indexOf(":");
    if (colon < 0) return [];
    const value = declaration
      .slice(colon + 1)
      .trim()
      .replace(/\s*!important$/i, "");
    return [{ prop: declaration.slice(0, colon).trim().toLowerCase(), value }];
  });
}

/**
 * A small CSS reader for the minified production stylesheet. It returns each style rule with the media queries that
 * enclose it. Blocks such as @font-face and @keyframes are skipped by brace matching.
 */
function parseCss(css: string): CssRule[] {
  const text = stripComments(css);
  const rules: CssRule[] = [];
  let pos = 0;

  /** Reads a block body. `pos` is just after the opening brace and ends just after the matching close brace. */
  const readBlockBody = (): string => {
    const start = pos;
    let depth = 1;
    let quote: string | null = null;
    while (pos < text.length) {
      const ch = text.charAt(pos);
      pos += 1;
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, pos - 1);
      }
    }
    return text.slice(start);
  };

  const parseList = (media: readonly string[]): void => {
    for (;;) {
      while (pos < text.length && /[\s;]/.test(text.charAt(pos))) pos += 1;
      if (pos >= text.length) return;
      if (text.charAt(pos) === "}") {
        pos += 1;
        return;
      }
      const preludeStart = pos;
      while (pos < text.length && !"{;}".includes(text.charAt(pos))) pos += 1;
      const prelude = text.slice(preludeStart, pos).trim();
      if (text.charAt(pos) !== "{") continue;
      pos += 1;
      const conditional = /^@(media|supports|layer)\b/i.exec(prelude);
      if (conditional) {
        parseList([...media, prelude.slice(conditional[0].length).trim()]);
        continue;
      }
      if (prelude.startsWith("@")) {
        readBlockBody();
        continue;
      }
      rules.push({
        selectors: splitTopLevel(prelude, ","),
        declarations: parseDeclarations(readBlockBody()),
        media,
      });
    }
  };

  parseList([]);
  return rules;
}

/**
 * Whether a media query holds at a viewport width. Only `(min-width: Npx)` and `(max-width: Npx)` joined by `and` are
 * understood. Any other feature (for example `prefers-reduced-motion`) makes the query fail, so an unknown rule never
 * counts as applying at a width.
 */
function mediaHolds(query: string, width: number): boolean {
  const features = [...query.matchAll(/\(([^()]*)\)/g)].map((m) => (m[1] ?? "").trim());
  if (features.length === 0) return false;
  const leftover = query.replace(/\([^()]*\)/g, "").replace(/\band\b/gi, "").trim();
  if (leftover !== "") return false;
  return features.every((feature) => {
    const match = /^(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px$/i.exec(feature);
    if (!match) return false;
    const limit = Number(match[2]);
    return (match[1] ?? "").toLowerCase() === "min" ? width >= limit : width <= limit;
  });
}

/** Whether an enclosing media query requires a min-width of at least `minimum` px. */
function guardedByMinWidth(media: readonly string[], minimum: number): boolean {
  return media.some((query) =>
    [...query.matchAll(/\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/gi)].some((m) => Number(m[1]) >= minimum),
  );
}

/** A plain CSS length in CSS pixels. rem and em use a 16 px root, as in build-scan.test.ts. */
function lengthPx(value: string): number | undefined {
  if (value === "0") return 0;
  const match = /^(-?\d*\.?\d+)(px|rem|em)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  return (match[2] ?? "").toLowerCase() === "px" ? amount : amount * 16;
}

/** Values of `width` that depend on the container or viewport, or that are not a length. They are not fixed widths. */
const NOT_FIXED_WIDTH =
  /^(auto|inherit|initial|unset|revert|revert-layer|fit-content|max-content|min-content|-?\d*\.?\d+%|-?\d*\.?\d+(vw|vh|svw|svh|dvw|dvh|lvw|lvh|vmin|vmax|vi|vb|cqw|cqh|cqi|cqb|cqmin|cqmax))$/;

/**
 * The fixed px width of a `width` value: a plain length, or the smallest px argument of `min()`. Returns undefined for
 * values that are not fixed, and "unresolved" for calc(), var(), clamp() and similar, which this reader does not evaluate.
 */
function fixedWidthPx(value: string): number | "unresolved" | undefined {
  const v = value.trim().toLowerCase();
  if (NOT_FIXED_WIDTH.test(v)) return undefined;
  const plain = lengthPx(v);
  if (plain !== undefined) return plain;
  const min = /^min\((.*)\)$/.exec(v);
  if (min) {
    const lengths = splitTopLevel(min[1] ?? "", ",")
      .map(lengthPx)
      .filter((n): n is number => n !== undefined);
    return lengths.length > 0 ? Math.min(...lengths) : undefined;
  }
  return "unresolved";
}

/** The computed value at one width: the last declaration that a matching rule sets on the selector. */
function declaredAt(rules: readonly CssRule[], selector: string, prop: string, width: number): string | undefined {
  let value: string | undefined;
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    if (!rule.media.every((query) => mediaHolds(query, width))) continue;
    for (const declaration of rule.declarations) {
      if (declaration.prop === prop) value = declaration.value.toLowerCase();
    }
  }
  return value;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Builds the cabinet into a fresh directory with the same script and NODE_ENV that Dist uses. */
function buildCabinetTo(outDir: string): void {
  try {
    execSync(`npm run build -w apps/cabinet -- --outDir ${JSON.stringify(outDir)} --emptyOutDir`, {
      cwd: ROOT,
      stdio: "pipe",
      timeout: BUILD_TIMEOUT_MS,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" },
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(`cabinet build failed:\n${stderr.slice(-2000)}`);
  }
}

describe("Cabinet layout does not scroll sideways at 375 px or 320 px (task 10.2)", () => {
  let outDir = "";
  let rules: CssRule[] = [];
  let css = "";

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "cabinet-hscroll-"));
    buildCabinetTo(outDir);
    css = walk(outDir)
      .filter((abs) => abs.endsWith(".css"))
      .map((abs) => readFileSync(abs, "utf8"))
      .join("\n");
    rules = parseCss(css);
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
  });

  it("reads the built stylesheet into rules, including the jar grid (sanity check on the reader)", () => {
    expect(css.length).toBeGreaterThan(0);
    expect(rules.length).toBeGreaterThan(0);
    const grid = rules.filter((rule) => rule.selectors.some((s) => JAR_GRID_SELECTORS.includes(s as never)));
    expect(grid.length).toBeGreaterThan(0);
  });

  it("the jar grid is two cells in a row below 600 px, 140 px cells from 600 px and 180 px cells from 1280 px (Requirement 7.7)", () => {
    const columnsAt = (width: number): string | undefined =>
      declaredAt(rules, "ol.shelf-grid", "grid-template-columns", width)?.replace(/\s+/g, "");
    expect(columnsAt(375)).toBe("repeat(2,minmax(0,1fr))");
    expect(columnsAt(320)).toBe("repeat(2,minmax(0,1fr))");
    expect(columnsAt(700)).toBe("repeat(auto-fill,minmax(140px,1fr))");
    expect(columnsAt(1440)).toBe("repeat(auto-fill,minmax(180px,1fr))");
  });

  it("no width above 320 px sits outside a min-width media query of 600 px or more (Requirements 7.10, 10.5)", () => {
    const problems: string[] = [];
    for (const rule of rules) {
      for (const declaration of rule.declarations) {
        if (declaration.prop !== "width") continue;
        const px = fixedWidthPx(declaration.value);
        const selector = rule.selectors.join(", ");
        if (px === "unresolved") {
          problems.push(`${selector} { width: ${declaration.value} } cannot be resolved`);
          continue;
        }
        if (px === undefined || px <= MAX_FIXED_WIDTH_PX) continue;
        if (!guardedByMinWidth(rule.media, WIDE_MIN_WIDTH_PX)) {
          problems.push(`${selector} { width: ${declaration.value} } outside min-width ${WIDE_MIN_WIDTH_PX}px`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("the narrow header stacks in a column below 600 px (Requirement 10.5, design breakpoints)", () => {
    for (const width of NARROW_WIDTHS_PX) {
      expect(declaredAt(rules, HEADER_SELECTOR, "display", width), `display at ${width} px`).toBe("flex");
      expect(declaredAt(rules, HEADER_SELECTOR, "flex-direction", width), `flex-direction at ${width} px`).toBe(
        "column",
      );
    }
  });

  it("html and body do not hide horizontal overflow with overflow-x or overflow (Requirements 7.10, 10.5)", () => {
    const hiding = new Set(["hidden", "clip"]);
    const problems: string[] = [];
    for (const rule of rules) {
      if (!rule.selectors.some((s) => s === "html" || s === "body")) continue;
      for (const declaration of rule.declarations) {
        if (declaration.prop !== "overflow" && declaration.prop !== "overflow-x") continue;
        if (hiding.has(declaration.value.toLowerCase())) {
          problems.push(`${rule.selectors.join(", ")} { ${declaration.prop}: ${declaration.value} }`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
