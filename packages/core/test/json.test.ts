import { describe, expect, it } from "vitest";
import { canonicalJson, inputHash, isJsonResponse, sha256Hex, type Json } from "../src/index.js";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and removes whitespace", () => {
    const value: Json = { b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } };
    expect(canonicalJson(value)).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });

  it("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("writes scalars with JSON.stringify rules", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson(425)).toBe("425");
    expect(canonicalJson('a"b\n')).toBe('"a\\"b\\n"');
  });

  it("treats __proto__ and constructor as ordinary keys", () => {
    const value = JSON.parse('{"constructor":2,"__proto__":{"x":1}}') as Json;
    expect(canonicalJson(value)).toBe('{"__proto__":{"x":1},"constructor":2}');
  });

  it("gives equal text for inputs that differ only in key order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe("isJsonResponse", () => {
  it("is true for a JSON object or array", () => {
    expect(isJsonResponse('{"a":1}')).toBe(true);
    expect(isJsonResponse("[]")).toBe(true);
  });

  it("is false for scalars, empty text and non-JSON text", () => {
    expect(isJsonResponse("425")).toBe(false);
    expect(isJsonResponse("null")).toBe(false);
    expect(isJsonResponse('"s"')).toBe(false);
    expect(isJsonResponse("")).toBe(false);
    expect(isJsonResponse("Room booked")).toBe(false);
  });
});

describe("inputHash", () => {
  it("is the SHA-256 of the canonical text", () => {
    const value: Json = { room: "r-04", nights: 2 };
    expect(inputHash(value)).toBe(sha256Hex(canonicalJson(value)));
    expect(inputHash(value)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is equal for key order differences only", () => {
    expect(inputHash({ a: 1, b: 2 })).toBe(inputHash({ b: 2, a: 1 }));
  });
});
