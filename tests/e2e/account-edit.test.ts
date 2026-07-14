import { test, expect } from "@playwright/test";
import path from "node:path";
import { readLiveSession } from "./_shared";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("profile edit", () => {
  test("success toast appears after renaming name", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    const session = await readLiveSession(page);
    const userId = session.user?.id;
    if (!userId) throw new Error("Could not resolve the signed-in user.");

    await page.goto(`/users/${userId}`);

    const editName = page.locator("#edit-name");
    await expect(async () => {
      await page.getByRole("button", { name: "Edit" }).first().click();
      await expect(editName).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });

    await editName.fill(`E2E ${Date.now()}`);
    await page.getByRole("button", { name: "Save" }).first().click();

    await expect(
      page.getByRole("status").filter({ hasText: /Name updated|已更新姓名/ }),
    ).toBeVisible({ timeout: 10000 });

    await context.close();
  });
});
