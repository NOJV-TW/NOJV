import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Courses", () => {
  test("student can see enrolled courses", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/courses");
    await expect(page.getByRole("main")).toBeVisible();
    // Student is enrolled in os-lab-spring-2026
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await context.close();
  });

  test("teacher sees all courses and create button", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    // Teacher should see the create course button
    await expect(page.getByRole("button", { name: /create/i })).toBeVisible();
    await context.close();
  });

  test("can view course detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026");
    await expect(page.getByRole("main")).toBeVisible();
    // Course title should be visible
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await context.close();
  });

  test("student does not see create course button", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/courses");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("button", { name: /create/i })).not.toBeVisible();
    await context.close();
  });
});
