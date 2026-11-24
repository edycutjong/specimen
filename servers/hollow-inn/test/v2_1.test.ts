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

  it("tool list is book, booking_cancel, get_room, list_bookings, quote, search_rooms", async () => {
    const { client } = await open();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["book", "booking_cancel", "get_room", "list_bookings", "quote", "search_rooms"]);
  });

  it("search_rooms without limit returns 5 rooms", async () => {
    const { call } = await open();
    const r = await call("search_rooms", { check_in: "2026-12-04", nights: 2, guests: 3 });
    expect(r.json.rooms).toHaveLength(5);
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
  booking_cancel: { type: "object", properties: { booking_id: { type: "string" } }, required: ["booking_id"], $schema: SCHEMA_DRAFT },
};

const BOOK_TEXT =
  '{"booking_id":"BK-0001","room_id":"r-01","check_in":"2026-12-11","nights":1,"guest":"E. Lavenza","status":"confirmed","created_at":"2026-11-26T09:00:00.000Z"}';

const bookingFlow = async (c: Conn) => [
  await run(c, "book", { room_id: "r-01", check_in: "2026-12-11", nights: 1, guest: "E. Lavenza" }),
  await run(c, "list_bookings"),
  await run(c, "booking_cancel", { booking_id: "BK-0001" }),
  await run(c, "booking_cancel", { booking_id: "BK-0001" }),
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
  it("lists the six v2 tools, with the same inputSchema for each", async () => {
    const { base, subj } = await pair();
    const names = (await base.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["book", "booking_cancel", "get_room", "list_bookings", "quote", "search_rooms"]);
    expect(await toolSchemas(base)).toEqual(EXPECTED_SCHEMAS);
    expect(await toolSchemas(subj)).toEqual(await toolSchemas(base));
  });

  it("search_rooms without limit returns the default 5 rooms, on both sides", async () => {
    const { base, subj } = await pair();
    const b = await base.call("search_rooms", { check_in: "2026-12-04", nights: 2, guests: 3 });
    expect(b.json.rooms.map((x: { id: string }) => x.id)).toEqual(["r-02", "r-03", "r-04", "r-06", "r-07"]);
    expect(await run(subj, "search_rooms", { check_in: "2026-12-04", nights: 2, guests: 3 })).toEqual(
      await run(base, "search_rooms", { check_in: "2026-12-04", nights: 2, guests: 3 }),
    );
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
    const flow = await bookingFlow(base);
    expect(flow[0]).toEqual({ isError: false, text: BOOK_TEXT });
    expect(flow[1]).toEqual({ isError: false, text: `{"bookings":[${BOOK_TEXT}]}` });
    expect(flow[2]).toEqual({ isError: false, text: '{"booking_id":"BK-0001","status":"cancelled"}' });
    expect(flow[3]).toEqual({ isError: true, text: '{"error":"BK-0001 is already cancelled"}' });
    expect(await bookingFlow(subj)).toEqual(flow);
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

  it("search_rooms returns identical text on both sides for any guests, nights, date and optional limit", async () => {
    const { base, subj } = await pair();
    const args = fc.record({
      check_in: isoDate,
      nights: fc.integer({ min: 1, max: 30 }),
      guests: fc.integer({ min: 1, max: 8 }),
      limit: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
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
      fc.integer({ min: 1, max: 4 }).map((n) => ({ tool: "booking_cancel", args: { booking_id: `BK-${String(n).padStart(4, "0")}` } })),
      fc.constant({ tool: "list_bookings", args: {} as Record<string, unknown> }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 8 }), async (steps) => {
        const p = await pair(false);
        try {
          for (const s of steps) {
            expect(await run(p.subj, s.tool, s.args)).toEqual(await run(p.base, s.tool, s.args));
          }
        } finally {
          await p.close();
        }
      }),
      { numRuns: 30, seed: SEED },
    );
  });
});
