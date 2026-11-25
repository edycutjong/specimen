import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSpec, diff, type Json, type ResultEntry } from "@specimen/core";
import { createProgram } from "../src/main.js";
import {
  FILE_EXIT,
  buildCuratorPrompt,
  buildSkeleton,
  runFile,
  signatureGroup,
  specSlug,
  type FileIO,
  type KiroCall,
  type KiroRun,
  type KiroRunner,
} from "../src/file.js";
import { createWorkspace, type Workspace } from "./support/capture.js";

/**
 * `specimen file` with a fake Kiro runner. The workspace is a temporary directory, so no real
 * kiro-cli is started and no file under the repository `jars/` or `.specimen/` is used.
 */

const RECORDED = '{"room_id":"r-04","nights":2,"total":425.00,"total_cents":42500}';
const REPLAYED = '{"room_id":"r-04","nights":2,"total":430,"total_cents":43000}';
const PRESERVED_RECORDED = '{"room_id":"r-02","nights":1,"total":212.50,"total_cents":21250}';
const SPEC = ".kiro/specs/quote-total-total-cents/bugfix.md";
const REPLAY = "replays/hollow-inn-2026-05-01T10-00-00.000Z.json";

let ws: Workspace;

beforeEach(() => {
  ws = createWorkspace();
  mkdirSync(join(ws.root, "replays"));
});

afterEach(() => {
  ws.remove();
});

/** One Result_Entry. Changes come from the real diff of the recorded and replayed text. */
function entry(p: {
  id: string | null;
  seq: number;
  tool: string;
  state: ResultEntry["state"];
  input: Json;
  recorded: string | null;
  replayed: string | null;
  error?: string;
  reason?: string;
}): ResultEntry {
  const recorded = p.recorded === null ? null : (JSON.parse(p.recorded) as Json);
  const replayed = p.replayed === null ? null : (JSON.parse(p.replayed) as Json);
  return {
    id: p.id,
    session_id: "s-1",
    seq: p.seq,
    tool: p.tool,
    state: p.state,
    input: p.input,
    response_text: p.recorded,
    changes: recorded !== null && replayed !== null ? diff(recorded, replayed) : [],
    compatible: [],
    ignored: [],
    replayed_text: p.replayed,
    replayed,
    ms: 3,
    ...(p.error !== undefined ? { error: p.error } : {}),
    ...(p.reason !== undefined ? { reason: p.reason } : {}),
  };
}

const QUOTE_INPUT = { room_id: "r-04", nights: 2 };

/** Two rattled quote jars at /total and /total_cents, one rattled quote jar at /total only, one preserved quote jar, one cracked cancel_booking jar. */
function jars(): ResultEntry[] {
  return [
    entry({ id: "SPC-0001", seq: 1, tool: "quote", state: "rattled", input: QUOTE_INPUT, recorded: RECORDED, replayed: REPLAYED }),
    entry({ id: "SPC-0002", seq: 2, tool: "quote", state: "rattled", input: QUOTE_INPUT, recorded: RECORDED, replayed: REPLAYED }),
    entry({
      id: "SPC-0005",
      seq: 5,
      tool: "quote",
      state: "rattled",
      input: QUOTE_INPUT,
      recorded: RECORDED,
      replayed: '{"room_id":"r-04","nights":2,"total":430,"total_cents":42500}',
    }),
    entry({
      id: "SPC-0003",
      seq: 3,
      tool: "quote",
      state: "preserved",
      input: { room_id: "r-02", nights: 1 },
      recorded: PRESERVED_RECORDED,
      replayed: PRESERVED_RECORDED,
    }),
    entry({
      id: "SPC-0004",
      seq: 4,
      tool: "cancel_booking",
      state: "cracked",
      input: { booking_id: "b-7" },
      recorded: '{"booking_id":"b-7","status":"cancelled"}',
      replayed: null,
      reason: "tool not in tools/list",
    }),
  ];
}

/** A Replay_Result document in the real shape. */
function replayDoc(entries: ResultEntry[]): Record<string, unknown> {
  return {
    v: 1,
    server: "hollow-inn",
    started_at: "2026-05-01T10:00:00.000Z",
    strict: false,
    jars: entries,
    spoiled: [],
    counts: { preserved: 1, rattled: 3, cracked: 1, unsealed: 0, skipped: 0 },
    schema_diff: { tools_removed: [], tools_added: [], input_schema_changed: [] },
    verdict: "HOLD",
    red: 4,
    filed: 0,
    covered: true,
    reason: "4 jars red",
    coverage: {
      compared: 5,
      tools_compared: ["quote", "cancel_booking"],
      tools_listed: ["quote", "cancel_booking"],
      tools_unrecorded: [],
    },
  };
}

function writeReplay(name = REPLAY, entries: ResultEntry[] = jars()): string {
  const path = join(ws.root, name);
  writeFileSync(path, JSON.stringify(replayDoc(entries), null, 2));
  return name;
}

/** The test's stdout and stderr, and a working directory at the workspace root. */
function captureIO(): { io: FileIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  const io: FileIO = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    cwd: () => ws.root,
  };
  return { io, out: () => out.join(""), err: () => err.join("") };
}

/** A runner that records each call and answers with `step`. The default answer is exit 0. */
function fakeRunner(step?: (call: KiroCall, attempt: number) => Promise<void> | KiroRun | void): {
  runner: KiroRunner;
  calls: KiroCall[];
} {
  const calls: KiroCall[] = [];
  const runner: KiroRunner = async (call) => {
    calls.push(call);
    const answer = await step?.(call, calls.length);
    return answer ?? { exitCode: 0, stderr: "", timedOut: false };
  };
  return { runner, calls };
}

/** The file the curator writes in these tests. It is the skeleton with every section filled in. */
function fillSections(skeleton: string): string {
  return skeleton
    .replace(
      "## Introduction\n\n",
      "## Introduction\n\nThe quote tool rattles on /total and /total_cents for SPC-0001 and SPC-0002. The preserved jar SPC-0003 stays intact.\n\n",
    )
    .replace(
      "### Current Behavior (Defect)\n\n",
      "### Current Behavior (Defect)\n\n1. WHEN a quote for room r-04 over 2 nights is requested THEN the system returns /total 430 and /total_cents 43000.\n\n",
    )
    .replace(
      "### Expected Behavior (Correct)\n\n",
      "### Expected Behavior (Correct)\n\n1. WHEN a quote for room r-04 over 2 nights is requested THEN the system SHALL return /total with the recorded value 425.00 and /total_cents with the recorded value 42500.\n\n",
    )
    .replace(
      "### Unchanged Behavior (Regression Prevention)\n\n",
      "### Unchanged Behavior (Regression Prevention)\n\n1. WHEN a quote for room r-02 over 1 night is requested THEN the system SHALL CONTINUE TO return the recorded values of jar SPC-0003.\n\n",
    );
}

/** The curator run that writes filled sections, with an optional edit applied after filling. */
function curatorWrites(edit?: (text: string) => string): (call: KiroCall) => void {
  return () => {
    const path = join(ws.root, SPEC);
    const skeleton = readFileSync(path, "utf8");
    const filled = fillSections(skeleton);
    writeFileSync(path, edit === undefined ? filled : edit(filled));
  };
}

/** The `replay` option, so tests do not depend on the newest-file lookup. */
const withReplay = { replay: REPLAY };

describe("signature group and slug", () => {
  it("groups jars by tool, state and changed path set in Replay_Result order", () => {
    const all = jars();
    const target = all.find((jar) => jar.id === "SPC-0001");
    expect(target).toBeDefined();
    expect(signatureGroup(all, target as ResultEntry).map((jar) => jar.id)).toEqual(["SPC-0001", "SPC-0002"]);
  });

  it("groups every cracked jar of the tool with the same cause, and leaves out a crack with another cause", () => {
    const all = [
      ...jars(),
      entry({ id: "SPC-0006", seq: 6, tool: "cancel_booking", state: "cracked", input: {}, recorded: '{"ok":true}', replayed: null, reason: "tool not in tools/list" }),
      entry({ id: "SPC-0007", seq: 7, tool: "cancel_booking", state: "cracked", input: {}, recorded: '{"ok":true}', replayed: null, error: "Request timed out" }),
    ];
    const target = all.find((jar) => jar.id === "SPC-0004");
    expect(signatureGroup(all, target as ResultEntry).map((jar) => jar.id)).toEqual(["SPC-0004", "SPC-0006"]);
  });

  it("builds the slug from the tool and the sorted paths", () => {
    expect(specSlug("quote", "rattled", ["/total", "/total_cents"])).toBe("quote-total-total-cents");
    expect(specSlug("cancel_booking", "cracked", [])).toBe("cancel-booking-missing-tool");
  });

  it("caps the slug at 48 characters without a trailing dash", () => {
    const slug = specSlug("quote", "rattled", ["/" + "a".repeat(40), "/bb-cc"]);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("skeleton", () => {
  it("writes the headings and the repro block in the required order", () => {
    const text = buildSkeleton(jars().slice(0, 2));
    expect(text.startsWith("# Bugfix Requirements Document\n\n## Introduction\n\n<!-- specimen:repro:start -->\n```json specimen-repro\n")).toBe(true);
    expect(text.endsWith("## Bug Analysis\n\n### Current Behavior (Defect)\n\n### Expected Behavior (Correct)\n\n### Unchanged Behavior (Regression Prevention)\n\n")).toBe(true);
  });

  it("copies the JSON block from the entries and writes one table row per change", () => {
    const group = jars().slice(0, 2);
    const text = buildSkeleton(group);
    const block = JSON.stringify(
      group.map((entry) => ({
        id: entry.id,
        input: entry.input,
        response_text: entry.response_text,
        replayed: entry.replayed,
        changed_paths: entry.changes.map((change) => change.path),
      })),
      null,
      2,
    );
    expect(text).toContain("```json specimen-repro\n" + block + "\n```\n");
    expect(text.split("\n").filter((line) => line.startsWith("| SPC-000"))).toHaveLength(4);
  });
});

describe("curator prompt", () => {
  it("names the file, the markers rule, the references and the preserved jars", () => {
    const all = jars();
    const group = all.filter((jar) => jar.id === "SPC-0001" || jar.id === "SPC-0002");
    const prompt = buildCuratorPrompt({
      filePath: SPEC,
      server: "hollow-inn",
      tool: "quote",
      state: "rattled",
      group,
      preserved: all.filter((jar) => jar.state === "preserved"),
    });
    expect(prompt).toContain(`Write the Bugfix_Spec at ${SPEC}.`);
    expect(prompt).toContain("keep it byte for byte");
    expect(prompt).toContain("Jar ids: SPC-0001, SPC-0002");
    expect(prompt).toContain("/total with recorded value 425.00");
    expect(prompt).toContain("/total_cents with recorded value 42500");
    expect(prompt).toContain('- SPC-0003 · input {"nights":1,"room_id":"r-02"}');
  });

  it("names the missing tool of a cracked jar and says when no preserved jar exists", () => {
    const cracked = jars().find((jar) => jar.id === "SPC-0004") as ResultEntry;
    const prompt = buildCuratorPrompt({
      filePath: ".kiro/specs/cancel-booking-missing-tool/bugfix.md",
      server: "hollow-inn",
      tool: "cancel_booking",
      state: "cracked",
      group: [cracked],
      preserved: [],
    });
    expect(prompt).toContain("missing tool cancel_booking");
    expect(prompt).toContain("no preserved jar of cancel_booking was recorded");
  });

  it("quotes the failing checks on a retry", () => {
    const cracked = jars().find((jar) => jar.id === "SPC-0004") as ResultEntry;
    const prompt = buildCuratorPrompt({
      filePath: "x.md",
      server: "hollow-inn",
      tool: "cancel_booking",
      state: "cracked",
      group: [cracked],
      preserved: [],
      failures: [{ id: "SPC-0004", code: "shall", message: "no SHALL" }],
    });
    expect(prompt).toContain("FAIL SPC-0004 shall: no SHALL");
  });
});

describe("runFile", () => {
  it("files a spec that passes check-spec for every jar of the group", async () => {
    writeReplay();
    const { io, out, err } = captureIO();
    const { runner, calls } = fakeRunner(curatorWrites());

    const code = await runFile("SPC-0001", withReplay, io, runner);

    expect(code).toBe(FILE_EXIT.filed);
    expect(err()).toBe("");
    expect(out()).toBe(`filed ${SPEC} · PASS SPC-0001, SPC-0002\n`);
    expect(calls).toHaveLength(1);
    const call = calls[0] as KiroCall;
    expect(call.command).toBe("kiro-cli");
    expect(call.args.slice(0, 7)).toEqual(["chat", "--no-interactive", "--agent-engine", "v3", "--trust-workspace", "--agent", "specimen-curator"]);
    expect(call.args).not.toContain("--trust-tools");
    expect(call.args).not.toContain("--trust-all-tools");
    expect(call.timeoutMs).toBe(300_000);
    const text = readFileSync(join(ws.root, SPEC), "utf8");
    const replay = replayResultFor(["SPC-0001", "SPC-0002"]);
    expect(checkSpec(text, "SPC-0001", replay)).toBe("pass");
  });

  it("retries once when the repro block was edited, then rejects the file with exit 20", async () => {
    writeReplay();
    const { io, out } = captureIO();
    const edit = (text: string): string => text.replaceAll('"total": 430,', '"total": 431,');
    const { runner, calls } = fakeRunner(curatorWrites(edit));

    const code = await runFile("SPC-0001", withReplay, io, runner);

    expect(code).toBe(FILE_EXIT.rejected);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.at(-1)).toContain("FAIL SPC-0001 repro_block_edited:");
    expect(out()).toContain("FAIL SPC-0001 repro_block_edited: repro block between the markers differs from the CLI skeleton\n");
    expect(existsSync(join(ws.root, SPEC))).toBe(false);
    expect(existsSync(join(ws.root, ".kiro/specs/quote-total-total-cents/bugfix.rejected.md"))).toBe(true);
  });

  it("accepts the spec when the retry is clean", async () => {
    writeReplay();
    const { io, out } = captureIO();
    const edit = (text: string): string => text.replaceAll('"total": 430,', '"total": 431,');
    const { runner, calls } = fakeRunner((call, attempt) => curatorWrites(attempt === 1 ? edit : undefined)(call));

    const code = await runFile("SPC-0001", withReplay, io, runner);

    expect(code).toBe(FILE_EXIT.filed);
    expect(calls).toHaveLength(2);
    expect(out()).toContain("PASS SPC-0001");
  });

  it("exits 21 when the curator times out", async () => {
    writeReplay();
    const { io, err } = captureIO();
    const { runner, calls } = fakeRunner(() => ({ exitCode: null, stderr: "", timedOut: true }));

    const code = await runFile("SPC-0001", { ...withReplay, timeout: "7" }, io, runner);

    expect(code).toBe(FILE_EXIT.timeout);
    expect(calls[0]?.timeoutMs).toBe(7_000);
    expect(err()).toContain("curator timed out after 7 s — no spec written");
    expect(existsSync(join(ws.root, ".kiro/specs/quote-total-total-cents"))).toBe(false);
  });

  it("exits 22 and prints the code and stderr when kiro-cli fails", async () => {
    writeReplay();
    const { io, err } = captureIO();
    const { runner } = fakeRunner(() => ({ exitCode: 4, stderr: "boom: no session\n", timedOut: false }));

    const code = await runFile("SPC-0001", withReplay, io, runner);

    expect(code).toBe(FILE_EXIT.kiroFailed);
    expect(err()).toContain("kiro-cli failed with exit code 4");
    expect(err()).toContain("boom: no session");
    expect(existsSync(join(ws.root, ".kiro/specs/quote-total-total-cents/bugfix.md"))).toBe(false);
  });

  it("writes nothing and runs nothing with --dry-run", async () => {
    writeReplay();
    const { io, out } = captureIO();
    const { runner, calls } = fakeRunner();

    const code = await runFile("SPC-0001", { ...withReplay, dryRun: true }, io, runner);

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(ws.root, ".kiro/specs"))).toBe(false);
    expect(out()).toContain("# Bugfix Requirements Document");
    expect(out()).toContain(`Write the Bugfix_Spec at ${SPEC}.`);
  });

  it("uses the cracked slug for a cracked jar in dry-run", async () => {
    writeReplay();
    const { io, out } = captureIO();
    const { runner } = fakeRunner();

    const code = await runFile("SPC-0004", { ...withReplay, dryRun: true }, io, runner);

    expect(code).toBe(0);
    expect(out()).toContain("Write the Bugfix_Spec at .kiro/specs/cancel-booking-missing-tool/bugfix.md.");
  });

  it("exits 2 with one line for a preserved jar", async () => {
    writeReplay();
    const { io, err, out } = captureIO();
    const { runner, calls } = fakeRunner();

    const code = await runFile("SPC-0003", withReplay, io, runner);

    expect(code).toBe(FILE_EXIT.usage);
    expect(calls).toHaveLength(0);
    expect(out()).toBe("");
    expect(err().trim().split("\n")).toHaveLength(1);
    expect(err()).toContain("SPC-0003 is preserved, not rattled or cracked");
  });

  it("refuses a jar cracked by a timeout instead of filing it as a missing tool", async () => {
    const timedOut = entry({
      id: "SPC-0004",
      seq: 4,
      tool: "cancel_booking",
      state: "cracked",
      input: { booking_id: "b-7" },
      recorded: '{"booking_id":"b-7","status":"cancelled"}',
      replayed: null,
      error: "Request timed out",
    });
    writeReplay(REPLAY, [...jars().filter((jar) => jar.id !== "SPC-0004"), timedOut]);
    const { io, err } = captureIO();
    const { runner, calls } = fakeRunner();

    const code = await runFile("SPC-0004", withReplay, io, runner);

    expect(code).toBe(FILE_EXIT.usage);
    expect(calls).toHaveLength(0);
    expect(err()).toContain('cracked by "Request timed out", an operational failure');
    expect(existsSync(join(ws.root, ".kiro/specs/cancel-booking-missing-tool"))).toBe(false);
  });

  it("never overwrites a filed spec, and leaves it byte for byte", async () => {
    writeReplay();
    const filed = join(ws.root, ".kiro/specs/cancel-booking-missing-tool/bugfix.md");
    mkdirSync(dirname(filed), { recursive: true });
    writeFileSync(filed, "an accepted spec\n");
    const { io, err } = captureIO();
    const { runner, calls } = fakeRunner();

    const code = await runFile("SPC-0004", withReplay, io, runner);

    expect(code).toBe(FILE_EXIT.usage);
    expect(calls).toHaveLength(0);
    expect(err()).toContain(".kiro/specs/cancel-booking-missing-tool/bugfix.md already exists");
    expect(readFileSync(filed, "utf8")).toBe("an accepted spec\n");
  });

  it("exits 2 for an unknown jar id", async () => {
    writeReplay();
    const { io, err } = captureIO();
    const code = await runFile("SPC-9999", withReplay, io, fakeRunner().runner);
    expect(code).toBe(FILE_EXIT.usage);
    expect(err()).toContain("jar SPC-9999 is not in the Replay_Result");
  });

  it("exits 2 when the Replay_Result file is missing", async () => {
    const { io, err } = captureIO();
    const code = await runFile("SPC-0001", { replay: "replays/missing.json" }, io, fakeRunner().runner);
    expect(code).toBe(FILE_EXIT.usage);
    expect(err()).toContain("cannot read Replay_Result");
  });

  it("reads the newest Replay_Result in replays/ when --replay is absent", async () => {
    writeReplay();
    const { io, out } = captureIO();
    const code = await runFile("SPC-0001", { dryRun: true }, io, fakeRunner().runner);
    expect(code).toBe(0);
    expect(out()).toContain("SPC-0001");
  });
});

describe("command wiring", () => {
  it("registers file next to check-spec", () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain("file");
    expect(names.indexOf("file")).toBe(names.indexOf("check-spec") + 1);
  });
});

/** The Result_Entry list of the test jars for the given ids, as check-spec reads it. */
function replayResultFor(ids: string[]): ResultEntry[] {
  return jars().filter((jar) => jar.id !== null && (ids.includes(jar.id) || jar.state === "preserved"));
}
