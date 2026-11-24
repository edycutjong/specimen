import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Json } from "../src/json.js";
import {
  DEFAULT_REDACT_CONFIG,
  MARKER,
  compileRedact,
  redactConfigSchema,
  redactInput,
  redactResponse,
  type Compiled,
  type RedactConfig,
} from "../src/redact.js";

function compile(c: RedactConfig): Compiled {
  const result = compileRedact(c);
  if (!result.ok) throw new Error(`pattern ${result.patternIndex} rejected`);
  return result.value;
}

const base = compile(DEFAULT_REDACT_CONFIG);

describe("redactConfigSchema", () => {
  it("accepts the default config", () => {
    expect(redactConfigSchema.safeParse(DEFAULT_REDACT_CONFIG).success).toBe(true);
  });

  it("rejects an unknown key", () => {
    expect(redactConfigSchema.safeParse({ ...DEFAULT_REDACT_CONFIG, extra: 1 }).success).toBe(
      false,
    );
  });

  it("rejects a text mode other than redact or hash", () => {
    expect(redactConfigSchema.safeParse({ ...DEFAULT_REDACT_CONFIG, text: "mask" }).success).toBe(
      false,
    );
  });
});

describe("compileRedact", () => {
  it("compiles the default patterns", () => {
    expect(compileRedact(DEFAULT_REDACT_CONFIG).ok).toBe(true);
  });

  it("names the index of a pattern that is not a valid regular expression", () => {
    const result = compileRedact({ keys: [], patterns: ["ok", "("], text: "redact" });
    expect(result).toEqual({ ok: false, patternIndex: 1 });
  });

  it("names the index of a pattern that matches the empty string", () => {
    const result = compileRedact({ keys: [], patterns: ["x*"], text: "redact" });
    expect(result).toEqual({ ok: false, patternIndex: 0 });
  });
});

describe("redactInput", () => {
  it("replaces a value of any JSON type under a listed key and records its pointer", () => {
    const input: Json = { password: 12, room: "r-04", token: { a: 1 } };
    const { value, pointers } = redactInput(input, base);
    expect(value).toEqual({ password: MARKER, room: "r-04", token: MARKER });
    expect(pointers).toEqual(["/password", "/token"]);
  });

  it("replaces a string array element that matches a pattern as a whole string", () => {
    const { value, pointers } = redactInput({ notes: ["fine", "Bearer abc.def"] }, base);
    expect(value).toEqual({ notes: ["fine", MARKER] });
    expect(pointers).toEqual(["/notes/1"]);
  });

  it("replaces the whole string, not only the matching part", () => {
    const { value } = redactInput({ text: "contact a@b.co please" }, base);
    expect(value).toEqual({ text: MARKER });
  });

  it("escapes ~ and / in pointer tokens per RFC 6901", () => {
    const c = compile({ keys: ["a/b~c"], patterns: [], text: "redact" });
    const { pointers } = redactInput({ "a/b~c": 1 }, c);
    expect(pointers).toEqual(["/a~1b~0c"]);
  });

  it("keeps a __proto__ key as an own data property", () => {
    const input = JSON.parse('{"__proto__":{"x":1},"token":"t"}') as Json;
    const { value, pointers } = redactInput(input, base);
    const descriptor = Object.getOwnPropertyDescriptor(value, "__proto__");
    expect(descriptor?.value).toEqual({ x: 1 });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(pointers).toEqual(["/token"]);
  });
});

describe("redactResponse on a JSON_Response", () => {
  it("replaces only the listed value and keeps number literals outside the span", () => {
    const text = '{"token":"abc123","total":425.00,"nightly":212.50}';
    const result = redactResponse(text, base);
    expect(result.responseText).toBe('{"token":"[REDACTED]","total":425.00,"nightly":212.50}');
    expect(result.pointers).toEqual(["/token"]);
    expect(result.textRedacted).toBe(false);
    expect(result.response).toEqual({ token: MARKER, total: 425, nightly: 212.5 });
  });

  it("returns the text byte-identical when nothing needs redacting", () => {
    const text = '{"total":425.00,"currency":"USD"}';
    const result = redactResponse(text, base);
    expect(result.responseText).toBe(text);
    expect(result.pointers).toEqual([]);
  });

  it("replaces only the outermost value when a located value contains another", () => {
    const result = redactResponse('{"token":{"inner":"x","token":"y"},"n":1}', base);
    expect(result.responseText).toBe('{"token":"[REDACTED]","n":1}');
    expect(result.pointers).toEqual(["/token"]);
  });

  it("replaces every duplicate key and lists its pointer once", () => {
    const result = redactResponse('{"token":"a","token":"b"}', base);
    expect(result.responseText).toBe('{"token":"[REDACTED]","token":"[REDACTED]"}');
    expect(result.pointers).toEqual(["/token"]);
  });

  it("replaces a string value whose content matches a pattern", () => {
    const result = redactResponse('{"note":"ping Bearer abc.def ok","n":425.00}', base);
    expect(result.responseText).toBe('{"note":"[REDACTED]","n":425.00}');
    expect(result.pointers).toEqual(["/note"]);
  });

  it("records pointers of array elements", () => {
    const result = redactResponse('["x@y.io","fine"]', base);
    expect(result.responseText).toBe('["[REDACTED]","fine"]');
    expect(result.pointers).toEqual(["/0"]);
  });

  it("sorts pointers by code-unit order across the whole response", () => {
    const text =
      '{"b":{"token":"1"},"a":{"password":"2"},"c":"sk-abcdefghijklmnopqrstuvwxyz"}';
    const result = redactResponse(text, base);
    expect(result.pointers).toEqual(["/a/password", "/b/token", "/c"]);
  });
});

describe("redactResponse on non-JSON text", () => {
  it("replaces each pattern match with the marker and sets textRedacted", () => {
    const result = redactResponse("mail a@b.co now", base);
    expect(result.responseText).toBe(`mail ${MARKER} now`);
    expect(result.textRedacted).toBe(true);
    expect(result.response).toBeNull();
    expect(result.responseLength).toBeUndefined();
  });

  it("sets textRedacted even when no pattern matched", () => {
    const result = redactResponse("plain text", base);
    expect(result.responseText).toBe("plain text");
    expect(result.textRedacted).toBe(true);
    expect(result.response).toBeNull();
  });

  it("treats a scalar JSON value as non-JSON text", () => {
    const result = redactResponse("42", base);
    expect(result.responseText).toBe("42");
    expect(result.response).toBeNull();
    expect(result.textRedacted).toBe(true);
  });

  it("stores the SHA-256 of the replaced text in hash mode", () => {
    const hashing = compile({ ...DEFAULT_REDACT_CONFIG, text: "hash" });
    const replaced = `mail ${MARKER} now`;
    const hex = createHash("sha256").update(replaced, "utf8").digest("hex");
    const result = redactResponse("mail a@b.co now", hashing);
    expect(result.responseText).toBe(`sha256:${hex}`);
    expect(result.responseLength).toBe(replaced.length);
    expect(result.response).toBeNull();
    expect(result.textRedacted).toBe(true);
    expect(result.responseText).not.toContain("a@b.co");
  });
});

describe("shipped .specimen/redact.json", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = JSON.parse(
    readFileSync(join(here, "..", "..", "..", ".specimen", "redact.json"), "utf8"),
  ) as unknown;

  it("equals the built-in default config", () => {
    expect(redactConfigSchema.parse(file)).toEqual(DEFAULT_REDACT_CONFIG);
  });

  it("lists the five required keys and the bearer, sk- and e-mail patterns", () => {
    const parsed = redactConfigSchema.parse(file);
    for (const key of ["authorization", "password", "secret", "token", "api_key"]) {
      expect(parsed.keys).toContain(key);
    }
    expect(parsed.patterns.some((p) => p.includes("Bearer"))).toBe(true);
    expect(parsed.patterns.some((p) => p.includes("sk-"))).toBe(true);
    expect(parsed.patterns.some((p) => p.includes("@"))).toBe(true);
    expect(parsed.text).toBe("redact");
  });
});
