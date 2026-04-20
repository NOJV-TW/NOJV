import { test, expect } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

// Use a known seeded problem with testcases
const PROBLEM_ID = "problem_warmup-sum";

test.describe("Submission Validation", () => {
  test("unauthenticated user cannot submit", async ({ page }) => {
    const res = await page.request.post("/api/submissions", {
      data: {
        problemId: PROBLEM_ID,
        language: "python",
        sourceCode: "print(1)",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("rejects empty source code", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post("/api/submissions", {
      data: {
        problemId: PROBLEM_ID,
        language: "python",
        sourceCode: "",
      },
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("rejects invalid language", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post("/api/submissions", {
      data: {
        problemId: PROBLEM_ID,
        language: "brainfuck",
        sourceCode: "print(1)",
      },
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("rejects nonexistent problem", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post("/api/submissions", {
      data: {
        problemId: "nonexistent-problem-xyz",
        language: "python",
        sourceCode: "print(1)",
      },
    });
    // Should be 404 or 500 (problem not found)
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await context.close();
  });

  test("student can view submissions page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/submissions");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("student can view problem workspace", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    // Editor should be visible (with code area and run/submit buttons).
    // Anchored regex to avoid matching HelpTooltip aria-labels that contain
    // "runs" or "submit a complete program" as substrings.
    await expect(page.getByRole("button", { name: /^(run|執行)$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(submit|繳交)$/i })).toBeVisible();
    await context.close();
  });
});
