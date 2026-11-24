import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{packages,servers,apps,spikes}/**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
