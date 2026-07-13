import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { DisposableCredentialUser, signInWithPassword } from "./_disposable-user";
import { activateTwoFactor, settingsMethodRow } from "./_two-factor";

// Exercises Phase 5 passkey step-up. A verified passkey assertion must count as
// a fresh step-up — enforced by a server-side after-hook on the better-auth
// verify-authentication endpoint (it fires only when the assertion verified, so
// it can't be forged). Drives the full ceremony with a CDP virtual authenticator.

const REDIS = "nojv-redis-1";

function redis(...args: string[]): string {
  return execFileSync("docker", ["exec", REDIS, "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();
}

test.describe.configure({ retries: 0 });

const user = new DisposableCredentialUser("passkey-stepup");
const sessionIds = new Set<string>();

async function sessionId(page: import("@playwright/test").Page): Promise<string> {
  const response = (await (await page.request.get("/api/auth/get-session")).json()) as {
    session?: { id?: string };
  };
  const id = response.session?.id;
  if (!id) throw new Error("Could not resolve the active session.");
  sessionIds.add(id);
  return id;
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
  // 1. enroll a passkey
  await signInWithPassword(page, user.email);
  await activateTwoFactor(page);
  await signInWithPassword(otherPage, user.email);
  await settingsMethodRow(page, "Passkey")
    .getByRole("button", { name: "Set up", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Passkey" });
  await dialog.getByRole("button", { name: "Add passkey" }).click();
  await expect(dialog.getByRole("button", { name: "Remove" })).toBeVisible({ timeout: 20000 });

  // 2. the step-up verify page is now reachable (the user has a passkey, no TOTP)
  await page.goto("/account/api-tokens/verify");
  const oldSessionId = await sessionId(page);
  expect(redis("GET", `nojv:apitoken:stepup:${oldSessionId}`)).toBe("");

  // 3. step up with the passkey
  let verificationResponse: import("@playwright/test").Response | undefined;
  await expect(async () => {
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().endsWith("/api/auth/passkey/verify-authentication"),
      { timeout: 1_500 },
    );
    await page.getByRole("button", { name: "Verify with passkey" }).click();
    verificationResponse = await response;
  }).toPass({ timeout: 20_000 });
  if (!verificationResponse?.ok()) {
    throw new Error(
      `Passkey verification failed with HTTP ${String(verificationResponse?.status())}: ${verificationResponse ? await verificationResponse.text() : "no response"}`,
    );
  }
  // 4. the handoff binds the verified assertion to the newly-created session.
  await page.waitForURL(/\/account\/api-tokens$/, { timeout: 15000 });
  const newSessionId = await sessionId(page);
  expect(newSessionId).not.toBe(oldSessionId);
  await expect.poll(() => redis("GET", `nojv:apitoken:stepup:${newSessionId}`)).toBe("1");

  // 5. another authenticated session for the same account remains locked.
  const otherSessionId = await sessionId(otherPage);
  expect(redis("GET", `nojv:apitoken:stepup:${otherSessionId}`)).toBe("");
  await otherPage.goto("/account/api-tokens");
  await expect(otherPage).toHaveURL(/\/account\/api-tokens\/verify$/);

  await steppedUpContext.close();
  await otherContext.close();
});
