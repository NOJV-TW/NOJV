import { expect, test } from "@playwright/test";

import { studentAuth } from "./_shared";

test.use({ storageState: studentAuth });

test.describe("account connections + 2FA confirm route (Phase 4/5 UI smoke)", () => {
  test("connections page lists both providers with bind buttons", async ({ page }) => {
    await page.goto("/account/connections");
    await expect(page.getByRole("heading", { name: "登入方式" })).toBeVisible();
    await expect(page.getByText("Google", { exact: true })).toBeVisible();
    // both providers are unlinked for a password-only student → two bind buttons
    await expect(page.getByRole("button", { name: "綁定" })).toHaveCount(2);
  });

  test("account security section links to the connections page", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("link", { name: "登入方式" })).toBeVisible();
  });

  test("2FA confirm route rejects an invalid token", async ({ page }) => {
    await page.goto("/account/two-factor/confirm?token=not-a-real-token");
    await expect(page.getByRole("heading", { name: "連結無效或已過期" })).toBeVisible();
  });
});
