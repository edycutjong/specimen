// @vitest-environment jsdom
/**
 * Requirements 13.1 to 13.8 for the GuideStrip. The component takes its steps as props, so these
 * tests drive each tick and the pulse through rerender, with no mocked protocol or replay.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuideStrip, type GuideStripProps } from "../src/components/GuideStrip.js";
import type { GuideStepState } from "../src/cabinet-model.js";

const LABELS = ["Open a red jar", "Read the bugfix spec filed for it", "Switch to v2.1 and replay"];

function steps(done: [boolean, boolean, boolean]): GuideStepState[] {
  return LABELS.map((label, index) => ({ label, done: done[index] === true }));
}

function baseProps(overrides: Partial<GuideStripProps> = {}): GuideStripProps {
  return {
    steps: steps([false, false, false]),
    coldOpenDone: false,
    reducedMotion: false,
    ...overrides,
  };
}

function stepItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("li.guide-strip__step"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GuideStrip steps (13.1)", () => {
  it("shows the three step labels in order with SVG numerals 1 to 3", () => {
    const { container } = render(<GuideStrip {...baseProps()} />);

    const items = stepItems(container);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.querySelector(".guide-strip__label")?.textContent)).toEqual(LABELS);

    const numerals = screen.getAllByRole("img");
    expect(numerals.map((node) => node.getAttribute("aria-label"))).toEqual(["1", "2", "3"]);
    for (const numeral of numerals) {
      expect(numeral.tagName.toLowerCase()).toBe("svg");
      expect(numeral.querySelector("path")?.getAttribute("d")).toBeTruthy();
    }
  });

  it("draws no numeral as text, so no glyph can fall back to a system font", () => {
    const { container } = render(<GuideStrip {...baseProps()} />);

    const numerals = container.querySelectorAll(".guide-strip__numeral");
    expect(numerals).toHaveLength(3);
    expect(container.querySelectorAll(".guide-strip__numeral text")).toHaveLength(0);
    for (const numeral of Array.from(numerals)) {
      expect(numeral.textContent).toBe("");
    }
  });

  it("starts with every step to do and no mark", () => {
    const { container } = render(<GuideStrip {...baseProps()} />);

    expect(screen.getAllByText("to do")).toHaveLength(3);
    expect(screen.queryByText("done")).toBeNull();
    expect(container.querySelector(".guide-strip__mark")).toBeNull();
  });
});

describe("GuideStrip tick transitions (13.2, 13.3, 13.4, 13.8)", () => {
  it("ticks step 1 when a Red_Jar is opened, and shows the visible done text", () => {
    const { container, rerender } = render(<GuideStrip {...baseProps()} />);

    rerender(<GuideStrip {...baseProps({ steps: steps([true, false, false]) })} />);

    const items = stepItems(container);
    expect(items[0]?.dataset.done).toBe("true");
    expect(items[1]?.dataset.done).toBe("false");
    expect(items[2]?.dataset.done).toBe("false");
    expect(items[0]?.querySelector(".guide-strip__state")?.textContent).toBe("done");
    expect(items[0]?.querySelector(".guide-strip__mark")).not.toBeNull();
    expect(screen.getAllByText("done")).toHaveLength(1);
    expect(screen.getAllByText("to do")).toHaveLength(2);
  });

  it("ticks step 2 when a Bugfix_Spec is shown for a Red_Jar, keeping step 1 ticked", () => {
    const { container, rerender } = render(<GuideStrip {...baseProps()} />);

    rerender(<GuideStrip {...baseProps({ steps: steps([true, false, false]) })} />);
    rerender(<GuideStrip {...baseProps({ steps: steps([true, true, false]) })} />);

    const items = stepItems(container);
    expect(items.map((item) => item.dataset.done)).toEqual(["true", "true", "false"]);
    expect(screen.getAllByText("done")).toHaveLength(2);
    expect(screen.getAllByText("to do")).toHaveLength(1);
  });

  it("ticks step 3 when a v2.1 replay completes, so all three show done", () => {
    const { container, rerender } = render(<GuideStrip {...baseProps()} />);

    rerender(<GuideStrip {...baseProps({ steps: steps([true, true, true]) })} />);

    expect(stepItems(container).map((item) => item.dataset.done)).toEqual(["true", "true", "true"]);
    expect(screen.getAllByText("done")).toHaveLength(3);
    expect(screen.queryByText("to do")).toBeNull();
  });

  it("does not untick a step when its input goes back to not done (page-load ticks)", () => {
    const { container, rerender } = render(<GuideStrip {...baseProps()} />);

    rerender(<GuideStrip {...baseProps({ steps: steps([true, false, false]) })} />);
    rerender(<GuideStrip {...baseProps({ steps: steps([false, false, false]) })} />);

    expect(stepItems(container)[0]?.dataset.done).toBe("true");
  });

  it("starts ticked when the steps are already done on the first render", () => {
    const { container } = render(<GuideStrip {...baseProps({ steps: steps([true, false, false]) })} />);

    expect(stepItems(container)[0]?.dataset.done).toBe("true");
    expect(screen.getAllByText("done")).toHaveLength(1);
  });
});

describe("GuideStrip cold-open pulse (13.5)", () => {
  it("does not pulse before the Cold_Open ends", () => {
    const { container } = render(<GuideStrip {...baseProps()} />);

    expect(container.querySelector(".guide-strip__step--pulse")).toBeNull();
    expect(container.querySelector(".guide-strip__step--highlight")).toBeNull();
  });

  it("pulses step 1 once when the Cold_Open ends, and never again", () => {
    const { container, rerender } = render(<GuideStrip {...baseProps()} />);

    rerender(<GuideStrip {...baseProps({ coldOpenDone: true })} />);
    const items = stepItems(container);
    expect(items[0]?.classList.contains("guide-strip__step--pulse")).toBe(true);
    expect(items[1]?.classList.contains("guide-strip__step--pulse")).toBe(false);

    fireEvent.animationEnd(items[0] as HTMLElement);
    expect(items[0]?.classList.contains("guide-strip__step--pulse")).toBe(false);

    rerender(<GuideStrip {...baseProps({ coldOpenDone: false })} />);
    rerender(<GuideStrip {...baseProps({ coldOpenDone: true })} />);
    expect(container.querySelector(".guide-strip__step--pulse")).toBeNull();
    expect(container.querySelector(".guide-strip__step--highlight")).toBeNull();
  });
});

describe("GuideStrip Reduced_Motion (13.6)", () => {
  it("shows a static highlight on step 1 instead of the pulse", () => {
    const { container, rerender } = render(<GuideStrip {...baseProps({ reducedMotion: true })} />);

    rerender(<GuideStrip {...baseProps({ reducedMotion: true, coldOpenDone: true })} />);

    const first = stepItems(container)[0];
    expect(first?.classList.contains("guide-strip__step--highlight")).toBe(true);
    expect(first?.classList.contains("guide-strip__step--pulse")).toBe(false);
    expect(container.querySelector(".guide-strip__step--pulse")).toBeNull();
  });

  it("keeps the highlight static and leaves no animated class in place", () => {
    const { container, rerender } = render(<GuideStrip {...baseProps({ reducedMotion: true })} />);

    rerender(<GuideStrip {...baseProps({ reducedMotion: true, coldOpenDone: true })} />);
    fireEvent.animationEnd(stepItems(container)[0] as HTMLElement);

    expect(container.querySelector(".guide-strip__step--highlight")).not.toBeNull();
    expect(container.querySelector(".guide-strip__step--pulse")).toBeNull();
  });
});

describe("GuideStrip storage and cookies (13.7)", () => {
  it("writes no localStorage, sessionStorage or document.cookie through a full run of ticks and pulse", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookieSet = vi.fn();
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: cookieSet,
    });

    try {
      const { rerender } = render(<GuideStrip {...baseProps()} />);
      rerender(<GuideStrip {...baseProps({ steps: steps([true, false, false]) })} />);
      rerender(<GuideStrip {...baseProps({ steps: steps([true, true, false]) })} />);
      rerender(<GuideStrip {...baseProps({ steps: steps([true, true, true]), coldOpenDone: true })} />);

      expect(setItem).toHaveBeenCalledTimes(0);
      expect(cookieSet).toHaveBeenCalledTimes(0);
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie;
      if (cookieDescriptor !== undefined) {
        Object.defineProperty(Document.prototype, "cookie", cookieDescriptor);
      }
    }
  });
});
