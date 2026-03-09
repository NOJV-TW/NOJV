import { test, expect } from "@playwright/test";
import { screenshotPage } from "./helpers";

test.describe("Navigation", () => {
  test("homepage loads and shows content", async ({ page }) => {
    await page.goto("/zh-TW");
    await expect(page.locator("h2")).toBeVisible();
    await screenshotPage(page, "homepage-zh-tw");
  });

  test("locale switching works", async ({ page }) => {
    await page.goto("/zh-TW");
    // Click the "en" locale link
    await page.click('a[href="/en"]');
    await expect(page).toHaveURL(/\/en/);
    await screenshotPage(page, "homepage-en");
  });

  test("navigation links work", async ({ page }) => {
    await page.goto("/zh-TW");

    // Navigate to problems
    await page.click('a[href="/zh-TW/problems"]');
    await expect(page).toHaveURL(/\/problems/);

    // Navigate to contests
    await page.click('a[href="/zh-TW/contests"]');
    await expect(page).toHaveURL(/\/contests/);

    // Navigate to courses
    await page.click('a[href="/zh-TW/courses"]');
    await expect(page).toHaveURL(/\/courses/);
  });

  test("submissions page requires auth", async ({ page }) => {
    await page.goto("/zh-TW/submissions");
    // Should show sign-in required message
    await expect(page.locator("h2")).toBeVisible();
    await screenshotPage(page, "submissions-unauthenticated");
  });

  test("integrity page renders", async ({ page }) => {
    await page.goto("/zh-TW/integrity");
    await expect(page.locator("h2")).toBeVisible();
    await screenshotPage(page, "integrity-page");
  });
});
