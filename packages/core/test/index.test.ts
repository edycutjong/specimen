import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("@specimen/core entry", () => {
  it("re-exports the json, sha256 and payload modules", () => {
    expect(typeof core.canonicalJson).toBe("function");
    expect(typeof core.isJsonResponse).toBe("function");
    expect(typeof core.inputHash).toBe("function");
    expect(typeof core.sha256Hex).toBe("function");
    expect(typeof core.validSessionId).toBe("function");
    expect(typeof core.fieldPaths).toBe("function");
    expect(core.prePayloadSchema).toBeDefined();
    expect(core.postPayloadSchema).toBeDefined();
    expect(core.sessionIdRe).toBeInstanceOf(RegExp);
  });
});
