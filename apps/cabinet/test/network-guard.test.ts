// @vitest-environment jsdom
/**
 * Requirements 16.8 and 17.2: the page makes no network calls. The four browser network entry
 * points (fetch, XMLHttpRequest, WebSocket and EventSource) are replaced with recorders. A full
 * replay and its Reveal run through the real App, and the test fails if any recorder is called.
 * The MCP SDK is not mocked: the replay uses the real Client and Server over InMemoryTransport.
 */
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

/** Names of the recorders that were called, in call order. An empty list means no network call. */
const calls: string[] = [];

/** The VerdictPlate counts line of hollow-inn v2 over the committed jars (evidence/replay/racks-vs-v2.txt). */
const V2_COUNTS = /5 preserved · 4 rattled · 1 cracked/;
const NOT_REPLAYED = /— not replayed$/;

function recordFetch(): Promise<Response> {
  calls.push("fetch");
  return Promise.reject(new Error("fetch must not be called"));
}

function recordingClass(name: string): new (...args: unknown[]) => never {
  return class RecordingNetworkClass {
    constructor() {
      calls.push(name);
      throw new Error(`${name} must not be called`);
    }
  } as unknown as new (...args: unknown[]) => never;
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", recordFetch);
  vi.stubGlobal("XMLHttpRequest", recordingClass("XMLHttpRequest"));
  vi.stubGlobal("WebSocket", recordingClass("WebSocket"));
  vi.stubGlobal("EventSource", recordingClass("EventSource"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("network guard", () => {
  it("the recorders catch a call, so the guard below cannot pass vacuously", () => {
    expect(() => new XMLHttpRequest()).toThrow("XMLHttpRequest must not be called");
    expect(() => new EventSource("/events")).toThrow("EventSource must not be called");
    expect(() => new WebSocket("ws://localhost/")).toThrow("WebSocket must not be called");
    void fetch("/data.json").catch(() => undefined);

    expect(calls).toEqual(["XMLHttpRequest", "EventSource", "WebSocket", "fetch"]);
    calls.length = 0;
  });

  it("a full replay and its Reveal make no fetch, XMLHttpRequest, WebSocket or EventSource call", async () => {
    render(createElement(App));

    // The replay has finished when the v2 counts show, and the Reveal is complete when no jar is
    // still "not replayed". Each jar takes its state on a timer, so both waits are needed.
    await screen.findByText(V2_COUNTS, undefined, { timeout: 15_000 });
    await waitFor(() => expect(screen.queryAllByRole("button", { name: NOT_REPLAYED })).toHaveLength(0), {
      timeout: 15_000,
    });
    expect(screen.getAllByRole("button", { name: /— rattled/ })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /— cracked/ })).toHaveLength(1);

    expect(calls).toEqual([]);
  });
});
