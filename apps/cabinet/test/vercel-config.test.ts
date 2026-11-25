/**
 * Task 8.1. Requirements 17.4 and 17.5.
 *
 * Node environment. Reads the `vercel.json` at the repository root as text and checks it. The file is
 * outside `apps/cabinet`, so the path comes from `process.cwd()`, which is the repository root when
 * `npm test` runs there.
 *
 * Assumptions:
 * - `framework: null` tells Vercel to use the build command and output directory as given.
 * - The build command builds the Cabinet, then adds the landing page and the deck (`site/`, not part of the Cabinet)
 *   to the Cabinet's output directory (claude-direct, P4 2026-11-26).
 * - "No Pro-only feature" is checked by the allow-list of top-level keys below. A new key fails the test
 *   until someone reviews it against the Vercel plan limits.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const CONFIG_PATH = join(process.cwd(), "vercel.json");

/** Keys the static deploy may use. `functions` is excluded on purpose (Requirement 17.5). */
const ALLOWED_KEYS = ["$schema", "buildCommand", "outputDirectory", "framework"] as const;

const VercelConfig = z.object({
  $schema: z.string().optional(),
  buildCommand: z.literal("npm run build -w apps/cabinet && npx vite build --config site/vite.config.ts"),
  outputDirectory: z.literal("apps/cabinet/dist"),
  framework: z.null(),
});

function readConfig(): unknown {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
}

describe("vercel.json (Requirements 17.4, 17.5)", () => {
  it("sits at the repository root and parses as JSON", () => {
    expect(() => readConfig()).not.toThrow();
    expect(readConfig()).toBeTypeOf("object");
  });

  it("names the Cabinet build command and output directory with no framework preset", () => {
    const parsed = VercelConfig.safeParse(readConfig());
    if (!parsed.success) {
      throw new Error(`vercel.json does not match the expected shape: ${parsed.error.message}`);
    }
    expect(parsed.data.buildCommand).toBe("npm run build -w apps/cabinet && npx vite build --config site/vite.config.ts");
    expect(parsed.data.outputDirectory).toBe("apps/cabinet/dist");
    expect(parsed.data.framework).toBeNull();
  });

  it("has no functions key, so the deploy needs no serverless function", () => {
    expect(readConfig()).not.toHaveProperty("functions");
  });

  it("uses only the allowed top-level keys, so no Pro-only feature is configured", () => {
    const keys = Object.keys(readConfig() as Record<string, unknown>);
    const unexpected = keys.filter((key) => !(ALLOWED_KEYS as readonly string[]).includes(key));
    expect(unexpected).toEqual([]);
  });
});
