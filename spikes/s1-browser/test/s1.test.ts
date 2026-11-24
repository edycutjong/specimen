import { describe, expect, it } from "vitest";
import { fieldDiff } from "../src/replay";
import { runS1 } from "../src/s1";

describe("spike S1 (node side; the browser side is `npm run spike:s1`)", () => {
  it("passes every check over the in-memory MCP transport", async () => {
    const report = await runS1();
    for (const c of report.checks) expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
    expect(report.status).toBe("PASS");
  });

  it("reports removed, added and changed pointers", () => {
    expect(fieldDiff({ a: 1, b: { c: 2 } }, { b: { c: 3 }, d: 4 })).toEqual({
      removed: ["/a"],
      added: ["/d"],
      changed: [{ path: "/b/c", before: 2, after: 3 }],
    });
  });
});
