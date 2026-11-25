import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Checks the Kiro wiring files against Requirement 9 of the jar-capture spec. These tests read
// the repository's .kiro folder only. They never write to it and never touch jars/.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HOOKS_DIR = join(ROOT, ".kiro", "hooks");
const MCP_FILE = join(ROOT, ".kiro", "settings", "mcp.json");

const TRIGGERS = [
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "SessionStart",
  "Stop",
  "UserPromptSubmit",
  "PreTaskExec",
  "PostTaskExec",
  "PreCompact",
  "PostCompact",
  "PostFileCreate",
  "PostFileSave",
  "PostFileDelete",
] as const;

// Triggers that carry no tool name, so they take no matcher.
const TASK_TRIGGERS: readonly string[] = ["PreTaskExec", "PostTaskExec", "Stop", "UserPromptSubmit"];

const hookSchema = z
  .object({
    name: z.string().min(1),
    trigger: z.enum(TRIGGERS),
    matcher: z.string().min(1).optional(),
    timeout: z.number().int().positive().optional(),
    action: z
      .object({
        type: z.literal("command"),
        command: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .refine((hook) => hook.matcher !== undefined || TASK_TRIGGERS.includes(hook.trigger), {
    message: "matcher is required unless the trigger is a task, Stop or UserPromptSubmit trigger",
    path: ["matcher"],
  });

const hookFileSchema = z
  .object({
    version: z.literal("v1"),
    hooks: z.array(hookSchema).min(1),
  })
  .strict();

type HookFile = z.infer<typeof hookFileSchema>;

function readHookFile(fileName: string): HookFile {
  const raw: unknown = JSON.parse(readFileSync(join(HOOKS_DIR, fileName), "utf8"));
  return hookFileSchema.parse(raw);
}

/** Every Hook_File in .kiro/hooks, parsed with the schema. Failures throw with the file name. */
function parseAllHookFiles(): Map<string, HookFile> {
  const parsed = new Map<string, HookFile>();
  for (const fileName of readdirSync(HOOKS_DIR).filter((name) => name.endsWith(".json")).sort()) {
    parsed.set(fileName, readHookFile(fileName));
  }
  return parsed;
}

function commandsOf(file: HookFile): string[] {
  return file.hooks.map((hook) => hook.action.command);
}

const SHELL_OPERATORS = ["&&", "||", "|", ";", ">", "<"] as const;

describe("Kiro hook files (Requirement 9)", () => {
  it("parses every Hook_File with the hook schema", () => {
    const files = parseAllHookFiles();
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        "specimen-jar-pre.json",
        "specimen-jar-post.json",
        "specimen-jar-firewall.json",
        "specimen-manifest-check.json",
        "post-task-tests.json",
      ]),
    );
  });

  it("covers the PreToolUse, PostToolUse, PreTaskExec and PostTaskExec triggers across the files", () => {
    const triggers = new Set<string>();
    for (const file of parseAllHookFiles().values()) {
      for (const hook of file.hooks) triggers.add(hook.trigger);
    }
    for (const required of ["PreToolUse", "PostToolUse", "PreTaskExec", "PostTaskExec"]) {
      expect(triggers.has(required)).toBe(true);
    }
  });

  it("specimen-jar-pre.json runs the exact pre command on PreToolUse for @hollowinn", () => {
    const file = readHookFile("specimen-jar-pre.json");
    expect(file.hooks).toHaveLength(1);
    expect(file.hooks[0]?.trigger).toBe("PreToolUse");
    expect(file.hooks[0]?.matcher).toBe("@hollowinn");
    expect(commandsOf(file)).toEqual(["npx --no-install specimen hook pre --server hollowinn"]);
  });

  it("specimen-jar-post.json runs the exact post command on PostToolUse for @hollowinn", () => {
    const file = readHookFile("specimen-jar-post.json");
    expect(file.hooks).toHaveLength(1);
    expect(file.hooks[0]?.trigger).toBe("PostToolUse");
    expect(file.hooks[0]?.matcher).toBe("@hollowinn");
    expect(commandsOf(file)).toEqual(["npx --no-install specimen hook post --server hollowinn"]);
  });

  it("specimen-jar-firewall.json runs the exact firewall command on PreToolUse for write", () => {
    const file = readHookFile("specimen-jar-firewall.json");
    expect(file.hooks).toHaveLength(1);
    expect(file.hooks[0]?.trigger).toBe("PreToolUse");
    expect(file.hooks[0]?.matcher).toBe("write");
    expect(commandsOf(file)).toEqual(["npx --no-install specimen hook firewall"]);
  });

  it("specimen-manifest-check.json has one exact manifest check hook per task trigger", () => {
    const file = readHookFile("specimen-manifest-check.json");
    expect(file.hooks.map((hook) => hook.trigger)).toEqual(["PreTaskExec", "PostTaskExec"]);
    expect(commandsOf(file)).toEqual([
      "npx --no-install specimen manifest check",
      "npx --no-install specimen manifest check",
    ]);
  });

  it("contains no shell operator in the pre, post or firewall commands", () => {
    const files = parseAllHookFiles();
    const captureFiles = [
      "specimen-jar-pre.json",
      "specimen-jar-post.json",
      "specimen-jar-firewall.json",
    ];
    for (const fileName of captureFiles) {
      const file = files.get(fileName);
      expect(file, fileName).toBeDefined();
      for (const command of commandsOf(file as HookFile)) {
        for (const operator of SHELL_OPERATORS) {
          expect(command.includes(operator), `${fileName}: ${command}`).toBe(false);
        }
      }
    }
  });

  // skipped until .kiro/settings/mcp.json is created; see task 8.1
  it("registers hollowinn in .kiro/settings/mcp.json as specified", () => {
    const config = JSON.parse(readFileSync(MCP_FILE, "utf8")) as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
    };
    const server = config.mcpServers?.hollowinn;
    expect(server).toBeDefined();
    expect(server?.command).toBe("npx");
    expect(server?.args).toEqual(["tsx", "servers/hollow-inn/src/main.ts", "v1"]);
  });
});
