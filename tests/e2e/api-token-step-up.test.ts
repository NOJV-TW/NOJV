import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const adminAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/admin.json");

const SEED_PASSWORD = "password123";

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secretBase32: string): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

test.describe("API token step-up", () => {
  // The enroll test turns on 2FA for admin and marks a fresh step-up. Undo both
  // on the shared dev DB/Redis so the next run starts clean: leftover 2FA hangs
  // the plain-password global setup, and a leftover step-up marker skips the
  // /verify redirect this test asserts.
  test.afterAll(() => {
    const pg = (sql: string): string =>
      execFileSync(
        "docker",
        ["exec", "-i", "nojv-postgres-1", "psql", "-U", "postgres", "-d", "nojv", "-tA"],
        { input: sql, encoding: "utf8" },
      ).trim();
    const adminId = pg(`SELECT id FROM "User" WHERE email = 'admin@nojv.local';`);
    pg(
      `DELETE FROM "TwoFactor" WHERE "userId" = '${adminId}'; UPDATE "User" SET "twoFactorEnabled" = false WHERE id = '${adminId}';`,
    );
    if (adminId) {
      execFileSync("docker", [
        "exec",
        "passwordless-stepup-2fa-redis-1",
        "redis-cli",
        "DEL",
        `nojv:apitoken:stepup:${adminId}`,
      ]);
    }
  });

  test("a user without 2FA is redirected from /account/api-tokens to enroll", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto("/account/api-tokens");
    await expect(page).toHaveURL(/\/account\?verify=totp/);

    await context.close();
  });

  test("password user: enroll TOTP, then step-up unlocks token management", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();

    await page.goto("/account?verify=totp");
    const passwordInput = page.locator('input[name="password"]');
    await passwordInput.waitFor({ state: "visible" });
    await passwordInput.click();
    await passwordInput.pressSequentially(SEED_PASSWORD);
    const enableButton = page.getByRole("button", { name: "Enable 2FA" });
    await expect(enableButton).toBeEnabled();
    await enableButton.click();

    const manualKey = page.locator("code").first();
    await expect(manualKey).toBeVisible({ timeout: 10000 });
    const secret = ((await manualKey.textContent()) ?? "").trim();
    expect(secret.length).toBeGreaterThan(0);

    await page.locator('input[type="checkbox"]').check();

    const enrollCode = page.locator('form[action="?/verify"] input[name="code"]');
    await enrollCode.click();
    await enrollCode.pressSequentially(totp(secret));
    await page.getByRole("button", { name: "Verify & activate" }).click();

    await expect(page.getByRole("status").filter({ hasText: /active|啟用/i })).toBeVisible({
      timeout: 10000,
    });

    await page.goto("/account/api-tokens");
    await expect(page).toHaveURL(/\/account\/api-tokens\/verify/);

    const stepUpCode = page.locator('input[name="code"]');
    await stepUpCode.waitFor({ state: "visible" });
    await stepUpCode.click();
    await stepUpCode.pressSequentially(totp(secret));
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/account\/api-tokens$/, { timeout: 10000 });
    await expect(page.getByRole("button", { name: /Create token/i })).toBeVisible();

    await context.close();
  });
});
