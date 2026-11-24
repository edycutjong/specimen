// The one entry point every caller uses: the stdio main, `specimen replay`, the Stop gate and the browser cabinet.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InnOptions } from "./inn.js";
import { createV1 } from "./v1.js";

export const VERSIONS = ["v1"] as const;
export type Version = (typeof VERSIONS)[number];
export const isVersion = (v: string): v is Version => (VERSIONS as readonly string[]).includes(v);

export function createServer(version: Version, opts: InnOptions = {}): McpServer {
  switch (version) {
    case "v1":
      return createV1(opts);
  }
}

export { Money, toJsonText } from "./money.js";
export { ROOMS } from "./inn.js";
