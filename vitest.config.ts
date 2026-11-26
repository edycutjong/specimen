import { defineConfig } from "vitest/config";

const ALL = ["{packages,servers,apps,spikes}/**/test/**/*.test.{ts,tsx}"];
// motion.test.tsx holds a wall-clock check (render to the cold-open stamp under jsdom, see its comment). With the other
// ~120 files running beside it, CPU contention on a shared CI runner moved it by up to a second, so it runs in its own
// group after everything else, alone, where it measures the page and not the machine's load.
const WALL_CLOCK = ["apps/cabinet/test/motion.test.tsx"];

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    // jsdom lacks AnimationEvent, which browsers have (see vitest.setup.ts)
    setupFiles: ["./vitest.setup.ts"],
    // Several suites spawn real child processes (hooks, replay, MCP servers); the 5 s default timed out under heavy
    // machine load (load average ~35 during QA round 1), so the limit is 20 s. A real hang still fails.
    testTimeout: 20_000,
    projects: [
      { extends: true, test: { name: "suite", include: ALL, exclude: ["**/node_modules/**", "**/dist/**", ...WALL_CLOCK], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "wall-clock", include: WALL_CLOCK, sequence: { groupOrder: 1 } } },
    ],
  },
});
