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
    await expect
      .poll(() =>
        page.evaluate(() => {
          // @ts-expect-error monaco is attached to window in the editor host
          const monaco: typeof import("monaco-editor") | undefined = globalThis.monaco;
          return (monaco?.editor.getEditors().length ?? 0) > 0;
        }),
      )
      .toBe(true);

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

    expect(typed, "Monaco editor must be available for the draft persistence test").toBe(true);

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
    await expect
      .poll(() =>
        page.evaluate((expected) => {
          // @ts-expect-error monaco shimmed onto window in the editor host
          const monaco: typeof import("monaco-editor") | undefined = globalThis.monaco;
          return monaco?.editor.getEditors()[0]?.getValue().includes(expected) ?? false;
        }, stamp.trim()),
      )
      .toBe(true);
    await context.close();
  });
});
