import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";

import { signInWithPassword } from "./_disposable-user";
import { activateTwoFactor, settingsMethodRow } from "./_two-factor";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const SEED_PASSWORD = "password123";
const REDIS = "nojv-redis-1";
const TEMP_USER_ID = `api-token-stepup-${Date.now()}`;
const TEMP_ACCOUNT_ID = `${TEMP_USER_ID}-account`;
const TEMP_EMAIL = `${TEMP_USER_ID}@nojv.local`;
const TEMP_USERNAME = `api-token-${Date.now()}`;
const steppedUpSessionIds = new Set<string>();

function pg(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "nojv-postgres-1",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "nojv",
      "-tA",
    ],
    { input: sql, encoding: "utf8" },
  ).trim();
}

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
  test.describe.configure({ retries: 0 });

  test.beforeAll(() => {
    // Use a disposable credential account. Enabling TOTP correctly rotates the
    // account's sessions, so a shared fixture would invalidate later tests.
    pg(`
      INSERT INTO "User" (id, email, username, name, "emailVerified", "createdAt", "updatedAt")
      VALUES ('${TEMP_USER_ID}', '${TEMP_EMAIL}', '${TEMP_USERNAME}', 'API token E2E', true, NOW(), NOW());
      INSERT INTO "Account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      SELECT '${TEMP_ACCOUNT_ID}', '${TEMP_USER_ID}', 'credential', '${TEMP_USER_ID}', password, NOW(), NOW()
      FROM "Account"
      WHERE "userId" = (SELECT id FROM "User" WHERE email = 'student@nojv.local')
        AND "providerId" = 'credential';
    `);
  });

  test.afterAll(() => {
    pg(`DELETE FROM "User" WHERE id = '${TEMP_USER_ID}';`);
    if (steppedUpSessionIds.size > 0) {
      execFileSync("docker", [
        "exec",
        REDIS,
        "redis-cli",
        "DEL",
        ...[...steppedUpSessionIds].map((id) => `nojv:apitoken:stepup:${id}`),
      ]);
    }
  });

  test("a user without 2FA is redirected from /account/api-tokens to enroll", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto("/account/api-tokens");
    await expect(page).toHaveURL(/\/settings\?setup2fa=1&returnTo=%2Faccount%2Fapi-tokens/);

    await context.close();
  });

  test("password user: enroll TOTP, then step-up unlocks token management", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();

    await signInWithPassword(page, TEMP_EMAIL);
    await signInWithPassword(otherPage, TEMP_EMAIL);

    await activateTwoFactor(page);

    await settingsMethodRow(page, "Authenticator app (TOTP)")
      .getByRole("button", { name: "Set up", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Authenticator app (TOTP)" });
    const passwordInput = dialog.locator('input[name="password"]');
    await passwordInput.fill(SEED_PASSWORD);
    const enableButton = dialog.getByRole("button", { name: "Enable 2FA" });
    await expect(enableButton).toBeEnabled();
    await enableButton.click();

    const manualKey = dialog.locator("code").first();
    await expect(manualKey).toBeVisible({ timeout: 10000 });
    const secret = ((await manualKey.textContent()) ?? "").trim();
    expect(secret.length).toBeGreaterThan(0);

    await dialog.locator('input[type="checkbox"]').check();

    const enrollCode = dialog.locator('form[action="?/verify"] input[name="code"]');
    await enrollCode.fill(totp(secret));
    await dialog.getByRole("button", { name: "Verify & activate" }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The TOTP assertion that finalized enrollment is handed to this rotated session.
    await page.goto("/account/api-tokens");
    await expect(page).toHaveURL(/\/account\/api-tokens$/);
    await expect(page.getByRole("button", { name: /Create token/i })).toBeVisible();
    const enrolledSession = (await (
      await page.request.get("/api/auth/get-session")
    ).json()) as {
      session?: { id?: string };
    };
    if (enrolledSession.session?.id) steppedUpSessionIds.add(enrolledSession.session.id);

    // A different session for the same account receives no grant and must verify itself.
    await otherContext.clearCookies({ name: "better-auth.session_data" });
    await otherPage.goto("/account/api-tokens");
    await expect(otherPage).toHaveURL(/\/account\/api-tokens\/verify/);

    const stepUpCode = otherPage.locator('input[name="code"]');
    await stepUpCode.waitFor({ state: "visible" });
    await stepUpCode.click();
    await stepUpCode.pressSequentially(totp(secret));
    await otherPage.locator('button[type="submit"]').click();

    await expect(otherPage).toHaveURL(/\/account\/api-tokens$/, { timeout: 10000 });
    await expect(otherPage.getByRole("button", { name: /Create token/i })).toBeVisible();
    const session = (await (await otherPage.request.get("/api/auth/get-session")).json()) as {
      session?: { id?: string };
    };
    if (session.session?.id) steppedUpSessionIds.add(session.session.id);

    await context.close();
    await otherContext.close();
  });
});
