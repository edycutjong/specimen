// @vitest-environment jsdom
/**
 * Requirements 12.1 to 12.8 for the SpecViewer. Each Replay_Result comes from `runReplay()` over
 * the real hollow-inn modules and the committed jars, so the PASS badge is the live `checkSpec()`
 * outcome against the replay the page shows. Nothing is mocked.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { BugfixSpec } from "@specimen/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getBugfixSpecs,
  runReplay,
  type CabinetReplayResult,
  type HollowInnVersion,
} from "../src/browser-replay.js";
import { buildViewModel, type JarViewModel } from "../src/cabinet-model.js";
import { SpecViewer, chooseSpec, parseFiledDate, SPEC_FILED_DATE } from "../src/components/SpecViewer.js";
import { RACK_META } from "../src/rack-meta.js";

const QUOTE_SPEC = ".kiro/specs/quote-total-total-cents/bugfix.md";
const SPECS = getBugfixSpecs();

let v2: CabinetReplayResult;
let v21: CabinetReplayResult;

beforeAll(async () => {
  v2 = await runReplay("v2");
  v21 = await runReplay("v2.1");
}, 120_000);

afterEach(() => {
  cleanup();
});

afterAll(() => {
  cleanup();
});

/** The jar view model for `id` in the page of one Version, found the way the page finds it. */
function jarOf(id: string, version: HollowInnVersion, result: CabinetReplayResult): JarViewModel {
  const model = buildViewModel({
    result,
    version,
    bugfixSpecs: SPECS,
    racks: RACK_META,
    guideFlags: { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false },
  });
  const jar = model.racks.flatMap((rack) => rack.jars).find((candidate) => candidate.id === id);
  if (jar === undefined) throw new Error(`${id} is not on the shelves`);
  return jar;
}

describe("SpecViewer filing status (Requirements 12.4, 12.5, 12.7, 12.8)", () => {
  it("shows the PASS badge for SPC-0002 in v2, a red jar whose spec passes checkSpec()", () => {
    render(<SpecViewer jar={jarOf("SPC-0002", "v2", v2)} specs={SPECS} result={v2} />);

    expect(screen.getByText("check-spec PASS")).toBeTruthy();
    expect(screen.getByText("filed as a Kiro bugfix spec")).toBeTruthy();
  });

  it("shows no badge and 'not red in this replay' for SPC-0002 in v2.1, where the jar is preserved", () => {
    render(<SpecViewer jar={jarOf("SPC-0002", "v2.1", v21)} specs={SPECS} result={v21} />);

    expect(screen.queryByText("check-spec PASS")).toBeNull();
    expect(screen.getByText("not red in this replay")).toBeTruthy();
  });

  it("shows 'not filed' for SPC-0010 when its spec is withheld: red and cited by no spec", () => {
    const withoutSpec = SPECS.filter((spec) => !spec.text.includes("SPC-0010"));
    render(<SpecViewer jar={jarOf("SPC-0010", "v2", v2)} specs={withoutSpec} result={v2} />);

    expect(screen.getByText("not filed")).toBeTruthy();
    expect(screen.queryByText("check-spec PASS")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("SpecViewer spec body and link (Requirements 12.1, 12.3, 12.6)", () => {
  it("links the spec file on GitHub with rel=\"noopener noreferrer\" and renders its text", () => {
    const { container } = render(<SpecViewer jar={jarOf("SPC-0002", "v2", v2)} specs={SPECS} result={v2} />);

    const link = screen.getByRole("link", { name: /quote-total-total-cents/ });
    expect(link.getAttribute("href")).toBe(`https://github.com/edycutjong/specimen/blob/main/${QUOTE_SPEC}`);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector(".spec-viewer__body h1, .spec-viewer__body h2")).not.toBeNull();
  });

  it("states the provenance with the date from the slice heading and no Kiro version", () => {
    const { container } = render(<SpecViewer jar={jarOf("SPC-0002", "v2", v2)} specs={SPECS} result={v2} />);

    const provenance = container.querySelector(".spec-viewer__provenance")?.textContent ?? "";
    expect(provenance).toContain("specimen-curator");
    expect(provenance).toContain("specimen file");
    expect(provenance).toContain(SPEC_FILED_DATE);
    expect(provenance).not.toMatch(/Kiro\s+v?\d/);
  });

  it("renders the spec text and drops the repro markers", () => {
    const { container } = render(<SpecViewer jar={jarOf("SPC-0002", "v2", v2)} specs={SPECS} result={v2} />);

    const body = container.querySelector(".spec-viewer__body")?.textContent ?? "";
    expect(body).toContain("SPC-0002");
    expect(body).not.toContain("specimen:repro:start");
  });
});

describe("chooseSpec selection (Requirement 12.1)", () => {
  it("picks the passing citing spec for SPC-0002 in v2", () => {
    const choice = chooseSpec("SPC-0002", SPECS, v2.jars);

    expect(choice?.passes).toBe(true);
    expect(choice?.spec.name).toBe(QUOTE_SPEC);
  });

  it("falls back to the first citing spec in code-unit path order when none passes", () => {
    const failing: BugfixSpec[] = [
      { name: ".kiro/specs/zeta/bugfix.md", text: "SPC-0010 is cited here" },
      { name: ".kiro/specs/alpha/bugfix.md", text: "SPC-0010 is cited here too" },
    ];
    const choice = chooseSpec("SPC-0010", failing, v2.jars);

    expect(choice?.passes).toBe(false);
    expect(choice?.spec.name).toBe(".kiro/specs/alpha/bugfix.md");
  });

  it("returns null when no spec cites the id as a whole token", () => {
    const near: BugfixSpec[] = [{ name: ".kiro/specs/x/bugfix.md", text: "SPC-00101 only" }];

    expect(chooseSpec("SPC-0010", near, v2.jars)).toBeNull();
  });
});

describe("parseFiledDate (Requirement 12.3)", () => {
  it("reads the date from the heading of the slice note", () => {
    expect(parseFiledDate("# Vertical slice, step 1 (P1b, 2026-11-25 03:52 WIB)\n\nbody 2020-01-01")).toBe(
      "2026-11-25",
    );
  });

  it("throws when the heading has no date", () => {
    expect(() => parseFiledDate("# no date here\n")).toThrow();
  });
});
