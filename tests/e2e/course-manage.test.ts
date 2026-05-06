import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

// `/courses/[id]/manage` was flattened in the schema redesign — manage
// surfaces now live as direct children of the course node:
//   /courses/[id]/members
//   /courses/[id]/assignments
//   /courses/[id]/exams
//   /courses/[id]/settings
// Course id is also `course_os-lab-spring-2026` (with the `course_` prefix),
// not the bare slug used in the pre-redesign tests.
const COURSE_ID = "course_os-lab-spring-2026";

test.describe("Course Management", () => {
  test("teacher can access course detail (manage entrypoint)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await context.close();
  });

  test("teacher can access members management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access assignments management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/assignments`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access exams management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/exams`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access settings page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/settings`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
