import { test, expect, type Page } from "@playwright/test";

import { studentAuth } from "./_shared";

const PROBLEM_ID = "problem_warmup-sum";
const MULTI_FILE_PROBLEM_ID = "problem_stateful-dhcp-parser";

async function serverDraftCodes(page: Page, problemId = PROBLEM_ID): Promise<string[]> {
  return page.evaluate(async (id) => {
    const query = new URLSearchParams({
      context: JSON.stringify({ type: "practice" }),
      problemId: id,
    });
    const response = await fetch(`/api/drafts?${query}`);
    const body = (await response.json()) as {
      drafts: { sourceCode: string | null; sourceFiles: { content: string }[] | null }[];
    };
    return body.drafts.flatMap((draft) => [
      ...(draft.sourceCode === null ? [] : [draft.sourceCode]),
      ...(draft.sourceFiles ?? []).map((file) => file.content),
    ]);
  }, problemId);
}

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

  test("draft syncs to the server and restores on a machine without local copies", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    const editor = page.locator(".monaco-editor").first();
    await expect(editor).toBeVisible({ timeout: 15_000 });

    const stamp = `// e2e draft ${Date.now()}`;
    await page.getByRole("textbox", { name: "Editor content" }).focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.insertText(`${stamp}\n`);

    await expect
      .poll(() => serverDraftCodes(page), { timeout: 20_000 })
      .toContainEqual(expect.stringContaining(stamp));
    expect(await page.evaluate(() => Object.values(localStorage).join("\n"))).not.toContain(
      stamp,
    );
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.locator(".monaco-editor .view-lines").first()).toContainText(stamp, {
      timeout: 15_000,
    });
    await context.close();
  });

  test("multi-file workspace drafts sync to the server and restore without local copies", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/problems/${MULTI_FILE_PROBLEM_ID}`);
    const editor = page.getByRole("textbox", { name: "Editor content" });
    await expect(editor).toBeVisible({ timeout: 15_000 });

    const stamp = `# e2e workspace draft ${Date.now()}`;
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.insertText(`${stamp}\n`);

    await expect
      .poll(() => serverDraftCodes(page, MULTI_FILE_PROBLEM_ID), { timeout: 20_000 })
      .toContainEqual(expect.stringContaining(stamp));
    expect(await page.evaluate(() => Object.values(localStorage).join("\n"))).not.toContain(
      stamp,
    );
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator(".monaco-editor:visible .view-lines")).toContainText(stamp, {
      timeout: 15_000,
    });
    await context.close();
  });

  test("native editor shortcuts save and submit with Ctrl and Cmd", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const submissions: { sourceCode: string; sampleOnly: boolean }[] = [];
    await page.route("**/api/submissions", async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, json: { message: "Shortcut submission check" } });
    });
    try {
      await page.goto(`/problems/${PROBLEM_ID}`);
      const editor = page.getByRole("textbox", { name: "Editor content" });
      await expect(editor).toBeVisible({ timeout: 15_000 });
      for (const [index, modifier] of ["Control", "Meta"].entries()) {
        await editor.focus();
        await page.keyboard.press("ControlOrMeta+Home");
        const stamp = `// shortcut ${modifier} ${Date.now()}`;
        await page.keyboard.insertText(`${stamp}\n`);
        await page.keyboard.press(`${modifier}+s`);
        await expect(page.getByText("Draft saved", { exact: true }).last()).toBeVisible();
        await expect
          .poll(() => serverDraftCodes(page))
          .toContainEqual(expect.stringContaining(stamp));
        await page.keyboard.press(`${modifier}+Enter`);
        await expect.poll(() => submissions.length).toBe(index + 1);
        expect(submissions[index]).toMatchObject({
          sampleOnly: false,
          sourceCode: expect.stringContaining(stamp),
        });
        await expect(page.getByRole("button", { name: /^(submit|繳交)$/i })).toBeEnabled();
      }
    } finally {
      await context.close();
    }
  });
});
