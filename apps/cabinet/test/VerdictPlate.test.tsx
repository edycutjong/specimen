// @vitest-environment jsdom
/**
 * Requirements 2.5, 2.16, 2.17, 4.1 to 4.15 and 6.10 for the VerdictPlate, rendered from view
 * models built on real runReplay results for v1, v2 and v2.1.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { coverageString } from "@specimen/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CabinetReplayResult } from "../src/browser-replay.js";
import { VerdictPlate } from "../src/components/VerdictPlate.js";
import { countsLine } from "./support/counts.js";
import { loadReplays, singleJarResult, viewModelOf, type Replays } from "./support/replays.js";

const INTERVAL_MS = 250;
let replays: Replays;

beforeAll(async () => {
  replays = await loadReplays();
}, 120_000);

afterEach(() => {
  cleanup();
});

function plateOf(version: "v1" | "v2" | "v2.1", result: CabinetReplayResult | null) {
  return viewModelOf(version, result).plate;
}

function statusText(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("VerdictPlate before a replay", () => {
  it("shows no verdict word and no SHIP or HOLD text (4.12)", () => {
    render(<VerdictPlate plate={plateOf("v2", null)} revealed revealIntervalMs={INTERVAL_MS} />);

    expect(screen.queryByText("HOLD")).toBeNull();
    expect(screen.queryByText("SHIP")).toBeNull();
    expect(statusText()).toBe("");
    expect(screen.getByText("hollow-inn v2 has not been replayed yet.")).toBeTruthy();
  });
});

describe("VerdictPlate with real replays", () => {
  it("shows HOLD in --after with the v2 counts, coverage, filed counter and reason (4.2, 4.4 to 4.6, 4.15)", () => {
    const plate = plateOf("v2", replays.v2);
    render(<VerdictPlate plate={plate} revealed revealIntervalMs={INTERVAL_MS} />);

    expect(screen.getByText("HOLD").style.color).toBe("var(--after)");
    expect(screen.getByText("v2")).toBeTruthy();
    expect(screen.getByText(countsLine("5 preserved · 4 rattled · 1 cracked"))).toBeTruthy();
    expect(screen.getByText(coverageString(replays.v2.coverage))).toBeTruthy();
    expect(screen.getByText("5 red · all red jars covered by 3 filed Kiro bugfix specs")).toBeTruthy();
        expect(screen.getByText(replays.v2.reason)).toBeTruthy();
    expect(screen.queryByText(/replay clean on the recorded set/)).toBeNull();
  });

  it("shows SHIP in --before with the clean wording and no reason line (4.3, 4.14)", () => {
    render(<VerdictPlate plate={plateOf("v1", replays.v1)} revealed revealIntervalMs={INTERVAL_MS} />);

    expect(screen.getByText("SHIP").style.color).toBe("var(--before)");
    expect(screen.getByText(countsLine("10 preserved · 0 rattled · 0 cracked"))).toBeTruthy();
    expect(screen.getByText("0 red · 0 filed as Kiro bugfix specs")).toBeTruthy();
    expect(statusText()).toContain("replay clean on the recorded set");
    expect(document.querySelector(".verdict-plate__reason")).toBeNull();
    expect(screen.queryByText("HOLD")).toBeNull();
  });

  it("shows v2.1 as HOLD with the remaining red jars and never as clean (4.1, 4.15)", () => {
    render(<VerdictPlate plate={plateOf("v2.1", replays["v2.1"])} revealed revealIntervalMs={INTERVAL_MS} />);

    expect(screen.getByText("HOLD")).toBeTruthy();
    expect(screen.getByText(countsLine("8 preserved · 1 rattled · 1 cracked"))).toBeTruthy();
    expect(screen.getByText("2 red · all red jars covered by 2 filed Kiro bugfix specs")).toBeTruthy();
    expect(screen.getByText(replays["v2.1"].reason)).toBeTruthy();
    expect(screen.queryByText("SHIP")).toBeNull();
  });

  it("never says a SHIP verdict means the server is safe (4.13)", () => {
    for (const version of ["v1", "v2", "v2.1"] as const) {
      const { unmount } = render(
        <VerdictPlate plate={plateOf(version, replays[version])} revealed revealIntervalMs={INTERVAL_MS} />,
      );
      expect(document.body.textContent ?? "").not.toMatch(/\bsafe\b/i);
      unmount();
    }
  });

  it("states the paced reveal line with N and T from the real Replay_Result (2.5)", () => {
    const plate = plateOf("v2", replays.v2);
    render(<VerdictPlate plate={plate} revealed revealIntervalMs={INTERVAL_MS} />);

    const noun = plate.compared === 1 ? "jar" : "jars";
    expect(document.querySelector(".verdict-plate__timing")?.textContent).toBe(
      `${plate.compared} ${noun} replayed in ${Math.round(replays.v2.replayTimeMs)} ms · in this browser · ` +
        "hollow-inn v2 in memory · reveal paced at 250 ms per jar",
    );
  });

  it("uses the singular form of the jar count for one compared jar (6.10)", () => {
    const single = singleJarResult(replays.v2);
    const plate = plateOf("v2", single);
    expect(plate.compared).toBe(1);

    render(<VerdictPlate plate={plate} revealed revealIntervalMs={INTERVAL_MS} />);

    expect(screen.getByText("1 jar compared", { exact: false })).toBeTruthy();
    expect(document.querySelector(".verdict-plate__timing")?.textContent).toMatch(/^1 jar replayed in /);
    expect(screen.getByText("1 red · 0 filed as Kiro bugfix specs")).toBeTruthy();
  });
});

describe("VerdictPlate reveal state", () => {
  it("keeps the figures hidden until the reveal completes, then shows them in the one status region (2.16, 2.17)", () => {
    const plate = plateOf("v2", replays.v2);
    const { rerender } = render(<VerdictPlate plate={plate} revealed={false} revealIntervalMs={INTERVAL_MS} />);

    // Hidden by visibility (design pass, item 3): the lines keep their space and are not shown.
    expect(document.querySelector(".verdict-plate__status--pending")).not.toBeNull();
    expect(statusText()).toContain("5 preserved · 4 rattled · 1 cracked");

    rerender(<VerdictPlate plate={plate} revealed revealIntervalMs={INTERVAL_MS} />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.querySelector(".verdict-plate__status--pending")).toBeNull();
    expect(screen.getByText("HOLD")).toBeTruthy();
    expect(statusText()).toContain("5 preserved · 4 rattled · 1 cracked");
  });
});
