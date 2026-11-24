// hollow-inn v2 — a "cleanup" release. Three author-made changes, listed in CHANGES.md; its own suite (test/v2.test.ts)
// was updated with the refactor and passes, while calls the agents recorded against v1 break.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ROOMS, fail, findRoom, isBookedFor, newState, nextBookingId, nightly, ok, roomView, type InnOptions } from "./inn.js";

import { date, nights } from "./v1.js";

export function createV2(opts: InnOptions = {}): McpServer {
  const server = new McpServer({ name: "hollow-inn", version: "2.0.0" });
  const state = newState(opts);

  server.registerTool(
    "search_rooms",
    {
      description:
        "Find rooms free for a stay that sleep at least `guests`, in room order. Returns at most `limit` rooms (default 5).",
      inputSchema: { check_in: date, nights, guests: z.number().int().min(1).max(8), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ check_in, nights, guests, limit }) => {
      const rooms = ROOMS.filter((r) => r.max_guests >= guests && !isBookedFor(state, r.id, check_in, nights))
        .slice(0, limit ?? 5)
        .map(roomView);
      return ok({ check_in, nights, guests, rooms });
    },
  );

  server.registerTool(
    "get_room",
    { description: "One room's details.", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } },
    async ({ id }) => {
      const room = findRoom(id);
      return room ? ok(roomView(room)) : fail(`unknown room ${id}`);
    },
  );

  server.registerTool(
    "quote",
    {
      description: "Price a stay in USD: `total_cents` is the nightly rate times `nights`, in integer cents.",
      inputSchema: { room_id: z.string(), nights },
      annotations: { readOnlyHint: true },
    },
    async ({ room_id, nights }) => {
      const room = findRoom(room_id);
      if (!room) return fail(`unknown room ${room_id}`);
      return ok({ room_id, nights, nightly: nightly(room), total_cents: nightly(room).times(nights).cents, currency: "USD" });
    },
  );

  server.registerTool(
    "book",
    {
      description: "Book a room for a guest. Returns the booking with its id.",
      inputSchema: { room_id: z.string(), check_in: date, nights, guest: z.string().min(1) },
      annotations: { readOnlyHint: false },
    },
    async ({ room_id, check_in, nights, guest }) => {
      if (!findRoom(room_id)) return fail(`unknown room ${room_id}`);
      if (isBookedFor(state, room_id, check_in, nights)) return fail(`${room_id} is already booked for those nights`);
      const booking = {
        booking_id: nextBookingId(state),
        room_id,
        check_in,
        nights,
        guest,
        status: "confirmed" as const,
        created_at: state.now().toISOString(),
      };
      state.bookings.push(booking);
      return ok(booking);
    },
  );

  server.registerTool(
    "list_bookings",
    { description: "Every booking made on this server, in order.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ok({ bookings: state.bookings }),
  );

  server.registerTool(
    "booking_cancel",
    {
      description: "Cancel a booking by id.",
      inputSchema: { booking_id: z.string() },
      annotations: { readOnlyHint: false },
    },
    async ({ booking_id }) => {
      const b = state.bookings.find((x) => x.booking_id === booking_id);
      if (!b) return fail(`unknown booking ${booking_id}`);
      if (b.status === "cancelled") return fail(`${booking_id} is already cancelled`);
      b.status = "cancelled";
      return ok({ booking_id, status: b.status });
    },
  );

  return server;
}
