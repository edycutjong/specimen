import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { readText, writeAtomic } from "./fsx.js";
import { readStdin } from "./stdin.js";

/** File access used by the capture hooks. Production uses node:fs. */
export interface FsPort {
  /** The file text, or undefined when the file does not exist. */
  readText(path: string): string | undefined;
  /** Replaces the file through a temporary file and a rename. */
  writeAtomic(path: string, text: string): void;
  /** Appends text, creating the parent directory when it is missing. */
  appendText(path: string, text: string): void;
  /** Names of the regular files directly inside `dir`, sorted. Empty when `dir` is missing. */
  listFiles(dir: string): string[];
}

/**
 * Everything a capture hook takes from its surroundings: STDIN, the clock and the file system.
 * Production code uses `nodeIO`. Tests may supply their own values.
 */
export interface HookIO {
  readStdin(): Promise<string>;
  /** Milliseconds since the epoch, read when a hook takes its payload. */
  now(): number;
  fs: FsPort;
}

export const nodeFs: FsPort = {
  readText: (path) => readText(path),
  writeAtomic: (path, text) => writeAtomic(path, text),
  appendText(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, text, "utf8");
  },
  listFiles(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
      throw err;
    }
  },
};

export const nodeIO: HookIO = {
  readStdin,
  now: () => Date.now(),
  fs: nodeFs,
};
