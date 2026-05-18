import { test, expect } from "@playwright/test";

import { apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

const HW1_ID = "hw1-process-trace";
const PROBLEM_ID = "problem_warmup-sum";

test.describe("Clarifications API", () => {
  test("unauthenticated GET is rejected", async ({ page }) => {
    const res = await page.request.get(
      `/api/clarifications?type=assignment&assignmentId=${HW1_ID}`,
    );
    expect(res.status()).toBe(401);
  });

  test("listing requires contextType and contextId", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/clarifications`);
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("contextType is validated against the enum", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(
      `/api/clarifications?type=galaxy&assignmentId=${HW1_ID}`,
    );
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("student can list clarifications for an enrolled assignment", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(
      `/api/clarifications?type=assignment&assignmentId=${HW1_ID}`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    await context.close();
  });

  test("ask rejects bodies shorter than the 10-char minimum", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/clarifications`, {
      data: {
        context: { type: "assignment", assignmentId: HW1_ID },
        problemId: PROBLEM_ID,
        questionText: "too short",
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("student can ask a clarification on an enrolled assignment", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const stamp = Date.now();
    const res = await page.request.post(`/api/clarifications`, {
      data: {
        context: { type: "assignment", assignmentId: HW1_ID },
        problemId: PROBLEM_ID,
        questionText: `E2E clarification asked at ${stamp} — please ignore.`,
      },
      headers: apiWriteHeaders,
    });
    // The seeded student is enrolled in the os-lab course, so this should
    // succeed (200/201). 409 is also acceptable when the domain enforces
    // a uniqueness rule (e.g. duplicate-question dedupe across runs). The
    // contract: no 5xx, and on success we get a stable id back.
    expect([200, 201, 409]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json();
      expect(typeof body.id).toBe("string");
    }
    await context.close();
  });

  test("PATCH on unknown id returns 4xx", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/clarifications/nonexistent-id`, {
      method: "PATCH",
      data: { kind: "answer", answerText: "answer" },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });

  test("PATCH validates the discriminated payload", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/clarifications/some-id`, {
      method: "PATCH",
      data: { kind: "neither", answerText: "irrelevant" },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(400);
    await context.close();
  });
});
