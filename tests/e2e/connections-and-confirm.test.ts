import { expect, test } from "@playwright/test";

import { studentAuth } from "./_shared";

test.use({ storageState: studentAuth });

test.describe("settings connections (UI smoke)", () => {
  test("settings page lists both providers with bind buttons", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Sign-in methods" })).toBeVisible();
    await expect(page.getByText("Google", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Link" })).toHaveCount(2);
  });
});
