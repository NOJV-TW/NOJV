import { test, expect } from "@playwright/test";
import { screenshotPage } from "./helpers";

test.describe("Contests", () => {
  test("contests list page shows contests", async ({ page }) => {
    await page.goto("/zh-TW/contests");
    await expect(page.locator("h2")).toBeVisible();
    const contestCards = page.locator('a[href*="/contests/"]');
    await expect(contestCards.first()).toBeVisible();
    await screenshotPage(page, "contests-list");
  });

  test("contest detail page shows problems", async ({ page }) => {
    await page.goto("/zh-TW/contests/spring-qualifier-2026");
    await expect(page.locator("h2")).toContainText("Spring Qualifier");
    await screenshotPage(page, "contest-detail-spring-qualifier");
  });
});
