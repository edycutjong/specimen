// A deterministic consumer written against hollow-inn v1's contract, the kind of client a jar stands in for:
// it books the cheapest quote and prints the charge. It is NOT an agent: it has no tool descriptions to read,
// so it does exactly what its v1-era code says. Run against each version with a fresh server:
//   npx tsx scripts/consumer.ts v1 v2 v2.1
// Every line it prints is the real output of the call; an exception is printed as the line, never hidden.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Text = { content?: { type: string; text?: string }[]; isError?: boolean };
const textOf = (r: unknown): string => ((r as Text).content ?? []).map((c) => c.text ?? "").join("");

/** The v1-era client code, step by step. Each step reports what this consumer would show its user. */
async function consume(client: Client): Promise<string[]> {
  const out: string[] = [];
  const step = async (label: string, run: () => Promise<string>): Promise<void> => {
    try {
      out.push(`${label}: ${await run()}`);
    } catch (error) {
      out.push(`${label}: THREW ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)}`);
    }
  };
  await step("rooms offered for 2026-12-24, 2 nights, 2 guests (no limit)", async () => {
    const body = JSON.parse(textOf(await client.callTool({ name: "search_rooms", arguments: { check_in: "2026-12-24", nights: 2, guests: 2 } })));
    return `${body.rooms.length} rooms (${body.rooms.map((room: { id: string }) => room.id).join(", ")})`;
  });
  let bookingId = "";
  await step("charge for r-04, 2 nights", async () => {
    const body = JSON.parse(textOf(await client.callTool({ name: "quote", arguments: { room_id: "r-04", nights: 2 } })));
    return `${body.currency} ${body.total.toFixed(2)}`;
  });
  await step("book r-04", async () => {
    const body = JSON.parse(textOf(await client.callTool({ name: "book", arguments: { room_id: "r-04", check_in: "2026-12-24", nights: 2, guest: "Consumer" } })));
    bookingId = body.booking_id;
    return `booking ${bookingId}`;
  });
  await step("cancel it", async () => {
    const result = (await client.callTool({ name: "cancel_booking", arguments: { booking_id: bookingId } })) as Text;
    if (result.isError === true) throw new Error(textOf(result));
    return JSON.parse(textOf(result)).status;
  });
  return out;
}

for (const version of process.argv.slice(2)) {
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "servers/hollow-inn/src/main.ts", version], stderr: "ignore" });
  const client = new Client({ name: "v1-consumer", version: "1.0.0" });
  await client.connect(transport);
  const lines = await consume(client);
  await client.close();
  process.stdout.write(`## hollow-inn ${version}\n${lines.map((line) => `- ${line}`).join("\n")}\n\n`);
}
