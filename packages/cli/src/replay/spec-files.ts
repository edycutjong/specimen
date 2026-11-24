/**
 * Reads the Bugfix_Specs of the Workspace_Root and computes the filed jar ids (Requirement 9).
 * A Bugfix_Spec is only read. Nothing here writes or changes a file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSpec, type ResultEntry } from "@specimen/core";

/** One `.kiro/specs/<name>/bugfix.md` file. */
export type BugfixSpec = { name: string; text: string };

/**
 * Every `.kiro/specs/<name>/bugfix.md` under `root`, sorted by spec name in code-unit order. A
 * missing `.kiro/specs` or a spec folder without `bugfix.md` gives no entry. Other read errors are
 * thrown, because a partly read set of specs would under-count the filed jars.
 */
export function readBugfixSpecs(root: string): BugfixSpec[] {
  const specsDir = join(root, ".kiro", "specs");
  let folders;
  try {
    folders = readdirSync(specsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
    throw err;
  }

  const specs: BugfixSpec[] = [];
  for (const folder of folders.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const path = join(specsDir, folder, "bugfix.md");
    try {
      specs.push({ name: folder, text: readFileSync(path, "utf8") });
    } catch (err) {
      if ((err as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") throw err;
    }
  }
  return specs;
}

/**
 * True when `id` occurs in `text` as a Whole_Token_Match: it is neither preceded nor followed by
 * an alphanumeric character or by "-". So `SPC-0004` does not match inside `SPC-00045`.
 */
export function citesId(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`).test(text);
}

/**
 * The ids of the Red_Jars (rattled or cracked) for which at least one Bugfix_Spec that cites the
 * id passes checkSpec. Each spec is checked against every id it cites, so a spec that fails for
 * one of several ids counts only for the ids it passes. The Replay_Result entries are read only
 * to find the Red_Jars and to run the check.
 */
export function filedJarIds(specs: readonly BugfixSpec[], jars: ResultEntry[]): Set<string> {
  const filed = new Set<string>();
  for (const jar of jars) {
    if (jar.id === null) continue;
    if (jar.state !== "rattled" && jar.state !== "cracked") continue;
    const id = jar.id;
    const passes = specs.some((spec) => citesId(spec.text, id) && checkSpec(spec.text, id, jars) === "pass");
    if (passes) filed.add(id);
  }
  return filed;
}
