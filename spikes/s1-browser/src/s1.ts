import { fieldDiff, runSession, type Call } from "./replay";

export type S1Report = {
  status: "PASS" | "FAIL";
  checks: { name: string; pass: boolean; detail: string }[];
  quoteDiff: ReturnType<typeof fieldDiff>;
};

const SESSION: Call[] = [
  { tool: "search_rooms", args: { guests: 2 } },
  { tool: "quote", args: { room_id: "R-101", nights: 2 } },
  { tool: "book", args: { room_id: "R-101", nights: 2 } },
  { tool: "list_bookings", args: {} },
];

export async function runS1(): Promise<S1Report> {
  const checks: S1Report["checks"] = [];
  const s1 = await runSession("v1", SESSION);
  const booked = s1[2]?.body as { booking_id?: string } | undefined;
  const listed = s1[3]?.body as { bookings?: { id: string }[] } | undefined;
  checks.push({
    name: "stateful: book then list_bookings returns the booking",
    pass: booked?.booking_id === "BK-0001" && listed?.bookings?.[0]?.id === "BK-0001",
    detail: `book → ${booked?.booking_id}; list_bookings → ${JSON.stringify(listed?.bookings?.map((b) => b.id))}`,
  });
  const fresh = await runSession("v1", [{ tool: "book", args: { room_id: "R-102", nights: 1 } }]);
  const freshId = (fresh[0]?.body as { booking_id?: string } | undefined)?.booking_id;
  checks.push({
    name: "second fresh session: first book is BK-0001 again",
    pass: freshId === "BK-0001",
    detail: `fresh session book → ${freshId}`,
  });
  const v2 = await runSession("v2", SESSION);
  const quoteDiff = fieldDiff(s1[1]?.body, v2[1]?.body);
  checks.push({
    name: "field diff v1 → v2 on quote",
    pass: quoteDiff.removed.includes("/total") && quoteDiff.added.includes("/total_cents"),
    detail: `removed ${JSON.stringify(quoteDiff.removed)} · added ${JSON.stringify(quoteDiff.added)} · v1 /total=${JSON.stringify((s1[1]?.body as Record<string, unknown>)?.total)} · v2 /total_cents=${JSON.stringify((v2[1]?.body as Record<string, unknown>)?.total_cents)}`,
  });
  const unchanged = [0, 2, 3].every((i) => JSON.stringify(s1[i]?.body) === JSON.stringify(v2[i]?.body));
  checks.push({ name: "other three calls identical v1 vs v2", pass: unchanged, detail: `identical=${unchanged}` });
  return { status: checks.every((c) => c.pass) ? "PASS" : "FAIL", checks, quoteDiff };
}
