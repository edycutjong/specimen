// Round-06 agent-review fixes on the CLI side: a stale counter never repeats an accession id, a
// truncated spec slug cannot collide, and an error-result crack gets its own slug.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ERROR_RESULT_REASON, MISSING_TOOL_REASON } from "@specimen/core";
import { specSlug } from "../src/file.js";
import { CHILD_TIMEOUT, createWorkspace, fire, postPayload, prePayload, type Workspace } from "./support/capture.js";

let ws: Workspace;
beforeEach(() => {
  ws = createWorkspace();
});
afterEach(() => {
  ws.remove();
});

describe("accession ids with a stale counter", () => {
  it(
    "takes the id after the highest one in jars/, not after the counter",
    () => {
      // A real jar line first, renumbered to SPC-0007, then a counter that fell behind it.
      expect(fire(ws.root, "pre", prePayload(ws.root)).status).toBe(0);
      expect(fire(ws.root, "post", postPayload(ws.root)).status).toBe(0);
      const first = readFileSync(ws.jarFile(), "utf8");
      writeFileSync(join(ws.root, "jars", "older.jsonl"), first.replace('"id":"SPC-0001"', '"id":"SPC-0007"'));
      writeFileSync(ws.jarFile(), "");
      mkdirSync(join(ws.root, ".specimen"), { recursive: true });
      writeFileSync(join(ws.root, ".specimen", "counter"), "2\n");

      expect(fire(ws.root, "pre", prePayload(ws.root)).status).toBe(0);
      expect(fire(ws.root, "post", postPayload(ws.root)).status).toBe(0);

      const line = JSON.parse(readFileSync(ws.jarFile(), "utf8").split("\n")[0] ?? "") as { id: string };
      expect(line.id).toBe("SPC-0008");
      expect(readFileSync(join(ws.root, ".specimen", "counter"), "utf8")).toBe("8\n");
    },
    CHILD_TIMEOUT,
  );
});

describe("specSlug", () => {
  it("keeps every slug of 48 characters or fewer exactly as before", () => {
    expect(specSlug("quote", "rattled", ["/total", "/total_cents"])).toBe("quote-total-total-cents");
    expect(specSlug("cancel_booking", "cracked", [], MISSING_TOOL_REASON)).toBe("cancel-booking-missing-tool");
    expect(specSlug("search_rooms", "rattled", ["/rooms", "/rooms/r-08", "/rooms/r-09"])).toBe("search-rooms-rooms-rooms-r-08-rooms-r-09");
  });

  it("names an error-result crack apart from a missing tool", () => {
    expect(specSlug("book", "cracked", [], ERROR_RESULT_REASON)).toBe("book-returns-error");
  });

  it("gives two long signatures that share their first 48 characters different slugs, each at most 48", () => {
    const a = specSlug("search_rooms", "rattled", ["/rooms/r-01/amenities/fireplace", "/rooms/r-01/nightly"]);
    const b = specSlug("search_rooms", "rattled", ["/rooms/r-01/amenities/fireplace", "/rooms/r-01/view"]);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(48);
    expect(b.length).toBeLessThanOrEqual(48);
    expect(a).toMatch(/-[0-9a-f]{8}$/);
  });
});
