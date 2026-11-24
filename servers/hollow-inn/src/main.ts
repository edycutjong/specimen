// stdio entry: `npx tsx servers/hollow-inn/src/main.ts <version>` — what Kiro, `specimen replay` and the Stop gate start.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSIONS, createServer, isVersion } from "./index.js";

const version = process.argv[2] ?? "v1";
if (!isVersion(version)) {
  process.stderr.write(`hollow-inn: unknown version "${version}" (expected one of ${VERSIONS.join(", ")})\n`);
  process.exit(2);
}
await createServer(version).connect(new StdioServerTransport());
