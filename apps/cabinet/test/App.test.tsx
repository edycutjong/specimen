// @vitest-environment jsdom
/**
 * Requirements 2.1, 3.4, 3.6, 3.11, 15.1, 15.2, 15.3 and 15.7 for the App wiring. The page load
 * and the version switch run the real replay of hollow-inn over InMemoryTransport. Only the
 * forced rejection spies on `runReplay`, and only in its own test.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import * as browserReplay from "../src/browser-replay.js";

/** The VerdictPlate counts line of hollow-inn v2 over the committed jars (evidence/replay/racks-vs-v2.txt). */
const V2_COUNTS = /5 preserved · 4 rattled · 1 cracked/;
const V1_IDLE = "hollow-inn v1 has not been replayed yet.";
const JAR_COUNT = 10;

function versionRadio(name: string): HTMLElement {
  return screen.getByRole("radio", { name });
}

async function waitForReplayedV2(): Promise<void> {
  await screen.findByText(V2_COUNTS, undefined, { timeout: 15_000 });
  // The figures show once the Reveal has ended, and the jars take their states before that.
  await waitFor(() => expect(document.querySelector(".verdict-plate__status--pending")).toBeNull(), {
    timeout: 15_000,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("selects v2 on page load and shows its replayed result without a click", async () => {
    render(<App />);

    expect(versionRadio("v2").getAttribute("aria-checked")).toBe("true");
    expect(versionRadio("v1").getAttribute("aria-checked")).toBe("false");

    await waitForReplayedV2();
    expect(screen.getAllByRole("button", { name: /— rattled/ })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /— cracked/ })).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switching version clears the jars and hides the figures", async () => {
    render(<App />);
    await waitForReplayedV2();

    fireEvent.click(versionRadio("v1"));

    expect(versionRadio("v1").getAttribute("aria-checked")).toBe("true");
    await screen.findByText(V1_IDLE);
    expect(screen.queryByText(V2_COUNTS)).toBeNull();
    // The labels stay in the page, but no schema or replay figure is shown (design pass, item 3).
    expect(document.querySelector(".counts-pair__schema .counts-pair__value")?.textContent).toBe("");
    expect(document.querySelector(".counts-pair__replay .counts-pair__value")?.textContent).toBe("");
    expect(screen.getAllByRole("button", { name: /— not replayed$/ })).toHaveLength(JAR_COUNT);
  });

  it("shows a thrown replay as the plate message, marks every jar not replayed, and focuses Retry", async () => {
    const replay = vi
      .spyOn(browserReplay, "runReplay")
      .mockRejectedValueOnce(new Error("hollow-inn did not start"));

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("hollow-inn did not start");

    const retry = screen.getByRole("button", { name: "Retry" });
    await waitFor(() => expect(document.activeElement).toBe(retry));
    expect(screen.getAllByRole("button", { name: /— not replayed$/ })).toHaveLength(JAR_COUNT);
    expect(replay).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);

    await waitForReplayedV2();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(replay).toHaveBeenCalledTimes(2);
  });
});
