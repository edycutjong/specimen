// Shared by every hollow-inn version: the fixture, the per-server state and the result helpers.
// No `node:` imports here — this module is also bundled into the browser cabinet.
import roomsJson from "../rooms.json";
import { Money, toJsonText } from "./money.js";

export type Room = { id: string; name: string; beds: number; max_guests: number; fireplace: boolean; nightly: number };
export const ROOMS: readonly Room[] = roomsJson as Room[];

export type Booking = {
  booking_id: string;
  room_id: string;
  check_in: string;
  nights: number;
  guest: string;
  status: "confirmed" | "cancelled";
  created_at: string;
};

export type InnOptions = { now?: () => Date };

/** Everything mutable lives in one object created per server, so a fresh server always starts at BK-0001. */
export type InnState = { bookings: Booking[]; counter: number; now: () => Date };
export const newState = (opts: InnOptions = {}): InnState => ({ bookings: [], counter: 0, now: opts.now ?? (() => new Date()) });

export const nightly = (room: Room): Money => Money.fromDollars(room.nightly);
export const findRoom = (id: string): Room | undefined => ROOMS.find((r) => r.id === id);

export const roomView = (r: Room) => ({
  id: r.id,
  name: r.name,
  beds: r.beds,
  max_guests: r.max_guests,
  fireplace: r.fireplace,
  nightly: nightly(r),
});

const DAY = 86_400_000;
const dayIndex = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
/** True if [a, a+an) and [b, b+bn) share a night. */
export const overlaps = (a: string, an: number, b: string, bn: number) => {
  const s1 = dayIndex(a), s2 = dayIndex(b);
  return s1 < s2 + bn && s2 < s1 + an;
};
export const isBookedFor = (state: InnState, roomId: string, checkIn: string, nights: number) =>
  state.bookings.some((b) => b.status === "confirmed" && b.room_id === roomId && overlaps(b.check_in, b.nights, checkIn, nights));

export const nextBookingId = (state: InnState) => `BK-${String(++state.counter).padStart(4, "0")}`;

type Text = { type: "text"; text: string };
export const ok = (value: unknown): { content: Text[] } => ({ content: [{ type: "text", text: toJsonText(value) }] });
export const fail = (message: string): { isError: true; content: Text[] } => ({
  isError: true,
  content: [{ type: "text", text: toJsonText({ error: message }) }],
});
