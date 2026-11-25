// @vitest-environment jsdom
/**
 * Requirements 6.1 to 6.10 for the CountsPair, rendered from view models built on real
 * runReplay results for v1, v2 and v2.1.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getBugfixSpecs, type CabinetReplayResult } from "../src/browser-replay.js";
import { CountsPair, connectorText } from "../src/components/CountsPair.js";
import { buildViewModel, type CountsPairViewModel } from "../src/cabinet-model.js";
import { RACK_META } from "../src/rack-meta.js";
import { loadReplays, singleJarResult, viewModelOf, type Replays } from "./support/replays.js";

let replays: Replays;

beforeAll(async () => {
  replays = await loadReplays();
}, 120_000);

afterEach(() => {
  cleanup();
});

/** The full text of one half of the CountsPair: its label and value are separate elements. */
function halfText(selector: ".counts-pair__schema" | ".counts-pair__replay"): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

function countsOf(result: CabinetReplayResult | null, schemaDiffError?: string): CountsPairViewModel {
  return buildViewModel({
    result,
    version: "v2",
    bugfixSpecs: getBugfixSpecs(),
    racks: RACK_META,
    guideFlags: { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false },
    ...(schemaDiffError === undefined ? {} : { schemaDiffError }),
  }).counts;
}

describe("CountsPair with real replays", () => {
  it("shows v1 as 0 of 6 schema changes and no jars changed (6.7)", () => {
    const { container } = render(<CountsPair counts={countsOf(replays.v1)} replayed />);

    expect(halfText(".counts-pair__schema")).toBe("input-schema diff: 0 of 6 tools changed");
    expect(halfText(".counts-pair__replay")).toBe("replay: 0 tools · 0 jars changed");
    expect(container.querySelector(".counts-pair__added")).toBeNull();
    expect(document.querySelector(".counts-pair__connector")?.textContent).toBe(
      "Nothing changed — every recorded call came back the same.",
    );
  });

  it("shows v2 as a rename with its replay impact (6.2, 6.5, design pass item 1)", () => {
    render(<CountsPair counts={countsOf(replays.v2)} replayed />);

    expect(halfText(".counts-pair__schema")).toBe(
      "input-schema diff: 1 of 6 tools changed",
    );
    expect(halfText(".counts-pair__replay")).toBe("replay: 3 tools · 5 jars changed");
  });

  it("reads the v2 connector from the diff and the replay: one renamed tool, 1 call, 5 broken, 4 unchanged", () => {
    render(<CountsPair counts={countsOf(replays.v2)} replayed />);

    expect(document.querySelector(".counts-pair__connector")?.textContent).toBe(
      "The schema diff saw one renamed tool (cancel_booking → booking_cancel); 1 recorded call used it. 5 calls came back different — 4 in tools whose inputs never changed.",
    );
  });

  it("reads the v2.1 connector with its own numbers: 1 call used it, 2 broken, 1 in unchanged tools", () => {
    render(<CountsPair counts={countsOf(replays["v2.1"])} replayed />);

    expect(halfText(".counts-pair__schema")).toBe(
      "input-schema diff: 1 of 6 tools changed",
    );
    expect(document.querySelector(".counts-pair__connector")?.textContent).toBe(
      "The schema diff saw one renamed tool (cancel_booking → booking_cancel); 1 recorded call used it. 2 calls came back different — 1 in tools whose inputs never changed.",
    );
    expect(halfText(".counts-pair__replay")).toBe("replay: 2 tools · 2 jars changed");
  });

  it("names removed and added tools separately when the diff does not pair them as one rename", () => {
    const counts: CountsPairViewModel = {
      ...countsOf(replays.v2),
      schemaChanged: 2,
      renamed: null,
      removedToolNames: ["cancel_booking", "get_room"],
      addedToolNames: ["booking_cancel"],
    };
    expect(connectorText(counts)).toMatch(/^The schema diff saw 3 changed tools: removed cancel_booking, get_room, added booking_cancel;/);
  });

  it("puts the schema half in --muted and the replay half in --after (6, colour rule)", () => {
    const { container } = render(<CountsPair counts={countsOf(replays.v2)} replayed />);

    const schema = container.querySelector<HTMLElement>(".counts-pair__schema");
    const replay = container.querySelector<HTMLElement>(".counts-pair__replay");
    expect(schema?.style.color).toBe("var(--muted)");
    expect(replay?.style.color).toBe("var(--after)");
    expect(schema?.textContent).toBe("input-schema diff: 1 of 6 tools changed");
    expect(replay?.textContent).toBe("replay: 3 tools · 5 jars changed");
  });

  it("uses the singular forms for one tool and one jar (6.10)", () => {
    const single = singleJarResult(replays.v2);
    render(<CountsPair counts={countsOf(single)} replayed />);

    expect(halfText(".counts-pair__replay")).toBe("replay: 1 tool · 1 jar changed");
    expect(halfText(".counts-pair__schema")).toBe(
      "input-schema diff: 1 of 6 tools changed",
    );
  });

  it("shows no figures while the Version has not been replayed (6.8)", () => {
    const { container } = render(<CountsPair counts={countsOf(null)} replayed={false} />);

    expect(container.querySelector(".counts-pair__schema .counts-pair__value")?.textContent).toBe("");
    expect(container.querySelector(".counts-pair__replay .counts-pair__value")?.textContent).toBe("");
    expect(container.querySelector(".counts-pair__connector")?.textContent).toBe("");
    expect(viewModelOf("v2", null).replayed).toBe(false);
  });
});

describe("CountsPair schemaDiffError", () => {
  it("shows the unavailable schema diff and still shows the replay figure (6.9)", () => {
    const counts = countsOf(replays.v2, "baseline tools/list failed");
    render(<CountsPair counts={counts} replayed />);

    expect(halfText(".counts-pair__schema")).toBe("input-schema diff: unavailable — baseline tools/list failed");
    expect(halfText(".counts-pair__schema")).not.toMatch(/of 6 tools changed/);
    expect(halfText(".counts-pair__replay")).toBe("replay: 3 tools · 5 jars changed");
  });
});

describe("CountsPair reserved space (design pass, item 3)", () => {
  it("renders the strip before a replay, with its values and connector empty and in place", () => {
    const { container } = render(<CountsPair counts={countsOf(null)} replayed={false} />);

    expect(container.querySelector(".counts-pair")).not.toBeNull();
    expect(container.querySelector(".counts-pair__connector")).not.toBeNull();
  });

  it("hides the connector until the Reveal has ended and shows no schema detail line (design pass, item 4; QA round 3, item 2)", () => {
    const { container, rerender } = render(
      <CountsPair counts={countsOf(replays.v2)} replayed revealed={false} countUp={false} />,
    );

    expect(container.querySelector(".counts-pair__added")).toBeNull();
    expect(container.querySelector(".counts-pair__connector")?.className).toContain("counts-pair__connector--hidden");

    rerender(<CountsPair counts={countsOf(replays.v2)} replayed revealed countUp={false} />);

    expect(container.querySelector(".counts-pair__connector")?.className).not.toContain("--hidden");
  });
});
