/// <reference types="vite/client" />
/**
 * Rack metadata for the shelves (Requirement 7). For each rack in jars/racks.json, in the key
 * order of that file, it gives the task from the rack prompt, the session id, the shortened
 * session id, the call count and the valid Jar_Lines in seq order. The jars are kept here so the
 * shelves can show every jar before a replay has run.
 *
 * `buildRackMeta` is pure and takes its sources as arguments. `RACK_META` is the same function
 * applied to the build-time imports. No `node:` import here: the browser bundles this module.
 */
import { readJar, type Json } from "@specimen/core";
import { z } from "zod";
import racksJson from "../../../jars/racks.json";

/** One valid Jar_Line of a rack, with the fields the shelves and the drawer read. */
export type RackJar = {
  id: string;
  tool: string;
  seq: number;
  input: Json;
  responseText: string;
};

export type RackMeta = {
  /** The rack code, for example "RACK A". */
  code: string;
  /** The task given to the agent: the rack prompt without its header comment. */
  task: string;
  /** The session id, the Jar_File name without ".jsonl". */
  sessionId: string;
  /** "sess_" plus the first 8 characters of the session uuid. */
  shortSessionId: string;
  /** The number of valid Jar_Lines of the rack's Jar_File. */
  callCount: number;
  /** The valid Jar_Lines in seq order. */
  jars: RackJar[];
};

/** The sources of `buildRackMeta`. Text is keyed by file name, not by path. */
export type RackSources = {
  /** The parsed jars/racks.json: rack code to Jar_File name, in file order. */
  racks: unknown;
  /** Jar_File name to its full text. */
  jarTexts: Readonly<Record<string, string>>;
  /** Prompt file name (for example "rack-a.md") to its full text. */
  prompts: Readonly<Record<string, string>>;
};

const racksSchema = z.record(
  z.string().regex(/^RACK [A-Z]$/),
  z.string().regex(/^sess_[A-Za-z0-9-]+\.jsonl$/),
);

const JSONL_SUFFIX = ".jsonl";
const SHORT_SESSION_LENGTH = "sess_".length + 8;
const HEADER_COMMENT = /^<!--[\s\S]*-->\s*$/;

/** The prompt file of a rack: "RACK A" gives "rack-a.md". */
export function promptFileFor(code: string): string {
  return `${code.toLowerCase().replace(/ /g, "-")}.md`;
}

/**
 * The task of a rack prompt: everything after the first line, which must be an HTML header
 * comment. The result has no leading or trailing whitespace.
 */
export function taskFromPrompt(text: string): string {
  const newline = text.indexOf("\n");
  const header = newline === -1 ? text : text.slice(0, newline);
  if (!HEADER_COMMENT.test(header)) {
    throw new Error("rack prompt does not start with an HTML header comment");
  }
  return newline === -1 ? "" : text.slice(newline + 1).trim();
}

/** Builds the rack metadata from the sources, in the key order of racks.json. */
export function buildRackMeta(sources: RackSources): RackMeta[] {
  const racks = racksSchema.parse(sources.racks);
  return Object.entries(racks).map(([code, jarFile]) => {
    const jarText = sources.jarTexts[jarFile];
    if (jarText === undefined) {
      throw new Error(`${jarFile} is listed in racks.json but was not imported`);
    }
    const prompt = sources.prompts[promptFileFor(code)];
    if (prompt === undefined) {
      throw new Error(`${promptFileFor(code)} is missing for ${code}`);
    }

    const sessionId = jarFile.slice(0, -JSONL_SUFFIX.length);
    const jars = readJar(jarText)
      .lines.map((line): RackJar => {
        if (line.session_id !== sessionId) {
          throw new Error(`${jarFile} holds a line of session ${line.session_id}`);
        }
        return {
          id: line.id,
          tool: line.tool,
          seq: line.seq,
          input: line.input,
          responseText: line.response_text,
        };
      })
      .sort((a, b) => a.seq - b.seq);

    return {
      code,
      task: taskFromPrompt(prompt),
      sessionId,
      shortSessionId: sessionId.slice(0, SHORT_SESSION_LENGTH),
      callCount: jars.length,
      jars,
    };
  });
}

/** Text of each imported file, keyed by its base name. */
function byBaseName(raw: Record<string, string>): Record<string, string> {
  const keyed: Record<string, string> = {};
  for (const [path, text] of Object.entries(raw)) {
    keyed[path.slice(path.lastIndexOf("/") + 1)] = text;
  }
  return keyed;
}

const RAW_JARS = import.meta.glob("../../../jars/*.jsonl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const RAW_PROMPTS = import.meta.glob("../../../prompts/rack-*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The racks of jars/racks.json with their tasks and jars, built at module load. */
export const RACK_META: RackMeta[] = buildRackMeta({
  racks: racksJson,
  jarTexts: byBaseName(RAW_JARS),
  prompts: byBaseName(RAW_PROMPTS),
});
