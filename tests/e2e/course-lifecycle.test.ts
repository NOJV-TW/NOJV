import { test, expect } from "@playwright/test";
import path from "node:path";
import { formActionHeaders } from "./_shared";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const adminAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/admin.json");

const timestamp = Date.now();
const COURSE_TITLE = `E2E Course ${timestamp}`;

let createdCourseId = "";

test.describe("Course Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("teacher can create a new course via the default form action", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const res = await page.request.post("/courses/new", {
      form: {
        title: COURSE_TITLE,
        description: "Automated E2E test course for lifecycle verification.",
      },
      headers: formActionHeaders,
    });

    const body = (await res.json()) as { type: string; location?: string };
    expect(body.type).toBe("redirect");
    expect(body.location).toMatch(/^\/courses\//);
    createdCourseId = body.location!.replace(/^\/courses\//, "");
    expect(createdCourseId).toBeTruthy();

    await context.close();
  });

  test("created course appears in the managing tab", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses?tab=managing");
    await expect(page.getByText(COURSE_TITLE)).toBeVisible();
    await context.close();
  });

  test("teacher can access course detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${createdCourseId}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(COURSE_TITLE)).toBeVisible();
    await context.close();
  });

  test("teacher can access members page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${createdCourseId}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access assignments page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${createdCourseId}/assignments`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("admin can access any course detail", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${createdCourseId}`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("non-enrolled student does not see the new course on the enrolled tab", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/courses");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(COURSE_TITLE)).not.toBeVisible();
    await context.close();
  });
});
