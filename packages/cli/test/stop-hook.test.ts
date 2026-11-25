/**
 * The Agent Stop gate (`runStop`). Real replays run against hollow-inn in temporary workspaces
 * that hold copies of the recorded jars. The repository `jars/`, `.specimen/` and `replays/` are
 * only read. Every write goes to a temporary directory.
 *
 * Expected red ids come from the recorded v2 Replay_Result in replays/ (five rattled or cracked
 * jars: SPC-0002, SPC-0006, SPC-0007, SPC-0009 and SPC-0010). The E3 spec is the repository
 * `cancel-booking-missing-tool` bugfix spec, which cites only SPC-0009.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { runPrompt } from "../src/hooks/prompt.js";
import { MAX_BLOCKS, nodeStopPorts, runStop, type StopPorts } from "../src/hooks/stop.js";
import { runReplay, type ReplayIO, type ReplayOptions } from "../src/replay.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SESSION = "sess_gate-test";
const V1 = "npx tsx servers/hollow-inn/src/main.ts v1";
const V2 = "npx tsx servers/hollow-inn/src/main.ts v2";
const ALL_TOOLS = ["search_rooms", "get_room", "quote", "book", "list_bookings", "cancel_booking"];
const RED_V2 = ["SPC-0002", "SPC-0006", "SPC-0007", "SPC-0009", "SPC-0010"];
const REAL_TIMEOUT = 150_000;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A temporary workspace with a copy of the jars, the policies and a link to hollow-inn. */
function workspace(options: { allow?: string[]; jars?: "all" | "none" } = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-gate-")));
  roots.push(root);
  mkdirSync(join(root, ".kiro"));
  mkdirSync(join(root, "jars"));
  mkdirSync(join(root, ".specimen"));
  if (options.jars !== "none") {
    for (const name of readdirSync(join(REPO, "jars"))) {
      if (name.endsWith(".jsonl")) copyFileSync(join(REPO, "jars", name), join(root, "jars", name));
    }
  }
  copyFileSync(join(REPO, ".specimen", "volatile.json"), join(root, ".specimen", "volatile.json"));
  copyFileSync(join(REPO, ".specimen", "redact.json"), join(root, ".specimen", "redact.json"));
  writeFileSync(
    join(root, ".specimen", "replay.json"),
    `${JSON.stringify({ allow: options.allow ?? ALL_TOOLS, watch: ["servers/**"] })}\n`,
  );
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), "dir");
  symlinkSync(join(REPO, "servers"), join(root, "servers"), "dir");
  // The gate's own diagnostics and the workspace probe read process.cwd(), so point them here.
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

/** The Stop payload that Kiro sends: only session_id, hook_event_name and cwd. */
function payload(root: string): string {
  return JSON.stringify({ session_id: SESSION, hook_event_name: "Stop", cwd: root });
}

/**
 * Ports for the gate. The replay is the real runReplay unless a fake is given. The start probe is
 * the real one, unless `probe` is given. Tests that fake the replay also fake the probe, because
 * their temporary workspace has no node_modules link for `npx`.
 */
function portsFor(
  root: string,
  replay: StopPorts["replay"] = runReplay,
  probe: StopPorts["probe"] = nodeStopPorts.probe,
): { ports: StopPorts; out: string[] } {
  const out: string[] = [];
  return {
    out,
    ports: {
      readStdin: async () => payload(root),
      probe,
      replay,
      stdout: (text) => {
        out.push(text);
      },
    },
  };
}

function gateFile(root: string): string {
  return join(root, ".specimen", `gate-${SESSION}.json`);
}

/** The block decision on STDOUT, parsed. Fails the test when STDOUT holds anything else. */
function blockOf(out: readonly string[]): { decision: string; reason: string } {
  const text = out.join("");
  const parsed = JSON.parse(text) as { decision: string; reason: string };
  expect(parsed.decision).toBe("block");
  return parsed;
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** A git workspace with one committed server file and the prompt snapshot taken. */
function gitWorkspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-gate-git-")));
  roots.push(root);
  mkdirSync(join(root, ".kiro"));
  mkdirSync(join(root, ".specimen"));
  mkdirSync(join(root, "servers"));
  writeFileSync(join(root, "servers", "demo.txt"), "v1\n");
  writeFileSync(join(root, ".specimen", "replay.json"), `${JSON.stringify({ allow: [], watch: ["servers/**"] })}\n`);
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

/** A start probe that always succeeds. */
const noProbe: StopPorts["probe"] = async () => {};

/** Stands in for the replay so the test sees whether the gate asked for one. */
function fakeReplay(exitCode: number): { replay: StopPorts["replay"]; calls: ReplayOptions[] } {
  const calls: ReplayOptions[] = [];
  return {
    calls,
    replay: async (options: ReplayOptions, _io: ReplayIO) => {
      calls.push(options);
      return exitCode;
    },
  };
}

describe("Stop gate: control flow with a fake replay", () => {
  it("does not replay when the server source did not change in the turn", async () => {
    const root = gitWorkspace();
    expect(await runPrompt(async () => JSON.stringify({ session_id: SESSION, cwd: root }))).toBe(0);
    const fake = fakeReplay(1);
    const { ports, out } = portsFor(root, fake.replay, noProbe);
    expect(await runStop(V1, ports)).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(out.join("")).toBe("");
  });

  it("does nothing at all when SPECIMEN_GATE=off (the curator that `specimen file` starts)", async () => {
    const root = gitWorkspace();
    expect(await runPrompt(async () => JSON.stringify({ session_id: SESSION, cwd: root }))).toBe(0);
    appendFileSync(join(root, "servers", "demo.txt"), "edited in the turn\n");
    const fake = fakeReplay(1);
    const { ports, out } = portsFor(root, fake.replay, noProbe);
    vi.stubEnv("SPECIMEN_GATE", "off");
    try {
      expect(await runStop(V2, ports)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(fake.calls).toEqual([]);
    expect(out.join("")).toBe("");
    expect(existsSync(join(root, ".specimen", `gate-${SESSION}.json`))).toBe(false);
  });

  it("replays when a watched file changed after the snapshot", async () => {
    const root = gitWorkspace();
    await runPrompt(async () => JSON.stringify({ session_id: SESSION, cwd: root }));
    writeFileSync(join(root, "servers", "demo.txt"), "v2\n");
    const fake = fakeReplay(2);
    const { ports, out } = portsFor(root, fake.replay, noProbe);
    expect(await runStop(V1, ports)).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.server).toBe(V1);
    expect(fake.calls[0]?.json).toBe(true);
    expect(out.join("")).toBe("");
  });

  it("still replays when the change was committed during the turn", async () => {
    const root = gitWorkspace();
    await runPrompt(async () => JSON.stringify({ session_id: SESSION, cwd: root }));
    writeFileSync(join(root, "servers", "demo.txt"), "v2\n");
    git(root, ["commit", "-qam", "change during the turn"]);
    const fake = fakeReplay(2);
    expect(await runStop(V1, portsFor(root, fake.replay, noProbe).ports)).toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  it("replays when the snapshot belongs to another session", async () => {
    const root = gitWorkspace();
    await runPrompt(async () => JSON.stringify({ session_id: "sess_other", cwd: root }));
    const fake = fakeReplay(0);
    expect(await runStop(V1, portsFor(root, fake.replay, noProbe).ports)).toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  it("allows the stop without output when the replay exits with a usage error", async () => {
    const root = workspace();
    const fake = fakeReplay(2);
    const { ports, out } = portsFor(root, fake.replay, noProbe);
    expect(await runStop(V1, ports)).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(out.join("")).toBe("");
    expect(existsSync(gateFile(root))).toBe(false);
  });

  it("allows without a throw when the server cannot start", async () => {
    const root = workspace();
    const fake = fakeReplay(1);
    const { ports, out } = portsFor(root, fake.replay);
    expect(await runStop("definitely-not-a-real-command-specimen", ports)).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(out.join("")).toBe("");
    expect(readFileSync(join(root, ".specimen", "hook.log"), "utf8")).toContain("server did not start");
  }, REAL_TIMEOUT);

  it("allows without a throw on a corrupt or missing turn file when the server cannot start", async () => {
    const root = workspace();
    writeFileSync(join(root, ".specimen", "turn.json"), "{ not json");
    const corrupt = portsFor(root);
    expect(await runStop("definitely-not-a-real-command-specimen", corrupt.ports)).toBe(0);
    expect(corrupt.out.join("")).toBe("");

    rmSync(join(root, ".specimen", "turn.json"), { force: true });
    const missing = portsFor(root);
    expect(await runStop("definitely-not-a-real-command-specimen", missing.ports)).toBe(0);
    expect(missing.out.join("")).toBe("");
  }, REAL_TIMEOUT);

  it("fails open on a payload that is not JSON and writes nothing", async () => {
    const root = workspace();
    const out: string[] = [];
    const ports: StopPorts = {
      readStdin: async () => "not json",
      probe: noProbe,
      replay: runReplay,
      stdout: (text) => {
        out.push(text);
      },
    };
    expect(await runStop(V1, ports)).toBe(0);
    expect(out).toEqual([]);
    expect(existsSync(gateFile(root))).toBe(false);
  });
});

describe("Stop gate: real hollow-inn replays", () => {
  it("E1: v1 against its own jars allows the stop", async () => {
    const root = workspace();
    const { ports, out } = portsFor(root);
    expect(await runStop(V1, ports)).toBe(0);
    expect(out.join("")).toBe("");
    expect(existsSync(gateFile(root))).toBe(false);
    expect(existsSync(join(root, ".specimen", "unresolved.md"))).toBe(false);
  }, REAL_TIMEOUT);

  it("never blocks for jars cracked by an operational failure, and lists them in unresolved.md (a2a round 06)", async () => {
    const root = workspace();
    // The real v2 replay, with every red jar turned into a timeout crack: the shape `specimen file` refuses.
    const operational: StopPorts["replay"] = async (options, io) => {
      let text = "";
      const code = await runReplay(options, { ...io, stdout: (chunk) => { text += chunk; } });
      const result = JSON.parse(text) as { jars: Record<string, unknown>[]; counts: Record<string, number> };
      for (const jar of result.jars) {
        if (jar.state !== "rattled" && jar.state !== "cracked") continue;
        jar.state = "cracked";
        delete jar.reason;
        jar.error = "Request timed out";
        jar.changes = [];
        jar.compatible = [];
      }
      const red = result.jars.filter((jar) => jar.state === "cracked").length;
      result.counts = { ...result.counts, rattled: 0, cracked: red };
      io.stdout(JSON.stringify(result));
      return code;
    };
    const { ports, out } = portsFor(root, operational);
    expect(await runStop(V2, ports)).toBe(0);
    expect(out.join("")).toBe("");
    expect(existsSync(gateFile(root))).toBe(false);
    const unresolved = readFileSync(join(root, ".specimen", "unresolved.md"), "utf8");
    expect(unresolved).toContain("operational failure");
    for (const id of RED_V2) expect(unresolved).toContain(id);
  }, REAL_TIMEOUT);

  it("E2: v2 with no filed spec blocks once and names every red jar", async () => {
    const root = workspace();
    const { ports, out } = portsFor(root);
    expect(await runStop(V2, ports)).toBe(0);
    const block = blockOf(out);
    expect(block.reason.startsWith("jars rattled or cracked: ")).toBe(true);
    for (const id of RED_V2) expect(block.reason).toContain(id);
    expect(block.reason.length).toBeLessThanOrEqual(600);
    expect(JSON.parse(readFileSync(gateFile(root), "utf8"))).toEqual({ session_id: SESSION, blocks: 1 });
  }, REAL_TIMEOUT);

  it("E3: v2 with a passing spec for one red jar lists only the unfiled jars", async () => {
    const root = workspace();
    mkdirSync(join(root, ".kiro", "specs", "cancel-booking-missing-tool"), { recursive: true });
    copyFileSync(
      join(REPO, ".kiro", "specs", "cancel-booking-missing-tool", "bugfix.md"),
      join(root, ".kiro", "specs", "cancel-booking-missing-tool", "bugfix.md"),
    );
    const { ports, out } = portsFor(root);
    expect(await runStop(V2, ports)).toBe(0);
    const block = blockOf(out);
    for (const id of ["SPC-0002", "SPC-0006", "SPC-0007", "SPC-0010"]) expect(block.reason).toContain(id);
    expect(block.reason).not.toContain("SPC-0009");
  }, REAL_TIMEOUT);

  it("E3c: an empty jar set allows the stop", async () => {
    const root = workspace({ jars: "none" });
    const { ports, out } = portsFor(root);
    expect(await runStop(V1, ports)).toBe(0);
    expect(out.join("")).toBe("");
  }, REAL_TIMEOUT);

  it("E3d: every jar skipped allows the stop", async () => {
    const root = workspace({ allow: [] });
    const { ports, out } = portsFor(root);
    expect(await runStop(V2, ports)).toBe(0);
    expect(out.join("")).toBe("");
  }, REAL_TIMEOUT);

  it("E3e: a quarantined orphan and a spoiled line among preserved jars allows the stop", async () => {
    const root = workspace();
    // A pending entry that no response ever paired becomes an orphan pre-event.
    writeFileSync(
      join(root, ".specimen", "pending.jsonl"),
      `${JSON.stringify({
        session_id: SESSION,
        seq: 99,
        tool_id: "get_room",
        input_sha256: "a".repeat(64),
        t0: "2026-01-01T00:00:00.000Z",
      })}\n`,
    );
    const jar = readdirSync(join(root, "jars")).find((name) => name.endsWith(".jsonl"));
    if (jar === undefined) throw new Error("the workspace has no jar");
    appendFileSync(join(root, "jars", jar), "this line is not json\n");

    const { ports, out } = portsFor(root);
    expect(await runStop(V1, ports)).toBe(0);
    expect(out.join("")).toBe("");
    const quarantine = JSON.parse(readFileSync(join(root, ".specimen", "quarantine.json"), "utf8")) as {
      items: Array<{ reason: string }>;
    };
    expect(quarantine.items.map((item) => item.reason)).toContain("orphan pre-event");
  }, REAL_TIMEOUT);

  it("the block after MAX_BLOCKS allows the stop and records the unresolved jars", async () => {
    expect(MAX_BLOCKS).toBe(3);
    const root = workspace();
    writeFileSync(gateFile(root), `${JSON.stringify({ session_id: SESSION, blocks: MAX_BLOCKS })}\n`);
    const { ports, out } = portsFor(root);
    expect(await runStop(V2, ports)).toBe(0);
    expect(out.join("")).toBe("");
    const unresolved = readFileSync(join(root, ".specimen", "unresolved.md"), "utf8");
    expect(unresolved).toContain(`session: ${SESSION}`);
    expect(unresolved).toContain("after 3 blocks");
    for (const id of RED_V2) expect(unresolved).toContain(id);
    expect(JSON.parse(readFileSync(gateFile(root), "utf8"))).toEqual({ session_id: SESSION, blocks: MAX_BLOCKS });
  }, REAL_TIMEOUT);

  it("never touches the repository .specimen or replays folders", async () => {
    const before = readdirSync(join(REPO, "replays")).sort();
    const root = workspace();
    const { ports } = portsFor(root);
    await runStop(V1, ports);
    expect(readdirSync(join(REPO, "replays")).sort()).toEqual(before);
    expect(existsSync(join(REPO, ".specimen", `gate-${SESSION}.json`))).toBe(false);
    expect(existsSync(join(REPO, ".specimen", "unresolved.md"))).toBe(false);
    expect(existsSync(join(REPO, ".specimen", "turn.json"))).toBe(false);
  }, REAL_TIMEOUT);
});
