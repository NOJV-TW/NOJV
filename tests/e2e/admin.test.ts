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
    // Layout gate throws error(403, ...). SvelteKit may serve the bytes
    // with a 200 inside an error boundary; the canonical contract is
    // either status >= 400 OR an error message rendered on the page.
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
    const res = await page.goto("/admin/content/announcements");
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
    await page.goto("/admin/content/announcements");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("admin can open the users management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin/system/users");
    await expect(page.getByRole("main")).toBeVisible();
    // The seeded teacher / student rows must show up in the table.
    await expect(page.getByText("teacher@nojv.local").first()).toBeVisible({
      timeout: 10_000,
    });
    await context.close();
  });

  test("admin users page accepts a role filter via querystring", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin/system/users?role=teacher");
    await expect(page.getByRole("main")).toBeVisible();
    expect(page.url()).toContain("role=teacher");
    await context.close();
  });

  test("admin users page accepts a search query", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto("/admin/system/users?search=admin");
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
});
