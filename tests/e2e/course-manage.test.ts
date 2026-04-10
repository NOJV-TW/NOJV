import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Course Management", () => {
  test("teacher can access course manage overview", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage");
    await expect(page.getByRole("main")).toBeVisible();
    // Should show the manage header with course slug
    await expect(page.getByText("Manage")).toBeVisible();
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await context.close();
  });

  test("teacher can access members management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/members");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access assessments management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/assessments");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  // NOTE: `/courses/[slug]/manage/problems` was removed in commit b21759a
  // (schema redesign — problems are managed via /problems instead).

  test("teacher can access progress page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/progress");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
