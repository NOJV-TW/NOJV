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
});
