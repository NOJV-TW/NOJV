import { expect, test, type Page } from "@playwright/test";

import { DisposableCredentialUser, TEST_PASSWORD } from "./_disposable-user";
import { currentTotp, nextTotp } from "./_two-factor";

test.describe.configure({ mode: "serial", retries: 0 });
test.setTimeout(150_000);

const totpAdmin = new DisposableCredentialUser("super-totp");
const passkeyAdmin = new DisposableCredentialUser("super-passkey");
const newPassword = "new-password-456";
const emailOtp = "314159";

async function submitPassword(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/admin-signin", { waitUntil: "networkidle" });
  await page.getByLabel(/username or email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

async function completeFirstPasswordChange(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveValue(TEST_PASSWORD);
  await page.locator("#admin-new-password").fill(newPassword);
  await page.locator("#admin-confirm-password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
}

async function confirmSetupEmail(page: Page, userId: string): Promise<void> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("sendSecuritySetupOtp"),
  );
  await page.getByRole("button", { name: "Email me a code" }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(
      `Security setup OTP failed (${response.status()}): ${await response.text()}`,
    );
  }
  const otpInput = page.getByLabel("6-digit email code");
  await expect(otpInput).toBeVisible();
  const { storeSecuritySetupOtp } = await import("@nojv/application");
  await storeSecuritySetupOtp(userId, emailOtp);
  await otpInput.fill(emailOtp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose a security factor" })).toBeVisible();
}

async function expectDirectSuperAdminAccess(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/admin(?:\/|$)/, { timeout: 15_000 });
  await page.getByRole("button", { name: /open account menu/i }).click();
  await expect(page.getByRole("menuitem", { name: /admin mode/i })).toHaveCount(0);
}

test.beforeAll(() => {
  totpAdmin.create({ isSuperAdmin: true, mustChangePassword: true, platformRole: "admin" });
  passkeyAdmin.create({ isSuperAdmin: true, mustChangePassword: true, platformRole: "admin" });
});

test.afterAll(() => {
  totpAdmin.cleanup();
  passkeyAdmin.cleanup();
});

test("first login and later password plus TOTP login lead directly to /admin", async ({
  page,
  context,
}) => {
  await submitPassword(page, totpAdmin.email, TEST_PASSWORD);
  await completeFirstPasswordChange(page);
  await confirmSetupEmail(page, totpAdmin.id);
  await page.getByRole("button", { name: "Set up authenticator" }).click();

  const manualKey = page.locator("code").first();
  await expect(manualKey).toBeVisible();
  const secret = ((await manualKey.textContent()) ?? "").trim();
  const backupCode = (
    (await page.locator("ul.font-mono li").first().textContent()) ?? ""
  ).trim();
  expect(secret).not.toBe("");
  expect(backupCode).not.toBe("");
  const setupCode = currentTotp(secret);
  await page.locator('input[type="checkbox"]').check();
  await page.getByLabel("Confirm new authenticator setup").fill(setupCode);
  await page.getByRole("button", { name: "Confirm and finish setup" }).click();
  await expectDirectSuperAdminAccess(page);

  await context.clearCookies();
  await submitPassword(page, totpAdmin.email, newPassword);
  await expect(
    page.getByRole("heading", { name: "Complete security verification" }),
  ).toBeVisible();
  const loginCode = await nextTotp(secret, setupCode);
  await page.getByLabel("6-digit code from your current authenticator").fill(loginCode);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expectDirectSuperAdminAccess(page);

  await context.clearCookies();
  await submitPassword(page, totpAdmin.email, newPassword);
  await page.getByRole("button", { name: /recover your account/i }).click();
  await page.getByLabel("Backup code").fill(backupCode);
  await page.getByRole("button", { name: "Recover with backup code" }).click();
  await expect(page.getByRole("heading", { name: "Choose a security factor" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin-signin\?returnTo=%2Fadmin/);
});

test("first login and later password plus passkey login preserve setup-only recovery", async ({
  page,
  context,
}) => {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      automaticPresenceSimulation: true,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      protocol: "ctap2",
      transport: "internal",
    },
  });

  await submitPassword(page, passkeyAdmin.email, TEST_PASSWORD);
  await completeFirstPasswordChange(page);
  await confirmSetupEmail(page, passkeyAdmin.id);
  await page.getByRole("button", { name: "Set up passkey" }).click();
  await expectDirectSuperAdminAccess(page);

  await context.clearCookies();
  await submitPassword(page, passkeyAdmin.email, newPassword);
  await page.getByRole("button", { name: "Verify with passkey" }).click();
  await expectDirectSuperAdminAccess(page);

  await context.clearCookies();
  await submitPassword(page, passkeyAdmin.email, newPassword);
  await page.getByRole("button", { name: /recover your account/i }).click();
  await expect(page.getByRole("heading", { name: "Recover security factors" })).toBeVisible();
  await page.getByRole("button", { name: "Send email recovery code" }).click();
  const recoveryOtpInput = page.getByLabel("6-digit email code");
  await expect(recoveryOtpInput).toBeVisible();
  const { storeSuperAdminRecoveryOtp } = await import("@nojv/application");
  await storeSuperAdminRecoveryOtp(passkeyAdmin.id, emailOtp);
  await recoveryOtpInput.fill(emailOtp);
  await page.getByLabel("Re-enter password").fill(newPassword);
  await page.getByRole("button", { name: "Clear old factors and continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose a security factor" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin-signin\?returnTo=%2Fadmin/);
});
