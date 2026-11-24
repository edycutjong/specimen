#!/usr/bin/env node
// Runs the TypeScript CLI from source. Warnings are removed before tsx registers, so Node
// and tsx print nothing on stderr. main.ts loads only after tsx is registered.
process.removeAllListeners("warning");
const { register } = await import("tsx/esm/api");
register();
const { run } = await import("../src/main.ts");
await run(process.argv);
