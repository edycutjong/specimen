import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACT_CONFIG,
  MARKER,
  compileRedact,
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

describe("redaction examples: sibling literals", () => {
  it("keeps 425.00 byte-identical beside a redacted sibling key", () => {
    const text =
      '{"room_id":"r-04","password":"hunter2","nightly":212.50,"total":425.00,"nights":2,"currency":"USD"}';
    const result = redactResponse(text, base);
    expect(result.responseText).toBe(
      '{"room_id":"r-04","password":"[REDACTED]","nightly":212.50,"total":425.00,"nights":2,"currency":"USD"}',
    );
    expect(result.responseText.split("425.00")).toHaveLength(2);
  });

  it("keeps 425.00 byte-identical when the redacted key sits one level deeper", () => {
    const result = redactResponse('{"quote":{"secret":"s3cr3t","total":425.00}}', base);
    expect(result.responseText).toBe('{"quote":{"secret":"[REDACTED]","total":425.00}}');
    expect(result.pointers).toEqual(["/quote/secret"]);
  });
});

describe("redaction examples: non-JSON responses", () => {
  it("replaces every pattern match, and a sensitive key's value written as JSON, in plain text and sets text_redacted", () => {
    const result = redactResponse("Booked. Key sk-ABCDEFGHIJKLMNOPQRSTUV, mail ops@inn.example", base);
    expect(result.responseText).toBe(`Booked. Key ${MARKER}, mail ${MARKER}`);
    expect(result.textRedacted).toBe(true);
    expect(result.response).toBeNull();
    expect(result.responseLength).toBeUndefined();
    // a2a round 07: an error message that embeds JSON is text, so the key rule runs on it as well
    expect(redactResponse('Error: {"password":"hunter2","tokens_used":3}', base).responseText).toBe(
      `Error: {"password":"${MARKER}","tokens_used":3}`,
    );
    expect(redactResponse('Error: {"X-Auth-Token": 1234} retry', base).responseText).toBe(`Error: {"X-Auth-Token": "${MARKER}"} retry`);
    // an object or array under a sensitive key cannot be bounded in free text: the whole text goes
    expect(redactResponse('Error: {"secret":{"k":"v"}} at line 3', base).responseText).toBe(MARKER);
  });

  it("redacts a JSON string scalar as text, keeping its quote marks", () => {
    const result = redactResponse('"Bearer abc.def"', base);
    expect(result.responseText).toBe(`"${MARKER}"`);
    expect(result.textRedacted).toBe(true);
    expect(result.response).toBeNull();
  });
});

describe("redaction examples: hash mode", () => {
  const hashing = compile({ ...DEFAULT_REDACT_CONFIG, text: "hash" });

  it("stores only the SHA-256 of the replaced text, its UTF-16 length and no response", () => {
    const original = "Ünïcode 😀 a@b.co";
    const replaced = `Ünïcode 😀 ${MARKER}`;
    const digest = createHash("sha256").update(replaced, "utf8").digest("hex");

    const result = redactResponse(original, hashing);

    expect(result.responseText).toBe(`sha256:${digest}`);
    expect(result.responseLength).toBe(21);
    expect(replaced.length).toBe(21);
    expect(result.response).toBeNull();
    expect(result.textRedacted).toBe(true);
    expect(result.pointers).toEqual([]);
    expect(result.responseText).not.toContain("a@b.co");
    expect(result.responseText).not.toContain("Ünïcode");
  });
});

describe("redaction examples: shipped .specimen/redact.json", () => {
  it("matches DEFAULT_REDACT_CONFIG exactly, with no extra keys and the three named patterns", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(
      readFileSync(join(here, "..", "..", "..", ".specimen", "redact.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(raw).toStrictEqual(DEFAULT_REDACT_CONFIG);
    expect(Object.keys(raw).sort()).toEqual(["keys", "patterns", "text"]);
    expect(new Set(DEFAULT_REDACT_CONFIG.keys)).toEqual(
      new Set(["authorization", "password", "secret", "token", "api_key"]),
    );
    expect(DEFAULT_REDACT_CONFIG.patterns).toEqual([
      "Bearer\\s+[A-Za-z0-9._~+/=-]+",
      "sk-[A-Za-z0-9]{20,}",
      "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
    ]);
  });
});
