import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { psql, signInWithPassword } from "./_disposable-user";
import { readLiveSession } from "./_shared";
import { activateTwoFactor, enrollTotp, nextTotp } from "./_two-factor";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const SEED_PASSWORD = "password123";
const REDIS = "nojv-redis-1";
const TEMP_USER_ID = `api-token-stepup-${Date.now()}`;
const TEMP_ACCOUNT_ID = `${TEMP_USER_ID}-account`;
const TEMP_EMAIL = `${TEMP_USER_ID}@nojv.local`;
const TEMP_USERNAME = `api-token-${Date.now()}`;
const steppedUpSessionIds = new Set<string>();

test.describe("API token step-up", () => {
  test.describe.configure({ retries: 0 });
  test.setTimeout(150_000);

  test.beforeAll(() => {
    // Use a disposable credential account. Enabling TOTP correctly rotates the
    // account's sessions, so a shared fixture would invalidate later tests.
    psql(`
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
    psql(`DELETE FROM "User" WHERE id = '${TEMP_USER_ID}';`);
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

    const { secret, verificationCode } = await enrollTotp(page, SEED_PASSWORD);

    // Enrollment changes the factor set, so its assertion cannot authorize the
    // post-enrollment security generation. The same TOTP is explicitly replay-blocked.
    await page.goto("/account/api-tokens");
    await expect(page).toHaveURL(/\/account\/api-tokens\/verify$/);
    const enrollingStepUpCode = page.locator('input[name="code"]');
    await enrollingStepUpCode.fill(verificationCode);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("alert")).toContainText("already used");

    const firstFreshCode = await nextTotp(secret, verificationCode);
    await enrollingStepUpCode.fill(firstFreshCode);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account\/api-tokens$/);
    await expect(page.getByRole("button", { name: /Create token/i })).toBeVisible();
    const enrolledSession = await readLiveSession(page);
    steppedUpSessionIds.add(enrolledSession.session.id);

    // A different session receives no grant. TOTP replay prevention is
    // account-wide, so it must wait for one more authenticator window.
    await otherPage.goto("/account/api-tokens");
    await expect(otherPage).toHaveURL(/\/account\/api-tokens\/verify/);

    const stepUpCode = otherPage.locator('input[name="code"]');
    await stepUpCode.waitFor({ state: "visible" });
    await stepUpCode.fill(firstFreshCode);
    await otherPage.locator('button[type="submit"]').click();
    await expect(otherPage.getByRole("alert")).toContainText("already used");

    const secondFreshCode = await nextTotp(secret, firstFreshCode);
    await stepUpCode.fill(secondFreshCode);
    await otherPage.locator('button[type="submit"]').click();

    await expect(otherPage).toHaveURL(/\/account\/api-tokens$/, { timeout: 10000 });
    await expect(otherPage.getByRole("button", { name: /Create token/i })).toBeVisible();
    const session = await readLiveSession(otherPage);
    steppedUpSessionIds.add(session.session.id);

    await context.close();
    await otherContext.close();
  });
});
