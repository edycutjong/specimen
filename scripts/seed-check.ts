// `npm run seed:check` — asserts the authored fixture still holds the properties the demo depends on
// (specs: seed data). Exit 0 = every check holds; exit 1 lists what drifted.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ROOMS, createServer } from "../servers/hollow-inn/src/index.js";

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);

check("9 rooms r-01 … r-09", ROOMS.length === 9 && ROOMS.every((r, i) => r.id === `r-0${i + 1}`));
const sleeps3 = ROOMS.filter((r) => r.max_guests >= 3);
check("7 of 9 rooms sleep 3 guests", sleeps3.length === 7);
check("r-08 and r-09 are the 6th and 7th rooms for 3 guests (a default limit of 5 drops exactly them)",
  sleeps3.slice(5).map((r) => r.id).join() === "r-08,r-09");
const fire3 = sleeps3.filter((r) => r.fireplace).sort((a, b) => a.nightly - b.nightly);
check("cheapest fireplace room for 3 guests is r-04 Hearth Room at 212.50", fire3[0]?.id === "r-04" && fire3[0]?.name === "Hearth Room" && fire3[0]?.nightly === 212.5);
check("at least two fireplace rooms sleep 3 (RACK A compares the two cheapest)", fire3.length >= 2);
check("a cheaper fireplace room exists that does NOT sleep 3 (the guest count matters)", ROOMS.some((r) => r.fireplace && r.max_guests < 3 && r.nightly < 212.5));
check("every nightly rate has at most two decimals", ROOMS.every((r) => Math.abs(Math.round(r.nightly * 100) - r.nightly * 100) < 1e-6));

const [a, b] = InMemoryTransport.createLinkedPair();
await createServer("v1").connect(a);
const client = new Client({ name: "seed-check", version: "0" });
await client.connect(b);
const q = (await client.callTool({ name: "quote", arguments: { room_id: "r-04", nights: 2 } })) as { content: { text: string }[] };
check('v1 quote r-04 × 2 nights carries "total":425.00 verbatim', q.content[0]?.text.includes('"total":425.00') === true);
await client.close();

for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
const failed = checks.filter(([, p]) => !p).length;
console.log(`seed:check ${checks.length - failed}/${checks.length} pass`);
process.exit(failed ? 1 : 0);
