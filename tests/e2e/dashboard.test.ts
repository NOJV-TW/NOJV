import { test, expect } from "@playwright/test";

import { adminAuth, newStudentAuth, studentAuth, teacherAuth } from "./_shared";

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

    await expect(page.getByText(/At a glance|數據一覽/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Topic Proficiency|主題熟練度/i).first()).toBeVisible();

    const activityArea = page.getByText(
      /Daily Activity|每日解題熱圖|No submissions yet|尚無提交記錄/i,
    );
    await expect(activityArea.first()).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(/Recent Activity|最近活動/i).first()).toBeVisible();

    await context.close();
  });

  test("brand-new user sees the onboarding empty state", async ({ browser }) => {
    const context = await browser.newContext({ storageState: newStudentAuth });
    const page = await context.newPage();
    await page.goto("/dashboard");

    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Welcome to NOJV, New Student/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Pick a problem to start solving/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse problems/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse courses/i })).toBeVisible();
    await expect(page.getByText(/Could not load dashboard data|Failed to load/i)).toHaveCount(
      0,
    );

    await context.close();
  });

  test("view toggle switches to the site-wide overview", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/dashboard");

    const tour = page.locator(".driver-popover");
    const tourAppeared = await tour.waitFor({ state: "visible", timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (tourAppeared) {
      await page.locator(".driver-popover-close-btn").click();
      await tour.waitFor({ state: "hidden" });
    }

    const serverTab = page.getByRole("button", { name: /Site-wide|全服總覽/i });
    await expect(serverTab).toBeVisible({ timeout: 10_000 });
    await serverTab.click();

    await expect(page).toHaveURL(/view=server/);
    await expect(page.getByText(/Site submission trend|全服提交趨勢/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Trending problems|熱門題目/i).first()).toBeVisible();

    await page.getByRole("button", { name: /My overview|個人總覽/i }).click();
    await expect(page).not.toHaveURL(/view=server/);

    await context.close();
  });

  test("direct link to ?view=server renders the site-wide overview", async ({ browser }) => {
    const context = await browser.newContext({ storageState: newStudentAuth });
    const page = await context.newPage();
    await page.goto("/dashboard?view=server");

    await expect(page.getByText(/Site submission trend|全服提交趨勢/i).first()).toBeVisible({
      timeout: 10_000,
    });

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
