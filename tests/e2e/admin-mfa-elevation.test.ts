import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { DisposableCredentialUser, psql, signInWithPassword } from "./_disposable-user";
import { readLiveSession } from "./_shared";
import { currentTotp, enrollTotp, unlockSecuritySettings } from "./_two-factor";

test.describe.configure({ retries: 0 });
test.setTimeout(90_000);

const user = new DisposableCredentialUser("admin-mfa");

function redis(...args: string[]): string {
  return execFileSync("docker", ["compose", "exec", "-T", "redis", "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();
}

test.beforeAll(() => {
  user.create({ platformRole: "admin" });
});

test.afterAll(() => {
  user.cleanup();
});

test("a regular admin reuses one verification when entering admin mode again", async ({
  page,
}) => {
  await signInWithPassword(page, user.email);
  await unlockSecuritySettings(page);
  const { secret } = await enrollTotp(page);

  const sessionId = (await readLiveSession(page)).session.id;
  const generation = psql(`SELECT "securityGeneration" FROM "User" WHERE id = '${user.id}';`);
  const marker = `sg1:${user.id}:${generation}`;
  expect(redis("GET", `nojv:admin:mfa:${sessionId}`)).toBe(marker);
  expect(redis("GET", `nojv:admin:mode:${sessionId}`)).toBe("");

  await page.goto("/dashboard");
  await page.getByRole("button", { name: /open account menu/i }).click();
  await page.getByRole("menuitem", { name: /switch to admin mode/i }).click();
  await expect(page).toHaveURL(/\/admin(?:\/|$)/, { timeout: 15_000 });
  expect(redis("GET", `nojv:admin:mode:${sessionId}`)).toBe(marker);

  await page.getByRole("button", { name: /open account menu/i }).click();
  await page.getByRole("menuitem", { name: /exit admin mode/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(redis("GET", `nojv:admin:mfa:${sessionId}`)).toBe(marker);

  await page.getByRole("button", { name: /open account menu/i }).click();
  await page.getByRole("menuitem", { name: /switch to admin mode/i }).click();
  await expect(page).toHaveURL(/\/admin(?:\/|$)/, { timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Verify it's you" })).toBeHidden();

  await page.context().clearCookies();
  await page.goto("/admin-signin");
  await page.getByLabel("Username or email").fill(user.email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const totpInput = page.getByLabel("Code from your current authenticator");
  await expect(totpInput).toBeVisible();
  await expect(page.getByRole("button", { name: "Recover account" })).toBeHidden();
  await totpInput.fill(currentTotp(secret));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
