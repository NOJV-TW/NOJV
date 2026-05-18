import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 2,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5173",
    locale: "en-US",
    trace: "on-first-retry",
    actionTimeout: 15000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "../setup/playwright-global-setup.ts",
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    cwd: "../..",
    // Lift API rate limits so the parallel suite's request bursts don't
    // trip the limiter (see `rate-limiter.ts`).
    env: { NOJV_E2E: "1" },
  },
});
