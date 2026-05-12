import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

// Pre-redesign this spec covered the legacy `/courses/[slug]/manage/assessments`
// page that hosted both assessment + contest forms. After the contest/exam
// split (commit b21759a) creation lives in three separate routes:
//   /courses/[id]/assignments/new
//   /courses/[id]/exams/new
//   /contests/new
// The legacy unified page is gone, so the form-submission scenarios it
// hosted no longer have a home. We keep the shape of the suite (smoke
// the new-creation flows are reachable) and drop the dead form-error
// assertions until a parallel page-level test gets written for each
// new-creation route.
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
