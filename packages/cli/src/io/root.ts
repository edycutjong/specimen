import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** True when `path` exists and is a directory. Never throws. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The Workspace_Root for a directory: the nearest ancestor (or the directory itself) that
 * contains a `.kiro` directory. Falls back to the directory itself when none exists.
 */
export function findWorkspaceRoot(cwd: string): string {
  const start = resolve(cwd);
  let dir = start;
  for (;;) {
    if (isDirectory(join(dir, ".kiro"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
