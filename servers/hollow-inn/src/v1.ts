// hollow-inn v1 — the baseline the agents were recorded against.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ROOMS, fail, findRoom, isBookedFor, newState, nextBookingId, nightly, ok, roomView, type InnOptions } from "./inn.js";

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const nights = z.number().int().min(1).max(30);

export function createV1(opts: InnOptions = {}): McpServer {
  const server = new McpServer({ name: "hollow-inn", version: "1.0.0" });
  const state = newState(opts);

  server.registerTool(
    "search_rooms",
    {
      description:
        "Find rooms free for a stay that sleep at least `guests`, in room order. Returns at most `limit` rooms (default 20).",
      inputSchema: { check_in: date, nights, guests: z.number().int().min(1).max(8), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ check_in, nights, guests, limit }) => {
      const rooms = ROOMS.filter((r) => r.max_guests >= guests && !isBookedFor(state, r.id, check_in, nights))
        .slice(0, limit ?? 20)
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
      description: "Price a stay in USD: `total` is the nightly rate times `nights`, in dollars.",
      inputSchema: { room_id: z.string(), nights },
      annotations: { readOnlyHint: true },
    },
    async ({ room_id, nights }) => {
      const room = findRoom(room_id);
      if (!room) return fail(`unknown room ${room_id}`);
      return ok({ room_id, nights, nightly: nightly(room), total: nightly(room).times(nights), currency: "USD" });
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
    "cancel_booking",
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
