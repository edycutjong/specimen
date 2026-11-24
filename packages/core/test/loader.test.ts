import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  PENDING_FILE,
  findOrphans,
  groupBySession,
  loadJars,
  loadPending,
  type JarFile,
  type JarLine,
  type PendingEntry,
  type SpoiledLine,
} from "../src/index.js";

const RUNS = { numRuns: 200 };
const T0 = "2025-01-01T10:00:00.000Z";
const T1 = "2025-01-01T10:00:01.000Z";
const ZERO_HASH = "0".repeat(64);

const pad4 = (n: number): string => String(n).padStart(4, "0");

/** A schema-valid Jar_Line as a plain record, ready to be written as one JSON line. */
function jarRecord(id: string, sessionId: string, seq: number): Record<string, unknown> {
  return {
    v: 1,
    id,
    session_id: sessionId,
    seq,
    server: "hollow-inn",
    tool: "quote",
    tool_id: "tool-1",
    input: { room_id: "r-04" },
    response_text: '{"total":425}',
    response: { total: 425 },
    t0: T0,
    t1: T1,
    duration_ms: 5,
    redacted: [],
  };
}

function pendingRecord(sessionId: string, seq: number): PendingEntry {
  return { session_id: sessionId, seq, tool_id: "tool-1", input_sha256: ZERO_HASH, t0: T0 };
}

/** One JSON object per line, each terminated by a newline. An empty list gives an empty file. */
function jarText(records: readonly Record<string, unknown>[]): string {
  return records.length === 0 ? "" : records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function asJarLine(record: Record<string, unknown>): JarLine {
  return record as unknown as JarLine;
}

describe("loadJars examples", () => {
  it("spoils a duplicate id in the later file and keeps the earlier one", () => {
    const files: JarFile[] = [
      { file: "b.jsonl", text: jarText([jarRecord("SPC-0002", "s1", 2)]) },
      { file: "a.jsonl", text: jarText([jarRecord("SPC-0002", "s1", 1)]) },
    ];

    const result = loadJars(files);

    expect(result.spoiled).toEqual([{ file: "b.jsonl", line: 1, reason: "duplicate id" }]);
    expect(result.lines.map((l) => l.seq)).toEqual([1]);
    expect(result.valid).toHaveLength(2);
  });

  it("spoils a duplicate (session_id, seq) and keeps a different session with the same seq", () => {
    const files: JarFile[] = [
      {
        file: "a.jsonl",
        text: jarText([
          jarRecord("SPC-0001", "s1", 1),
          jarRecord("SPC-0002", "s1", 1),
          jarRecord("SPC-0003", "s2", 1),
        ]),
      },
    ];

    const result = loadJars(files);

    expect(result.spoiled).toEqual([{ file: "a.jsonl", line: 2, reason: "duplicate seq" }]);
    expect(result.lines.map((l) => l.id)).toEqual(["SPC-0001", "SPC-0003"]);
  });

  it("reports a blank line, a line that is not JSON and an incomplete last line with their file", () => {
    const first = JSON.stringify(jarRecord("SPC-0001", "s1", 1));
    const second = JSON.stringify(jarRecord("SPC-0009", "s1", 2));
    const files: JarFile[] = [
      { file: "a.jsonl", text: `${first}\n{bad\n\n${second}\npartial` },
    ];

    const result = loadJars(files);

    expect(result.spoiled).toEqual([
      { file: "a.jsonl", line: 2, reason: "not valid JSON" },
      { file: "a.jsonl", line: 3, reason: "blank line" },
      { file: "a.jsonl", line: 5, reason: "incomplete line at end of file" },
    ]);
    expect(result.lines.map((l) => l.id)).toEqual(["SPC-0001", "SPC-0009"]);
  });

  it("orders spoiled lines by file name and then by line number", () => {
    const files: JarFile[] = [
      { file: "z.jsonl", text: "{bad\n" },
      { file: "a.jsonl", text: jarText([jarRecord("SPC-0001", "s1", 1), jarRecord("SPC-0001", "s1", 2)]) },
    ];

    const result = loadJars(files);

    expect(result.spoiled.map((s) => `${s.file}:${s.line}`)).toEqual(["a.jsonl:2", "z.jsonl:1"]);
  });
});

describe("loadPending examples", () => {
  it("spoils an invalid line with the pending file name and keeps the valid entries", () => {
    const text =
      JSON.stringify(pendingRecord("s1", 1)) +
      "\n" +
      JSON.stringify({ ...pendingRecord("s1", 2), extra: 1 }) +
      "\n" +
      "{bad\n";

    const result = loadPending(text);

    expect(PENDING_FILE).toBe(".specimen/pending.jsonl");
    expect(result.entries.map((e) => e.seq)).toEqual([1]);
    expect(result.spoiled).toEqual([
      { file: ".specimen/pending.jsonl", line: 2, reason: "unknown field extra" },
      { file: ".specimen/pending.jsonl", line: 3, reason: "not valid JSON" },
    ]);
  });

  it("names the failing field of a pending line that fails its schema", () => {
    const bad = { ...pendingRecord("s1", 1), input_sha256: "XYZ" };

    const result = loadPending(JSON.stringify(bad) + "\n");

    expect(result.entries).toEqual([]);
    expect(result.spoiled).toEqual([
      { file: PENDING_FILE, line: 1, reason: "invalid field input_sha256" },
    ]);
  });

  it("reads an empty Pending_File as holding no entry and no spoiled line", () => {
    expect(loadPending("")).toEqual({ entries: [], spoiled: [] });
  });
});

describe("findOrphans examples", () => {
  it("does not treat a pending entry as an orphan when a jar line has the same session_id and seq", () => {
    const loaded = loadJars([{ file: "a.jsonl", text: jarText([jarRecord("SPC-0001", "s1", 1)]) }]);
    const pending = [pendingRecord("s1", 1), pendingRecord("s1", 2)];

    const orphans = findOrphans(pending, loaded.valid);

    expect(orphans.map((e) => e.seq)).toEqual([2]);
  });

  it("does not treat a pending entry as an orphan when its jar line was spoiled as a duplicate", () => {
    const loaded = loadJars([
      {
        file: "a.jsonl",
        text: jarText([jarRecord("SPC-0001", "s1", 1), jarRecord("SPC-0002", "s1", 1)]),
      },
    ]);

    expect(findOrphans([pendingRecord("s1", 1)], loaded.valid)).toEqual([]);
  });
});

describe("groupBySession examples", () => {
  it("orders groups by lowest seq, then session_id in code-unit order, and members by seq", () => {
    const lines = [
      asJarLine(jarRecord("SPC-0001", "s1", 3)),
      asJarLine(jarRecord("SPC-0002", "s1", 1)),
      asJarLine(jarRecord("SPC-0003", "B", 1)),
      asJarLine(jarRecord("SPC-0004", "a", 1)),
      asJarLine(jarRecord("SPC-0005", "A", 2)),
    ];
    const orphans = [pendingRecord("s1", 2)];

    const groups = groupBySession(lines, orphans);

    expect(groups.map((g) => g.sessionId)).toEqual(["B", "a", "s1", "A"]);
    const s1 = groups.find((g) => g.sessionId === "s1");
    expect(s1?.members.map((m) => (m.kind === "jar" ? m.line.seq : m.entry.seq))).toEqual([1, 2, 3]);
    expect(s1?.members.map((m) => m.kind)).toEqual(["jar", "orphan", "jar"]);
  });

  it("returns no group for no input", () => {
    expect(groupBySession([], [])).toEqual([]);
  });
});

// Model oracle for the loader. A file is either valid Jar_Lines, a line that is not JSON, a
// blank line, or valid JSON that fails the Jar_Schema. Files are loaded in name order, and each
// valid line is checked against the retained lines before it.
type Item =
  | { kind: "valid"; id: number; session: string; seq: number }
  | { kind: "json" }
  | { kind: "blank" }
  | { kind: "schema" };

/** The reason of a schema failure is reported as its field, so the model compares its category. */
function shapeOf(spoiled: SpoiledLine): SpoiledLine {
  const schema = spoiled.reason.startsWith("invalid field") || spoiled.reason.startsWith("unknown field");
  return schema ? { ...spoiled, reason: "schema" } : spoiled;
}

/** The (session_id, seq) pair of a Jar_Line as a comparable key. */
function pairKey(jar: JarLine): string {
  return JSON.stringify([jar.session_id, jar.seq]);
}

type ModelFile = { file: string; items: Item[] };

const FILE_NAMES = ["a.jsonl", "b.jsonl", "c.jsonl"];

const itemArb: fc.Arbitrary<Item> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("valid" as const),
      id: fc.integer({ min: 1, max: 4 }),
      session: fc.constantFrom("s1", "s2"),
      seq: fc.integer({ min: 1, max: 3 }),
    }),
  },
  { weight: 1, arbitrary: fc.constant<Item>({ kind: "json" }) },
  { weight: 1, arbitrary: fc.constant<Item>({ kind: "blank" }) },
  { weight: 1, arbitrary: fc.constant<Item>({ kind: "schema" }) },
);

const filesArb: fc.Arbitrary<ModelFile[]> = fc
  .tuple(
    fc.array(itemArb, { maxLength: 6 }),
    fc.array(itemArb, { maxLength: 6 }),
    fc.array(itemArb, { maxLength: 6 }),
  )
  .chain(([a, b, c]) =>
    fc.shuffledSubarray(
      [
        { file: FILE_NAMES[0] as string, items: a },
        { file: FILE_NAMES[1] as string, items: b },
        { file: FILE_NAMES[2] as string, items: c },
      ],
      { minLength: 3, maxLength: 3 },
    ),
  );

function renderItem(item: Item): string {
  if (item.kind === "json") return '{"v":1';
  if (item.kind === "blank") return "";
  if (item.kind === "schema") return '{"v":1,"id":"SPC-0001"}';
  return JSON.stringify(jarRecord(`SPC-${pad4(item.id)}`, item.session, item.seq));
}

function renderFile(items: readonly Item[]): string {
  return items.length === 0 ? "" : items.map(renderItem).join("\n") + "\n";
}

function modelLoad(files: readonly ModelFile[]): {
  spoiled: SpoiledLine[];
  validCount: number;
  retainedCount: number;
} {
  const ordered = [...files].sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
  const spoiled: SpoiledLine[] = [];
  const ids = new Set<string>();
  const seqs = new Set<string>();
  let validCount = 0;
  let retainedCount = 0;

  for (const { file, items } of ordered) {
    items.forEach((item, index) => {
      const line = index + 1;
      if (item.kind === "json") {
        spoiled.push({ file, line, reason: "not valid JSON" });
        return;
      }
      if (item.kind === "blank") {
        spoiled.push({ file, line, reason: "blank line" });
        return;
      }
      if (item.kind === "schema") {
        spoiled.push({ file, line, reason: "schema" });
        return;
      }
      validCount++;
      const id = `SPC-${pad4(item.id)}`;
      const seqKey = JSON.stringify([item.session, item.seq]);
      if (ids.has(id)) {
        spoiled.push({ file, line, reason: "duplicate id" });
      } else if (seqs.has(seqKey)) {
        spoiled.push({ file, line, reason: "duplicate seq" });
      } else {
        ids.add(id);
        seqs.add(seqKey);
        retainedCount++;
      }
    });
  }
  return { spoiled, validCount, retainedCount };
}

// Feature: replay-engine, Property 1: Jar_Loader partitions valid lines from Spoiled_Lines
// **Validates: Requirements 1.2, 1.3**
describe("Jar_Loader partitions valid lines from Spoiled_Lines (Property 1)", () => {
  it("accounts for every input line exactly once and matches the model", () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const jarFiles: JarFile[] = files.map((f) => ({ file: f.file, text: renderFile(f.items) }));
        const expected = modelLoad(files);

        const result = loadJars(jarFiles);

        expect(result.spoiled.map(shapeOf)).toEqual(expected.spoiled);
        expect(result.valid).toHaveLength(expected.validCount);
        expect(result.lines).toHaveLength(expected.retainedCount);
        // Every valid line is either retained or spoiled as a duplicate, never both.
        const duplicates = result.spoiled.filter(
          (s) => s.reason === "duplicate id" || s.reason === "duplicate seq",
        );
        expect(result.lines.length + duplicates.length).toBe(result.valid.length);
        // Every non-valid line is spoiled with a 1-based line number inside its file.
        const invalidCount = result.spoiled.length - duplicates.length;
        const totalItems = files.reduce((n, f) => n + f.items.length, 0);
        expect(result.valid.length + invalidCount).toBe(totalItems);
      }),
      RUNS,
    );
  });
});

// Feature: replay-engine, Property 2: Duplicate ids and duplicate (session_id, seq) pairs are spoiled, not replayed
// **Validates: Requirements 1.19**
describe("Duplicate ids and duplicate (session_id, seq) pairs are spoiled, not replayed (Property 2)", () => {
  it("retains a valid line only when no earlier retained line shares its id or its pair", () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const jarFiles: JarFile[] = files.map((f) => ({ file: f.file, text: renderFile(f.items) }));

        const result = loadJars(jarFiles);

        const ids = result.lines.map((l) => l.id);
        const pairs = result.lines.map(pairKey);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(pairs).size).toBe(pairs.length);

        // result.valid is in loading order, and lines are the retained subset of it.
        const retained = new Set<JarLine>(result.lines);
        result.valid.forEach((jar, index) => {
          const earlierRetained = result.valid.slice(0, index).filter((e) => retained.has(e));
          const collides = earlierRetained.some((e) => e.id === jar.id || pairKey(e) === pairKey(jar));
          expect(retained.has(jar)).toBe(!collides);
        });

        const duplicateSpoils = result.spoiled.filter(
          (s) => s.reason === "duplicate id" || s.reason === "duplicate seq",
        );
        expect(duplicateSpoils).toHaveLength(result.valid.length - result.lines.length);
      }),
      RUNS,
    );
  });
});

// Feature: replay-engine, Property 3: Session grouping preserves membership and fixes order
// **Validates: Requirements 1.4**
describe("Session grouping preserves membership and fixes order (Property 3)", () => {
  const sessionArb = fc.constantFrom("s1", "s10", "s2", "B", "a", "_x");

  const linesArb: fc.Arbitrary<JarLine[]> = fc
    .uniqueArray(
      fc.record({ session: sessionArb, seq: fc.integer({ min: 1, max: 6 }) }),
      { selector: (r) => JSON.stringify([r.session, r.seq]), maxLength: 12 },
    )
    .map((rows) =>
      rows.map((r, i) => asJarLine(jarRecord(`SPC-${pad4(i + 1)}`, r.session, r.seq))),
    );

  const orphansArb: fc.Arbitrary<PendingEntry[]> = fc.array(
    fc.record({ session: sessionArb, seq: fc.integer({ min: 1, max: 6 }) }),
    { maxLength: 8 },
  ).map((rows) => rows.map((r) => pendingRecord(r.session, r.seq)));

  it("keeps every member once, in its own session, ordered by seq and by group", () => {
    fc.assert(
      fc.property(linesArb, orphansArb, (lines, orphans) => {
        const groups = groupBySession(lines, orphans);

        const members = groups.flatMap((g) => g.members);
        expect(members).toHaveLength(lines.length + orphans.length);

        const jarMembers = members.flatMap((m) => (m.kind === "jar" ? [m.line] : []));
        const orphanMembers = members.flatMap((m) => (m.kind === "orphan" ? [m.entry] : []));
        expect(new Set(jarMembers).size).toBe(lines.length);
        expect(new Set(orphanMembers).size).toBe(orphans.length);
        for (const line of lines) expect(jarMembers).toContain(line);
        for (const entry of orphans) expect(orphanMembers).toContain(entry);

        for (const group of groups) {
          const seqs = group.members.map((m) => (m.kind === "jar" ? m.line.seq : m.entry.seq));
          for (let i = 1; i < seqs.length; i++) {
            expect(seqs[i - 1] as number).toBeLessThanOrEqual(seqs[i] as number);
          }
          for (const m of group.members) {
            const session = m.kind === "jar" ? m.line.session_id : m.entry.session_id;
            expect(session).toBe(group.sessionId);
          }
        }

        const sessionIds = groups.map((g) => g.sessionId);
        expect(new Set(sessionIds).size).toBe(sessionIds.length);

        for (let i = 1; i < groups.length; i++) {
          const prev = groups[i - 1] as (typeof groups)[number];
          const next = groups[i] as (typeof groups)[number];
          const prevSeq = prev.members[0]?.kind === "jar" ? prev.members[0].line.seq : prev.members[0]?.entry.seq;
          const nextSeq = next.members[0]?.kind === "jar" ? next.members[0].line.seq : next.members[0]?.entry.seq;
          const ordered =
            (prevSeq as number) < (nextSeq as number) ||
            ((prevSeq as number) === (nextSeq as number) && prev.sessionId < next.sessionId);
          expect(ordered).toBe(true);
        }
      }),
      RUNS,
    );
  });
});
