import { test, expect } from "@playwright/test";

import { adminAuth, studentAuth, teacherAuth } from "./_shared";

test.describe("Dashboard", () => {
  test("unauthenticated user is redirected to signin", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/signin/);
  });

  test("student dashboard renders core sections", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("main")).toBeVisible();

    await expect(page.getByText(/Streak|連續解題/i).first()).toBeVisible({ timeout: 10_000 });

    const activityArea = page.getByText(
      /Daily Activity|每日解題熱圖|No submissions yet|尚無繳交/i,
    );
    await expect(activityArea.first()).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(/Suggested for you|為你推薦/i).first()).toBeVisible();

    await context.close();
  });

  test("teacher dashboard loads", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("admin dashboard loads", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
