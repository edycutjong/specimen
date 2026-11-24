// v2's own suite, updated together with the refactor: it asserts the NEW behaviour, so it is green —
// while the calls agents recorded against v1 break (that gap is what specimen's replay shows).
import { afterEach, describe, expect, it } from "vitest";
import { connect } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
const open = async () => { const c = await connect("v2"); close = c.close; return c; };

describe("hollow-inn v2", () => {
  it("lists six tools; cancel_booking is now booking_cancel", async () => {
    const { client } = await open();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["book", "booking_cancel", "get_room", "list_bookings", "quote", "search_rooms"]);
  });

  it("search without a limit returns the new default of 5 rooms", async () => {
    const { call } = await open();
    const r = await call("search_rooms", { check_in: "2026-12-04", nights: 2, guests: 3 });
    expect(r.json.rooms.map((x: { id: string }) => x.id)).toEqual(["r-02", "r-03", "r-04", "r-06", "r-07"]);
  });

  it("an explicit limit is honoured", async () => {
    const { call } = await open();
    const r = await call("search_rooms", { check_in: "2026-12-11", nights: 1, guests: 2, limit: 3 });
    expect(r.json.rooms.map((x: { id: string }) => x.id)).toEqual(["r-01", "r-02", "r-03"]);
  });

  it("quote returns total_cents as an integer: r-04 × 2 nights = 42500", async () => {
    const { call } = await open();
    const r = await call("quote", { room_id: "r-04", nights: 2 });
    expect(r.text).toBe('{"room_id":"r-04","nights":2,"nightly":212.50,"total_cents":42500,"currency":"USD"}');
  });

  it("book, list_bookings and booking_cancel work end to end", async () => {
    const { call } = await open();
    const b = await call("book", { room_id: "r-01", check_in: "2026-12-11", nights: 1, guest: "E. Lavenza" });
    expect(b.json.booking_id).toBe("BK-0001");
    expect((await call("list_bookings")).json.bookings).toHaveLength(1);
    expect((await call("booking_cancel", { booking_id: "BK-0001" })).json.status).toBe("cancelled");
  });
});
