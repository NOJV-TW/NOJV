import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { studentAuth } from "./_shared";

// Exercises the Phase 5 passkey enrollment ceremony end-to-end using a CDP
// WebAuthn virtual authenticator (no real device). Proves the @better-auth/passkey
// plugin + Prisma model + migration accept a real registration: the ceremony
// completes and the passkey is persisted and listed in the UI.

const PG = "nojv-postgres-1";
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

test.use({ storageState: studentAuth });
test.describe.configure({ retries: 0 });

let userId = "";

test.beforeAll(() => {
  userId = psql(`select id from "User" where email = '${EMAIL}';`);
  psql(`delete from "Passkey" where "userId" = '${userId}';`);
});

test.afterAll(() => {
  psql(`delete from "Passkey" where "userId" = '${userId}';`);
});

test("enroll a passkey via a WebAuthn virtual authenticator", async ({ page, context }) => {
  // attach a virtual authenticator that auto-satisfies user verification
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

  expect(psql(`select count(*) from "Passkey" where "userId" = '${userId}';`)).toBe("0");

  await page.goto("/account/connections");
  // wait for SvelteKit hydration so the onclick handler is attached
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "新增 passkey" }).click();

  // the registration ceremony completes and the new passkey is listed
  await expect(page.getByRole("button", { name: "移除" })).toBeVisible({ timeout: 20000 });
  expect(psql(`select count(*) from "Passkey" where "userId" = '${userId}';`)).toBe("1");
});
