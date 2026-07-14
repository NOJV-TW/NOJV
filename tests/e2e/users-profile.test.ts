import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { readLiveSession } from "./_shared";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

async function readOwnUserId(page: Page): Promise<string> {
  const id = (await readLiveSession(page)).user?.id;
  if (!id) throw new Error("Could not resolve session user id");
  return id;
}

async function setProfilePublic(page: Page, userId: string, value: boolean): Promise<void> {
  await page.goto(`/users/${userId}`);
  // wait for SvelteKit hydration so the form onchange handler is attached
  await page.waitForTimeout(3000);
  const toggle = page.locator("form[action*='updateProfileVisibility'] input[type='checkbox']");
  await expect(toggle).toBeAttached();
  if ((await toggle.isChecked()) === value) return;
  const posted = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("updateProfileVisibility"),
  );
  await toggle.setChecked(value, { force: true });
  await posted;
}

test.describe("Public user profile", () => {
  test("private profile is hidden from others and logged-out visitors", async ({ browser }) => {
    const studentContext = await browser.newContext({ storageState: studentAuth });
    const studentPage = await studentContext.newPage();
    const studentId = await readOwnUserId(studentPage);
    await setProfilePublic(studentPage, studentId, false);

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
    await setProfilePublic(studentPage, studentId, true);

    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    const anonResponse = await anonPage.goto(`/users/${studentId}`);
    expect(anonResponse?.status()).toBe(200);
    await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible();
    await anonContext.close();

    await setProfilePublic(studentPage, studentId, false);
    await studentContext.close();
  });
});
