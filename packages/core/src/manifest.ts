/**
 * Manifest format and diff for `jars/MANIFEST.sha256`. Pure string and array logic. The
 * caller reads the files, hashes them and collects symbolic links. No Node built-in
 * imports, no clock, no I/O.
 *
 * A Manifest line has the `sha256sum` text form `<64 lowercase hex>  <path>` (two spaces)
 * and ends with "\n". Paths are relative to `jars/` and use "/" separators.
 */

export type ManifestEntry = { path: string; sha256: string };

export type ManifestDiff = { missing: string[]; changed: string[]; unlisted: string[] };

const HEX64 = /^[0-9a-f]{64}$/;
const LINE = /^([0-9a-f]{64})  (.+)$/;

const encoder = new TextEncoder();

/**
 * Orders two strings by Unicode code point. UTF-8 byte order equals code point order, so the
 * bytes are compared. UTF-16 code unit order would put U+10000 before U+FFFD, which is wrong.
 */
function compareCodePoints(a: string, b: string): number {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function sortPaths(paths: string[]): string[] {
  return [...paths].sort(compareCodePoints);
}

/**
 * Formats entries as Manifest text, one `<sha256>  <path>` line per entry, sorted by code
 * point. Throws when a sha256 is not 64 lowercase hex characters, when a path is empty, or
 * when a path contains a newline or a backslash, because `sha256sum` would need its escaped
 * form for those.
 */
export function formatManifest(entries: ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) => compareCodePoints(a.path, b.path));
  let out = "";
  for (const e of sorted) {
    if (e.path === "") throw new Error("manifest path is empty");
    if (/[\n\\]/.test(e.path)) throw new Error("manifest path contains a newline or backslash");
    if (!HEX64.test(e.sha256)) throw new Error("manifest sha256 is not 64 lowercase hex characters");
    out += `${e.sha256}  ${e.path}\n`;
  }
  return out;
}

/**
 * Parses Manifest text. Every line must match `<64 lowercase hex>  <path>` and end with "\n",
 * and a path must not contain a backslash. Returns the 1-based number of the first bad line.
 * Empty text is an empty Manifest.
 */
export function parseManifest(text: string): { entries: ManifestEntry[] } | { error: { line: number } } {
  if (text === "") return { entries: [] };
  const lines = text.split("\n");
  const last = lines.pop();
  if (last !== "") return { error: { line: lines.length + 1 } };

  const entries: ManifestEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = LINE.exec(lines[i] ?? "");
    const sha256 = match?.[1];
    const path = match?.[2];
    if (sha256 === undefined || path === undefined || path.includes("\\")) {
      return { error: { line: i + 1 } };
    }
    entries.push({ path, sha256 });
  }
  return { entries };
}

/**
 * Compares the Manifest (`listed`) with the files found on disk (`actual`) and the symbolic
 * links found on disk (`extraUnlisted`). Returns:
 * - `missing`: listed paths with no file on disk.
 * - `changed`: listed paths whose file hash differs.
 * - `unlisted`: files on disk the Manifest does not list, plus every symbolic link.
 * Each list is sorted by code point.
 */
export function diffManifest(
  listed: ManifestEntry[],
  actual: ManifestEntry[],
  extraUnlisted: string[],
): ManifestDiff {
  const listedMap = new Map<string, string>(listed.map((e) => [e.path, e.sha256] as [string, string]));
  const actualMap = new Map<string, string>(actual.map((e) => [e.path, e.sha256] as [string, string]));

  const missing: string[] = [];
  const changed: string[] = [];
  for (const [path, hash] of listedMap) {
    const found = actualMap.get(path);
    if (found === undefined) missing.push(path);
    else if (found !== hash) changed.push(path);
  }

  const unlisted: string[] = [];
  for (const path of actualMap.keys()) {
    if (!listedMap.has(path)) unlisted.push(path);
  }
  unlisted.push(...extraUnlisted);

  return {
    missing: sortPaths(missing),
    changed: sortPaths(changed),
    unlisted: sortPaths([...new Set(unlisted)]),
  };
}
