import { defineConfig, devices } from "@playwright/test"

// Minimal Playwright config — runs the e2e tests in tests/e2e/ against the dev server on
// port 3000 (already running externally; we don't spawn it via `webServer` because the
// repo's dev workflow assumes the user starts it manually).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // POS sale flow mutates DB state; run serially to avoid races
  workers: 1,
  reporter: [["list"]],
  timeout: 90_000, // POS form has a lot of network round-trips per step; 30s default is too tight
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
})
