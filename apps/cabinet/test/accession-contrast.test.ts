/**
 * Accessibility fix (axe colour-contrast on `.jar__accession`). Node environment, no jsdom.
 *
 * Reads the Token_File and Jar.css as text, resolves the colours the accession text uses, and checks the WCAG 2.x
 * contrast ratio against its background in every jar state (preserved, rattled, cracked). The ratio is computed
 * from the tokens, not from a browser. The test also fails if a state rule overrides the accession or the tag colours.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONTRAST_MIN = 4.5;
const STATES = ["preserved", "rattled", "cracked"] as const;

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** The declarations of every rule whose selector list contains `selector` exactly. */
function declarationsOf(css: string, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const statement of (match[2] ?? "").split(";")) {
      const colon = statement.indexOf(":");
      if (colon > 0) found.set(statement.slice(0, colon).trim(), statement.slice(colon + 1).trim());
    }
  }
  return found;
}

function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of read("../src/styles/tokens.css").matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    map.set(match[1] ?? "", match[2] ?? "");
  }
  return map;
}

/** Resolves `var(--name)` to its hex value. Anything else is returned unchanged. */
function resolve(value: string, map: Map<string, string>): string {
  const m = /^var\((--[a-z-]+)\)$/.exec(value);
  if (!m) return value;
  const hex = map.get(m[1] ?? "");
  if (hex === undefined) throw new Error(`token ${m[1]} is not defined in tokens.css`);
  return hex;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("accession text contrast (axe color-contrast)", () => {
  const css = read("../src/components/Jar.css");
  const map = tokens();
  const accession = declarationsOf(css, ".jar__accession");

  it("sets the accession colour and its own background from tokens", () => {
    expect(accession.get("color")).toBe("var(--label-ink)");
    expect(accession.get("background")).toBe("var(--tag)");
  });

  for (const state of STATES) {
    it(`reaches 4.5:1 for the accession text in the ${state} state`, () => {
      // No state rule may change the tag or the accession colours. The tag background is one token for all states.
      const stateRules = stripComments(css).match(new RegExp(`[^{}]*(data-state="${state}"|jar__tag--)[^{}]*\\{[^{}]*\\}`, "g")) ?? [];
      for (const rule of stateRules) {
        expect(/\b(color|background)\s*:/.test(rule), rule).toBe(false);
      }
      const text = resolve(accession.get("color") ?? "", map);
      const background = resolve(accession.get("background") ?? "", map);
      const ratio = contrast(text, background);
      expect(ratio, `${state}: ${text} on ${background}`).toBeGreaterThanOrEqual(CONTRAST_MIN);
    });
  }
});
