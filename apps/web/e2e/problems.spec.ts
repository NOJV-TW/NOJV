import { test, expect } from "@playwright/test";
import { screenshotPage } from "./helpers";

test.describe("Problems", () => {
  test("problems list page shows problems", async ({ page }) => {
    await page.goto("/zh-TW/problems");
    await expect(page.locator("h2")).toBeVisible();
    // Should show at least the seeded public problems
    const problemCards = page.locator('a[href*="/problems/"]');
    await expect(problemCards.first()).toBeVisible();
    await screenshotPage(page, "problems-list");
  });

  test("problem detail page shows editor", async ({ page }) => {
    await page.goto("/zh-TW/problems/warmup-sum");
    await expect(page.locator("h2")).toContainText("Warmup Sum");
    // Editor should be visible
    await expect(page.locator('[class*="monaco"]')).toBeVisible({ timeout: 10000 });
    await screenshotPage(page, "problem-detail-warmup-sum");
  });

  test("problem detail shows sample testcases", async ({ page }) => {
    await page.goto("/zh-TW/problems/warmup-sum");
    await expect(page.getByText("Sample 1")).toBeVisible();
    await screenshotPage(page, "problem-detail-samples");
  });

  test("en locale problems page works", async ({ page }) => {
    await page.goto("/en/problems");
    await expect(page.locator("h2")).toBeVisible();
    await screenshotPage(page, "problems-list-en");
  });
});
