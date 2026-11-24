import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * The real path of `path`: the symbolic links of its longest existing ancestor are resolved,
 * and the segments below that ancestor are appended unchanged. Works for a path that does
 * not exist yet. Errors other than a missing path are thrown to the caller.
 */
export function realResolve(path: string): string {
  const start = resolve(path);
  const tail: string[] = [];
  let current = start;
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...[...tail].reverse());
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    const parent = dirname(current);
    if (parent === current) return start;
    tail.push(basename(current));
    current = parent;
  }
}

/** The file text, or undefined when the file does not exist. Other errors are thrown. */
export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * Writes `text` to `<path>.tmp`, flushes it to disk, then renames it over `path`. A reader
 * sees either the old file or the new one. Creates the parent directory when it is missing.
 */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/** Path of a file under `<root>/.specimen`. */
export function specimenFile(root: string, name: string): string {
  return join(root, ".specimen", name);
}

/** The raw text of `.specimen/counter`, or undefined when it is missing. */
export function readCounterText(root: string): string | undefined {
  return readText(specimenFile(root, "counter"));
}

/** Stores the last assigned accession number in `.specimen/counter`. */
export function writeCounter(root: string, n: number): void {
  writeAtomic(specimenFile(root, "counter"), `${n}\n`);
}

/** The raw text of `.specimen/pending.jsonl`. An empty string when the file is missing. */
export function readPendingText(root: string): string {
  return readText(specimenFile(root, "pending.jsonl")) ?? "";
}

/** Replaces the content of `.specimen/pending.jsonl`. */
export function writePendingText(root: string, text: string): void {
  writeAtomic(specimenFile(root, "pending.jsonl"), text);
}
