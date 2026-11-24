/**
 * Replay_Result schemas, the Quarantine_File schema and the text report (Requirements 5, 6 and
 * 10). Pure logic: no clock, no randomness, no I/O and no Node built-in import.
 *
 * The report never says or implies that a server is safe. SHIP means "replay clean on the
 * recorded set" and nothing more.
 */
import { z } from "zod";
import type { Change, ChangeKind } from "./diff.js";
import { jsonValue } from "./jar.js";

const CHANGE_KINDS = [
  "removed",
  "added",
  "value",
  "type",
  "length",
] as const satisfies readonly ChangeKind[];

const JAR_STATES = ["preserved", "rattled", "cracked", "unsealed", "skipped"] as const;

/** One difference, as stored in `changes` and `compatible`. */
export const changeSchema: z.ZodType<Change> = z.strictObject({
  path: z.string(),
  kind: z.enum(CHANGE_KINDS),
  was: jsonValue.optional(),
  now: jsonValue.optional(),
  note: z.string().optional(),
});

/** One element of `jars` in a Replay_Result. */
export const resultEntrySchema = z.strictObject({
  id: z.string().nullable(),
  session_id: z.string(),
  seq: z.number().int(),
  tool: z.string(),
  state: z.enum(JAR_STATES),
  input: jsonValue.nullable(),
  response_text: z.string().nullable(),
  changes: z.array(changeSchema),
  compatible: z.array(changeSchema),
  ignored: z.array(z.string()),
  replayed_text: z.string().nullable(),
  replayed: jsonValue.nullable(),
  reason: z.string().optional(),
  error: z.string().optional(),
  ms: z.number().int().min(0),
});

export type ResultEntry = z.infer<typeof resultEntrySchema>;

const spoiledSchema = z.strictObject({
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
});

/** The Replay_Result document, written to `replays/<server>-<iso>.json`. */
export const replayResultSchema = z.strictObject({
  v: z.literal(1),
  server: z.string(),
  started_at: z.iso.datetime({ offset: true }),
  strict: z.boolean(),
  jars: z.array(resultEntrySchema),
  spoiled: z.array(spoiledSchema),
  counts: z.strictObject({
    preserved: z.number().int(),
    rattled: z.number().int(),
    cracked: z.number().int(),
    unsealed: z.number().int(),
    skipped: z.number().int(),
  }),
  schema_diff: z.strictObject({
    tools_removed: z.array(z.string()),
    tools_added: z.array(z.string()),
    input_schema_changed: z.array(z.string()),
  }),
  verdict: z.enum(["SHIP", "HOLD"]),
  red: z.number().int(),
  filed: z.number().int(),
  covered: z.boolean(),
  reason: z.string(),
  coverage: z.strictObject({
    compared: z.number().int(),
    tools_compared: z.array(z.string()),
    tools_listed: z.array(z.string()),
    tools_unrecorded: z.array(z.string()),
  }),
});

export type ReplayResult = z.infer<typeof replayResultSchema>;

/** The Quarantine_File, `.specimen/quarantine.json`. */
export const quarantineFileSchema = z.strictObject({
  v: z.literal(1),
  items: z.array(
    z.strictObject({
      id: z.string().nullable(),
      session_id: z.string(),
      seq: z.number().int(),
      tool: z.string(),
      reason: z.string(),
    }),
  ),
});

export type QuarantineFile = z.infer<typeof quarantineFileSchema>;

/**
 * The coverage text: "N jars compared · T of K tools · not recorded: a, b". N is 1 gives
 * "1 jar compared". An empty `tools_unrecorded` gives "none".
 */
export function coverageString(coverage: ReplayResult["coverage"]): string {
  const compared =
    coverage.compared === 1 ? "1 jar compared" : `${coverage.compared} jars compared`;
  const tools = `${coverage.tools_compared.length} of ${coverage.tools_listed.length} tools`;
  const unrecorded =
    coverage.tools_unrecorded.length === 0 ? "none" : coverage.tools_unrecorded.join(", ");
  return `${compared} · ${tools} · not recorded: ${unrecorded}`;
}

/**
 * The text report, one string per line. The first line gives the verdict and coverage. Then
 * one line per jar in `jars` order, then one line per Spoiled_Line.
 */
export function buildReport(result: ReplayResult): string[] {
  const coverage = coverageString(result.coverage);
  let head: string;
  if (result.verdict === "SHIP") {
    head = `SHIP · replay clean on the recorded set · ${coverage}`;
  } else if (result.covered) {
    head = `HOLD · covered · ${result.reason} · ${coverage}`;
  } else {
    head = `HOLD · ${result.reason} · ${coverage}`;
  }
  const lines = [head, ...result.jars.map(jarLine)];
  for (const spoiled of result.spoiled) {
    lines.push(`spoiled · ${spoiled.file}:${spoiled.line} · ${spoiled.reason}`);
  }
  return lines;
}

/** `<id> · <tool> · <state> · <changed paths> · <note>`. */
function jarLine(entry: ResultEntry): string {
  const id = entry.id ?? `${entry.session_id}#${entry.seq}`;
  const paths = entry.changes.length === 0 ? "-" : entry.changes.map((c) => c.path).join(", ");
  const notes: string[] = [];
  for (const change of entry.changes) {
    if (change.note !== undefined) notes.push(change.note);
  }
  if (entry.compatible.length > 0) notes.push(`+${entry.compatible.length} field`);
  if (entry.reason !== undefined) notes.push(entry.reason);
  if (entry.error !== undefined) notes.push(entry.error);
  const note = notes.length === 0 ? "-" : notes.join("; ");
  return `${id} · ${entry.tool} · ${entry.state} · ${paths} · ${note}`;
}
