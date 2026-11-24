/// <reference types="vite/client" />
/**
 * The Replay_Module of the cabinet (Requirements 1, 5). It runs the real `replay()` and `verdict()`
 * of @specimen/core against the real hollow-inn server modules over InMemoryTransport, in the
 * browser. It is the browser port of `replayIn()` in spikes/s1-browser/src/s1-real.ts, with the
 * Filed_Ids of the committed Bugfix_Specs passed to `verdict()`.
 *
 * No `node:` import here: the browser bundles this module. Inputs come only from the Jar_Files
 * listed in jars/racks.json, the three policy files and the committed Bugfix_Specs, all imported
 * at build time. Nothing is written.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildReplayResultFields,
  compileRedact,
  filedJarIds,
  redactConfigSchema,
  replay,
  replayPolicySchema,
  replayResultSchema,
  verdict,
  volatilePolicySchema,
  type BugfixSpec,
  type ClientFactory,
  type JarFile,
  type ReplayResult,
} from "@specimen/core";
import { createServer } from "../../../servers/hollow-inn/src/index.js";
import racksJson from "../../../jars/racks.json";
import replayJson from "../../../.specimen/replay.json";
import volatileJson from "../../../.specimen/volatile.json";
import redactJson from "../../../.specimen/redact.json";

export type HollowInnVersion = "v1" | "v2" | "v2.1";

/**
 * A Replay_Result plus the Replay_Time in milliseconds, measured around the single `replay()` call.
 * `schemaDiffError` is the engine's reason when the schema diff could not be computed. It is not
 * part of the strict Replay_Result schema, so it is carried beside the result.
 */
export type CabinetReplayResult = ReplayResult & { replayTimeMs: number; schemaDiffError?: string };

export type RunReplayOptions = { signal?: AbortSignal };

/** The committed policy files, as imported. `runReplay` parses them with the core zod schemas. */
export const REPLAY_POLICY = replayJson;
export const VOLATILE_POLICY = volatileJson;
export const REDACT_CONFIG = redactJson;

// Every committed jar as raw text. The glob is narrowed to the Jar_Files that racks.json lists below.
const RAW_JARS = import.meta.glob("../../../jars/*.jsonl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The Jar_Files of jars/racks.json, in the key order of that file. */
export const JAR_FILES: JarFile[] = Object.values(racksJson).map((file) => {
  const text = RAW_JARS[`../../../jars/${file}`];
  if (text === undefined) {
    throw new Error(`jars/racks.json lists ${file}, which is not among the imported jar files`);
  }
  return { file, text };
});

// Every committed Bugfix_Spec as raw text, keyed by its repository path.
const RAW_SPECS = import.meta.glob("../../../.kiro/specs/*/bugfix.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The committed Bugfix_Specs, named by repository path (for example `.kiro/specs/<name>/bugfix.md`). */
export function getBugfixSpecs(): BugfixSpec[] {
  return Object.entries(RAW_SPECS)
    .map(([path, text]) => ({ name: path.replace(/^(\.\.\/)+/, ""), text }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Every version runs against the recorded baseline as the schema-diff reference. */
const BASELINE: HollowInnVersion = "v1";
const TIMEOUT_MS = 10000;

/** Closes one client and server pair. Safe to call more than once; close errors are not raised. */
type Closer = () => Promise<void>;

/**
 * A ClientFactory that starts one hollow-inn server over InMemoryTransport and connects the real
 * SDK client to it. Each pair is recorded in `opened` before it connects, so `runReplay` can
 * close it even when a connect or the replay fails.
 */
function serverFactory(version: HollowInnVersion, opened: Closer[]): ClientFactory {
  return async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer(version);
    const client = new Client({ name: "specimen-cabinet", version: "0.0.0" });
    let closing: Promise<void> | undefined;
    const close: Closer = () => {
      closing ??= Promise.allSettled([client.close(), server.close()]).then(() => undefined);
      return closing;
    };
    opened.push(close);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, close };
  };
}

/** One full replay of `version` against the committed jars. Closes every pair it opened. */
async function replayOnce(version: HollowInnVersion): Promise<CabinetReplayResult> {
  const opened: Closer[] = [];
  try {
    const compiled = compileRedact(redactConfigSchema.parse(REDACT_CONFIG));
    if (!compiled.ok) {
      throw new Error(`redact pattern ${compiled.patternIndex} of .specimen/redact.json does not compile`);
    }
    const replayPolicy = replayPolicySchema.parse(REPLAY_POLICY);
    const volatilePolicy = volatilePolicySchema.parse(VOLATILE_POLICY);
    const serverLabel = `hollow-inn ${version} (browser, InMemoryTransport)`;
    const startedAt = new Date().toISOString();

    const replayStart = performance.now();
    const outcome = await replay({
      jarFiles: JAR_FILES,
      pendingText: undefined,
      replayPolicy,
      volatilePolicy,
      redactConfig: compiled.value,
      strict: false,
      clientFactory: serverFactory(version, opened),
      baselineFactory: serverFactory(BASELINE, opened),
      // Whole milliseconds, because the Replay_Result stores each jar's `ms` as an integer.
      clock: () => Math.floor(performance.now()),
      serverLabel,
      startedAt,
      timeoutMs: TIMEOUT_MS,
    });
    const replayTimeMs = performance.now() - replayStart;

    // Filed_Ids come from the same entries that the verdict reads, and they are computed first.
    const filedIds = filedJarIds(getBugfixSpecs(), outcome.resultEntries);
    const judged = verdict({
      entries: outcome.resultEntries,
      spoiledCount: outcome.spoiled.length,
      toolsListed: outcome.toolsListed,
      filedIds,
    });

    const result = replayResultSchema.parse({
      ...buildReplayResultFields({ serverLabel, startedAt, strict: false }, outcome),
      ...judged,
    });
    return {
      ...result,
      replayTimeMs,
      ...(outcome.schemaDiffError === undefined ? {} : { schemaDiffError: outcome.schemaDiffError }),
    };
  } finally {
    await Promise.all(opened.map((close) => close()));
  }
}

function abortError(): DOMException {
  return new DOMException("The replay was aborted.", "AbortError");
}

/**
 * Replays the committed jars against hollow-inn `version` and resolves with the Replay_Result and
 * its Replay_Time. `replay()` cannot be cancelled, so an abort does not stop the replay in
 * progress. It makes the promise reject with an AbortError at once, and the replay closes its own
 * clients and servers when it ends. A signal that is already aborted starts nothing.
 */
export async function runReplay(
  version: HollowInnVersion,
  opts: RunReplayOptions = {},
): Promise<CabinetReplayResult> {
  const signal = opts.signal;
  if (signal?.aborted) throw abortError();

  const work = replayOnce(version);
  if (signal === undefined) return work;

  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
