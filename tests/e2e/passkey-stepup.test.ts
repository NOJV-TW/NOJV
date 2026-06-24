import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { studentAuth } from "./_shared";

// Exercises Phase 5 passkey step-up. A verified passkey assertion must count as
// a fresh step-up — enforced by a server-side after-hook on the better-auth
// verify-authentication endpoint (it fires only when the assertion verified, so
// it can't be forged). Drives the full ceremony with a CDP virtual authenticator.

const PG = "nojv-postgres-1";
const REDIS = "passwordless-stepup-2fa-redis-1";
const EMAIL = "student@nojv.local";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", PG, "psql", "-U", "postgres", "-d", "nojv", "-tA"],
    {
      input: sql,
      encoding: "utf8",
    },
  ).trim();
}

function redis(...args: string[]): string {
  return execFileSync("docker", ["exec", REDIS, "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();
}

test.use({ storageState: studentAuth });
test.describe.configure({ retries: 0 });

let userId = "";

test.beforeAll(() => {
  userId = psql(`select id from "User" where email = '${EMAIL}';`);
  psql(`delete from "Passkey" where "userId" = '${userId}';`);
});

test.afterAll(() => {
  psql(`delete from "Passkey" where "userId" = '${userId}';`);
  redis("DEL", `nojv:apitoken:stepup:${userId}`);
});

test("a verified passkey assertion marks a fresh step-up", async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  redis("DEL", `nojv:apitoken:stepup:${userId}`);

  // 1. enroll a passkey
  await page.goto("/account/connections");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "新增 passkey" }).click();
  await expect(page.getByRole("button", { name: "移除" })).toBeVisible({ timeout: 20000 });

  // 2. the step-up verify page is now reachable (the user has a passkey, no TOTP)
  await page.goto("/account/api-tokens/verify");
  await page.waitForTimeout(3000);
  expect(redis("GET", `nojv:apitoken:stepup:${userId}`)).toBe(""); // not fresh yet

  // 3. step up with the passkey
  await page.getByRole("button", { name: "使用 passkey 驗證" }).click();

  // 4. the widened gate lets the passkey-only user (no TOTP) reach token management
  await page.waitForURL(/\/account\/api-tokens$/, { timeout: 15000 });

  // 5. the verified-assertion hook marked a fresh step-up
  expect(redis("GET", `nojv:apitoken:stepup:${userId}`)).toBe("1");
});
