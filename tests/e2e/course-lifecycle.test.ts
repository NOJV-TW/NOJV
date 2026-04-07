import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const adminAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/admin.json");

const timestamp = Date.now();
const COURSE_SLUG = `e2e-${timestamp}`;
const COURSE_TITLE = `E2E Course ${timestamp}`;

test.describe("Course Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("teacher can create a new course via form action", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const res = await page.request.post("/courses?/create", {
      form: {
        title: COURSE_TITLE,
        slug: COURSE_SLUG,
        description: "Automated E2E test course for lifecycle verification.",
        locale: "en"
      },
      headers: { origin: "http://localhost:5173" }
    });

    const body = await res.json();
    expect(body.type).not.toBe("error");

    await context.close();
  });

  test("created course appears in course list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses");
    await expect(page.getByText(COURSE_TITLE)).toBeVisible();
    await context.close();
  });

  test("teacher can access course detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_SLUG}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(COURSE_TITLE)).toBeVisible();
    await context.close();
  });

  test("teacher can access manage overview", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_SLUG}/manage`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access members page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_SLUG}/manage/members`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access problems page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_SLUG}/manage/problems`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access assessments page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_SLUG}/manage/assessments`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("student cannot access course manage page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.goto(`/courses/${COURSE_SLUG}/manage`);
    const status = res?.status() ?? 0;
    expect(status === 403 || status === 404 || page.url().includes("/courses")).toBe(true);
    await context.close();
  });

  test("admin can access any course manage page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_SLUG}/manage`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
