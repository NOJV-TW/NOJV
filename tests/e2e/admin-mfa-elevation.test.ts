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

async function currentSessionId(page: import("@playwright/test").Page): Promise<string> {
  const session = (await (await page.request.get("/api/auth/get-session")).json()) as {
    session?: { id?: string };
  };
  const sessionId = session.session?.id;
  if (!sessionId) throw new Error("Could not resolve the current admin session.");
  return sessionId;
}

test("enrollment handoff and a real TOTP establish distinct admin states", async ({ page }) => {
  await signInWithPassword(page, user.email);
  await activateTwoFactor(page);
  const secret = await enrollTotp(page);

  const sessionId = await currentSessionId(page);
  const epoch = redis("GET", `nojv:admin:epoch:${user.id}`) || "0";
  const marker = `${user.id}:${epoch}`;

  // Enrollment verification rotates the session, then the one-shot handoff
  // must bind that verified factor to the replacement session without granting
  // admin mode on its own.
  expect(redis("GET", `nojv:admin:mfa:${sessionId}`)).toBe(marker);
  expect(redis("GET", `nojv:apitoken:stepup:${sessionId}`)).toBe("1");
  expect(redis("GET", `nojv:admin:mode:${sessionId}`)).toBe("");

  await page.goto("/account/api-tokens/verify?purpose=admin-mode");
  await expect(page).toHaveURL(/\/account\/api-tokens\/verify\?purpose=admin-mode$/);

  await page.locator('input[name="code"]').fill(currentTotp(secret));
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/admin(?:\/|$)/, { timeout: 15_000 });
  await expect(page.getByRole("main")).toBeVisible();

  expect(await currentSessionId(page)).toBe(sessionId);
  expect(redis("GET", `nojv:admin:mfa:${sessionId}`)).toBe(marker);
  expect(redis("GET", `nojv:admin:mode:${sessionId}`)).toBe(marker);
});
