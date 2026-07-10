import { test, expect } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

async function readOwnUserId(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/settings");
  const response = await page.request.get("/api/auth/get-session");
  const session = (await response.json()) as { user?: { id?: string } };
  const id = session.user?.id;
  if (!id) throw new Error("Could not resolve session user id");
  return id;
}

test.describe("Public user profile", () => {
  test("private profile is hidden from others and logged-out visitors", async ({ browser }) => {
    const studentContext = await browser.newContext({ storageState: studentAuth });
    const studentPage = await studentContext.newPage();
    const studentId = await readOwnUserId(studentPage);

    await studentPage.goto("/settings");
    const toggle = studentPage
      .locator("form[action*='updateProfileVisibility'] input[type='checkbox']");
    if (await toggle.isChecked()) {
      await toggle.click();
      await studentPage.waitForLoadState("networkidle");
    }

    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    const anonResponse = await anonPage.goto(`/users/${studentId}`);
    expect(anonResponse?.status()).toBe(404);
    await anonContext.close();

    const teacherContext = await browser.newContext({ storageState: teacherAuth });
    const teacherPage = await teacherContext.newPage();
    const teacherResponse = await teacherPage.goto(`/users/${studentId}`);
    expect(teacherResponse?.status()).toBe(404);
    await teacherContext.close();

    await studentContext.close();
  });

  test("owner always sees their own profile with a private badge", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const userId = await readOwnUserId(page);

    await page.goto(`/users/${userId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.close();
  });

  test("enabling the toggle makes the profile world-visible", async ({ browser }) => {
    const studentContext = await browser.newContext({ storageState: studentAuth });
    const studentPage = await studentContext.newPage();
    const studentId = await readOwnUserId(studentPage);

    await studentPage.goto("/settings");
    const toggle = studentPage
      .locator("form[action*='updateProfileVisibility'] input[type='checkbox']");
    if (!(await toggle.isChecked())) {
      await toggle.click();
      await studentPage.waitForLoadState("networkidle");
    }

    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    const anonResponse = await anonPage.goto(`/users/${studentId}`);
    expect(anonResponse?.status()).toBe(200);
    await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible();
    await anonContext.close();

    const revert = studentPage
      .locator("form[action*='updateProfileVisibility'] input[type='checkbox']");
    await studentPage.goto("/settings");
    if (await revert.isChecked()) {
      await revert.click();
      await studentPage.waitForLoadState("networkidle");
    }
    await studentContext.close();
  });
});
