/**
 * The stdio Client_Factory of `specimen replay`. It is the only CLI file that spawns a server
 * process. Each call starts a new child process with the MCP SDK StdioClientTransport and no
 * shell. Child STDERR is piped and discarded. The connect timeout is enforced here, because
 * packages/core has no timers. Per-request timeouts are passed by packages/core to the SDK.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ClientFactory } from "@specimen/core";

/** A `--server` or `--baseline` command that cannot be split into arguments. */
export class CommandSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandSyntaxError";
  }
}

/**
 * Splits a command into an executable and its arguments by whitespace. Single and double quotes
 * group text, including whitespace, and are removed. Adjacent quoted and unquoted text join into
 * one argument, and `""` gives an empty argument. An empty command gives no words. No other
 * escaping applies. Throws CommandSyntaxError on an unterminated quote.
 */
export function splitCommand(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | undefined;

  for (const ch of command) {
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    word += ch;
    inWord = true;
  }

  if (quote !== undefined) {
    throw new CommandSyntaxError(`unterminated ${quote === '"' ? "double" : "single"} quote`);
  }
  if (inWord) words.push(word);
  return words;
}

/** Rejects with an error when `work` has not settled within `ms` milliseconds. */
async function withConnectTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`connect timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds a Client_Factory that starts `command` as a child process in `root` for every call.
 * The command is split once, so an unterminated quote throws here. Each returned close function
 * closes the SDK client, which ends the transport and its child process.
 */
export function makeStdioClientFactory(command: string, timeoutMs: number, root: string): ClientFactory {
  const [executable, ...args] = splitCommand(command);
  if (executable === undefined) throw new CommandSyntaxError("the command is empty");

  return async () => {
    const transport = new StdioClientTransport({
      command: executable,
      args,
      cwd: root,
      stderr: "pipe",
    });
    // Drain the piped STDERR and discard it, so a chatty server never blocks on a full pipe.
    transport.stderr?.on("data", () => undefined);

    const client = new Client({ name: "specimen", version: "0.0.0" });
    try {
      await withConnectTimeout(client.connect(transport, { timeout: timeoutMs }), timeoutMs);
    } catch (failure) {
      await transport.close().catch(() => undefined);
      throw failure;
    }
    return { client, close: () => client.close() };
  };
}
