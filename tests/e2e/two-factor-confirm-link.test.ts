import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { studentAuth } from "./_shared";

// Drives the Phase 2 enrollment-confirm mechanism end-to-end. The emailed token
// is high-entropy and only ever stored as sha256, so it cannot be recovered
// from Redis — instead we inject a known token (simulating "the email was
// delivered and clicked") and assert that confirming sets the per-user flag
// that enable() gates on. No pepper, no low-entropy OTP anywhere in the path.

const PG = "nojv-postgres-1";
const REDIS = "passwordless-stepup-2fa-redis-1";
const EMAIL = "student@nojv.local";

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", PG, "psql", "-U", "postgres", "-d", "nojv", "-tA"], {
    input: sql,
    encoding: "utf8",
  }).trim();
}

function redis(...args: string[]): string {
  return execFileSync("docker", ["exec", REDIS, "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();
}

test.use({ storageState: studentAuth });
test.describe.configure({ retries: 0 });

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("base64url");
let userId = "";

test.beforeAll(() => {
  userId = psql(`select id from "User" where email = '${EMAIL}';`);
  redis("SET", `nojv:2fa:enroll-confirm:${tokenHash}`, userId, "EX", "600");
});

test.afterAll(() => {
  redis("DEL", `nojv:2fa:enroll-confirm:${tokenHash}`, `nojv:2fa:enroll-confirmed:${userId}`);
});

test("confirm link consumes the token and sets the per-user confirmed flag", async ({ page }) => {
  // the confirmed flag is not set before the link is clicked
  expect(redis("GET", `nojv:2fa:enroll-confirmed:${userId}`)).toBe("");

  // open the emailed confirm link and confirm
  await page.goto(`/account/two-factor/confirm?token=${token}`);
  await expect(page.getByRole("heading", { name: "確認啟用兩步驟驗證" })).toBeVisible();
  await page.getByRole("button", { name: "確認" }).click();
  await page.waitForURL(/\/account\/two-factor$/);

  // confirming set the flag that enable() gates on, and burned the one-time token
  expect(redis("GET", `nojv:2fa:enroll-confirmed:${userId}`)).toBe("1");
  expect(redis("GET", `nojv:2fa:enroll-confirm:${tokenHash}`)).toBe("");
});
