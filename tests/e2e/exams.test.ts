import { test, expect } from "@playwright/test";

import { apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

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
    await expect(page.getByText("Warmup: Sum")).not.toBeVisible();
    await context.close();
  });

  test("starting an exam session requires authentication", async ({ page }) => {
    const res = await page.request.post(`/exams/${MIDTERM_ID}?/startExam`, {
      form: {},
      headers: apiWriteHeaders,
    });
    const body = await res.json();
    expect(body.type).not.toBe("success");
  });

  test("starting a session for a nonexistent exam fails for a student", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/exams/exam_does-not-exist?/startExam`, {
      form: {},
      headers: apiWriteHeaders,
    });
    const body = await res.json();
    expect(body.type).not.toBe("success");
    await context.close();
  });

  test("ip-violations endpoint handles unknown exam id gracefully", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get("/api/exams/exam_does-not-exist/ip-violations");
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });

  test("ip-violations endpoint forbids students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/exams/${MIDTERM_ID}/ip-violations`);
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("teacher can list ip-violations for a real exam", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/exams/${MIDTERM_ID}/ip-violations`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.violations)).toBe(true);
    await context.close();
  });

  test("active exam workspace keeps its countdown and end-session action", async ({
    browser,
  }) => {
    const examId = "exam_demo_gradebook_active";
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    try {
      const response = await page.request.post(`/exams/${examId}?/startExam`, {
        form: {},
        headers: apiWriteHeaders,
      });
      expect((await response.json()).type).toBe("success");
      await page.goto(`/exams/${examId}/problems/problem_warmup-sum`);
      const countdown = page.getByText(/^\d{2,}:\d{2}:\d{2}$/);
      await expect(countdown).toBeVisible();
      const initial = await countdown.textContent();
      await expect.poll(() => countdown.textContent()).not.toBe(initial);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: /end exam/i }).click();
      await expect(page).toHaveURL(new RegExp(`/exams/${examId}$`));
    } finally {
      await page.request.post(`/exams/${examId}?/releaseSession`, {
        form: {},
        headers: apiWriteHeaders,
      });
      await context.close();
    }
  });
});
