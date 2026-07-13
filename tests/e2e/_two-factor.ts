import { expect, type Page } from "@playwright/test";

export async function activateTwoFactor(page: Page): Promise<void> {
  await page.goto("/settings?setup2fa=1");

  const dialog = page.getByRole("dialog", { name: "Turn on two-factor authentication" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Email me a code" }).click();

  const code = dialog.locator("code");
  await expect(code).toBeVisible();
  const otp = (await code.textContent())?.trim();
  if (!otp || !/^\d{6}$/.test(otp)) {
    throw new Error("Development two-factor activation did not expose a six-digit code.");
  }

  await dialog.locator('input[name="otp"]').fill(otp);
  await dialog.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();
}

export function settingsMethodRow(page: Page, method: string) {
  return page.getByText(method, { exact: true }).locator("xpath=../..");
}
