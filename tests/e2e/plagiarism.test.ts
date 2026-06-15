import { test, expect } from "@playwright/test";

import { apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

const HW1_ID = "hw1-process-trace";
const HW2_ID = "hw2-signal-handling";

test.describe("Plagiarism — reports + flag API", () => {
  test("unauthenticated user cannot read plagiarism reports", async ({ page }) => {
    const res = await page.request.get(`/api/plagiarism/${HW1_ID}/reports?type=assessment`);
    expect(res.status()).toBe(401);
  });

  test("student cannot read plagiarism reports", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/plagiarism/${HW1_ID}/reports?type=assessment`);
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("teacher can read plagiarism reports for an assessment", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/plagiarism/${HW1_ID}/reports?type=assessment`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.reports)).toBe(true);
    await context.close();
  });

  test("student cannot trigger a plagiarism check", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/plagiarism/${HW2_ID}/reports?type=assessment`, {
      data: {},
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("flag pair API rejects unauthenticated callers", async ({ page }) => {
    const res = await page.request.post(`/api/plagiarism-flags`, {
      data: {
        contextType: "assessment",
        contextId: HW1_ID,
        problemId: "problem_warmup-sum",
        userAId: "user-a",
        userBId: "user-b",
        note: null,
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(401);
  });

  test("flag pair API rejects students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/plagiarism-flags`, {
      data: {
        contextType: "assessment",
        contextId: HW1_ID,
        problemId: "problem_warmup-sum",
        userAId: "user-a",
        userBId: "user-b",
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("flag pair API validates body shape", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/plagiarism-flags`, {
      data: {
        contextId: HW1_ID,
        problemId: "problem_warmup-sum",
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("DELETE flag returns 4xx on missing flag for staff", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/plagiarism-flags/nonexistent-flag-id`, {
      method: "DELETE",
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });

  test("teacher can open assignment plagiarism dashboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/assignments/${HW1_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    const plagiarismTab = page.getByRole("tab", { name: /plagiarism|抄襲/i }).first();
    if (await plagiarismTab.count()) {
      await expect(plagiarismTab).toBeVisible();
    }
    await context.close();
  });
});
