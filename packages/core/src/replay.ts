/**
 * The replay loop (Requirements 1, 2 and 6). It drives one Session_Group at a time against a
 * fresh server, assigns every jar one Jar_State, and returns one Result_Entry per jar.
 *
 * Pure logic: no Node built-in import, no file access and no clock of its own. Time comes only
 * from the injected Clock, and the MCP client comes only from the injected ClientFactory. Every
 * call goes through the real MCP SDK client.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { diff, type Change } from "./diff.js";
import type { JarLine } from "./jar.js";
import {
  findOrphans,
  groupBySession,
  loadJars,
  loadPending,
  type GroupMember,
  type JarFile,
  type SpoiledLine,
} from "./jar-loader.js";
import { canonicalJson, isJsonResponse, type Json } from "./json.js";
import { normalize } from "./normalize.js";
import type { PendingEntry } from "./pairing.js";
import { decideTool, type ReplayPolicy, type VolatilePolicy } from "./policy.js";
import { redactText, type Compiled } from "./redact.js";
import { redactEntry } from "./replay-redact.js";
import type { ReplayResult, ResultEntry } from "./replay-result.js";

/** Monotonic milliseconds, supplied by packages/cli. */
export type Clock = () => number;

/** A connected SDK client for one fresh server, and the function that closes it. */
export type ClientFactory = () => Promise<{ client: Client; close: () => Promise<void> }>;

/** One tool of a tools/list result, reduced to the parts that the schema diff uses. */
export type ListedTool = { name: string; inputSchema: Json };

export type SchemaDiff = ReplayResult["schema_diff"];
export type StateCounts = ReplayResult["counts"];

export type ReplayEngineArgs = {
  /** Jar file texts. The loader sorts them by file name. */
  jarFiles: JarFile[];
  /** Pending_File text, or undefined when the file is missing. */
  pendingText: string | undefined;
  replayPolicy: ReplayPolicy;
  volatilePolicy: VolatilePolicy;
  /**
   * Compiled Redact_Config of jar-capture. It drives the Hashed_Jar and text_redacted
   * comparisons, and it redacts every value written to the Replay_Result.
   */
  redactConfig: Compiled;
  /** Strict_Mode: an Additive_Change makes a jar rattled. */
  strict: boolean;
  clientFactory: ClientFactory;
  /**
   * Optional Baseline_Server factory. It is used only for `schema_diff`, and its outcome never
   * changes a jar state or the Verdict.
   */
  baselineFactory?: ClientFactory;
  clock: Clock;
  /** Server label written to the Replay_Result. packages/cli derives it from `--server`. */
  serverLabel: string;
  /** UTC start time, `YYYY-MM-DDTHH:mm:ss.sssZ`, passed in by packages/cli. */
  startedAt: string;
  /** Per-request timeout in milliseconds, passed to the SDK for tools/list and tools/call. */
  timeoutMs: number;
};

export type EngineOutcome = {
  /** One entry per jar and Orphan_Entry, in Session_Group order and then seq order. */
  resultEntries: ResultEntry[];
  /** Spoiled lines of the jar files and the Pending_File, by file name then line. */
  spoiled: SpoiledLine[];
  /** Names from the first successful tools/list of the Target_Server, sorted, or [] when none. */
  toolsListed: string[];
  /** Tool differences between the Baseline_Server and the Target_Server. */
  schemaDiff: SchemaDiff;
  /**
   * Why `schemaDiff` could not be computed: the baseline failed to start or to list, or the
   * Target_Server had no successful tools/list. Absent when the diff was computed or no
   * baseline was given. The caller decides the exit code.
   */
  schemaDiffError?: string;
};

/** JSON-RPC error codes that the SDK uses for a closed connection and for a request timeout. */
const CONNECTION_CLOSED = -32000;
const REQUEST_TIMEOUT = -32001;

/** One open server session of a Session_Group, and the function that closes it. */
type Session = { client: Client; close: () => Promise<void> };

/** The state of one Session_Group while its jars are replayed. */
type GroupRun = {
  /** True once a server was started for this group, whether or not that worked. */
  attempted: boolean;
  session?: Session;
  /** Names from tools/list. Set only when the listing succeeded. */
  tools?: ReadonlySet<string>;
  /** Failure text of a failed connect or tools/list. */
  startFailure?: string;
  /** Failure text of the call that ended the session, when later jars must not be called. */
  abortedBy?: string;
};

type Engine = {
  clientFactory: ClientFactory;
  clock: Clock;
  timeoutMs: number;
  replayPolicy: ReplayPolicy;
  volatilePolicy: VolatilePolicy;
  strict: boolean;
  redactConfig: Compiled;
  /** Names from the first successful tools/list, sorted. */
  toolsListed?: string[];
  /** The full tools/list of the first successful listing, for the schema diff. */
  targetTools?: ListedTool[];
};

/**
 * Replays every Session_Group that holds a Replayable_Jar and assigns every jar and Orphan_Entry
 * one Jar_State. The precedence of Requirement 2 criterion 21 is applied per jar before any
 * call is made for it: unsealed, then skipped, then cracked, then preserved or rattled by the
 * diff. Never writes to any file.
 */
export async function replay(args: ReplayEngineArgs): Promise<EngineOutcome> {
  const loaded = loadJars(args.jarFiles);
  const pending = loadPending(args.pendingText ?? "");
  const orphans = findOrphans(pending.entries, loaded.valid);
  const spoiled = [...loaded.spoiled, ...pending.spoiled].sort(
    (a, b) => compareText(a.file, b.file) || a.line - b.line,
  );
  const groups = groupBySession(loaded.lines, orphans);

  const engine: Engine = {
    clientFactory: args.clientFactory,
    clock: args.clock,
    timeoutMs: args.timeoutMs,
    replayPolicy: args.replayPolicy,
    volatilePolicy: args.volatilePolicy,
    strict: args.strict,
    redactConfig: args.redactConfig,
  };

  const resultEntries: ResultEntry[] = [];
  let anyReplayable = false;
  for (const group of groups) {
    const run: GroupRun = { attempted: false };
    try {
      for (const member of group.members) {
        if (isReplayableMember(member, engine.replayPolicy)) anyReplayable = true;
        resultEntries.push(await judgeMember(member, run, engine));
      }
    } finally {
      await closeRun(run);
    }
  }

  // No Replayable_Jar exists: start one server only to call tools/list (Requirement 1 criterion 17).
  if (!anyReplayable) {
    const run: GroupRun = { attempted: false };
    try {
      await ensureSession(run, engine);
    } finally {
      await closeRun(run);
    }
  }

  const schema = await schemaDiffFor(args, engine.targetTools);
  const outcome: EngineOutcome = {
    resultEntries: resultEntries.map((entry) => redactEntry(entry, args.redactConfig)),
    spoiled,
    toolsListed: engine.toolsListed ?? [],
    schemaDiff: schema.schemaDiff,
  };
  if (schema.error !== undefined) outcome.schemaDiffError = schema.error;
  return outcome;
}

/** A jar that is not unpaired and whose tool is allowed or watched (Replayable_Jar). */
function isReplayableMember(member: GroupMember, policy: ReplayPolicy): boolean {
  if (member.kind !== "jar") return false;
  return member.line.unpaired !== true && decideTool(member.line.tool, policy) !== "skipped";
}

/** Judges one member of a group. Only a member that reaches the replay step calls a tool. */
async function judgeMember(member: GroupMember, run: GroupRun, engine: Engine): Promise<ResultEntry> {
  if (member.kind === "orphan") return orphanEntry(member.entry);
  const jar = member.line;
  if (jar.unpaired === true) {
    return build(jar, { state: "unsealed", reason: "unpaired post-event", ms: 0 });
  }
  if (decideTool(jar.tool, engine.replayPolicy) === "skipped") {
    return build(jar, { state: "skipped", ms: 0 });
  }
  return replayJar(jar, run, engine);
}

/** An Orphan_Entry has no recorded call, so it has no input and no response. */
function orphanEntry(entry: PendingEntry): ResultEntry {
  return {
    id: null,
    session_id: entry.session_id,
    seq: entry.seq,
    tool: entry.tool_id,
    state: "unsealed",
    input: null,
    response_text: null,
    changes: [],
    compatible: [],
    ignored: [],
    replayed_text: null,
    replayed: null,
    reason: "orphan pre-event",
    ms: 0,
  };
}

/** Replays one Replayable_Jar on the group's server and assigns its state. */
async function replayJar(jar: JarLine, run: GroupRun, engine: Engine): Promise<ResultEntry> {
  if (run.abortedBy !== undefined) {
    return build(jar, { state: "cracked", error: `session aborted after ${run.abortedBy}`, ms: 0 });
  }

  await ensureSession(run, engine);
  if (run.startFailure !== undefined) {
    return build(jar, { state: "cracked", error: run.startFailure, ms: 0 });
  }
  const session = run.session;
  const tools = run.tools;
  if (session === undefined || tools === undefined) {
    return build(jar, { state: "cracked", error: "server session was not started", ms: 0 });
  }
  if (!tools.has(jar.tool)) {
    return build(jar, { state: "cracked", reason: "tool not in tools/list", ms: 0 });
  }

  const started = engine.clock();
  let result: unknown;
  try {
    result = await session.client.callTool(
      { name: jar.tool, arguments: jar.input as Record<string, unknown> },
      undefined,
      { timeout: engine.timeoutMs },
    );
  } catch (failure) {
    const ms = engine.clock() - started;
    const text = failureText(failure);
    if (endsSession(failure)) run.abortedBy = text;
    return build(jar, { state: "cracked", error: text, ms });
  }
  const ms = engine.clock() - started;

  const replayedText = textOf(result);
  const replayed = parseReplayed(replayedText);

  if (isErrorResult(result) && !isErrorShaped(jar.response)) {
    return build(jar, { state: "cracked", error: replayedText, replayedText, replayed, ms });
  }

  const judged = judgeJar(jar, replayedText, engine);
  return build(jar, {
    state: judged.state,
    changes: judged.changes,
    compatible: judged.compatible,
    ignored: judged.ignored,
    replayedText,
    replayed,
    ms,
  });
}

/**
 * Starts the group's server and calls tools/list, once. A failure to connect or to list is
 * kept as the group's startFailure, and the session is closed.
 */
async function ensureSession(run: GroupRun, engine: Engine): Promise<void> {
  if (run.attempted) return;
  run.attempted = true;

  let session: Session;
  try {
    session = await engine.clientFactory();
  } catch (failure) {
    run.startFailure = failureText(failure);
    return;
  }
  run.session = session;

  try {
    const tools = await listAllTools(session.client, engine.timeoutMs);
    run.tools = new Set(tools.map((tool) => tool.name));
    if (engine.targetTools === undefined) {
      engine.targetTools = tools;
      engine.toolsListed = [...run.tools].sort(compareText);
    }
  } catch (failure) {
    run.startFailure = failureText(failure);
    await closeRun(run);
  }
}

/** Closes the group's session, if one is open. Close errors do not change any state. */
async function closeRun(run: GroupRun): Promise<void> {
  const session = run.session;
  run.session = undefined;
  await closeQuietly(session);
}

/** Closes a session and ignores a failure to close, since nothing depends on it afterwards. */
async function closeQuietly(session: Session | undefined): Promise<void> {
  if (session === undefined) return;
  try {
    await session.close();
  } catch {
    // The session is already gone.
  }
}

/** A tools/list entry reduced to its name and input schema. */
function toListed(tool: { name: string; inputSchema?: unknown }): ListedTool {
  return { name: tool.name, inputSchema: (tool.inputSchema ?? null) as Json };
}

/** The most tools/list pages one listing follows before it gives up. */
export const MAX_LIST_PAGES = 100;

/**
 * Every tool of a server, following `nextCursor` page by page (MCP tools/list is paginated: a
 * server may return its tools across several pages). Reading only the first page would crack
 * every jar whose tool is on a later page as "tool not in tools/list", and would hide those
 * tools from the schema diff. A cursor seen twice, or more than MAX_LIST_PAGES pages, rejects,
 * so a server that pages forever cannot hang the replay.
 */
export async function listAllTools(client: Pick<Client, "listTools">, timeoutMs: number): Promise<ListedTool[]> {
  const tools: ListedTool[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const listing = await client.listTools(cursor === undefined ? undefined : { cursor }, { timeout: timeoutMs });
    tools.push(...listing.tools.map(toListed));
    const next = listing.nextCursor;
    if (next === undefined) return tools;
    if (seen.has(next)) throw new Error(`tools/list repeated the cursor ${JSON.stringify(next)}`);
    seen.add(next);
    cursor = next;
  }
  throw new Error(`tools/list did not end after ${MAX_LIST_PAGES} pages`);
}

/** The outcome of comparing one replayed response with the jarred response. */
type Judged = {
  state: "preserved" | "rattled";
  changes: Change[];
  compatible: Change[];
  ignored: string[];
};

const UNCHANGED: Omit<Judged, "state"> = { changes: [], compatible: [], ignored: [] };

/**
 * Chooses the comparison for one replayed text. A Hashed_Jar compares the hash of the replayed
 * text. A text_redacted jar compares the replayed text after pattern redaction. Every other
 * jar compares the Bodies as replayed, before redaction (Requirement 2 criteria 22 and 23, and
 * Requirement 6 criterion 9).
 */
function judgeJar(jar: JarLine, replayedText: string, engine: Engine): Judged {
  if (jar.response_length !== undefined) {
    return judgeHashed(jar, replayedText, engine.redactConfig);
  }
  if (jar.text_redacted === true) {
    const redacted = redactText(replayedText, { ...engine.redactConfig, text: "redact" });
    return judgeBodies(jar, redacted.responseText, engine);
  }
  return judgeBodies(jar, replayedText, engine);
}

/**
 * Hashes the replayed text in hash mode with the same Redact_Config. The jar is preserved when
 * the hash equals the jarred `response_text`, and rattled with one `value` Change otherwise.
 */
function judgeHashed(jar: JarLine, replayedText: string, c: Compiled): Judged {
  const hashed = redactText(replayedText, { ...c, text: "hash" }).responseText;
  if (hashed === jar.response_text) return { state: "preserved", ...UNCHANGED };
  return {
    state: "rattled",
    changes: [{ path: "/response_text", kind: "value", was: jar.response_text, now: hashed }],
    compatible: [],
    ignored: [],
  };
}

/**
 * Compares the Bodies of one jar and its replayed text. Pointers listed in the jar's `redacted`
 * array are excluded from both Bodies after the `/response` prefix is stripped, so they are
 * recorded as Body-relative pointers, such as `/total`. The Volatile_Policy matches are removed
 * as well, and every pointer removed is listed as ignored. Strict_Mode makes an Additive_Change
 * rattle the jar. Otherwise an Additive_Change is compatible. A Rename_Suspicion is breaking in
 * both modes.
 */
function judgeBodies(jar: JarLine, replayedText: string, engine: Engine): Judged {
  const excluded = jar.redacted.flatMap((pointer) => {
    const tail = responseTail(pointer);
    return tail === undefined ? [] : [tail];
  });
  // The empty pointer excludes the whole Body, so no part of it can produce a Change.
  if (excluded.includes("")) return { state: "preserved", changes: [], compatible: [], ignored: [""] };

  const jarBody = removePointers(bodyOf(jar.response_text), excluded);
  const replayedBody = removePointers(bodyOf(replayedText), excluded);
  const jarNormal = normalize(jarBody, engine.volatilePolicy);
  const replayedNormal = normalize(replayedBody, engine.volatilePolicy);

  const ignored = [
    ...new Set([...excluded, ...jarNormal.removed, ...replayedNormal.removed]),
  ].sort(compareText);
  const all = diff(jarNormal.value, replayedNormal.value);

  const isAdditive = (change: Change): boolean => change.kind === "added" && change.note === undefined;
  const additive = all.filter(isAdditive);
  const breaking = all.filter((change) => !isAdditive(change));

  const changes = engine.strict ? all : breaking;
  const compatible = engine.strict ? [] : additive;
  return {
    state: changes.length > 0 ? "rattled" : "preserved",
    changes,
    compatible,
    ignored,
  };
}

/** True for a jar pointer into the response: `/response` itself or one of its children. */
function isResponsePointer(pointer: string): boolean {
  return pointer === "/response" || pointer.startsWith("/response/");
}

/** The pointer with the `/response` prefix removed, so it is relative to the Body. */
function responseTail(pointer: string): string | undefined {
  if (!isResponsePointer(pointer)) return undefined;
  return pointer.slice("/response".length);
}

/** The Body of a response text: the parsed JSON_Response, or the text itself. */
function bodyOf(text: string): Json {
  return isJsonResponse(text) ? (JSON.parse(text) as Json) : text;
}

/** The parsed JSON_Response of a replayed text, or null. */
function parseReplayed(text: string): Json | null {
  return isJsonResponse(text) ? (JSON.parse(text) as Json) : null;
}

/** RFC 6901 token escaping: `~` becomes `~0` first, then `/` becomes `~1`. */
function escapeToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Removes the values named by Body-relative pointers, where each pointer is a non-empty RFC
 * 6901 tail such as `/total`. Array indexes refer to the original Body. The input is not
 * mutated. Built objects use Object.defineProperty, so a key such as "__proto__" stays an
 * ordinary key.
 */
function removePointers(body: Json, pointers: readonly string[]): Json {
  const tails = pointers.map((pointer) => pointer.slice(1).split("/"));
  return removeBelow(body, tails);
}

function removeBelow(current: Json, tails: string[][]): Json {
  if (current === null || typeof current !== "object" || tails.length === 0) return current;

  if (Array.isArray(current)) {
    const kept: Json[] = [];
    current.forEach((child, index) => {
      const here = tails.filter((segments) => segments[0] === String(index));
      if (here.some((segments) => segments.length === 1)) return;
      kept.push(removeBelow(child, here.map((segments) => segments.slice(1))));
    });
    return kept;
  }

  const out: { [k: string]: Json } = {};
  for (const key of Object.keys(current)) {
    const token = escapeToken(key);
    const here = tails.filter((segments) => segments[0] === token);
    if (here.some((segments) => segments.length === 1)) continue;
    const child = Object.getOwnPropertyDescriptor(current, key)?.value as Json;
    Object.defineProperty(out, key, {
      value: removeBelow(child, here.map((segments) => segments.slice(1))),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Error_Shaped: a JSON object whose only key is `error` and whose value is a string. */
function isErrorShaped(response: Json | null): boolean {
  if (response === null || typeof response !== "object" || Array.isArray(response)) return false;
  const keys = Object.keys(response);
  return keys.length === 1 && keys[0] === "error" && typeof response.error === "string";
}

/** The `isError` flag of a tools/call result. */
function isErrorResult(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
}

/** The concatenated text of the `text` items of `content`, or "" when there are none. */
function textOf(result: unknown): string {
  const content = typeof result === "object" && result !== null ? (result as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: unknown) => {
      if (typeof item !== "object" || item === null) return "";
      const record = item as { type?: unknown; text?: unknown };
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

/**
 * True when a failure ends the session: a closed connection, a request timeout, or any error
 * without a JSON-RPC code, such as a transport error. A JSON-RPC error response leaves the
 * session usable.
 */
function endsSession(failure: unknown): boolean {
  if (typeof failure === "object" && failure !== null && typeof (failure as { code?: unknown }).code === "number") {
    const code = (failure as { code: number }).code;
    return code === CONNECTION_CLOSED || code === REQUEST_TIMEOUT;
  }
  return true;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** A ResultEntry for a Jar_Line with the given state and optional fields. */
function build(
  jar: JarLine,
  fields: {
    state: ResultEntry["state"];
    reason?: string;
    error?: string;
    changes?: Change[];
    compatible?: Change[];
    ignored?: string[];
    replayedText?: string;
    replayed?: Json | null;
    ms: number;
  },
): ResultEntry {
  const entry: ResultEntry = {
    id: jar.id,
    session_id: jar.session_id,
    seq: jar.seq,
    tool: jar.tool,
    state: fields.state,
    input: jar.input,
    response_text: jar.response_text,
    changes: fields.changes ?? [],
    compatible: fields.compatible ?? [],
    ignored: fields.ignored ?? [],
    replayed_text: fields.replayedText ?? null,
    replayed: fields.replayed ?? null,
    ms: fields.ms,
  };
  if (fields.reason !== undefined) entry.reason = fields.reason;
  if (fields.error !== undefined) entry.error = fields.error;
  return entry;
}

/**
 * Compares two tool lists for the schema diff. `removed` holds the tools of the baseline that
 * the target lacks, and `added` holds the tools that only the target has. `input_schema_changed`
 * holds the tools in both whose inputSchema differ by Canonical_JSON. Every list is sorted in
 * code-unit order. The result never changes a jar state or the Verdict.
 */
export function schemaDiffOf(
  baseline: readonly ListedTool[],
  target: readonly ListedTool[],
): SchemaDiff {
  const before = new Map(baseline.map((tool) => [tool.name, tool.inputSchema] as const));
  const after = new Map(target.map((tool) => [tool.name, tool.inputSchema] as const));
  const tools_removed = [...before.keys()].filter((name) => !after.has(name)).sort(compareText);
  const tools_added = [...after.keys()].filter((name) => !before.has(name)).sort(compareText);
  const input_schema_changed = [...before.keys()]
    .filter((name) => after.has(name))
    .filter((name) => canonicalJson(before.get(name) ?? null) !== canonicalJson(after.get(name) ?? null))
    .sort(compareText);
  return { tools_removed, tools_added, input_schema_changed };
}

/** A schema diff with every list empty. */
export function emptySchemaDiff(): SchemaDiff {
  return { tools_removed: [], tools_added: [], input_schema_changed: [] };
}

type Listing = { ok: true; tools: ListedTool[] } | { ok: false; error: string };

/** Starts one server for tools/list, reads the list, and closes the server. */
async function listToolsOf(factory: ClientFactory, timeoutMs: number): Promise<Listing> {
  let session: Session;
  try {
    session = await factory();
  } catch (failure) {
    return { ok: false, error: failureText(failure) };
  }
  try {
    return { ok: true, tools: await listAllTools(session.client, timeoutMs) };
  } catch (failure) {
    return { ok: false, error: failureText(failure) };
  } finally {
    await closeQuietly(session);
  }
}

/**
 * Computes `schema_diff` from the baseline's tools/list and the Target_Server's tools/list. No
 * baseline gives an empty diff. A failed baseline, or a Target_Server with no listing, gives an
 * empty diff and an error text. Nothing here raises an exception.
 */
async function schemaDiffFor(
  args: ReplayEngineArgs,
  target: ListedTool[] | undefined,
): Promise<{ schemaDiff: SchemaDiff; error?: string }> {
  if (args.baselineFactory === undefined) return { schemaDiff: emptySchemaDiff() };
  const baseline = await listToolsOf(args.baselineFactory, args.timeoutMs);
  if (!baseline.ok) {
    return { schemaDiff: emptySchemaDiff(), error: `baseline failed: ${baseline.error}` };
  }
  if (target === undefined) {
    return {
      schemaDiff: emptySchemaDiff(),
      error: "schema diff skipped: the Target_Server tools/list did not succeed",
    };
  }
  return { schemaDiff: schemaDiffOf(baseline.tools, target) };
}

/** The counts of Replay_Result: the number of entries in each Jar_State. */
export function countStates(entries: readonly ResultEntry[]): StateCounts {
  const counts: StateCounts = { preserved: 0, rattled: 0, cracked: 0, unsealed: 0, skipped: 0 };
  for (const entry of entries) counts[entry.state] += 1;
  return counts;
}

/**
 * The Replay_Result fields that the engine owns. The verdict, red, filed, covered, reason and
 * coverage belong to the verdict function and are added by packages/cli. The result is typed
 * as this subset rather than filled with placeholders, so a missing field is a compile error
 * and not a silent value that could reach a file.
 */
export type EngineResultFields = Pick<
  ReplayResult,
  "v" | "server" | "started_at" | "strict" | "jars" | "spoiled" | "counts" | "schema_diff"
>;

/** Builds the engine-owned Replay_Result fields from the run arguments and the outcome. */
export function buildReplayResultFields(
  args: Pick<ReplayEngineArgs, "serverLabel" | "startedAt" | "strict">,
  outcome: EngineOutcome,
): EngineResultFields {
  return {
    v: 1,
    server: args.serverLabel,
    started_at: args.startedAt,
    strict: args.strict,
    jars: outcome.resultEntries,
    spoiled: outcome.spoiled,
    counts: countStates(outcome.resultEntries),
    schema_diff: outcome.schemaDiff,
  };
}

/** Code-unit order, as used for file names, pointers and tool names. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
