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
    await expect(page.getByRole("tab", { name: /my courses/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await context.close();
  });

  test("teacher defaults to managed courses and can switch to enrolled courses", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("tab", { name: /managing/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /new course|create your first/i }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /my courses/i }).click();
    await expect(page).toHaveURL(/tab=enrolled/);
    await page.reload();
    await expect(page.getByRole("tab", { name: /my courses/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await context.close();
  });

  test("can view course detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/courses/course_os-lab-spring-2026");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await context.close();
  });

  test("student does not see the new-course link", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/courses?tab=managing");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /new course|create your first/i }),
    ).not.toBeVisible();
    await context.close();
  });
});
