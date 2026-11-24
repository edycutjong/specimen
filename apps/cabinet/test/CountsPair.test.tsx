// @vitest-environment jsdom
/**
 * Requirements 6.1 to 6.10 for the CountsPair, rendered from view models built on real
 * runReplay results for v1, v2 and v2.1.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getBugfixSpecs, type CabinetReplayResult } from "../src/browser-replay.js";
import { CountsPair } from "../src/components/CountsPair.js";
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

    expect(screen.getByText("schema diff: 0 of 6 tools changed")).toBeTruthy();
    expect(screen.getByText("replay: 0 tools · 0 jars changed")).toBeTruthy();
    expect(container.querySelector(".counts-pair__added")).toBeNull();
  });

  it("shows v2 with the added tool name and the replay impact (6.2, 6.5)", () => {
    render(<CountsPair counts={countsOf(replays.v2)} replayed />);

    expect(screen.getByText("schema diff: 1 of 6 tools changed")).toBeTruthy();
    expect(screen.getByText("added booking_cancel")).toBeTruthy();
    expect(screen.getByText("replay: 3 tools · 5 jars changed")).toBeTruthy();
  });

  it("shows v2.1 with the added tool name and the remaining replay impact (6.6)", () => {
    render(<CountsPair counts={countsOf(replays["v2.1"])} replayed />);

    expect(screen.getByText("schema diff: 1 of 6 tools changed")).toBeTruthy();
    expect(screen.getByText("added booking_cancel")).toBeTruthy();
    expect(screen.getByText("replay: 2 tools · 2 jars changed")).toBeTruthy();
  });

  it("puts the schema half in --muted and the replay half in --after (6, colour rule)", () => {
    const { container } = render(<CountsPair counts={countsOf(replays.v2)} replayed />);

    const schema = container.querySelector<HTMLElement>(".counts-pair__schema");
    const replay = container.querySelector<HTMLElement>(".counts-pair__replay");
    expect(schema?.style.color).toBe("var(--muted)");
    expect(replay?.style.color).toBe("var(--after)");
    expect(schema?.textContent).toBe("schema diff: 1 of 6 tools changed");
    expect(replay?.textContent).toBe("replay: 3 tools · 5 jars changed");
  });

  it("uses the singular forms for one tool and one jar (6.10)", () => {
    const single = singleJarResult(replays.v2);
    render(<CountsPair counts={countsOf(single)} replayed />);

    expect(screen.getByText("replay: 1 tool · 1 jar changed")).toBeTruthy();
    expect(screen.getByText("schema diff: 1 of 6 tools changed")).toBeTruthy();
  });

  it("shows no figures while the Version has not been replayed (6.8)", () => {
    const { container } = render(<CountsPair counts={countsOf(null)} replayed={false} />);

    expect(container.textContent).toBe("");
    expect(viewModelOf("v2", null).replayed).toBe(false);
  });
});

describe("CountsPair schemaDiffError", () => {
  it("shows the unavailable schema diff and still shows the replay figure (6.9)", () => {
    const counts = countsOf(replays.v2, "baseline tools/list failed");
    render(<CountsPair counts={counts} replayed />);

    expect(screen.getByText("schema diff: unavailable — baseline tools/list failed")).toBeTruthy();
    expect(screen.queryByText(/of 6 tools changed/)).toBeNull();
    expect(screen.getByText("replay: 3 tools · 5 jars changed")).toBeTruthy();
  });
});
