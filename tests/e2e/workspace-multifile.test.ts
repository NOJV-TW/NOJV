import { test, expect } from "@playwright/test";

import { studentAuth } from "./_shared";

const PROBLEM_ID = "problem_warmup-sum";

test.describe("Problem workspace UI", () => {
  test("student sees the editor and submit button on a public problem", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("button", { name: /^(submit|繳交)$/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: /^(test|測試)$/i })).toBeVisible();
    await context.close();
  });

  test("language selector exposes more than one option", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();

    const select = page.getByRole("combobox").first();
    await expect(select).toBeVisible({ timeout: 10_000 });
    const optionCount = await page.locator("option").count();
    expect(optionCount).toBeGreaterThan(1);
    await context.close();
  });

  test("draft text persists across a reload (localStorage hydration)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    const editor = page.locator(".monaco-editor").first();
    await expect(editor).toBeVisible({ timeout: 15_000 });

    const stamp = `// e2e draft ${Date.now()}\n`;
    await page.getByRole("textbox", { name: "Editor content" }).focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.insertText(stamp);

    await expect
      .poll(() =>
        page.evaluate(
          ({ problemId, expected }) => {
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index);
              if (!key?.startsWith(`nojv:draft:v1:practice:${problemId}:`)) continue;
              const value = localStorage.getItem(key);
              if (value?.includes(expected)) return true;
            }
            return false;
          },
          { problemId: PROBLEM_ID, expected: stamp.trim() },
        ),
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.locator(".monaco-editor .view-lines").first()).toContainText(
      stamp.trim(),
      { timeout: 15_000 },
    );
    await context.close();
  });
});
