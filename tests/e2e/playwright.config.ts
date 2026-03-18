import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: isCI ? "http://localhost:3000" : "http://localhost:5173",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "../setup/playwright-global-setup.ts",
  webServer: {
    command: isCI ? "node apps/web/build" : "pnpm dev",
    url: isCI ? "http://localhost:3000" : "http://localhost:5173",
    reuseExistingServer: !isCI,
    cwd: "../.."
  }
});
