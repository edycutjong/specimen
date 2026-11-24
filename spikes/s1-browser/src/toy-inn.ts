// Spike S1 toy server, written the way hollow-inn will be: no `node:` imports, data imported as a JSON module,
// one factory per version, all state in memory per server instance. NOT the product server (that lands on D2).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import rooms from "./rooms.json";

export type ToyVersion = "v1" | "v2";
export type ToyOptions = { moneyLiteral?: boolean };

type Room = { id: string; name: string; nightly: number; sleeps: number };
const ROOMS = rooms as Room[];

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export function createToyInn(version: ToyVersion, opts: ToyOptions = {}): McpServer {
  const server = new McpServer({ name: "toy-inn", version: version === "v1" ? "1.0.0" : "2.0.0" });
  const bookings: { id: string; room_id: string; nights: number }[] = [];

  server.registerTool(
    "search_rooms",
    { description: "List rooms that sleep at least `guests`", inputSchema: { guests: z.number().int().min(1) } },
    async ({ guests }) => json({ rooms: ROOMS.filter((r) => r.sleeps >= guests).map((r) => ({ id: r.id, name: r.name })) }),
  );

  server.registerTool(
    "quote",
    { description: "Price a stay", inputSchema: { room_id: z.string(), nights: z.number().int().min(1) } },
    async ({ room_id, nights }) => {
      const room = ROOMS.find((r) => r.id === room_id);
      if (!room) return { isError: true, content: [{ type: "text" as const, text: `unknown room ${room_id}` }] };
      const total = room.nightly * nights;
      // v2 is the planted break the product is about: the field is renamed and the unit becomes cents.
      if (version === "v1" && opts.moneyLiteral) {
        // D-425 probe: money as a two-decimal JSON number literal, written as text (JSON.stringify would print 425).
        const text = `{"room_id":${JSON.stringify(room_id)},"nights":${nights},"total":${total.toFixed(2)},"currency":"USD"}`;
        return { content: [{ type: "text" as const, text }] };
      }
      return version === "v1"
        ? json({ room_id, nights, total, currency: "USD" })
        : json({ room_id, nights, total_cents: Math.round(total * 100), currency: "USD" });
    },
  );

  server.registerTool(
    "book",
    { description: "Book a room", inputSchema: { room_id: z.string(), nights: z.number().int().min(1) } },
    async ({ room_id, nights }) => {
      const id = `BK-${String(bookings.length + 1).padStart(4, "0")}`;
      bookings.push({ id, room_id, nights });
      return json({ booking_id: id, room_id, nights });
    },
  );

  server.registerTool(
    "list_bookings",
    { description: "List bookings made in this server process", inputSchema: {} },
    async () => json({ bookings }),
  );

  return server;
}
