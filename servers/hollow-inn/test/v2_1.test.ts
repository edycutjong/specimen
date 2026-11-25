// hollow-inn v2.1: the quote regression fix. The bug-condition tests check that v2.1's quote response has both total
// (dollars, two-decimal literal) and total_cents (integer cents). The v2 suite covers v2's behaviour and is not changed here.
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { connect } from "./helpers.js";
import { Money, ROOMS, toJsonText } from "../src/index.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
const open = async () => { const c = await connect("v2.1"); close = c.close; return c; };

const literalTotal = /"total":(-?\d+\.\d{2})[,}]/;
const nightlyCents = (id: string) => Math.round((ROOMS.find((r) => r.id === id)?.nightly ?? NaN) * 100);

describe("bug condition: quote returns /total and /total_cents (v2.1)", () => {
  it("SPC-0002: r-04 × 2 is the exact recorded text", async () => {
    const { call } = await open();
    const r = await call("quote", { room_id: "r-04", nights: 2 });
    expect(r.text).toBe('{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"total_cents":42500,"currency":"USD"}');
  });

  it("SPC-0006 and SPC-0007: r-01 × 1 and r-02 × 1 return total 98.00 and 142.00", async () => {
    const { call } = await open();
    const a = await call("quote", { room_id: "r-01", nights: 1 });
    expect(a.text).toMatch(literalTotal);
    expect(a.text.match(literalTotal)?.[1]).toBe("98.00");
    expect(a.json.total_cents).toBe(9800);
    const b = await call("quote", { room_id: "r-02", nights: 1 });
    expect(b.text.match(literalTotal)?.[1]).toBe("142.00");
    expect(b.json.total_cents).toBe(14200);
  });

  it("property: every room × nights 1..30 has a two-decimal total and total_cents = round(total × 100)", async () => {
    const { call } = await open();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ROOMS.map((r) => r.id)),
        fc.integer({ min: 1, max: 30 }),
        async (room_id, nights) => {
          const r = await call("quote", { room_id, nights });
          const m = r.text.match(literalTotal);
          expect(m, r.text).not.toBeNull();
          expect(Number.isInteger(r.json.total_cents)).toBe(true);
          expect(r.json.total_cents).toBe(nightlyCents(room_id) * nights);
          expect(r.json.total_cents).toBe(Math.round(Number(m![1]) * 100));
        },
      ),
      { numRuns: 100, seed: 2101 },
    );
  });
});

describe("v2.1 unit tests", () => {
  it("quote r-01 × 1 and r-02 × 1 return total 98.00 and 142.00 with total_cents 9800 and 14200", async () => {
    const { call } = await open();
    const a = await call("quote", { room_id: "r-01", nights: 1 });
    expect(a.text).toContain('"total":98.00,');
    expect(a.json.total_cents).toBe(9800);
    const b = await call("quote", { room_id: "r-02", nights: 1 });
    expect(b.text).toContain('"total":142.00,');
    expect(b.json.total_cents).toBe(14200);
  });

  it("quote for unknown room r-99 is an error with unknown room r-99", async () => {
    const { call } = await open();
    const r = await call("quote", { room_id: "r-99", nights: 1 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("unknown room r-99");
  });

  it("tool list is book, cancel_booking, get_room, list_bookings, quote, search_rooms", async () => {
    const { client } = await open();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["book", "cancel_booking", "get_room", "list_bookings", "quote", "search_rooms"]);
  });

  it("serialiser writes a Money value as its two-decimal literal", () => {
    expect(toJsonText({ total: new Money(42500) })).toBe('{"total":425.00}');
  });
});

// ---- Preservation (task 2): everything except the quote shape stays as in v2. ----
// Observed on unfixed v2 (exact values below were read from a live run). Until v2.1 is registered, BASELINE and
// SUBJECT are both "v2", so these comparisons pass on unfixed code. Task 3.6 changes SUBJECT to "v2.1" and keeps
// BASELINE as "v2"; the comparisons then check v2.1 against v2 with no other edits.
type Conn = Awaited<ReturnType<typeof connect>>;
const BASELINE: Parameters<typeof connect>[0] = "v2";
const SUBJECT: Parameters<typeof connect>[0] = "v2.1";

const opened: { close: () => Promise<void> }[] = [];
afterEach(async () => { while (opened.length) await opened.pop()!.close(); });

const pair = async (track = true) => {
  const base = await connect(BASELINE);
  const subj = await connect(SUBJECT);
  const p = { base, subj, close: async () => { await base.close(); await subj.close(); } };
  if (track) opened.push(p);
  return p;
};

// Like call(), but keeps protocol errors that the SDK throws (for example, nights out of range) so both sides compare.
const run = async (c: Conn, name: string, args: Record<string, unknown> = {}) => {
  try {
    const r = (await c.client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: r.isError === true, text: r.content[0]?.text ?? "" };
  } catch (e) {
    return { thrown: (e as Error).message };
  }
};

// Returns the text of a run() result. A thrown protocol error has no text, so this throws and the test fails.
const textOf = (r: { text?: string }): string => {
  if (typeof r.text !== "string") throw new Error(`expected a text result, got ${JSON.stringify(r)}`);
  return r.text;
};

const toolSchemas = async (c: Conn) =>
  Object.fromEntries((await c.client.listTools()).tools.map((t) => [t.name, t.inputSchema]));

const SCHEMA_DRAFT = "http://json-schema.org/draft-07/schema#";
const EXPECTED_SCHEMAS: Record<string, unknown> = {
  search_rooms: {
    type: "object",
    properties: {
      check_in: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      nights: { type: "integer", minimum: 1, maximum: 30 },
      guests: { type: "integer", minimum: 1, maximum: 8 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["check_in", "nights", "guests"],
    $schema: SCHEMA_DRAFT,
  },
  get_room: { type: "object", properties: { id: { type: "string" } }, required: ["id"], $schema: SCHEMA_DRAFT },
  quote: {
    type: "object",
    properties: { room_id: { type: "string" }, nights: { type: "integer", minimum: 1, maximum: 30 } },
    required: ["room_id", "nights"],
    $schema: SCHEMA_DRAFT,
  },
  book: {
    type: "object",
    properties: {
      room_id: { type: "string" },
      check_in: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      nights: { type: "integer", minimum: 1, maximum: 30 },
      guest: { type: "string", minLength: 1 },
    },
    required: ["room_id", "check_in", "nights", "guest"],
    $schema: SCHEMA_DRAFT,
  },
  list_bookings: { type: "object", properties: {}, $schema: SCHEMA_DRAFT },
  cancel_booking: { type: "object", properties: { booking_id: { type: "string" } }, required: ["booking_id"], $schema: SCHEMA_DRAFT },
};

const BOOK_TEXT =
  '{"booking_id":"BK-0001","room_id":"r-01","check_in":"2026-12-11","nights":1,"guest":"E. Lavenza","status":"confirmed","created_at":"2026-11-26T09:00:00.000Z"}';

const bookingFlow = async (c: Conn, cancelName: string) => [
  await run(c, "book", { room_id: "r-01", check_in: "2026-12-11", nights: 1, guest: "E. Lavenza" }),
  await run(c, "list_bookings"),
  await run(c, cancelName, { booking_id: "BK-0001" }),
  await run(c, cancelName, { booking_id: "BK-0001" }),
];

const withoutTotal = (json: Record<string, unknown>) => {
  const { total: _total, ...rest } = json;
  return rest;
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = fc
  .tuple(fc.integer({ min: 2026, max: 2027 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}-${pad(m)}-${pad(d)}`);
const roomIds = ROOMS.map((r) => r.id);
const SEED = 2102;

describe("preservation: observed on unfixed v2", () => {
  it("lists the six tools: v2.1 cancel_booking schema equals v1's, the other five equal v2's", async () => {
    const { base, subj } = await pair();
    const v1 = await connect("v1");
    try {
      const subjNames = (await subj.client.listTools()).tools.map((t) => t.name).sort();
      expect(subjNames).toEqual(["book", "cancel_booking", "get_room", "list_bookings", "quote", "search_rooms"]);
      const baseNames = (await base.client.listTools()).tools.map((t) => t.name).sort();
      expect(baseNames).toEqual(["book", "booking_cancel", "get_room", "list_bookings", "quote", "search_rooms"]);

      const v1Schemas = await toolSchemas(v1);
      const baseSchemas = await toolSchemas(base);
      const subjSchemas = await toolSchemas(subj);
      expect(v1Schemas.cancel_booking).toEqual(EXPECTED_SCHEMAS.cancel_booking);
      expect(subjSchemas.cancel_booking).toEqual(v1Schemas.cancel_booking);
      expect(baseSchemas.booking_cancel).toEqual(EXPECTED_SCHEMAS.cancel_booking);
      for (const name of ["book", "get_room", "list_bookings", "quote", "search_rooms"]) {
        expect(subjSchemas[name], name).toEqual(EXPECTED_SCHEMAS[name]);
        expect(subjSchemas[name], name).toEqual(baseSchemas[name]);
      }
    } finally {
      await v1.close();
    }
  });

  it("search_rooms input schema is the same on both sides, and the limit is optional", async () => {
    const { base, subj } = await pair();
    const bs = (await toolSchemas(base)).search_rooms;
    expect(bs).toEqual(EXPECTED_SCHEMAS.search_rooms);
    expect((await toolSchemas(subj)).search_rooms).toEqual(bs);
  });

  it("get_room r-04 has the observed text, and an unknown room is an error", async () => {
    const { base, subj } = await pair();
    expect((await run(base, "get_room", { id: "r-04" })).text).toBe(
      '{"id":"r-04","name":"Hearth Room","beds":2,"max_guests":4,"fireplace":true,"nightly":212.50}',
    );
    const missing = await run(base, "get_room", { id: "r-99" });
    expect(missing).toEqual({ isError: true, text: '{"error":"unknown room r-99"}' });
    expect(await run(subj, "get_room", { id: "r-99" })).toEqual(missing);
  });

  it("book, list_bookings and booking_cancel give the observed text, first booking BK-0001", async () => {
    const { base, subj } = await pair();
    const flow = await bookingFlow(base, "booking_cancel");
    expect(flow[0]).toEqual({ isError: false, text: BOOK_TEXT });
    expect(flow[1]).toEqual({ isError: false, text: `{"bookings":[${BOOK_TEXT}]}` });
    expect(flow[2]).toEqual({ isError: false, text: '{"booking_id":"BK-0001","status":"cancelled"}' });
    expect(flow[3]).toEqual({ isError: true, text: '{"error":"BK-0001 is already cancelled"}' });
    expect(await bookingFlow(subj, "cancel_booking")).toEqual(flow);
  });

  it("quote for unknown room r-99 is isError true with the same error text", async () => {
    const { base, subj } = await pair();
    const b = await run(base, "quote", { room_id: "r-99", nights: 1 });
    expect(b).toEqual({ isError: true, text: '{"error":"unknown room r-99"}' });
    expect(await run(subj, "quote", { room_id: "r-99", nights: 1 })).toEqual(b);
  });

  it("quote nightly is a two-decimal literal for every room, and currency is USD", async () => {
    const { base, subj } = await pair();
    for (const id of roomIds) {
      const b = await run(base, "quote", { room_id: id, nights: 1 });
      expect(b.text, id).toMatch(/"nightly":\d+\.\d{2},/);
      expect(b.text, id).toContain('"currency":"USD"');
      const s = await run(subj, "quote", { room_id: id, nights: 1 });
      expect(textOf(s).match(/"nightly":(\d+\.\d{2}),/)?.[1], id).toBe(textOf(b).match(/"nightly":(\d+\.\d{2}),/)?.[1]);
    }
  });

  it("quote with nights 31 is rejected the same way on both sides", async () => {
    const { base, subj } = await pair();
    const b = await run(base, "quote", { room_id: "r-04", nights: 31 });
    expect("thrown" in b || b.isError === true).toBe(true);
    expect(await run(subj, "quote", { room_id: "r-04", nights: 31 })).toEqual(b);
  });
});

describe("preservation properties: subject (SUBJECT) matches baseline (BASELINE) outside the quote total", () => {
  it("quote: for any room and nights 1..30, the response without total equals the baseline, and total_cents matches", async () => {
    const { base, subj } = await pair();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...roomIds), fc.integer({ min: 1, max: 30 }), async (room_id, nights) => {
        const b = await run(base, "quote", { room_id, nights });
        const s = await run(subj, "quote", { room_id, nights });
        expect(b.isError).toBe(false);
        expect(s.isError).toBe(false);
        const bj = JSON.parse(textOf(b));
        const sj = JSON.parse(textOf(s));
        expect(withoutTotal(sj)).toEqual(withoutTotal(bj));
        expect(sj.currency).toBe("USD");
        expect(sj.total_cents).toBe(bj.total_cents);
      }),
      { numRuns: 100, seed: SEED },
    );
  });

  it("quote and get_room errors for unknown ids are identical on both sides", async () => {
    const { base, subj } = await pair();
    const unknownId = fc.string({ minLength: 1, maxLength: 6 }).filter((id) => !roomIds.includes(id));
    await fc.assert(
      fc.asyncProperty(unknownId, async (id) => {
        const q = await run(base, "quote", { room_id: id, nights: 1 });
        expect(q.isError).toBe(true);
        expect(await run(subj, "quote", { room_id: id, nights: 1 })).toEqual(q);
        const g = await run(base, "get_room", { id });
        expect(g.isError).toBe(true);
        expect(await run(subj, "get_room", { id })).toEqual(g);
      }),
      { numRuns: 50, seed: SEED },
    );
  });

  it("get_room returns identical text on both sides for every room", async () => {
    const { base, subj } = await pair();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...roomIds), async (id) => {
        expect(await run(subj, "get_room", { id })).toEqual(await run(base, "get_room", { id }));
      }),
      { numRuns: 50, seed: SEED },
    );
  });

  it("search_rooms returns identical text on both sides for any guests, nights, date and explicit limit", async () => {
    const { base, subj } = await pair();
    const args = fc.record({
      check_in: isoDate,
      nights: fc.integer({ min: 1, max: 30 }),
      guests: fc.integer({ min: 1, max: 8 }),
      limit: fc.integer({ min: 1, max: 50 }),
    });
    await fc.assert(
      fc.asyncProperty(args, async (a) => {
        expect(await run(subj, "search_rooms", a)).toEqual(await run(base, "search_rooms", a));
      }),
      { numRuns: 100, seed: SEED },
    );
  });

  it("book, list_bookings and booking_cancel match on both sides for any sequence of calls", async () => {
    const bookArb = fc.record({
      room_id: fc.constantFrom(...roomIds),
      check_in: isoDate,
      nights: fc.integer({ min: 1, max: 30 }),
      guest: fc.string({ minLength: 1, maxLength: 12 }),
    });
    const step = fc.oneof(
      bookArb.map((a) => ({ tool: "book", args: a as Record<string, unknown> })),
      fc.integer({ min: 1, max: 4 }).map((n) => ({ tool: "cancel", args: { booking_id: `BK-${String(n).padStart(4, "0")}` } })),
      fc.constant({ tool: "list_bookings", args: {} as Record<string, unknown> }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 8 }), async (steps) => {
        const p = await pair(false);
        try {
          for (const s of steps) {
            const baseName = s.tool === "cancel" ? "booking_cancel" : s.tool;
            const subjName = s.tool === "cancel" ? "cancel_booking" : s.tool;
            expect(await run(p.subj, subjName, s.args)).toEqual(await run(p.base, baseName, s.args));
          }
        } finally {
          await p.close();
        }
      }),
      { numRuns: 30, seed: SEED },
    );
  });
});

// ---- Preservation (task 2, search_rooms): an explicit limit, and no-limit calls with 5 or fewer matches, match v2. ----
// Observed on unfixed v2.1: SPC-0001 input (limit 50) returns 7 rooms and SPC-0005 input (limit 3) returns 3 rooms, both
// equal to v2 and v1. With no limit, guests 8 matches no room (0 rooms), and guests 4 to 8 match at most 3 rooms. v2.1
// equals v2 on all of them.
const searchThree = async (args: Record<string, unknown>) => {
  const { base, subj, close } = await pair(false);
  const v1 = await connect("v1");
  try {
    return { subj: await run(subj, "search_rooms", args), base: await run(base, "search_rooms", args), v1: await run(v1, "search_rooms", args) };
  } finally {
    await close();
    await v1.close();
  }
};

describe("preservation (task 2): search_rooms with an explicit limit, and few-match calls", () => {
  it("SPC-0001 input (limit 50) returns 7 rooms, identical on v2.1, v2 and v1", async () => {
    const r = await searchThree({ check_in: "2026-12-04", nights: 2, guests: 3, limit: 50 });
    expect(r.subj).toEqual(r.base);
    expect(textOf(r.subj)).toBe(textOf(r.v1));
    expect(JSON.parse(textOf(r.subj)).rooms).toHaveLength(7);
  });

  it("SPC-0005 input (limit 3) returns 3 rooms, identical on v2.1, v2 and v1", async () => {
    const r = await searchThree({ check_in: "2026-12-11", nights: 1, guests: 2, limit: 3 });
    expect(r.subj).toEqual(r.base);
    expect(textOf(r.subj)).toBe(textOf(r.v1));
    expect(JSON.parse(textOf(r.subj)).rooms).toHaveLength(3);
  });

  it("no limit with guests 8 (no matching room) returns 0 rooms, identical on v2.1 and v2", async () => {
    const r = await searchThree({ check_in: "2026-12-04", nights: 2, guests: 8 });
    expect(r.subj).toEqual(r.base);
    expect(JSON.parse(textOf(r.subj)).rooms).toHaveLength(0);
  });

  it("property: for any explicit limit 1..50, v2.1 text equals v2 text", async () => {
    const { base, subj, close } = await pair(false);
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            check_in: isoDate,
            nights: fc.integer({ min: 1, max: 30 }),
            guests: fc.integer({ min: 1, max: 8 }),
            limit: fc.integer({ min: 1, max: 50 }),
          }),
          async (a) => {
            expect(await run(subj, "search_rooms", a)).toEqual(await run(base, "search_rooms", a));
          },
        ),
        { numRuns: 100, seed: SEED },
      );
    } finally {
      await close();
    }
  });

  it("property: with no limit and 5 or fewer matching rooms (guests 4 to 8), v2.1 text equals v2 text", async () => {
    const { base, subj, close } = await pair(false);
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            check_in: isoDate,
            nights: fc.integer({ min: 1, max: 30 }),
            guests: fc.integer({ min: 4, max: 8 }),
          }),
          async (a) => {
            expect(ROOMS.filter((r) => r.max_guests >= a.guests).length).toBeLessThanOrEqual(5);
            expect(await run(subj, "search_rooms", a)).toEqual(await run(base, "search_rooms", a));
          },
        ),
        { numRuns: 100, seed: SEED },
      );
    } finally {
      await close();
    }
  });

  it("v2.1 lists the six tools, and the search_rooms limit is optional, integer, min 1, max 50", async () => {
    const { client } = await open();
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["book", "cancel_booking", "get_room", "list_bookings", "quote", "search_rooms"]);
    const search = tools.find((t) => t.name === "search_rooms");
    expect(search?.inputSchema.required).toEqual(["check_in", "nights", "guests"]);
    expect(search?.inputSchema.properties?.limit).toEqual({ type: "integer", minimum: 1, maximum: 50 });
  });
});

// ---- Bug condition (task 1, search_rooms default limit): with no `limit`, v2.1 must match v1's default of 20. ----
// These tests are expected to FAIL on the unfixed v2_1.ts (it uses `limit ?? 5`). See .kiro/specs/search-rooms-rooms-rooms-r-08-rooms-r-09.
describe("bug condition: search_rooms without limit uses the v1 default of 20 (v2.1)", () => {
  it("SPC-0010 input with no limit returns r-02, r-03, r-04, r-06, r-07, r-08, r-09", async () => {
    const { call } = await open();
    const r = await call("search_rooms", { check_in: "2026-12-04", nights: 2, guests: 3 });
    expect(r.json.rooms.map((x: { id: string }) => x.id)).toEqual(["r-02", "r-03", "r-04", "r-06", "r-07", "r-08", "r-09"]);
  });

  it("the search_rooms description says default 20", async () => {
    const { client } = await open();
    const tool = (await client.listTools()).tools.find((t) => t.name === "search_rooms");
    expect(tool?.description).toContain("default 20");
  });

  it("property: with no limit, v2.1 text equals v1 text, and the room count is min(20, matching)", async () => {
    const v1 = await connect("v1");
    const v21 = await connect("v2.1");
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            check_in: isoDate,
            nights: fc.integer({ min: 1, max: 30 }),
            guests: fc.integer({ min: 1, max: 8 }),
          }),
          async (a) => {
            const expected = await v1.call("search_rooms", a);
            const actual = await v21.call("search_rooms", a);
            expect(actual.text).toBe(expected.text);
            const matching = ROOMS.filter((r) => r.max_guests >= a.guests).length;
            expect(actual.json.rooms).toHaveLength(Math.min(20, matching));
          },
        ),
        { numRuns: 100, seed: 2101 },
      );
    } finally {
      await v1.close();
      await v21.close();
    }
  });
});

// ---- Bug condition (task 1, cancel_booking): v2.1 must expose cancel_booking with the v1 behaviour. ----
// Expected to FAIL on the unfixed v2_1.ts, which registered the cancel tool as booking_cancel. Passes now (task 3.2).
// See .kiro/specs/cancel-booking-missing-tool/bugfix.md (SPC-0009).
describe("bug condition: cancel_booking is available on v2.1 (SPC-0009)", () => {
  it("tools/list contains cancel_booking and does not contain booking_cancel", async () => {
    const { client } = await open();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("cancel_booking");
    expect(names).not.toContain("booking_cancel");
  });

  it("SPC-0009: book BK-0001 then cancel_booking returns exactly {\"booking_id\":\"BK-0001\",\"status\":\"cancelled\"}", async () => {
    const { call } = await open();
    const booked = await call("book", { room_id: "r-01", check_in: "2026-12-11", nights: 1, guest: "Guest" });
    expect(booked.json.booking_id).toBe("BK-0001");
    const r = await call("cancel_booking", { booking_id: "BK-0001" });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('{"booking_id":"BK-0001","status":"cancelled"}');
  });

  it("a second cancel_booking on BK-0001 is isError with BK-0001 is already cancelled", async () => {
    const { call } = await open();
    await call("book", { room_id: "r-01", check_in: "2026-12-11", nights: 1, guest: "Guest" });
    await call("cancel_booking", { booking_id: "BK-0001" });
    const r = await call("cancel_booking", { booking_id: "BK-0001" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("BK-0001 is already cancelled");
  });

  it("cancel_booking BK-9999 is isError with unknown booking BK-9999", async () => {
    const { call } = await open();
    const r = await call("cancel_booking", { booking_id: "BK-9999" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("unknown booking BK-9999");
  });
});

// ---- Preservation (task 2, cancel): v2.1's cancel tool matches v1's cancel_booking apart from its name. ----
// v2.1 registers the cancel tool as cancel_booking, the same name, description, inputSchema and handler as v1.
// Unknown BK-9999 gives isError with {"error":"unknown booking BK-9999"}, and a second cancel of BK-0001 gives isError
// with {"error":"BK-0001 is already cancelled"}. v1 gives the same text for both.
const V21_CANCEL_NAME = "cancel_booking";

describe("preservation (task 2, cancel): v2.1 cancel tool matches v1 cancel_booking", () => {
  it("the cancel tool on v2.1 has the same description and inputSchema as v1 cancel_booking", async () => {
    const v1 = await connect("v1");
    const subj = await open();
    try {
      const v1Tool = (await v1.client.listTools()).tools.find((t) => t.name === "cancel_booking");
      const subjTool = (await subj.client.listTools()).tools.find((t) => t.name === V21_CANCEL_NAME);
      expect(v1Tool?.inputSchema).toEqual(EXPECTED_SCHEMAS.cancel_booking);
      expect(subjTool?.inputSchema).toEqual(v1Tool?.inputSchema);
      expect(subjTool?.description).toBe(v1Tool?.description);
    } finally {
      await v1.close();
    }
  });

  it("unknown id and double cancel give the same isError results on v2.1 as on v1", async () => {
    const v1 = await connect("v1");
    const subj = await open();
    try {
      const unknown = await run(v1, "cancel_booking", { booking_id: "BK-9999" });
      expect(unknown).toEqual({ isError: true, text: '{"error":"unknown booking BK-9999"}' });
      expect(await run(subj, V21_CANCEL_NAME, { booking_id: "BK-9999" })).toEqual(unknown);

      const book = { room_id: "r-01", check_in: "2026-12-11", nights: 1, guest: "E. Lavenza" };
      await run(v1, "book", book);
      await run(subj, "book", book);
      const first = await run(v1, "cancel_booking", { booking_id: "BK-0001" });
      expect(first).toEqual({ isError: false, text: '{"booking_id":"BK-0001","status":"cancelled"}' });
      expect(await run(subj, V21_CANCEL_NAME, { booking_id: "BK-0001" })).toEqual(first);

      const again = await run(v1, "cancel_booking", { booking_id: "BK-0001" });
      expect(again).toEqual({ isError: true, text: '{"error":"BK-0001 is already cancelled"}' });
      expect(await run(subj, V21_CANCEL_NAME, { booking_id: "BK-0001" })).toEqual(again);
    } finally {
      await v1.close();
    }
  });

  it("property: for any sequence of book, cancel and list_bookings calls, v2.1 equals v1 call by call", async () => {
    const bookArb = fc.record({
      room_id: fc.constantFrom(...roomIds),
      check_in: isoDate,
      nights: fc.integer({ min: 1, max: 30 }),
      guest: fc.string({ minLength: 1, maxLength: 12 }),
    });
    const cancelId = fc.oneof(
      fc.integer({ min: 1, max: 4 }).map((n) => `BK-${String(n).padStart(4, "0")}`),
      fc.string({ maxLength: 8 }),
    );
    const step = fc.oneof(
      bookArb.map((a) => ({ tool: "book", args: a as Record<string, unknown> })),
      cancelId.map((id) => ({ tool: "cancel", args: { booking_id: id } as Record<string, unknown> })),
      fc.constant({ tool: "list_bookings", args: {} as Record<string, unknown> }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 8 }), async (steps) => {
        const v1 = await connect("v1");
        const subj = await connect("v2.1");
        try {
          for (const s of steps) {
            const v1Name = s.tool === "cancel" ? "cancel_booking" : s.tool;
            const subjName = s.tool === "cancel" ? V21_CANCEL_NAME : s.tool;
            expect(await run(subj, subjName, s.args)).toEqual(await run(v1, v1Name, s.args));
          }
        } finally {
          await v1.close();
          await subj.close();
        }
      }),
      { numRuns: 30, seed: SEED },
    );
  });

  it("property: for any sequence of book, cancel_booking (BK-0001 to BK-0004) and list_bookings, v2.1 text equals v1 text call by call", async () => {
    const bookArb = fc.record({
      room_id: fc.constantFrom(...roomIds),
      check_in: isoDate,
      nights: fc.integer({ min: 1, max: 30 }),
      guest: fc.string({ minLength: 1, maxLength: 12 }),
    });
    const step = fc.oneof(
      bookArb.map((a) => ({ tool: "book", args: a as Record<string, unknown> })),
      fc.integer({ min: 1, max: 4 }).map((n) => ({ tool: "cancel_booking", args: { booking_id: `BK-${String(n).padStart(4, "0")}` } })),
      fc.constant({ tool: "list_bookings", args: {} as Record<string, unknown> }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 10 }), async (steps) => {
        const v1 = await connect("v1");
        const subj = await connect("v2.1");
        try {
          for (const s of steps) {
            expect(await run(subj, s.tool, s.args)).toEqual(await run(v1, s.tool, s.args));
          }
        } finally {
          await v1.close();
          await subj.close();
        }
      }),
      { numRuns: 30, seed: SEED },
    );
  });
});
