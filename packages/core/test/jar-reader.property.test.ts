import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readJar, type JarError } from "../src/index.js";

// Feature: jar-capture, Property 2: Jar reader locates every defect
// **Validates: Requirements 1.18, 1.19, 1.20, 1.21**

const RUNS = { numRuns: 200 };
const MAX_INT32 = 2147483647;

type Raw = Record<string, unknown>;

/** Text that JSON.parse rejects. Each entry is a different kind of malformed JSON. */
const INVALID_JSON = ['{"v":1', "[1,2", "{not json", "null]", "tru", '{"a" 1}'];

/** Each entry breaks exactly one schema rule and names the field the reader must report. */
const SCHEMA_DEFECTS: Array<{ field: string; apply: (r: Raw) => Raw }> = [
  { field: "v", apply: (r) => ({ ...r, v: 2 }) },
  { field: "id", apply: (r) => ({ ...r, id: "SPC-1" }) },
  { field: "session_id", apply: (r) => ({ ...r, session_id: "a/b" }) },
  { field: "seq", apply: (r) => ({ ...r, seq: 0 }) },
  { field: "server", apply: (r) => ({ ...r, server: "" }) },
  { field: "tool", apply: (r) => ({ ...r, tool: "" }) },
  { field: "tool_id", apply: (r) => ({ ...r, tool_id: "" }) },
  { field: "response", apply: (r) => omit(r, "response") },
  { field: "response_text", apply: (r) => ({ ...r, response_text: 42 }) },
  { field: "t0", apply: (r) => ({ ...r, t0: "2025-01-01T10:00:00.000" }) },
  { field: "t1", apply: (r) => ({ ...r, t1: "not a time" }) },
  { field: "duration_ms", apply: (r) => ({ ...r, duration_ms: -1 }) },
  { field: "redacted.0", apply: (r) => ({ ...r, redacted: ["/other/x"] }) },
  { field: "text_redacted", apply: (r) => ({ ...r, text_redacted: "yes" }) },
];

type Defect =
  | { kind: "json"; text: string }
  | { kind: "schema"; field: string; apply: (r: Raw) => Raw }
  | { kind: "unknown_field"; key: string }
  | { kind: "blank" }
  | { kind: "incomplete" };

function omit(r: Raw, key: string): Raw {
  const out: Raw = { ...r };
  delete out[key];
  return out;
}

const pad4 = (n: number): string => String(n).padStart(4, "0");

const nonEmptyText: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 12 });

const instantArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 4102444800000 })
  .map((ms) => new Date(ms).toISOString());

/** Field values for one valid Jar_Line. The `v`, `id` and `seq` fields are added by the caller. */
const bodyArb: fc.Arbitrary<Raw> = fc.record({
  session_id: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/),
  server: nonEmptyText,
  tool: nonEmptyText,
  tool_id: nonEmptyText,
  input: fc.dictionary(
    fc.string({ maxLength: 6 }),
    fc.oneof(
      fc.string({ maxLength: 8 }),
      fc.integer({ min: -1000, max: 1000 }),
      fc.boolean(),
      fc.constant(null),
    ),
  ),
  response_text: fc.string({ maxLength: 40 }),
  response: fc.oneof(fc.constant(null), fc.record({ total: fc.integer({ min: 0, max: 99999 }) })),
  t0: instantArb,
  t1: instantArb,
  duration_ms: fc.integer({ min: 0, max: MAX_INT32 }),
  redacted: fc.constantFrom<string[]>([], ["/input/a"], ["/response/total"]),
});

/** Between one and six valid Jar_Lines with unique `id` and `seq` values, in file order. */
const recordsArb: fc.Arbitrary<Raw[]> = fc
  .array(bodyArb, { minLength: 1, maxLength: 6 })
  .map((bodies) =>
    bodies.map((body, i) => ({ v: 1, id: "SPC-" + pad4(i + 1), seq: i + 1, ...body })),
  );

const defectArb: fc.Arbitrary<Defect> = fc.oneof(
  fc.constantFrom(...INVALID_JSON).map((text): Defect => ({ kind: "json", text })),
  fc.constantFrom(...SCHEMA_DEFECTS).map(
    (d): Defect => ({ kind: "schema", field: d.field, apply: d.apply }),
  ),
  fc.stringMatching(/^zz_[a-z]{1,6}$/).map((key): Defect => ({ kind: "unknown_field", key })),
  fc.constant<Defect>({ kind: "blank" }),
  fc.constant<Defect>({ kind: "incomplete" }),
);

interface Rendered {
  text: string;
  expectedError: JarError;
  validIds: string[];
}

/**
 * Writes the Jar text with one defect at 0-based index `index` of the records. A final line
 * with no newline is always the last line, so its index is forced to the end.
 */
function render(records: Raw[], defect: Defect, index: number): Rendered {
  const n = records.length;
  const ids = records.map((r) => String(r.id));
  const texts = records.map((r) => JSON.stringify(r));

  switch (defect.kind) {
    case "json": {
      const i = index;
      texts[i] = defect.text;
      return {
        text: texts.join("\n") + "\n",
        expectedError: { line: i + 1, kind: "json" },
        validIds: ids.filter((_, j) => j !== i),
      };
    }
    case "schema": {
      const i = index;
      const bad = defect.apply(records[i] as Raw);
      texts[i] = JSON.stringify(bad);
      return {
        text: texts.join("\n") + "\n",
        expectedError: { line: i + 1, kind: "schema", field: defect.field },
        validIds: ids.filter((_, j) => j !== i),
      };
    }
    case "unknown_field": {
      const i = index;
      texts[i] = JSON.stringify({ ...(records[i] as Raw), [defect.key]: 1 });
      return {
        text: texts.join("\n") + "\n",
        expectedError: { line: i + 1, kind: "unknown_field", field: defect.key },
        validIds: ids.filter((_, j) => j !== i),
      };
    }
    case "blank": {
      const i = index;
      texts.splice(i, 0, "");
      return {
        text: texts.join("\n") + "\n",
        expectedError: { line: i + 1, kind: "blank" },
        validIds: ids,
      };
    }
    case "incomplete": {
      return {
        text: texts.join("\n"),
        expectedError: { line: n, kind: "incomplete" },
        validIds: ids.slice(0, -1),
      };
    }
  }
}

describe("Jar reader locates every defect (Property 2)", () => {
  it("reports exactly the injected defect at its 1-based line and keeps every other line", () => {
    fc.assert(
      fc.property(recordsArb, defectArb, fc.nat(), (records, defect, pick) => {
        const index =
          defect.kind === "incomplete" ? records.length - 1 : pick % records.length;
        const { text, expectedError, validIds } = render(records, defect, index);

        const result = readJar(text);

        expect(result.errors).toEqual([expectedError]);
        expect(result.lines.map((l) => l.id)).toEqual(validIds);
      }),
      RUNS,
    );
  });

  it("reads a defect-free Jar with every line and no errors", () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const text = records.map((r) => JSON.stringify(r)).join("\n") + "\n";

        const result = readJar(text);

        expect(result.errors).toEqual([]);
        expect(result.lines.map((l) => l.id)).toEqual(records.map((r) => String(r.id)));
      }),
      RUNS,
    );
  });
});
