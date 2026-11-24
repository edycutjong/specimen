import type { z } from "zod";

/**
 * A one-line description of the first zod issue that names the failing field. It carries no
 * file text other than a key or field name, so the caller may print it to STDERR.
 */
export function describeFirstIssue(issues: readonly z.core.$ZodIssue[]): string {
  const issue = issues[0];
  if (issue === undefined) return "invalid content";
  if (issue.code === "unrecognized_keys") return `unknown field ${issue.keys[0] ?? "(unknown)"}`;
  const path = issue.path.map(String).join(".");
  return `invalid field ${path === "" ? "(root)" : path}`;
}
