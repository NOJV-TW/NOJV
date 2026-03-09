import { test, expect } from "@playwright/test";
import { screenshotPage } from "./helpers";

test.describe("Courses", () => {
  test("courses list page shows courses", async ({ page }) => {
    await page.goto("/zh-TW/courses");
    await expect(page.locator("h2")).toBeVisible();
    const courseCards = page.locator('a[href*="/courses/"]');
    await expect(courseCards.first()).toBeVisible();
    await screenshotPage(page, "courses-list");
  });

  test("course detail page renders", async ({ page }) => {
    await page.goto("/zh-TW/courses/os-lab-spring-2026");
    // Should show course title
    await expect(page.locator("h2")).toBeVisible();
    await screenshotPage(page, "course-detail-os-lab");
  });
});
