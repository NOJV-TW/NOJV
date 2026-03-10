import { defineConfig } from "@playwright/test";

const ciSettings = process.env.CI
  ? {
      retries: 2,
      workers: 1
    }
  : {
      retries: 0
    };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  ...ciSettings,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "on-first-retry"
  },
  outputDir: "./e2e/test-results"
});
