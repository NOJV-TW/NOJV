import { createHmac } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { readLiveSession } from "./_shared";

const EMAIL_OTP = "314159";

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index >= 0) bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function currentTotp(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counterBytes).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

export async function nextTotp(secretBase32: string, previousCode: string): Promise<string> {
  const waitUntilNextWindowMs = 30_000 - (Date.now() % 30_000) + 250;
  await new Promise((resolve) => setTimeout(resolve, waitUntilNextWindowMs));
  const code = currentTotp(secretBase32);
  if (code === previousCode) {
    throw new Error("TOTP code did not advance at the next 30-second boundary.");
  }
  return code;
}

export async function unlockSecuritySettings(page: Page): Promise<void> {
  await page.goto("/settings?setupSecurity=1");
  const dialog = page.getByRole("dialog", { name: "Verify to edit security settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Email me a code" }).click();
  const otpInput = dialog.getByLabel("6-digit email code");
  await expect(otpInput).toBeVisible();

  const [{ user }, { storeSecuritySetupOtp }] = await Promise.all([
    readLiveSession(page),
    import("@nojv/application"),
  ]);
  await storeSecuritySetupOtp(user.id, EMAIL_OTP);
  await otpInput.fill(EMAIL_OTP);
  await dialog.getByRole("button", { name: "Verify and continue" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

export function settingsMethodRow(page: Page, method: string) {
  return page.getByText(method, { exact: true }).locator("xpath=../..");
}

export async function enrollTotp(
  page: Page,
): Promise<{ secret: string; verificationCode: string }> {
  await page.goto("/settings", { waitUntil: "networkidle" });
  await settingsMethodRow(page, "Authenticator app (TOTP)")
    .getByRole("button", { name: "Set up", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Authenticator app (TOTP)" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Set up", exact: true }).click();

  const manualKey = dialog.locator("code").first();
  await expect(manualKey).toBeVisible({ timeout: 10_000 });
  const secret = ((await manualKey.textContent()) ?? "").trim();
  if (!secret) throw new Error("TOTP enrollment did not expose a manual key.");

  await dialog.locator('input[type="checkbox"]').check();
  const verificationCode = currentTotp(secret);
  await dialog
    .locator('form[action="?/confirmTotpSetup"] input[name="code"]')
    .fill(verificationCode);
  await dialog.getByRole("button", { name: "Confirm and finish setup" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  return { secret, verificationCode };
}
