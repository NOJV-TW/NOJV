import { test, expect } from "@playwright/test";

import { adminAuth, formActionHeaders, studentAuth, teacherAuth } from "./_shared";

const COURSE_ID = "course_os-lab-spring-2026";

test.describe("Course members + settings", () => {
  test("teacher can open the members management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    // Seeded teacher membership row.
    await expect(page.getByText("Teacher").first()).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test("admin can open any course members page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("members page does not expose manage controls to a student", async ({ browser }) => {
    // The members page itself is reachable for any enrolled member —
    // this is intentional so the directory shows up in the course UI.
    // What MUST be hidden is the manage surface: bulk-add textarea,
    // change-role button, remove-member action.
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    // Any of these locators existing means the manager UI is leaking.
    await expect(page.getByRole("textbox", { name: /handles|帳號/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /add members|新增成員/i })).not.toBeVisible();
    await context.close();
  });

  test("bulkAdd action rejects students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/courses/${COURSE_ID}/members?/bulkAdd`, {
      form: { handles: "ghost-handle", role: "student" },
      headers: formActionHeaders,
    });
    const body = await res.json().catch(() => null);
    // Form actions return JSON with `type: "failure"` for fail()
    // responses; the HTTP status is 200 with that envelope, OR the
    // hook gates upstream and returns a 4xx. Either way: not success.
    if (body) {
      expect(body.type).not.toBe("success");
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });

  test("changeRole action rejects students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/courses/${COURSE_ID}/members?/changeRole`, {
      form: { userId: "user_someone", role: "ta" },
      headers: formActionHeaders,
    });
    const body = await res.json().catch(() => null);
    if (body) {
      expect(body.type).not.toBe("success");
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });

  test("teacher can open the settings page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/settings`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("student cannot reach the settings page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.goto(`/courses/${COURSE_ID}/settings`);
    const status = res?.status() ?? 0;
    if (status >= 400) {
      expect(status).toBeGreaterThanOrEqual(400);
    } else {
      expect(page.url()).not.toContain("/settings");
    }
    await context.close();
  });

  test("bulkAdd with empty handles surfaces a validation failure", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/courses/${COURSE_ID}/members?/bulkAdd`, {
      form: { handles: "", role: "student" },
      headers: formActionHeaders,
    });
    const body = await res.json().catch(() => null);
    if (body) {
      expect(["failure", "error"]).toContain(body.type);
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });
});
