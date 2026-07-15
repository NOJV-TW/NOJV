import { expect, test } from "@playwright/test";

import { DisposableCredentialUser, psql, signInWithPassword } from "./_disposable-user";
import { activateTwoFactor, settingsMethodRow } from "./_two-factor";

test.describe.configure({ retries: 0 });

const user = new DisposableCredentialUser("passkey-enroll");

test.beforeAll(() => {
  user.create();
});

test.afterAll(() => {
  user.cleanup();
});

test("enroll a passkey via a WebAuthn virtual authenticator", async ({ page, context }) => {
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

  expect(psql(`select count(*) from "Passkey" where "userId" = '${user.id}';`)).toBe("0");

  await signInWithPassword(page, user.email);
  await activateTwoFactor(page);
  await settingsMethodRow(page, "Passkey")
    .getByRole("button", { name: "Set up", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Passkey" });
  await dialog.getByRole("button", { name: "Add passkey" }).click();

  await expect(dialog.getByRole("button", { name: "Remove" })).toBeVisible({ timeout: 20000 });
  expect(psql(`select count(*) from "Passkey" where "userId" = '${user.id}';`)).toBe("1");
});
