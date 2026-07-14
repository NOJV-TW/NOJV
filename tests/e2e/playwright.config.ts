import { defineConfig, devices } from "@playwright/test";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { PLAYWRIGHT_STORAGE_ENVIRONMENT } from "../setup/playwright-environment";

const E2E_ORIGIN = "http://127.0.0.1:5174";
const e2eDatabaseUrl = resolveDestructiveTestDatabase("nojv_e2e_test");

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 60000,
  use: {
    baseURL: E2E_ORIGIN,
    locale: "en-US",
    trace: "on-first-retry",
    actionTimeout: 15000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "../setup/playwright-global-setup.ts",
  webServer: {
    command: "pnpm --filter @nojv/web exec vite dev --host 127.0.0.1 --port 5174 --strictPort",
    url: `${E2E_ORIGIN}/favicon.svg`,
    reuseExistingServer: false,
    cwd: "../..",
    env: {
      ...PLAYWRIGHT_STORAGE_ENVIRONMENT,
      APP_BASE_URL: E2E_ORIGIN,
      BETTER_AUTH_URL: E2E_ORIGIN,
      DATABASE_URL: e2eDatabaseUrl,
      NOJV_DESTRUCTIVE_TEST_DATABASE: "nojv_e2e_test",
      ORIGIN: E2E_ORIGIN,
      TEST_DATABASE_URL: e2eDatabaseUrl,
    },
  },
});
