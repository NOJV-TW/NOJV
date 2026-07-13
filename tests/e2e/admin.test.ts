import { test, expect } from "@playwright/test";

import { adminAuth, studentAuth, teacherAuth } from "./_shared";

test.describe("Admin panel — gating + pages", () => {
  test("admin landing page redirects unauthenticated users", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/signin/);
  });

  test("teacher cannot reach the admin landing page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.goto("/admin");
    const status = res?.status() ?? 0;
    if (status < 400) {
      await expect(page.getByText(/Admin access required/i)).toBeVisible();
    } else {
      expect(status).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });

  test("student cannot reach the admin announcements page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.goto("/admin/announcements");
    const status = res?.status() ?? 0;
    if (status < 400) {
      await expect(page.getByText(/Admin access required/i)).toBeVisible();
    } else {
      expect(status).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });

  test("admin can open the announcements management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin/announcements");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("admin can open the users management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin/users");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("teacher@nojv.local").first()).toBeVisible({
      timeout: 10_000,
    });
    await context.close();
  });

  test("admin users page accepts a role filter via querystring", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin/users?role=teacher");
    await expect(page.getByRole("main")).toBeVisible();
    expect(page.url()).toContain("role=teacher");
    await context.close();
  });

  test("admin users page accepts a search query", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin/users?search=admin");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("admin@nojv.local").first()).toBeVisible({
      timeout: 10_000,
    });
    await context.close();
  });

  test("admin landing page renders for admin", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("admin-mode activation requires a verified step-up", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // A fresh admin login starts de-elevated (original identity).
    await page.goto("/admin-signin", { waitUntil: "networkidle" });
    await page.getByLabel(/username or email/i).fill("admin@nojv.local");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /sign in|登入/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("signin"), { timeout: 15000 });

    // De-elevated: the backend is not reachable.
    const blocked = await page.goto("/admin");
    expect(blocked?.status() ?? 0).toBeGreaterThanOrEqual(400);

    // Entering admin mode starts the fixed verification flow; it never elevates
    // from the menu click itself.
    await page.locator('button[title="Admin"]').click();
    await page.getByRole("button", { name: /admin mode|管理模式/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/settings" &&
        url.searchParams.get("verify") === "totp" &&
        url.searchParams.get("returnTo") === "/account/api-tokens/verify?purpose=admin-mode",
      { timeout: 15000 },
    );
    expect(page.url()).not.toMatch(/\/admin(?:\/|$)/);

    await context.close();
  });
});
