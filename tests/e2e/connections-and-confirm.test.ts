import { expect, test } from "@playwright/test";

import { studentAuth } from "./_shared";

test.use({ storageState: studentAuth });

test.describe("settings connections (UI smoke)", () => {
  test("settings page lists both providers with bind buttons", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "登入方式" })).toBeVisible();
    await expect(page.getByText("Google", { exact: true })).toBeVisible();
    // both providers are unlinked for a password-only student → two bind buttons
    await expect(page.getByRole("button", { name: "綁定" })).toHaveCount(2);
  });
});
