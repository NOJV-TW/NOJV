import { test, expect } from "@playwright/test";

test.describe("Submission flow", () => {
  test.beforeEach(async ({ page }) => {
    // Sign in with seeded user via admin-signin (email/password login)
    await page.goto("/admin-signin");
    await page.getByLabel("Handle or Email").fill("alice@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("/");
  });

  test("can view problem list", async ({ page }) => {
    await page.goto("/problems");
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("can view submissions page", async ({ page }) => {
    await page.goto("/submissions");
    await expect(page.getByRole("main")).toBeVisible();
  });
});
