import { test, expect } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("/account edit", () => {
  test("success toast appears after renaming name", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto("/account");
    // The name field is display-only until the inline Edit toggle is clicked.
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.locator("#edit-name")).toBeVisible();

    // Wait for SvelteKit hydration so `use:enhance` attaches. Without this
    // the Save click triggers a native form POST that bypasses the toast.
    await page.waitForTimeout(1000);

    await page.locator("#edit-name").fill(`E2E ${Date.now()}`);
    await page.getByRole("button", { name: "Save" }).first().click();

    await expect(
      page.getByRole("status").filter({ hasText: /Name updated|已更新姓名/ }),
    ).toBeVisible({ timeout: 10000 });

    await context.close();
  });
});
