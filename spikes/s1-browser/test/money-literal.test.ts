import { describe, expect, it } from "vitest";
import { fieldDiff } from "../src/replay";

// Decision D-425 probe (evidence/spikes/README.md): a TypeScript server can put `425.00` on the wire honestly, because a
// JSON number literal may carry trailing zeros. Parsing gives the number 425, so the v1 → v2 pair stays a numeric
// rename ×100 (425 → 42500), not a TYPE change; the jar keeps the raw text for display.
const money = (n: number) => n.toFixed(2);
const v1Text = `{"room_id":"r-04","nights":2,"total":${money(212.5 * 2)},"currency":"USD"}`;
const v2Text = `{"room_id":"r-04","nights":2,"total_cents":${Math.round(212.5 * 2 * 100)},"currency":"USD"}`;

describe("D-425: two-decimal money literals", () => {
  it("emits 425.00 as valid JSON that parses to the number 425", () => {
    expect(v1Text).toContain('"total":425.00');
    expect(JSON.parse(v1Text).total).toBe(425);
    expect(typeof JSON.parse(v1Text).total).toBe("number");
  });
  it("keeps the v1 → v2 pair numeric on both sides (rename ×100, not TYPE)", () => {
    const d = fieldDiff(JSON.parse(v1Text), JSON.parse(v2Text));
    expect(d).toEqual({ removed: ["/total"], added: ["/total_cents"], changed: [] });
    expect(JSON.parse(v2Text).total_cents / JSON.parse(v1Text).total).toBe(100);
  });
  it("JSON.stringify alone would drop the zeros (why a money-aware serialiser is needed)", () => {
    expect(JSON.stringify({ total: 425.0 })).toBe('{"total":425}');
  });
});
