import { afterEach, describe, expect, it } from "vitest";
import { connect } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
const open = async () => { const c = await connect("v1"); close = c.close; return c; };

describe("hollow-inn v1", () => {
  it("lists six tools with read-only hints on the four lookups", async () => {
    const { client } = await open();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["book", "cancel_booking", "get_room", "list_bookings", "quote", "search_rooms"]);
    const ro = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(ro).toEqual(["get_room", "list_bookings", "quote", "search_rooms"]);
  });

  it("search without a limit returns all 7 rooms that sleep 3 (default limit 20)", async () => {
    const { call } = await open();
    const r = await call("search_rooms", { check_in: "2026-12-04", nights: 2, guests: 3 });
    expect(r.json.rooms.map((x: { id: string }) => x.id)).toEqual(["r-02", "r-03", "r-04", "r-06", "r-07", "r-08", "r-09"]);
    expect(r.text).toContain('"nightly":212.50');
  });

  it("an explicit limit is honoured", async () => {
    const { call } = await open();
    const r = await call("search_rooms", { check_in: "2026-12-11", nights: 1, guests: 2, limit: 3 });
    expect(r.json.rooms.map((x: { id: string }) => x.id)).toEqual(["r-01", "r-02", "r-03"]);
  });

  it("quote writes total as a two-decimal dollar literal: r-04 × 2 nights = 425.00", async () => {
    const { call } = await open();
    const r = await call("quote", { room_id: "r-04", nights: 2 });
    expect(r.text).toBe('{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"currency":"USD"}');
    expect(r.json.total).toBe(425);
  });

  it("book numbers bookings per server process from BK-0001, list_bookings returns them in order", async () => {
    const a = await open();
    const b1 = await a.call("book", { room_id: "r-04", check_in: "2026-12-04", nights: 2, guest: "M. Shelley" });
    const b2 = await a.call("book", { room_id: "r-07", check_in: "2026-12-04", nights: 2, guest: "M. Shelley" });
    expect([b1.json.booking_id, b2.json.booking_id]).toEqual(["BK-0001", "BK-0002"]);
    expect(b1.json.created_at).toBe("2026-11-26T09:00:00.000Z");
    const list = await a.call("list_bookings");
    expect(list.json.bookings.map((b: { booking_id: string }) => b.booking_id)).toEqual(["BK-0001", "BK-0002"]);
    await a.close();
    const fresh = await open();
    const again = await fresh.call("book", { room_id: "r-04", check_in: "2026-12-04", nights: 2, guest: "M. Shelley" });
    expect(again.json.booking_id).toBe("BK-0001");
  });

  it("a booked room drops out of search for overlapping nights and cannot be double-booked", async () => {
    const { call } = await open();
    await call("book", { room_id: "r-04", check_in: "2026-12-04", nights: 2, guest: "M. Shelley" });
    const s = await call("search_rooms", { check_in: "2026-12-05", nights: 1, guests: 3 });
    expect(s.json.rooms.map((x: { id: string }) => x.id)).not.toContain("r-04");
    const after = await call("search_rooms", { check_in: "2026-12-06", nights: 1, guests: 3 });
    expect(after.json.rooms.map((x: { id: string }) => x.id)).toContain("r-04");
    const dup = await call("book", { room_id: "r-04", check_in: "2026-12-05", nights: 1, guest: "V. Frankenstein" });
    expect(dup.isError).toBe(true);
  });

  it("cancel_booking cancels once, then refuses", async () => {
    const { call } = await open();
    await call("book", { room_id: "r-01", check_in: "2026-12-11", nights: 1, guest: "E. Lavenza" });
    const c = await call("cancel_booking", { booking_id: "BK-0001" });
    expect(c.text).toBe('{"booking_id":"BK-0001","status":"cancelled"}');
    expect((await call("cancel_booking", { booking_id: "BK-0001" })).isError).toBe(true);
    expect((await call("cancel_booking", { booking_id: "BK-9999" })).isError).toBe(true);
  });

  it("unknown rooms are errors, not crashes", async () => {
    const { call } = await open();
    expect((await call("get_room", { id: "r-99" })).isError).toBe(true);
    expect((await call("quote", { room_id: "r-99", nights: 1 })).isError).toBe(true);
  });
});
