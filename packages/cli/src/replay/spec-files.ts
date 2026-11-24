
/**
 * Reads the Bugfix_Specs of the Workspace_Root (Requirement 9). The filed-ids rule itself lives in
 * @specimen/core, and is re-exported here so the CLI call sites keep their imports.
 * A Bugfix_Spec is only read. Nothing here writes or changes a file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BugfixSpec } from "@specimen/core";

export { citesId, filedJarIds, type BugfixSpec } from "@specimen/core";

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
