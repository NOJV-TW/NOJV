import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { DisposableCredentialUser, signInWithPassword } from "./_disposable-user";
import { activateTwoFactor, currentTotp, enrollTotp } from "./_two-factor";

test.describe.configure({ retries: 0 });

const user = new DisposableCredentialUser("admin-mfa");

function redis(...args: string[]): string {
  return execFileSync("docker", ["exec", "nojv-redis-1", "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();
}

test.beforeAll(() => {
  user.create({ platformRole: "admin" });
});

test.afterAll(() => {
  user.cleanup();
});

test("a real TOTP factor grants admin mode to its verified session", async ({ page }) => {
  await signInWithPassword(page, user.email);
  await activateTwoFactor(page);
  const secret = await enrollTotp(page);

  await page.goto("/dashboard");
  await page.locator(`button[title="${user.name}"]`).click();
  await page.getByRole("button", { name: /admin mode|管理模式/i }).click();
  await expect(page).toHaveURL(/\/account\/api-tokens\/verify\?purpose=admin-mode$/);

  await page.locator('input[name="code"]').fill(currentTotp(secret));
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/admin(?:\/|$)/, { timeout: 15_000 });
  await expect(page.getByRole("main")).toBeVisible();

  const session = (await (await page.request.get("/api/auth/get-session")).json()) as {
    session?: { id?: string };
  };
  const sessionId = session.session?.id;
  if (!sessionId) throw new Error("Could not resolve the elevated admin session.");
  expect(redis("GET", `nojv:admin:mfa:${sessionId}`)).toBe(user.id);
  expect(redis("GET", `nojv:admin:mode:${sessionId}`)).toBe(user.id);

  const endpoint = await page.request.post("/api/admin-mode", {
    headers: { "x-requested-with": "fetch" },
    data: { active: true },
  });
  expect(endpoint.status()).toBe(200);
  await expect(endpoint.json()).resolves.toEqual({ active: true });
});
