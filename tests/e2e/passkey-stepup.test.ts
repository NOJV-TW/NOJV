import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { DisposableCredentialUser, psql, signInWithPassword } from "./_disposable-user";
import { readLiveSession } from "./_shared";
import { activateTwoFactor, settingsMethodRow } from "./_two-factor";

const REDIS = process.env.NOJV_E2E_REDIS_CONTAINER ?? "nojv-redis-1";

function redis(...args: string[]): string {
  return execFileSync("docker", ["exec", REDIS, "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();
}

test.describe.configure({ retries: 0 });

const user = new DisposableCredentialUser("passkey-stepup");
const sessionIds = new Set<string>();

async function sessionId(page: import("@playwright/test").Page): Promise<string> {
  const id = (await readLiveSession(page)).session.id;
  sessionIds.add(id);
  return id;
}

function securityMarker(): string {
  const generation = psql(`SELECT "securityGeneration" FROM "User" WHERE id = '${user.id}';`);
  return `sg1:${user.id}:${generation}`;
}

test.beforeAll(() => {
  user.create();
});

test.afterAll(() => {
  user.cleanup();
  if (sessionIds.size > 0) {
    redis("DEL", ...[...sessionIds].map((id) => `nojv:apitoken:stepup:${id}`));
  }
});

test("a verified passkey assertion unlocks only its new session", async ({ browser }) => {
  const steppedUpContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const page = await steppedUpContext.newPage();
  const otherPage = await otherContext.newPage();
  const client = await steppedUpContext.newCDPSession(page);
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
  await signInWithPassword(page, user.email);
  await activateTwoFactor(page);
  await signInWithPassword(otherPage, user.email);
  await settingsMethodRow(page, "Passkey")
    .getByRole("button", { name: "Set up", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Passkey" });
  await dialog.getByRole("button", { name: "Add passkey" }).click();
  await expect(dialog.getByRole("button", { name: "Remove" })).toBeVisible({ timeout: 20000 });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: /open account menu/i }).click();
  await page.getByRole("menuitem", { name: "API Tokens" }).click();
  const stepUpDialog = page.getByRole("dialog", { name: "Verify it's you" });
  await expect(stepUpDialog).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  const oldSessionId = await sessionId(page);
  expect(redis("GET", `nojv:apitoken:stepup:${oldSessionId}`)).toBe("");

  const [verificationResponse] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname.endsWith("/api/auth/passkey/verify-authentication"),
      { timeout: 20_000 },
    ),
    stepUpDialog.getByRole("button", { name: "Verify with passkey" }).click(),
  ]);
  if (!verificationResponse.ok()) {
    throw new Error(
      `Passkey verification failed with HTTP ${String(verificationResponse.status())}: ${await verificationResponse.text()}`,
    );
  }
  await page.waitForURL(/\/account\/api-tokens$/, { timeout: 15000 });
  const newSessionId = await sessionId(page);
  expect(newSessionId).not.toBe(oldSessionId);
  await expect
    .poll(() => redis("GET", `nojv:apitoken:stepup:${newSessionId}`))
    .toBe(securityMarker());

  const otherSessionId = await sessionId(otherPage);
  expect(redis("GET", `nojv:apitoken:stepup:${otherSessionId}`)).toBe("");
  await otherPage.goto("/account/api-tokens");
  await expect(otherPage).toHaveURL(/\/account\/api-tokens\/verify$/);

  await steppedUpContext.close();
  await otherContext.close();
});
