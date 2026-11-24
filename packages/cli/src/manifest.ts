import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import {
  diffManifest,
  formatManifest,
  parseManifest,
  sha256Hex,
  type ManifestEntry,
} from "@specimen/core";
import { readText } from "./io/fsx.js";
import { describeError } from "./io/log.js";
import { findWorkspaceRoot } from "./io/root.js";

/** File name of the Manifest inside `jars/`. */
export const MANIFEST_NAME = "MANIFEST.sha256";

/** An expected failure. The message is a fixed sentence written by this module. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

type JarFile = { path: string; abs: string };
type JarScan = { files: JarFile[]; links: string[] };
type Out = (text: string) => void;

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Walks `jars/` with lstat. Regular files, other than the Manifest at the top level, are
 * collected. Symbolic links are listed separately and never followed. Any other entry type
 * is an error, because reading a FIFO or socket could block. A missing `jars/` holds nothing.
 */
export function scanJars(jarsDir: string): JarScan {
  const scan: JarScan = { files: [], links: [] };
  let top;
  try {
    top = lstatSync(jarsDir);
  } catch (err) {
    if (isNotFound(err)) return scan;
    throw err;
  }
  if (top.isSymbolicLink()) throw new ManifestError("jars is a symbolic link");
  if (!top.isDirectory()) throw new ManifestError("jars is not a directory");

  const pending: { abs: string; rel: string }[] = [{ abs: jarsDir, rel: "" }];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const name of readdirSync(dir.abs)) {
      const abs = join(dir.abs, name);
      const rel = dir.rel === "" ? name : `${dir.rel}/${name}`;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        scan.links.push(rel);
      } else if (st.isDirectory()) {
        pending.push({ abs, rel });
      } else if (st.isFile()) {
        if (rel !== MANIFEST_NAME) scan.files.push({ abs, path: rel });
      } else {
        throw new ManifestError(`jars holds an entry that is not a regular file: ${rel}`);
      }
    }
  }
  return scan;
}

/** SHA-256 of each file's bytes. Reads only regular files found by `scanJars`. */
function hashFiles(files: JarFile[]): ManifestEntry[] {
  return files.map((f) => ({ path: f.path, sha256: sha256Hex(readFileSync(f.abs)) }));
}

/** Formats Manifest text. Paths that the core format rejects become an expected failure. */
function formatOrThrow(entries: ManifestEntry[]): string {
  try {
    return formatManifest(entries);
  } catch {
    throw new ManifestError("a file name under jars/ cannot be recorded in the Manifest");
  }
}

/**
 * Writes `jars/MANIFEST.sha256` for the workspace at `root`. The text goes to a temporary file
 * under `.specimen/` first, then replaces the Manifest with `rename`, so a reader never sees a
 * partial Manifest. Returns the number of entries written.
 */
export function writeManifest(root: string): number {
  const jarsDir = join(root, "jars");
  const entries = hashFiles(scanJars(jarsDir).files);
  const text = formatOrThrow(entries);

  mkdirSync(jarsDir, { recursive: true });
  const stage = join(root, ".specimen");
  mkdirSync(stage, { recursive: true });
  const tmp = join(stage, `${MANIFEST_NAME}.tmp`);
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, join(jarsDir, MANIFEST_NAME));
  return entries.length;
}

export type CheckResult = { status: 0 | 2; lines: string[] };

/**
 * Compares `jars/` with the Manifest at `root`. Status 0 when nothing differs. Otherwise each
 * MISSING, CHANGED or UNLISTED path is listed in `lines`, and status is 2. A missing Manifest
 * counts as an empty one. Throws `ManifestError` or a file system error on an operational
 * failure. Never writes.
 */
export function checkManifest(root: string): CheckResult {
  const jarsDir = join(root, "jars");
  const scan = scanJars(jarsDir);
  const actual = hashFiles(scan.files);
  formatOrThrow(actual);

  const text = readText(join(jarsDir, MANIFEST_NAME)) ?? "";
  const parsed = parseManifest(text);
  if ("error" in parsed) {
    throw new ManifestError(`Manifest is malformed at line ${parsed.error.line}`);
  }

  const diff = diffManifest(parsed.entries, actual, scan.links);
  const lines = [
    ...diff.missing.map((p) => `MISSING ${p}`),
    ...diff.changed.map((p) => `CHANGED ${p}`),
    ...diff.unlisted.map((p) => `UNLISTED ${p}`),
  ];
  return { status: lines.length === 0 ? 0 : 2, lines };
}

function failureText(err: unknown): string {
  return err instanceof ManifestError ? err.message : describeError(err);
}

/** `manifest write` for a workspace root. Returns the exit status. */
export function runWrite(root: string, out: Out = (t) => process.stdout.write(t)): number {
  try {
    const count = writeManifest(root);
    out(`wrote ${count} entries to jars/${MANIFEST_NAME}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`manifest write failed: ${failureText(err)}\n`);
    return 1;
  }
}

/** `manifest check` for a workspace root. Lists differences on STDERR and returns the status. */
export function runCheck(root: string, err: Out = (t) => process.stderr.write(t)): number {
  try {
    const result = checkManifest(root);
    if (result.lines.length > 0) err(`${result.lines.join("\n")}\n`);
    return result.status;
  } catch (e) {
    err(`manifest check failed: ${failureText(e)}\n`);
    return 1;
  }
}

/**
 * The `specimen manifest` command group. Runs from the workspace root found from the current
 * directory. Capture hooks never reach this code.
 */
export function createManifestGroup(): Command {
  const group = new Command("manifest").description("Seal jars/ with a Manifest and check it");
  group.addCommand(
    new Command("write")
      .description("Write jars/MANIFEST.sha256 for every regular file under jars/")
      .action(() => {
        process.exitCode = runWrite(findWorkspaceRoot(process.cwd()));
      }),
  );
  group.addCommand(
    new Command("check")
      .description("Compare jars/ with jars/MANIFEST.sha256 and exit 2 on any difference")
      .action(() => {
        process.exitCode = runCheck(findWorkspaceRoot(process.cwd()));
      }),
  );
  return group;
}
