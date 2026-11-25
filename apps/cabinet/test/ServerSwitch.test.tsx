// @vitest-environment jsdom
/**
 * Requirements 3.1, 3.2, 3.3, 3.5, 3.7, 3.9, 3.11 and 3.13 for the ServerSwitch and ReplayButton.
 * The switch sits in a real React tree with the real ReplayButton. Nothing here mocks the replay.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayButton } from "../src/components/ReplayButton.js";
import { ServerSwitch } from "../src/components/ServerSwitch.js";
import { splitChanges, versionNote } from "../src/changes.js";
import changesMarkdown from "../../../servers/hollow-inn/CHANGES.md?raw";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/** Stubs matchMedia so the viewport is narrower or wider than 600 px. */
function setViewportWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide && query === "(min-width: 600px)",
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("ServerSwitch", () => {
  it("offers exactly the three Versions v1, v2 and v2.1 as a segmented control (3.1, 3.2)", () => {
    setViewportWide(true);
    render(<ServerSwitch version="v2" onVersionChange={() => undefined} />);

    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["v1", "v2", "v2.1"]);
    expect(radios.find((radio) => radio.textContent === "v2")?.getAttribute("aria-checked")).toBe("true");
    expect(radios.find((radio) => radio.textContent === "v1")?.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders a native select with the same three Versions below 600 px (3.3)", () => {
    setViewportWide(false);
    render(<ServerSwitch version="v1" onVersionChange={() => undefined} />);

    const select = screen.getByRole("combobox", { name: "Server version" }) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["v1", "v2", "v2.1"]);
    expect(select.value).toBe("v1");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("moves and selects Versions with the arrow keys, Home and End (3.13)", () => {
    setViewportWide(true);
    const onVersionChange = vi.fn();
    render(<ServerSwitch version="v2" onVersionChange={onVersionChange} />);

    const v2 = screen.getByRole("radio", { name: "v2" });
    fireEvent.keyDown(v2, { key: "ArrowRight" });
    expect(onVersionChange).toHaveBeenLastCalledWith("v2.1");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "v2.1" }));

    fireEvent.keyDown(v2, { key: "ArrowLeft" });
    expect(onVersionChange).toHaveBeenLastCalledWith("v1");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "v1" }));

    fireEvent.keyDown(v2, { key: "End" });
    expect(onVersionChange).toHaveBeenLastCalledWith("v2.1");

    fireEvent.keyDown(v2, { key: "Home" });
    expect(onVersionChange).toHaveBeenLastCalledWith("v1");
  });

  it("keeps only the selected radio in the tab order (3.13)", () => {
    setViewportWide(true);
    render(<ServerSwitch version="v2.1" onVersionChange={() => undefined} />);

    const tabbable = screen.getAllByRole("radio").filter((radio) => radio.tabIndex === 0);
    expect(tabbable.map((radio) => radio.textContent)).toEqual(["v2.1"]);
  });

});

describe("ServerSwitch with a replay running", () => {
  it("stays enabled while the ReplayButton is running and still changes the Version (3.11)", () => {
    setViewportWide(true);
    const onVersionChange = vi.fn();
    const onReplay = vi.fn();
    render(
      <>
        <ServerSwitch version="v2" onVersionChange={onVersionChange} />
        <ReplayButton version="v2" running onReplay={onReplay} />
      </>,
    );

    const replay = screen.getByRole("button", { name: "Replay cabinet v2" });
    expect(replay.getAttribute("aria-disabled")).toBe("true");

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.hasAttribute("disabled")).toBe(false);
      expect(radio.getAttribute("aria-disabled")).not.toBe("true");
    }
    fireEvent.click(screen.getByRole("radio", { name: "v1" }));
    expect(onVersionChange).toHaveBeenCalledWith("v1");

    fireEvent.click(replay);
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("shows a live millisecond counter only while running (3.7)", () => {
    const onReplay = vi.fn();
    const { rerender } = render(<ReplayButton version="v1" running onReplay={onReplay} />);
    expect(screen.getByText(/^\d+ ms$/)).toBeTruthy();

    rerender(<ReplayButton version="v1" running={false} onReplay={onReplay} />);
    expect(screen.queryByText(/ ms$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Replay cabinet v1" }).getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Replay cabinet v1" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });
});

describe("changes.ts", () => {
  it("splits CHANGES.md into one entry per Version heading", () => {
    const notes = splitChanges(changesMarkdown);
    expect(notes.map((note) => note.version)).toEqual(["v2.1", "v2", "v1"]);
    expect(versionNote("v2")?.heading.startsWith("v2.0.0")).toBe(true);
    expect(versionNote("v1")?.body).toContain("Six tools");
  });
});
