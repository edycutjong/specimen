import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import {
  candidatePaths,
  decideFirewall,
  fieldPaths,
  lexicalResolve,
  validSessionId,
  type FirewallCandidate,
} from "@specimen/core";
import { realResolve } from "../io/fsx.js";
import { describeError, logDiag } from "../io/log.js";
import { findWorkspaceRoot } from "../io/root.js";
import { readStdin } from "../io/stdin.js";

const HOOK = "firewall";

/** The one line written to STDERR on a block. Kiro forwards it to the agent. */
export const FIREWALL_MESSAGE = "jars are evidence and read-only";

/**
 * Loose view of a Kiro PreToolUse payload. Only `cwd` and `tool_input` matter here. Unknown
 * keys are allowed, and a missing `tool_input` simply yields no candidate paths.
 */
const firewallPayloadSchema = z.looseObject({
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  tool_input: z.unknown(),
});

/** The real path, or the lexical path when the real path cannot be read (e.g. a NUL byte). */
function realOrLexical(lexical: string): string {
  try {
    return realResolve(lexical);
  } catch {
    return lexical;
  }
}

/**
 * Runs the firewall decision. Returns the exit status: 2 when a write targets `jars/`, 0
 * otherwise. Every failure is logged and returns 0, because a firewall fault must not block
 * unrelated writes (the manifest check is the backstop).
 */
export async function runFirewall(readInput: () => Promise<string>): Promise<number> {
  let root = findWorkspaceRoot(process.cwd());
  let sessionId: string | undefined;
  try {
    const text = await readInput();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      logDiag(root, HOOK, undefined, "stdin is not valid JSON");
      return 0;
    }
    const parsed = firewallPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      logDiag(root, HOOK, undefined, `payload invalid at ${fieldPaths(parsed.error.issues).join(", ")}`);
      return 0;
    }
    const payload = parsed.data;
    if (payload.session_id !== undefined && validSessionId(payload.session_id)) {
      sessionId = payload.session_id;
    }

    const cwd = resolve(payload.cwd ?? process.cwd());
    root = findWorkspaceRoot(cwd);

    const candidates = candidatePaths(payload.tool_input);
    if (candidates.length === 0) {
      logDiag(root, HOOK, sessionId, "no candidate path");
      return 0;
    }

    const jarsLexical = lexicalResolve(root, "jars");
    const jarsReal = realOrLexical(jarsLexical);
    const resolved: FirewallCandidate[] = candidates.map((path) => {
      const lexical = lexicalResolve(cwd, path);
      return { lexical, real: realOrLexical(lexical) };
    });

    if (decideFirewall({ jarsLexical, jarsReal, candidates: resolved }) === "block") {
      writeSync(2, `${FIREWALL_MESSAGE}\n`);
      return 2;
    }
    return 0;
  } catch (err) {
    logDiag(root, HOOK, sessionId, `unexpected ${describeError(err)}`);
    return 0;
  }
}

/** The `specimen hook firewall` command. Silent on STDOUT. STDERR is written only on a block. */
export function createFirewallCommand(): Command {
  return new Command("firewall")
    .description("PreToolUse guard for writes that target jars/")
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .action(async () => {
      process.exitCode = await runFirewall(readStdin);
    });
}
