import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestUser, testPrisma } from "../../fixtures/factories";
import { callRoute } from "./_harness";
import { getAuth } from "$lib/auth.server";
import {
  factorMutationPath,
  runInternalFactorMutation,
} from "$lib/server/auth-factor-mutation";

const authRoute = await import("../../../apps/web/src/routes/api/auth/[...path]/+server");
const requireFromWeb = createRequire(join(process.cwd(), "apps/web/package.json"));
const bcrypt = requireFromWeb("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

function cookieHeader(response: Response): string {
  const cookies = new Map<string, string>();
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";", 1)[0];
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator);
    if (/;\s*max-age=0(?:;|$)/i.test(setCookie)) cookies.delete(name);
    else cookies.set(name, pair.slice(separator + 1));
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index >= 0) bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

async function createSignedInCredentialUser(): Promise<{
  cookie: string;
  email: string;
  password: string;
  userId: string;
}> {
  const password = "correct horse battery staple";
  const user = await createTestUser({ emailVerified: true, twoFactorActivated: false });
  await testPrisma.account.create({
    data: {
      id: `credential-${user.id}`,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.hash(password, 10),
    },
  });
  const signIn = await callRoute({
    path: "/api/auth/sign-in/email",
    method: "POST",
    module: authRoute,
    body: { email: user.email, password },
  });
  expect(signIn.status).toBe(200);
  const cookie = cookieHeader(signIn);
  expect(cookie).not.toBe("");
  return { cookie, email: user.email, password, userId: user.id };
}

async function beginTrustedEnrollment(cookie: string, password: string) {
  return runInternalFactorMutation(factorMutationPath.enable, () =>
    getAuth().api.enableTwoFactor({
      body: { password },
      headers: new Headers({ cookie }),
    }),
  );
}

describe("Better Auth factor-mutation route gate", () => {
  it("rejects public TOTP enrollment before the provider mutates factor state", async () => {
    const { cookie, password, userId } = await createSignedInCredentialUser();

    const response = await callRoute({
      path: "/api/auth/two-factor/enable",
      method: "POST",
      module: authRoute,
      headers: { cookie },
      body: { password },
    });

    expect(response.status).toBe(403);
    await expect(testPrisma.twoFactor.count({ where: { userId } })).resolves.toBe(0);
  });

  it("rejects public enrollment verification before a valid TOTP mutates factor state", async () => {
    const { cookie, password, userId } = await createSignedInCredentialUser();
    const enrollment = await beginTrustedEnrollment(cookie, password);
    const secret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(secret).not.toBeNull();

    const response = await callRoute({
      path: "/api/auth/two-factor/verify-totp",
      method: "POST",
      module: authRoute,
      headers: { cookie },
      body: { code: currentTotp(secret!) },
    });

    expect(response.status).toBe(403);
    await expect(
      testPrisma.twoFactor.findFirstOrThrow({ where: { userId } }),
    ).resolves.toMatchObject({ verified: false });
    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ).resolves.toMatchObject({ twoFactorEnabled: false });
  });

  it("rejects public passkey deletion before the provider removes membership", async () => {
    const { cookie, userId } = await createSignedInCredentialUser();
    const passkeyId = `passkey-${userId}`;
    await testPrisma.passkey.create({
      data: {
        id: passkeyId,
        userId,
        publicKey: "public-key",
        credentialID: `credential-${userId}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    });

    const response = await callRoute({
      path: "/api/auth/passkey/delete-passkey",
      method: "POST",
      module: authRoute,
      headers: { cookie },
      body: { id: passkeyId },
    });

    expect(response.status).toBe(403);
    await expect(testPrisma.passkey.count({ where: { id: passkeyId } })).resolves.toBe(1);
  });

  it("keeps temporary sign-in TOTP verification available", async () => {
    const { cookie, email, password, userId } = await createSignedInCredentialUser();
    const enrollment = await beginTrustedEnrollment(cookie, password);
    const secret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(secret).not.toBeNull();
    await runInternalFactorMutation(factorMutationPath.verifyTotp, () =>
      getAuth().api.verifyTOTP({
        body: { code: currentTotp(secret!) },
        headers: new Headers({ cookie }),
      }),
    );
    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ).resolves.toMatchObject({ twoFactorEnabled: true });

    const signIn = await callRoute({
      path: "/api/auth/sign-in/email",
      method: "POST",
      module: authRoute,
      body: { email, password },
    });
    expect(signIn.status).toBe(200);
    const temporaryCookie = cookieHeader(signIn);
    expect(temporaryCookie).not.toBe("");

    const verification = await callRoute({
      path: "/api/auth/two-factor/verify-totp",
      method: "POST",
      module: authRoute,
      headers: { cookie: temporaryCookie },
      body: { code: currentTotp(secret!) },
    });

    expect(verification.status).toBe(200);
  });
});
