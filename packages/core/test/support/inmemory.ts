// Test-only Client_Factory builders. Every factory connects the real MCP SDK Client to the real
// hollow-inn server through InMemoryTransport. Nothing here mocks the MCP protocol. The failing
// factory wraps a real client and makes one chosen step fail, for the failure-path tests.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type Version } from "../../../../servers/hollow-inn/src/index.js";
import type { ClientFactory } from "../../src/index.js";

/** A fresh hollow-inn server of one version, linked to a connected SDK client. */
export function makeInMemoryClientFactory(version: Version): ClientFactory {
  return async () => {
    const server = createServer(version);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "specimen-test", version: "0.0.0" });
    await client.connect(clientTransport);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  };
}

/**
 * Where a failing factory breaks.
 * - `connect`: the factory itself throws a request timeout.
 * - `list`: tools/list throws a request timeout.
 * - `call`: the `call`-th tools/call of each session (1-based) fails. `timeout` throws the
 *   SDK's request-timeout McpError without sending the request. `transport-close` closes the
 *   real client transport first, so the call fails the way a dead connection does.
 */
export type FailPlan =
  | { at: "connect" }
  | { at: "list" }
  | { at: "call"; call: number; kind: "timeout" | "transport-close" };

/** Wraps a real Client_Factory so that one chosen step fails. */
export function makeFailingClientFactory(base: ClientFactory, plan: FailPlan): ClientFactory {
  return async () => {
    if (plan.at === "connect") {
      throw new McpError(ErrorCode.RequestTimeout, "Connection attempt timed out");
    }
    const session = await base();
    let calls = 0;
    const client = new Proxy(session.client, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "listTools" && plan.at === "list") {
          return () => Promise.reject(new McpError(ErrorCode.RequestTimeout, "tools/list timed out"));
        }
        if (property === "callTool" && plan.at === "call") {
          return async (...args: Parameters<Client["callTool"]>) => {
            calls += 1;
            if (calls === plan.call) {
              if (plan.kind === "timeout") {
                throw new McpError(ErrorCode.RequestTimeout, "Request timed out");
              }
              await target.close();
            }
            return target.callTool(...args);
          };
        }
        return value.bind(target);
      },
    });
    return { client, close: session.close };
  };
}
