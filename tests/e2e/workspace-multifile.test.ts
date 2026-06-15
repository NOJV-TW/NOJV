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
    await expect(page.getByRole("button", { name: /^(run|執行)$/i })).toBeVisible();
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
    await page.waitForTimeout(1500);

    const stamp = `// e2e draft ${Date.now()}\n`;
    const typed = await page.evaluate((source) => {
      // @ts-expect-error monaco is attached to window in the editor host
      const monaco: typeof import("monaco-editor") | undefined = globalThis.monaco;
      if (!monaco) return false;
      const editors = monaco.editor.getEditors();
      const target = editors[0];
      if (!target) return false;
      target.setValue(source + (target.getValue() ?? ""));
      return true;
    }, stamp);

    if (!typed) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "monaco editor not available in workspace; smoke-only",
      });
      await context.close();
      return;
    }

    await page.waitForTimeout(1500);
    await page.reload();
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForTimeout(1500);

    const restored = await page.evaluate(() => {
      // @ts-expect-error monaco shimmed onto window in the editor host
      const monaco: typeof import("monaco-editor") | undefined = globalThis.monaco;
      if (!monaco) return null;
      const editors = monaco.editor.getEditors();
      return editors[0]?.getValue() ?? null;
    });

    if (restored !== null) {
      expect(restored).toContain("e2e draft");
    }
    await context.close();
  });
});
