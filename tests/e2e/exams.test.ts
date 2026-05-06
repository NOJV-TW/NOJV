import { test, expect } from "@playwright/test";

import { apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

// Seeded exam fixtures (see packages/db/prisma/seeds/courses.ts):
//   `exam_midterm-systems-lab`   — published, IP whitelist 140.112.0.0/16
//   `exam_upcoming-demo`         — published, far-future start (2099)
const MIDTERM_ID = "exam_midterm-systems-lab";
const UPCOMING_ID = "exam_upcoming-demo";

test.describe("Exams — list, detail, problem visibility", () => {
  test("student sees the exams listing page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/exams");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher exams list shows midterm fixture", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/exams");
    await expect(page.getByText("Midterm Systems Lab")).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test("teacher can open midterm exam detail", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/exams/${MIDTERM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Midterm Systems Lab")).toBeVisible();
    await context.close();
  });

  test("student opening an upcoming exam sees no problem titles before start", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/exams/${UPCOMING_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    // Seeded `Upcoming Demo Exam` has one linked problem `problem_warmup-sum`
    // titled "Warmup: Sum"; that title MUST be hidden until startsAt.
    await expect(page.getByText("Warmup: Sum")).not.toBeVisible();
    await context.close();
  });

  test("starting an exam session requires authentication", async ({ page }) => {
    const res = await page.request.post("/api/exam-session/start", {
      data: { examId: MIDTERM_ID },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(401);
  });

  test("starting a session for a nonexistent exam fails for a student", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post("/api/exam-session/start", {
      data: { examId: "exam_does-not-exist" },
      headers: apiWriteHeaders,
    });
    // Either 404 (not found), 403 (not enrolled / not running), or 400
    // (gate failure). The contract here is "no 5xx, no 2xx".
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });

  test("ip-violations endpoint requires examId", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get("/api/ip-violations");
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("ip-violations endpoint forbids students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/ip-violations?examId=${MIDTERM_ID}`);
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("teacher can list ip-violations for a real exam", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/ip-violations?examId=${MIDTERM_ID}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.violations)).toBe(true);
    await context.close();
  });
});
