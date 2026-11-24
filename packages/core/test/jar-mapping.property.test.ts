import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildJarLine, durationMs, type BuildArgs } from "../src/pairing.js";
import { jarLineSchema } from "../src/jar.js";
import { isJsonResponse, type Json } from "../src/json.js";
import {
  compileRedact,
  DEFAULT_REDACT_CONFIG,
  redactInput,
  redactResponse,
  type Compiled,
  type RedactConfig,
} from "../src/redact.js";

const RUNS = { numRuns: 200 };
const BASE_MS = Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const MAX_INT32 = 2147483647;

/** Keys used in generated inputs and responses. "a/b" and "c~d" exercise RFC 6901 escaping. */
const KEYS = ["guest", "token", "password", "note", "a/b", "c~d"];

const iso = (offsetMs: number): string => new Date(BASE_MS + offsetMs).toISOString();

function compileOrThrow(c: RedactConfig): Compiled {
  const result = compileRedact(c);
  if (!result.ok) throw new Error(`test config pattern ${result.patternIndex} must compile`);
  return result.value;
}

/** Default config plus two custom configs (redact and hash text modes) that use escaped keys. */
const configArb = fc
  .constantFrom<RedactConfig>(
    DEFAULT_REDACT_CONFIG,
    {
      keys: ["token", "password", "a/b", "c~d"],
      patterns: ["secret-[0-9]+", "[a-z]+@[a-z]+\\.co"],
      text: "redact",
    },
    {
      keys: ["token", "password", "a/b", "c~d"],
      patterns: ["secret-[0-9]+", "[a-z]+@[a-z]+\\.co"],
      text: "hash",
    },
  )
  .map(compileOrThrow);

const scalarArb: fc.Arbitrary<Json> = fc.oneof(
  fc.constantFrom<Json>("plain", "secret-42", "x@y.co", "", "Bearer abc", "sk-aaaaaaaaaaaaaaaaaaaa", 425.5),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);

const valueArb: fc.Arbitrary<Json> = fc.oneof(
  scalarArb,
  fc.array(scalarArb, { maxLength: 3 }),
  fc.dictionary(fc.constantFrom(...KEYS), scalarArb, { maxKeys: 3 }),
);

const inputArb: fc.Arbitrary<Json> = fc.oneof(
  scalarArb,
  fc.array(valueArb, { maxLength: 3 }),
  fc.dictionary(fc.constantFrom(...KEYS), valueArb, { maxKeys: 4 }),
);

/** Response texts: JSON objects (including raw literals such as 425.00), and non-JSON text. */
const responseTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    `{"total":425.00,"nightly":212.50,"token":"abc"}`,
    `{"note":"secret-7","total":425.00}`,
    `[{"password":"x"},{"a/b":1}]`,
  ),
  fc
    .dictionary(fc.constantFrom(...KEYS), scalarArb, { maxKeys: 4 })
    .map((o) => JSON.stringify(o)),
  fc.constantFrom("", "plain text", "secret-7 and x@y.co", "bearer hi"),
  fc.string({ maxLength: 24 }),
);

/** A random pre and post pair, with the redaction config applied to both. */
const pairArb = fc.record({
  sessionId: fc.constantFrom("sess-a", "s_1.b"),
  seq: fc.integer({ min: 1, max: 1000 }),
  call: fc.constantFrom(
    { tool: "quote", toolId: "mcp_hollowinn_quote" },
    { tool: "book", toolId: "mcp_hollowinn_book" },
  ),
  serial: fc.integer({ min: 1, max: 9999 }),
  preOffset: fc.integer({ min: 0, max: 4_000_000_000 }),
  postOffset: fc.integer({ min: 0, max: 4_000_000_000 }),
  unpaired: fc.boolean(),
  input: inputArb,
  responseText: responseTextArb,
  config: configArb,
});

/** Lexicographic order by UTF-16 code unit, the order used by the default string sort. */
const isStrictlyAscending = (items: readonly string[]): boolean =>
  items.every((item, i) => i === 0 || (items[i - 1] ?? "") < item);

// Feature: jar-capture, Property 10: Jar_Line field mapping
// **Validates: Requirements 1.14, 1.15, 4.5, 4.7, 4.15, 4.16, 4.17, 4.18, 4.19, 4.20**
describe("Property 10: Jar_Line field mapping", () => {
  it("buildJarLine maps every field from the pre and post pair as the design specifies", () => {
    fc.assert(
      fc.property(pairArb, (p) => {
        const redactedInput = redactInput(p.input, p.config);
        const response = redactResponse(p.responseText, p.config);
        const t0 = iso(p.preOffset);
        const t1 = iso(p.postOffset);
        const measured = durationMs(t0, t1).ms;

        const args: BuildArgs = {
          id: `SPC-${String(p.serial).padStart(4, "0")}`,
          sessionId: p.sessionId,
          seq: p.seq,
          server: "hollowinn",
          tool: p.call.tool,
          toolId: p.call.toolId,
          input: redactedInput.value,
          inputPointers: redactedInput.pointers,
          response,
          t0,
          t1,
          durationMs: measured,
          unpaired: p.unpaired,
        };
        const line = buildJarLine(args);

        // Identity fields pass through unchanged.
        expect(line.v).toBe(1);
        expect(line.id).toBe(args.id);
        expect(line.session_id).toBe(p.sessionId);
        expect(line.seq).toBe(p.seq);
        expect(line.server).toBe("hollowinn");
        expect(line.tool).toBe(p.call.tool);
        expect(line.tool_id).toBe(p.call.toolId);

        // input is the redacted input; response_text is the redaction result.
        expect(line.input).toEqual(redactedInput.value);
        expect(line.response_text).toBe(response.responseText);

        // response is JSON.parse(response_text) for a JSON_Response, otherwise null.
        const expectedResponse = isJsonResponse(response.responseText)
          ? JSON.parse(response.responseText)
          : null;
        expect(line.response).toEqual(expectedResponse);

        // redacted is the sorted, deduplicated union of the prefixed pointers.
        const expectedRedacted = [
          ...new Set([
            ...redactedInput.pointers.map((q) => `/input${q}`),
            ...response.pointers.map((q) => `/response${q}`),
          ]),
        ].sort();
        expect(line.redacted).toEqual(expectedRedacted);
        expect(isStrictlyAscending(line.redacted as string[])).toBe(true);

        // Timestamps and duration: unpaired lines use t0 = t1 and duration 0.
        if (p.unpaired) {
          expect(line.t0).toBe(t1);
          expect(line.t1).toBe(t1);
          expect(line.duration_ms).toBe(0);
          expect(line.unpaired).toBe(true);
        } else {
          expect(line.t0).toBe(t0);
          expect(line.t1).toBe(t1);
          expect(line.duration_ms).toBe(measured);
          expect("unpaired" in line).toBe(false);
        }

        // Optional flags appear exactly when the redaction result sets them.
        if (response.textRedacted) {
          expect(line.text_redacted).toBe(true);
        } else {
          expect("text_redacted" in line).toBe(false);
        }
        if (response.responseLength !== undefined) {
          expect(line.response_length).toBe(response.responseLength);
        } else {
          expect("response_length" in line).toBe(false);
        }

        // The built line is a valid Jar_Line.
        expect(jarLineSchema.safeParse(line).success).toBe(true);
      }),
      RUNS,
    );
  });
});

// Feature: jar-capture, Property 3: Duration is the clamped difference
// **Validates: Requirements 1.14, 1.15, 4.7**
describe("Property 3: Duration is the clamped difference", () => {
  it("durationMs equals max(0, t1 - t0) in milliseconds, is never negative, and flags t1 < t0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.integer({ min: 0, max: 2_000_000_000 }),
        (a, b) => {
          const result = durationMs(iso(a), iso(b));
          expect(result.ms).toBe(Math.max(0, b - a));
          expect(result.ms).toBeGreaterThanOrEqual(0);
          expect(result.anomaly).toBe(b < a);
        },
      ),
      RUNS,
    );
  });

  it("durationMs also caps the result at the signed 32-bit bound of Requirement 1.7", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000 }),
        fc.integer({ min: 0, max: 4_000_000_000 }),
        (a, b) => {
          const result = durationMs(iso(a), iso(b));
          expect(result.ms).toBe(Math.min(Math.max(0, b - a), MAX_INT32));
          expect(result.ms).toBeGreaterThanOrEqual(0);
          expect(result.ms).toBeLessThanOrEqual(MAX_INT32);
        },
      ),
      RUNS,
    );
  });
});
