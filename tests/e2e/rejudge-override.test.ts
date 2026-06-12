import { test, expect } from "@playwright/test";

import { adminAuth, apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

const HW1_ID = "hw1-process-trace";
const PROBLEM_ID = "problem_warmup-sum";

test.describe("Rejudge API", () => {
  test("rejects unauthenticated callers", async ({ page }) => {
    const res = await page.request.post(`/api/submissions/sub-doesnt-exist/rejudge`, {
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(401);
  });

  test("rejects malformed batch bodies", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/rejudges`, {
      data: { problemId: "" }, // empty problemId fails schema validation
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("single mode returns 404 for an unknown submission", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/submissions/submission-doesnt-exist/rejudge`, {
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(404);
    await context.close();
  });

  test("batch mode runs the authz check (no 5xx leaks)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/rejudges`, {
      data: {
        problemId: PROBLEM_ID,
        assessmentId: HW1_ID,
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });
});

test.describe("Score override API", () => {
  test("rejects unauthenticated GET", async ({ page }) => {
    const res = await page.request.get(`/api/overrides?type=assignment&assignmentId=${HW1_ID}`);
    expect(res.status()).toBe(401);
  });

  test("rejects students on GET", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/overrides?type=assignment&assignmentId=${HW1_ID}`);
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("teacher can list overrides for a managed assignment", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/overrides?type=assignment&assignmentId=${HW1_ID}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    await context.close();
  });

  test("admin can list overrides", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/overrides?type=assignment&assignmentId=${HW1_ID}`);
    expect(res.ok()).toBe(true);
    await context.close();
  });

  test("override creation rejects bad body shape", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/overrides`, {
      data: { context: { type: "assignment", assignmentId: HW1_ID } }, // missing required fields
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("override creation rejects negative score", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/overrides`, {
      data: {
        userId: "user_does-not-exist",
        problemId: PROBLEM_ID,
        context: { type: "assignment", assignmentId: HW1_ID },
        overrideScore: -5,
        reason: "test reason",
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("override PATCH on unknown id returns 4xx", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/overrides/nonexistent-override-id`, {
      method: "PATCH",
      data: { overrideScore: 10 },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });

  test("override DELETE on unknown id returns 4xx", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/overrides/nonexistent-override-id`, {
      method: "DELETE",
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });
});
