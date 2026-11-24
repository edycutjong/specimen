// Spike harness: the S1 toy server over stdio, so a real Kiro session can call it. Not the product server.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createToyInn, type ToyVersion } from "../s1-browser/src/toy-inn";

const version = (process.argv[2] ?? "v1") as ToyVersion;
await createToyInn(version).connect(new StdioServerTransport());
