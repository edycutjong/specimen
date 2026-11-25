/**
 * Hover and press feedback on the disclosures and the footer link (axe-free UX check). Node environment.
 * Each selector must have a :hover rule, an :active rule, a focus ring that is kept, and a transition on the
 * token --hover-ms. The motion guard (prefers-reduced-motion) sets every transition to none.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const SELECTORS: Array<{ name: string; file: string; selector: string; markup: string }> = [
  { name: "cabinet details summary", file: "../src/styles/frame.css", selector: ".cabinet-details__summary", markup: "../src/App.tsx" },
  { name: "version notes summary", file: "../src/styles/version-notes.css", selector: ".version-notes__summary", markup: "../src/components/VersionNotes.tsx" },
  { name: "how-made summary", file: "../src/styles/frame.css", selector: ".how-made__summary", markup: "../src/components/HowJarsWereMade.tsx" },
  { name: "footer link", file: "../src/styles/frame.css", selector: ".how-made__link", markup: "../src/components/HowJarsWereMade.tsx" },
];

function stateRuleBody(css: string, selector: string, state: "hover" | "active" | "focus-visible"): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|[\\s,}])${escaped}:${state}\\s*\\{([^}]*)\\}`, "m").exec(css);
  return match?.[1];
}

describe("hover and press feedback on the disclosures and the footer link", () => {
  for (const item of SELECTORS) {
    it(`gives the ${item.name} a hover change, a press state and keeps its focus ring`, () => {
      const css = read(item.file);
      expect(read(item.markup)).toContain(item.selector.slice(1));
      expect(stateRuleBody(css, item.selector, "hover"), "hover rule").toBeDefined();
      expect(stateRuleBody(css, item.selector, "active"), "active rule").toBeDefined();
      // A link has no own focus rule: it keeps the page's global :focus-visible ring (cabinet.css).
      const focusRing =
        stateRuleBody(css, item.selector, "focus-visible") ??
        stateRuleBody(read("../src/styles/cabinet.css"), "", "focus-visible");
      expect(focusRing, "focus ring").toBeDefined();
      expect(new RegExp(`${item.selector.replace(/\./g, "\\.")}\\s*\\{[^}]*transition:[^;]*var\\(--hover-ms\\)`).test(css)).toBe(true);
    });
  }

  it("keeps every hover transition under the reduced-motion guard", () => {
    const motion = read("../src/styles/motion.css");
    expect(motion).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,[\s\S]*?transition: none !important;/);
  });
});
