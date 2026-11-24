/**
 * Task 4.2. Requirements 9.1, 9.2, 9.7, 9.8, 9.9, 9.12, 16.9 and 16.10.
 *
 * Node environment, no jsdom. Reads `src/styles/tokens.css` (the Token_File) and `src/styles/cabinet.css`
 * as text and checks them. It does not render the CSS and does not measure layout.
 *
 * Assumptions:
 * - rem and em convert against a 16 px root, the browser default. Neither file sets a font size on `html`.
 * - The no-purple and --after-on---tag checks work per rule: a single rule must hold both declarations.
 *   A pair split across a parent and a child rule is not caught.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT_PX = 16;
const MIN_FONT_PX = 14;
const CONTRAST_MIN = 4.5;

/** Requirement 9.1: the 11 colours. The three font faces are checked separately below. */
const EXPECTED_COLOURS: Record<string, string> = {
  "--bg": "#10150F",
  "--glass": "#192219",
  "--ink": "#ECE6D3",
  "--tag": "#D9C49A",
  "--label-ink": "#1E1912",
  "--muted": "#8E978A",
  "--before": "#A8E35F",
  "--after": "#FF4A2E",
  "--cracked": "#7A3B31",
  "--rule": "#333D31",
  "--storm": "#C9D6F2",
};

const EXPECTED_FONTS: Record<string, string> = {
  "--font-display": "Grenze Gotisch",
  "--font-body": "Atkinson Hyperlegible Next",
  "--font-data": "Azeret Mono",
};

/** Requirement 9.8: every allowed text colour pair, as [text, background]. */
const TEXT_PAIRS: Array<[string, string]> = [
  ["--ink", "--bg"],
  ["--muted", "--bg"],
  ["--label-ink", "--tag"],
  ["--label-ink", "--after"],
  ["--after", "--bg"],
  ["--before", "--bg"],
];

const PURPLE_NAMES =
  /\b(purple|violet|indigo|magenta|fuchsia|orchid|plum|lavender|mauve|lilac|thistle|rebeccapurple)\b/i;
const PURPLE_HUE_MIN = 260;
const PURPLE_HUE_MAX = 330;

const STORM_ALLOWED_RULE = /window|lightning/i;

interface Declaration {
  property: string;
  value: string;
}

interface Rule {
  selectors: string[];
  declarations: Declaration[];
}

type Rgb = [number, number, number];

function readStyle(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), "utf8");
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Splits CSS into rules. Only innermost blocks are matched, so an `@media` wrapper contributes
 * no rule of its own, and its child rules are still read.
 */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = match[1] ?? "";
    const body = match[2] ?? "";
    // Drop any statement that ends before the selector, such as an `@import ...;` line.
    const selectorText = prelude.split(";").pop() ?? "";
    const declarations: Declaration[] = [];
    for (const statement of body.split(";")) {
      const colon = statement.indexOf(":");
      if (colon < 0) continue;
      declarations.push({
        property: statement.slice(0, colon).trim(),
        value: statement.slice(colon + 1).trim(),
      });
    }
    rules.push({
      selectors: selectorText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      declarations,
    });
  }
  return rules;
}

function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let digits = m[1] ?? "";
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

function mustParseHex(hex: string): Rgb {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`not a 3- or 6-digit hex colour: ${hex}`);
  return rgb;
}

/** WCAG 2.x relative luminance of an sRGB colour. */
function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colours. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Converts a CSS size to px. Returns null for keywords and anything it cannot convert. */
function fontSizePx(value: string): number | null {
  const m = /^(\d*\.?\d+)(px|rem|em)$/i.exec(value.trim());
  if (!m) return null;
  const num = m[1] ?? "0";
  const unit = (m[2] ?? "").toLowerCase();
  const n = Number(num);
  return unit === "px" ? n : n * ROOT_PX;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1]: Rgb =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [r1 + m, g1 + m, b1 + m].map((v) => Math.round(v * 255)) as Rgb;
}

/** Every colour written in a declaration value as hex, rgb(), hsl() or a named purple. */
function coloursIn(value: string): Rgb[] {
  const out: Rgb[] = [];
  for (const m of value.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi)) {
    const rgb = parseHex(m[0]);
    if (rgb) out.push(rgb);
  }
  for (const m of value.matchAll(/rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/gi)) {
    const [, r = "0", g = "0", b = "0"] = m;
    out.push([Number(r), Number(g), Number(b)]);
  }
  for (const m of value.matchAll(
    /hsla?\(\s*(\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/gi,
  )) {
    const [, h = "0", s = "0", l = "0"] = m;
    out.push(hslToRgb(Number(h), Number(s) / 100, Number(l) / 100));
  }
  return out;
}

/** Hue in degrees, or null for a grey (no hue). */
function hueOf(rgb: Rgb): number | null {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return null;
  let h: number;
  if (max === r) h = 60 * ((((g - b) / d) % 6) + 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
}

function customPropertyNames(css: string): string[] {
  return parseRules(css)
    .flatMap((rule) => rule.declarations)
    .map((d) => d.property)
    .filter((p) => p.startsWith("--"));
}

function tokenValue(name: string): string {
  for (const rule of parseRules(readStyle("tokens.css"))) {
    if (!rule.selectors.includes(":root")) continue;
    for (const d of rule.declarations) {
      if (d.property === name) return d.value;
    }
  }
  throw new Error(`${name} is not defined in tokens.css`);
}

function tokenRgb(name: string): Rgb {
  return mustParseHex(tokenValue(name));
}

/** Requirement 9.2: each rule that reads --storm must be a window or lightning rule. */
function stormViolations(css: string): string[] {
  const out: string[] = [];
  for (const rule of parseRules(css)) {
    const usesStorm = rule.declarations.some(
      (d) =>
        /var\(\s*--storm\b/.test(d.value) ||
        (d.property === "--storm" && !rule.selectors.includes(":root")),
    );
    if (!usesStorm) continue;
    for (const selector of rule.selectors) {
      if (!STORM_ALLOWED_RULE.test(selector)) out.push(selector);
    }
  }
  return out;
}

/** Requirement 9.7 and 16.9: every font size, after rem and em conversion, is at least 14 px. */
function fontSizeProblems(css: string): string[] {
  const problems: string[] = [];
  for (const rule of parseRules(css)) {
    for (const d of rule.declarations) {
      const prop = d.property.toLowerCase();
      if (prop === "font-size") {
        const px = fontSizePx(d.value);
        if (px === null) {
          problems.push(`${rule.selectors.join(", ")}: font-size "${d.value}" has no px equivalent`);
        } else if (px < MIN_FONT_PX) {
          problems.push(`${rule.selectors.join(", ")}: font-size ${d.value} is ${px} px`);
        }
      } else if (prop === "font") {
        // The shorthand can carry a size. Check every size token it contains.
        for (const m of d.value.matchAll(/\d*\.?\d+(?:px|rem|em)\b/gi)) {
          const px = fontSizePx(m[0]);
          if (px === null || px < MIN_FONT_PX) {
            problems.push(`${rule.selectors.join(", ")}: font shorthand size ${m[0]} is below 14 px`);
          }
        }
      }
    }
  }
  return problems;
}

/** Requirement 9.12: no colour with a purple hue, and no purple colour name. */
function purpleProblems(css: string): string[] {
  const problems: string[] = [];
  for (const rule of parseRules(css)) {
    for (const d of rule.declarations) {
      if (PURPLE_NAMES.test(d.value)) {
        problems.push(`${d.property}: ${d.value} names a purple`);
      }
      for (const rgb of coloursIn(d.value)) {
        const hue = hueOf(rgb);
        if (hue !== null && hue >= PURPLE_HUE_MIN && hue < PURPLE_HUE_MAX) {
          problems.push(`${d.property}: ${d.value} has hue ${hue.toFixed(0)}`);
        }
      }
    }
  }
  return problems;
}

/** Requirement 9.9: no rule sets --after text on a --tag background. Returns the offending selectors. */
function afterOnTagViolations(css: string): string[] {
  return parseRules(css)
    .filter((rule) => {
      const afterText = rule.declarations.some(
        (d) => d.property === "color" && /var\(\s*--after\s*\)/.test(d.value),
      );
      const tagFill = rule.declarations.some(
        (d) =>
          (d.property === "background" || d.property === "background-color") &&
          /var\(\s*--tag\s*\)/.test(d.value),
      );
      return afterText && tagFill;
    })
    .map((rule) => rule.selectors.join(", "));
}

const tokensCss = readStyle("tokens.css");
const cabinetCss = readStyle("cabinet.css");
const allStyles = `${tokensCss}\n${cabinetCss}`;

describe("Token_File defines the custom properties of 9.1", () => {
  const expectedNames = [...Object.keys(EXPECTED_COLOURS), ...Object.keys(EXPECTED_FONTS)];

  it("defines exactly the 14 custom properties, each once", () => {
    const names = customPropertyNames(tokensCss);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(14);
    expect([...names].sort()).toEqual([...expectedNames].sort());
  });

  it.each(Object.entries(EXPECTED_COLOURS))("%s is %s", (name, hex) => {
    expect(tokenValue(name).toUpperCase()).toBe(hex.toUpperCase());
  });

  it.each(Object.entries(EXPECTED_FONTS))("%s names the %s face", (name, family) => {
    expect(tokenValue(name)).toContain(family);
  });

  it("cabinet.css declares no custom property, so the Token_File stays the only source", () => {
    expect(customPropertyNames(cabinetCss)).toEqual([]);
  });
});

describe("text colour pairs reach 4.5:1 (9.8, 16.10)", () => {
  it("the contrast calculation returns 21:1 for black on white", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  it.each(TEXT_PAIRS)("%s on %s", (text, background) => {
    const ratio = contrastRatio(tokenRgb(text), tokenRgb(background));
    expect(ratio, `${text} on ${background} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(CONTRAST_MIN);
  });
});

describe("--storm is only for the window and lightning (9.2)", () => {
  it("flags a jar rule that reads --storm, and accepts window and lightning rules", () => {
    expect(stormViolations(".jar-body { fill: var(--storm); }")).toEqual([".jar-body"]);
    expect(stormViolations(".window-bar, .lightning { fill: var(--storm); }")).toEqual([]);
  });

  it("no rule in tokens.css or cabinet.css uses --storm outside a window or lightning rule", () => {
    expect(stormViolations(tokensCss)).toEqual([]);
    expect(stormViolations(cabinetCss)).toEqual([]);
  });
});

describe("no font size below 14 px after rem and em conversion (9.7, 16.9)", () => {
  it("converts px, rem and em, and rejects keywords", () => {
    expect(fontSizePx("14px")).toBe(14);
    expect(fontSizePx("0.875rem")).toBe(14);
    expect(fontSizePx("0.8em")).toBeCloseTo(12.8, 10);
    expect(fontSizePx("small")).toBeNull();
  });

  it("every font-size in tokens.css and cabinet.css is at least 14 px", () => {
    const sizes = parseRules(allStyles)
      .flatMap((rule) => rule.declarations)
      .filter((d) => d.property.toLowerCase() === "font-size");
    expect(sizes.length).toBeGreaterThan(0);
    expect(fontSizeProblems(allStyles)).toEqual([]);
  });
});

describe("no purple hue (9.12)", () => {
  it("flags purple hex, rgb, hsl and named colours, and accepts the --storm blue", () => {
    expect(purpleProblems(".x { color: #8A2BE2; }")).toHaveLength(1);
    expect(purpleProblems(".x { color: rgb(138, 43, 226); }")).toHaveLength(1);
    expect(purpleProblems(".x { color: hsl(270, 60%, 50%); }")).toHaveLength(1);
    expect(purpleProblems(".x { color: violet; }")).toHaveLength(1);
    expect(purpleProblems(".x { fill: #C9D6F2; }")).toEqual([]);
  });

  it("the Token_File and cabinet.css contain no purple hue", () => {
    expect(purpleProblems(tokensCss)).toEqual([]);
    expect(purpleProblems(cabinetCss)).toEqual([]);
  });
});

describe("--after text never sits on a --tag background (9.9)", () => {
  it("flags a rule that pairs them, and accepts other pairs", () => {
    expect(afterOnTagViolations(".x { color: var(--after); background: var(--tag); }")).toEqual([".x"]);
    expect(afterOnTagViolations(".y { color: var(--after); background: var(--bg); }")).toEqual([]);
  });

  it("no rule in tokens.css or cabinet.css pairs them", () => {
    expect(afterOnTagViolations(tokensCss)).toEqual([]);
    expect(afterOnTagViolations(cabinetCss)).toEqual([]);
  });
});
