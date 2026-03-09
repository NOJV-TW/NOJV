import { test, expect } from "@playwright/test";
import { screenshotPage } from "./helpers";

test.describe("Authentication", () => {
  test("sign-in page renders correctly", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page.locator("h1")).toContainText("Sign in");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    // OAuth buttons
    await expect(page.getByText("GitHub")).toBeVisible();
    await expect(page.getByText("Google")).toBeVisible();
    await screenshotPage(page, "auth-signin");
  });

  test("sign-up page renders correctly", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(page.locator("h1")).toContainText("Sign up");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await screenshotPage(page, "auth-signup");
  });

  test("sign-in link navigates to sign-up", async ({ page }) => {
    await page.goto("/auth/signin");
    await page.click('a[href="/auth/signup"]');
    await expect(page).toHaveURL(/\/auth\/signup/);
  });
});
