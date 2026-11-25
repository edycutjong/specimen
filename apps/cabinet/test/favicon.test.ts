/**
 * The favicon (the console error on every load was a 404 for /favicon.ico). Node environment, no jsdom.
 * The page links an SVG icon, and the file exists in public/ so the link resolves.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("favicon", () => {
  it("links a favicon.svg from index.html", () => {
    const html = read("../index.html");
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });

  it("ships public/favicon.svg as a jar with two neck bolts in the brand colours", () => {
    expect(existsSync(fileURLToPath(new URL("../public/favicon.svg", import.meta.url)))).toBe(true);
    const svg = read("../public/favicon.svg");
    expect(svg.startsWith("<svg") || svg.trimStart().startsWith("<svg") || svg.includes("<svg")).toBe(true);
    expect(svg).toContain("#A8E35F");
    expect(svg).toContain("#10150F");
    expect(svg).not.toMatch(/<text/);
    expect(svg).not.toContain("--");
  });
});
