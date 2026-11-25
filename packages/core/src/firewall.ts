/**
 * Firewall decision for writes that could touch `jars/`. Pure string logic: the caller
 * performs every file system access (including symbolic link resolution) and passes the
 * results in. No Node built-in imports, no clock, no I/O.
 */

export type FirewallCandidate = { lexical: string; real: string };

export type FirewallDecision = "block" | "allow";

/** Turns backslashes into "/" so that a Windows-style path is treated as a POSIX path. */
function toSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * True for a POSIX absolute path and for a Windows drive-letter absolute path (`C:/…` once the
 * backslashes are turned around). Without the drive-letter case, `C:\repo\jars\x.jsonl` was
 * joined onto the cwd and never compared equal to the jars directory (a2a round 05).
 */
function isAbsolute(slashed: string): boolean {
  return slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed);
}

/**
 * Makes `p` absolute against `cwd` and collapses "." and ".." segments. Empty segments
 * (from "//") are dropped. A ".." above the root stays at the root. The letter case is
 * kept; comparison lowercases later.
 */
export function lexicalResolve(cwd: string, p: string): string {
  const joined = isAbsolute(toSlashes(p)) ? toSlashes(p) : `${toSlashes(cwd)}/${toSlashes(p)}`;
  const stack: string[] = [];
  for (const segment of joined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return `/${stack.join("/")}`;
}

/**
 * Every string at any depth of a parsed tool input, in depth-first order. Object keys are
 * not candidates, only values. Uses an explicit stack, so depth does not cause recursion.
 */
export function candidatePaths(toolInput: unknown): string[] {
  const found: string[] = [];
  const stack: unknown[] = [toolInput];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === "string") {
      found.push(node);
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
    } else if (node !== null && typeof node === "object") {
      const values = Object.values(node);
      for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
    }
  }
  return found;
}

/** Lowercases and normalises separators so that the comparison ignores case and "\" vs "/". */
function comparable(p: string): string {
  return toSlashes(p).toLowerCase();
}

/** True when `path` equals `root` or lies under it. Both arguments are comparable forms. */
function equalOrUnder(path: string, root: string): boolean {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Blocks when any candidate's lexical path, or its real path, is equal to or under the
 * matching form of the jars directory. Comparison ignores letter case.
 */
export function decideFirewall(a: {
  jarsLexical: string;
  jarsReal: string;
  candidates: FirewallCandidate[];
}): FirewallDecision {
  const jarsLexical = comparable(a.jarsLexical);
  const jarsReal = comparable(a.jarsReal);
  for (const c of a.candidates) {
    if (equalOrUnder(comparable(c.lexical), jarsLexical)) return "block";
    if (equalOrUnder(comparable(c.real), jarsReal)) return "block";
  }
  return "allow";
}
