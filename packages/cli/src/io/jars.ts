import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validSessionId } from "@specimen/core";

/**
 * Read-only access to `<root>/jars`. Nothing in this module writes, creates or removes a file,
 * and nothing creates the `jars` directory when it is missing.
 */

/** Path of the `jars` directory under a workspace root. */
export function jarsDirectory(root: string): string {
  return join(root, "jars");
}

/** Names of the regular files directly under `jars/`, sorted. Empty when `jars/` is missing. */
export function listJarFiles(root: string): string[] {
  let entries;
  try {
    entries = readdirSync(jarsDirectory(root), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The text of every regular file under `jars/`. A read error is thrown, not skipped, so a
 * caller never builds an accession counter from a partial view of the evidence.
 */
export function readJarTexts(root: string): string[] {
  return listJarFiles(root).map((name) => readFileSync(join(jarsDirectory(root), name), "utf8"));
}

/**
 * The text of `jars/<sessionId>.jsonl`, or undefined when that file does not exist. The
 * session id is checked before it becomes a path name.
 */
export function readSessionJar(root: string, sessionId: string): string | undefined {
  if (!validSessionId(sessionId)) throw new RangeError("session id is not valid");
  try {
    return readFileSync(join(jarsDirectory(root), `${sessionId}.jsonl`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
    throw err;
  }
}
