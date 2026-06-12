import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

const COURSE_ID = "course_os-lab-spring-2026";

test.describe("Teacher creation entrypoints", () => {
  test("teacher can open the assignment creation page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/assignments/new`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can open the exam creation page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/exams/new`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can open the standalone contest creation page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/contests/new`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
