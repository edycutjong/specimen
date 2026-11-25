// @vitest-environment jsdom
/**
 * Requirements 14.8 to 14.11 for the HowJarsWereMade section. The expected hook text is read from
 * the committed files, so the test fails if the page shows anything other than those files.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_LINE, HowJarsWereMade, KIRO_GITHUB_URL, SHIP_LINE } from "../src/components/HowJarsWereMade.js";

/** The committed hook files, read as raw text the same way the component imports them. */
const RAW_HOOKS = import.meta.glob("../../../.kiro/hooks/specimen-jar-*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function committedHook(name: string): string {
  const entry = Object.entries(RAW_HOOKS).find(([path]) => path.endsWith(`/${name}.json`));
  if (entry === undefined) {
    throw new Error(`committed hook file ${name}.json not found`);
  }
  return entry[1];
}

afterEach(() => {
  cleanup();
});

describe("HowJarsWereMade hook files (Requirement 14.8)", () => {
  it("shows the pre hook file exactly as committed", () => {
    const { container } = render(<HowJarsWereMade />);
    const block = container.querySelector('pre[data-hook="specimen-jar-pre"]');

    expect(block?.textContent).toBe(committedHook("specimen-jar-pre"));
    expect(JSON.parse(block?.textContent ?? "").hooks[0].name).toBe("specimen-jar-pre");
  });

  it("shows the post hook file exactly as committed", () => {
    const { container } = render(<HowJarsWereMade />);
    const block = container.querySelector('pre[data-hook="specimen-jar-post"]');

    expect(block?.textContent).toBe(committedHook("specimen-jar-post"));
    expect(JSON.parse(block?.textContent ?? "").hooks[0].name).toBe("specimen-jar-post");
  });
});

describe("HowJarsWereMade text (Requirements 14.10 and 14.11)", () => {
  it("shows the demo line with <your test instance> as literal text, the CLI fragment in code", () => {
    const { container } = render(<HowJarsWereMade />);
    const line = container.querySelector("p");

    expect(line?.textContent).toBe(DEMO_LINE);
    expect(DEMO_LINE.endsWith("specimen replay --server <your test instance>")).toBe(true);
    expect(line?.querySelector("code")?.textContent).toBe("specimen replay --server <your test instance>");
    expect(container.textContent).toContain("<your test instance>");
    expect(container.querySelector("your")).toBeNull();
  });

  it("states the SHIP meaning and that SHIP does not mean the server is safe", () => {
    render(<HowJarsWereMade />);

    expect(screen.getByText(SHIP_LINE)).toBeTruthy();
    expect(SHIP_LINE).toContain('"replay clean on the recorded set"');
    expect(SHIP_LINE).toContain('It never means "this server is safe".');
  });
});

describe("HowJarsWereMade links (Requirement 14.9)", () => {
  it("links to /.kiro on GitHub with noopener and noreferrer", () => {
    render(<HowJarsWereMade />);
    const link = screen.getByRole("link", { name: "/.kiro on GitHub" });

    expect(link.getAttribute("href")).toBe("https://github.com/edycutjong/specimen/tree/main/.kiro");
    expect(KIRO_GITHUB_URL).toBe("https://github.com/edycutjong/specimen/tree/main/.kiro");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
