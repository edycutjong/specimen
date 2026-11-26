import { defineConfig, devices } from "@playwright/test";

// End-to-end test of the judge path in Chromium.
// - Local / CI: the exact Vercel output (vercel.json buildCommand → apps/cabinet/dist), served statically.
//   Build first (`npm run build:site`), then `npm run test:e2e`.
// - Live: `E2E_BASE_URL=https://specimen.edycu.dev npm run test:e2e` runs the same tests against the deployed site
//   (.github/workflows/live.yml).
const PORT = 4173;
const live = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: live ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: live
    ? undefined
    : {
        command: `npx vite preview --outDir apps/cabinet/dist --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
