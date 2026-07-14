import { test, expect } from "@playwright/test";
import path from "node:path";

import { apiWriteHeaders, formActionHeaders } from "./_shared";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

let problemId = "";

test.describe("Problem Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("teacher can create a problem via API", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post("/api/problems", { headers: apiWriteHeaders });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    problemId = body.id;
    expect(problemId).toBeTruthy();
    await context.close();
  });

  test("new problem edit page shows draft badge", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${problemId}/edit`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /delete|刪除/i })).toBeVisible();
    await context.close();
  });

  test("teacher can fill and save basic info", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${problemId}/edit`);

    await page.locator("input[name='title']").clear();
    await page.locator("input[name='title']").fill("E2E Lifecycle Problem");
    await page
      .locator("textarea[name='statement']")
      .fill("Given two integers, output their sum.");
    await page.locator("textarea[name='inputFormat']").fill("Two integers a and b");
    await page.locator("textarea[name='outputFormat']").fill("Print a + b");

    await page.getByRole("button", { name: /save|儲存/i }).click();

    await page.waitForTimeout(2000);
    await context.close();
  });

  test("after saving, page shows actual title", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${problemId}/edit`);
    await expect(page.getByRole("heading", { name: "E2E Lifecycle Problem" })).toBeVisible();
    await context.close();
  });

  test("draft problem is not visible in public list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("E2E Lifecycle Problem")).not.toBeVisible();
    await context.close();
  });

  test("teacher publishes the problem", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const testcaseRes = await page.request.post(
      `/problems/${problemId}/edit?/createTestcaseSet`,
      {
        form: {
          data: JSON.stringify({
            name: "Sample",
            weight: 1,
            cases: [{ input: "1 2", output: "3" }],
          }),
        },
        headers: formActionHeaders,
      },
    );
    const testcaseBody = await testcaseRes.json();
    expect(testcaseBody.type).not.toBe("error");
    expect(testcaseBody.type).not.toBe("failure");

    const res = await page.request.post(`/problems/${problemId}/edit?/publish`, {
      form: {},
      headers: formActionHeaders,
    });
    const body = await res.json();
    expect(body.type).not.toBe("error");
    expect(body.type).not.toBe("failure");
    await context.close();
  });

  test("published problem detail heading shows displayId prefix", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${problemId}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/#\d+\s.+/);
    await context.close();
  });

  test("teacher can delete draft problem", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const createRes = await page.request.post("/api/problems", {
      headers: apiWriteHeaders,
    });
    const { id: deleteId } = await createRes.json();
    expect(deleteId).toBeTruthy();

    const deleteRes = await page.request.post(`/problems/${deleteId}/edit?/deleteProblem`, {
      form: {},
      headers: formActionHeaders,
    });
    const body = await deleteRes.json();
    expect(body.type).toBe("redirect");
    expect(body.location).toContain("/problems");

    await context.close();
  });
});
