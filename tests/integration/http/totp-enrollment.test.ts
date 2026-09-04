import { afterEach, describe, expect, it } from "vitest";

import { securityGenerationProof } from "@nojv/application";
import { getRedis, keys } from "@nojv/redis";

import { confirmPendingTotp, startPendingTotp } from "$lib/server/totp-enrollment";
import { currentTotp } from "../../e2e/_two-factor";
import { createTestUser, testPrisma } from "../../fixtures/factories";

const pendingSessions = new Set<string>();

afterEach(async () => {
  await Promise.all([...pendingSessions].map((id) => getRedis().del(keys.pendingTotp(id))));
  pendingSessions.clear();
});

async function userWithOldTotp() {
  const user = await createTestUser({ twoFactorEnabled: true });
  await testPrisma.twoFactor.create({
    data: {
      backupCodes: "old-backup-codes",
      id: `totp-${user.id}`,
      secret: "old-secret",
      userId: user.id,
      verified: true,
    },
  });
  return testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
}

describe("pending TOTP enrollment", () => {
  it("keeps the old TOTP until the new authenticator code is confirmed", async () => {
    const user = await userWithOldTotp();
    const sessionId = `pending-${user.id}`;
    pendingSessions.add(sessionId);
    const proof = securityGenerationProof(user);
    const pending = await startPendingTotp(sessionId, proof, user.email);
    expect(pending).not.toBeNull();
    await expect(
      testPrisma.twoFactor.findFirstOrThrow({ where: { userId: user.id } }),
    ).resolves.toMatchObject({ secret: "old-secret" });

    await expect(confirmPendingTotp(sessionId, proof, "000000")).resolves.toMatchObject({
      ok: false,
      reason: "invalid",
    });
    await expect(
      testPrisma.twoFactor.findFirstOrThrow({ where: { userId: user.id } }),
    ).resolves.toMatchObject({ secret: "old-secret" });

    const secret = new URL(pending!.totpURI).searchParams.get("secret");
    expect(secret).not.toBeNull();
    await expect(
      confirmPendingTotp(sessionId, proof, currentTotp(secret!)),
    ).resolves.toMatchObject({ ok: true, state: { hasTotp: true } });
    const factors = await testPrisma.twoFactor.findMany({ where: { userId: user.id } });
    expect(factors).toHaveLength(1);
    expect(factors[0]).toMatchObject({ verified: true });
    expect(factors[0]!.secret).not.toBe("old-secret");
  });

  it("rejects a pending setup after the durable security generation changes", async () => {
    const user = await userWithOldTotp();
    const sessionId = `stale-${user.id}`;
    pendingSessions.add(sessionId);
    const proof = securityGenerationProof(user);
    const pending = await startPendingTotp(sessionId, proof, user.email);
    const secret = new URL(pending!.totpURI).searchParams.get("secret")!;
    await testPrisma.user.update({ where: { id: user.id }, data: { disabled: true } });
    await expect(confirmPendingTotp(sessionId, proof, currentTotp(secret))).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    await expect(
      testPrisma.twoFactor.findFirstOrThrow({ where: { userId: user.id } }),
    ).resolves.toMatchObject({ secret: "old-secret" });
  });
});
