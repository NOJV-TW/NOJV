import { test, expect } from "@playwright/test";

import { DisposableCredentialUser, signInWithPassword } from "./_disposable-user";
import { adminAuth, studentAuth, teacherAuth } from "./_shared";

const regularAdmin = new DisposableCredentialUser("regular-admin-mode");

test.describe("Admin panel — gating + pages", () => {
  test.beforeAll(() => regularAdmin.create({ platformRole: "admin" }));
  test.afterAll(() => regularAdmin.cleanup());

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
    await expect(page.getByRole("combobox", { name: /role: teacher/i })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /advanced access: teacher/i })).toHaveValue(
      "true",
    );
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

  test("regular admin switches from the user menu without OTP", async ({ page }) => {
    await signInWithPassword(page, regularAdmin.email);
    await page.goto("/dashboard");

    const menuButton = page.getByRole("button", { name: /open account menu/i });
    await expect(menuButton).toBeEnabled();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    const switchButton = page.getByRole("menuitem", { name: /switch to admin mode/i });
    await expect(switchButton).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/admin-mode") &&
          response.request().method() === "POST" &&
          response.status() === 200,
      ),
      switchButton.click(),
    ]);

    await expect(page).toHaveURL(/\/admin(?:\/|$)/);
    await expect(page.getByRole("main")).toBeVisible();

    await page.locator('a[href="/problems"]').first().click();
    await expect(page).toHaveURL(/\/problems(?:\/|$)/);
    await menuButton.click();
    await expect(page.getByRole("menuitem", { name: /exit admin mode/i })).toBeVisible();
    await menuButton.click();

    await page.locator('a[href="/admin"]').first().click();
    await expect(page).toHaveURL(/\/admin(?:\/|$)/);

    await page.goto("/admin/users");
    await expect(page.getByRole("main")).toBeVisible();
    await menuButton.click();
    await expect(page.getByRole("menuitem", { name: /exit admin mode/i })).toBeVisible();
  });

  test("super-admin activation requires a verified step-up", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/admin-signin", { waitUntil: "networkidle" });
    await page.getByLabel(/username or email/i).fill("admin@nojv.local");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /sign in|登入/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/settings" &&
        url.searchParams.get("verify") === "totp" &&
        url.searchParams.get("returnTo") === "/account/api-tokens/verify?purpose=admin-mode",
      { timeout: 15000 },
    );

    const denied = await page.request.post("/api/admin-mode", {
      headers: { "x-requested-with": "fetch" },
      data: { active: true },
    });
    expect(denied.status()).toBe(403);

    await context.close();
  });
});
