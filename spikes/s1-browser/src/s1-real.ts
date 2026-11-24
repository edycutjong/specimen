// S1 re-check (D3): the REAL pieces in the production browser bundle — the committed jars (imported as raw text),
// the real @specimen/core replay engine + verdict, and the real hollow-inn v1/v2 modules over InMemoryTransport.
// It must reproduce, in the browser, what `specimen replay` measured over stdio in the CLI.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildReplayResultFields,
  compileRedact,
  redactConfigSchema,
  replay,
  replayPolicySchema,
  verdict,
  volatilePolicySchema,
  type ClientFactory,
} from "@specimen/core";
import { createServer, type Version } from "../../../servers/hollow-inn/src/index.js";
import rackA from "../../../jars/sess_2e9b7313-1fcc-4a05-9adc-987b528ae3b8.jsonl?raw";
import rackB from "../../../jars/sess_854a0f71-fdbf-4cea-82fb-ab61a8255115.jsonl?raw";
import replayJson from "../../../.specimen/replay.json";
import volatileJson from "../../../.specimen/volatile.json";
import redactJson from "../../../.specimen/redact.json";

export type RealCheck = { name: string; pass: boolean; detail: string };
export type RealReport = { status: "PASS" | "FAIL"; checks: RealCheck[] };

const factory =
  (version: Version): ClientFactory =>
  async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = createServer(version);
    await server.connect(serverT);
    const client = new Client({ name: "s1-real", version: "0.0.0" });
    await client.connect(clientT);
    return { client, close: async () => { await client.close(); await server.close(); } };
  };

async function replayIn(version: Version) {
  const compiled = compileRedact(redactConfigSchema.parse(redactJson));
  if (!compiled.ok) throw new Error("redact config did not compile");
  const startedAt = new Date().toISOString();
  const outcome = await replay({
    jarFiles: [
      { file: "sess_2e9b7313-1fcc-4a05-9adc-987b528ae3b8.jsonl", text: rackA },
      { file: "sess_854a0f71-fdbf-4cea-82fb-ab61a8255115.jsonl", text: rackB },
    ],
    pendingText: undefined,
    replayPolicy: replayPolicySchema.parse(replayJson),
    volatilePolicy: volatilePolicySchema.parse(volatileJson),
    redactConfig: compiled.value,
    strict: false,
    clientFactory: factory(version),
    baselineFactory: factory("v1"),
    clock: () => performance.now(),
    serverLabel: `hollow-inn ${version} (browser, InMemoryTransport)`,
    startedAt,
    timeoutMs: 10000,
  });
  const judged = verdict({
    entries: outcome.resultEntries,
    spoiledCount: outcome.spoiled.length,
    toolsListed: outcome.toolsListed,
    filedIds: new Set<string>(),
  });
  return { ...buildReplayResultFields({ serverLabel: version, startedAt, strict: false }, outcome), ...judged };
}

const states = (r: Awaited<ReturnType<typeof replayIn>>) =>
  r.jars.map((j) => `${j.id}:${j.state}`).join(" ");

export async function runS1Real(): Promise<RealReport> {
  const checks: RealCheck[] = [];
  const v1 = await replayIn("v1");
  checks.push({
    name: "real jars vs real hollow-inn v1 in the browser: SHIP, every jar preserved",
    pass: v1.verdict === "SHIP" && v1.counts.preserved === v1.jars.length && v1.jars.length === 10,
    detail: `${v1.verdict} · ${JSON.stringify(v1.counts)} · ${states(v1)}`,
  });
  const book = v1.jars.filter((j) => j.tool === "book");
  checks.push({
    name: "RACK B fresh server per session: every recorded book replays BK-0001",
    pass: book.length > 0 && book.every((j) => j.state === "preserved" && (j.replayed_text ?? "").includes("BK-0001")),
    detail: book.map((j) => `${j.id} → ${(j.replayed_text ?? "").match(/BK-\d{4}/)?.[0]}`).join(", "),
  });
  const quote = v1.jars.find((j) => j.tool === "quote");
  const rawTotal = quote?.replayed_text?.match(/"total":([0-9.]+)/)?.[1];
  checks.push({
    name: "D-425 (d): the money literal survives the browser Client result text byte for byte",
    pass: rawTotal !== undefined && rawTotal.includes(".") && (quote?.response_text ?? "").includes(`"total":${rawTotal}`),
    detail: `${quote?.id} replayed_text "total":${rawTotal} · jarred text has the same literal: ${(quote?.response_text ?? "").includes(`"total":${rawTotal}`)}`,
  });
  const v2 = await replayIn("v2");
  checks.push({
    name: "real jars vs real hollow-inn v2 in the browser: the CLI's measured HOLD (5 preserved · 4 rattled · 1 cracked)",
    pass: v2.verdict === "HOLD" && v2.counts.preserved === 5 && v2.counts.rattled === 4 && v2.counts.cracked === 1,
    detail: `${v2.verdict} · ${JSON.stringify(v2.counts)} · ${states(v2)}`,
  });
  const q2 = v2.jars.filter((j) => j.tool === "quote");
  checks.push({
    name: "quote jars rattle at /total → /total_cents with the ×100 rename note",
    pass: q2.length === 3 && q2.every((j) => j.state === "rattled" && j.changes.some((c) => (c.note ?? "").includes("×100"))),
    detail: q2.map((j) => `${j.id}: ${j.changes.map((c) => `${c.path} ${c.kind}${c.note ? ` (${c.note})` : ""}`).join("; ")}`).join(" | "),
  });
  checks.push({
    name: "schema diff in the browser sees only the cancel tool rename",
    pass: v2.schema_diff.tools_removed.join() === "cancel_booking" && v2.schema_diff.tools_added.join() === "booking_cancel",
    detail: JSON.stringify(v2.schema_diff),
  });
  return { status: checks.every((c) => c.pass) ? "PASS" : "FAIL", checks };
}
