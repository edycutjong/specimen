import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{packages,servers,apps,spikes}/**/test/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Several suites spawn real child processes (hooks, replay, MCP servers); the 5 s default timed out under heavy
    // machine load (load average ~35 during QA round 1), so the limit is 20 s. A real hang still fails.
    testTimeout: 20_000,
  },
});
