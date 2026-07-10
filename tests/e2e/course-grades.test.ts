import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const COURSE_GRADES_URL = "/courses/course_os-lab-spring-2026/grades";

test.describe("Course gradebook", () => {
  test("teacher sees the full gradebook with export", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(COURSE_GRADES_URL);
    await expect(page.getByRole("heading", { name: "Gradebook" })).toBeVisible();
    await expect(page.getByRole("button", { name: /export csv/i })).toBeVisible();
    await expect(page.locator("[data-slot='course-gradebook'] tbody tr").first()).toBeVisible();
    await context.close();
  });

  test("student sees only their own row without export", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(COURSE_GRADES_URL);
    await expect(page.getByRole("heading", { name: "My grades" })).toBeVisible();
    await expect(page.getByRole("button", { name: /export csv/i })).not.toBeVisible();
    const rows = page.locator("[data-slot='course-gradebook'] tbody tr");
    await expect(rows).toHaveCount(1);
    await context.close();
  });

  test("grades tab is visible on the course page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/courses/course_os-lab-spring-2026");
    await expect(page.getByRole("link", { name: "Grades" })).toBeVisible();
    await context.close();
  });
});
