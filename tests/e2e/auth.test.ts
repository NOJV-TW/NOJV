import { test, expect } from "@playwright/test";

test.describe("Authentication flow", () => {
  test("can view sign-in page", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveTitle(/NOJV/);
  });

  test("redirects unauthenticated user to signin", async ({ page }) => {
    await page.goto("/problems");
    await expect(page).toHaveURL(/signin/);
  });

  test("can view sign-up page with registration form", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByText("Create your NOJV account")).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.getByLabel("Handle")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign up/i })).toBeVisible();
  });

  test("can register a new account", async ({ page }) => {
    const timestamp = String(Date.now());

    await page.goto("/signup");
    await page.getByLabel("Display name").fill(`Test User ${timestamp}`);
    await page.getByLabel("Handle").fill(`testuser${timestamp}`);
    await page.getByLabel("Email").fill(`test-${timestamp}@example.com`);
    await page.getByLabel("Password").fill("TestPassword123!");
    await page.getByRole("button", { name: /sign up/i }).click();

    // After successful registration, redirects to home
    await expect(page).toHaveURL("/");
  });
});
