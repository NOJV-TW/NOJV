import { describe, expect, it } from "vitest";

import {
  markFactorChangeVerifiedSession,
  securityGenerationMarker,
  securityGenerationProof,
  unlockSecuritySettings,
} from "@nojv/application";
import { securityFactorRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

import { createTestUser, testPrisma } from "../../fixtures/factories";

async function addPasskey(userId: string, suffix = "1") {
  return testPrisma.passkey.create({
    data: {
      backedUp: false,
      counter: 0,
      credentialID: `credential-${userId}-${suffix}`,
      deviceType: "singleDevice",
      id: `passkey-${userId}-${suffix}`,
      publicKey: "public-key",
      userId,
    },
  });
}

async function addTotp(userId: string) {
  return testPrisma.twoFactor.create({
    data: {
      backupCodes: "old-backup-codes",
      id: `totp-${userId}`,
      secret: "old-secret",
      userId,
      verified: true,
    },
  });
}

describe("security factor repository", () => {
  it("derives security state from verified TOTP and passkey rows", async () => {
    const user = await createTestUser();
    await expect(securityFactorRepo.getState(user.id)).resolves.toMatchObject({
      hasPasskey: false,
      hasSecurityFactor: false,
      hasTotp: false,
    });
    await addPasskey(user.id);
    await expect(securityFactorRepo.getState(user.id)).resolves.toMatchObject({
      hasPasskey: true,
      hasSecurityFactor: true,
      hasTotp: false,
    });
  });

  it("replaces TOTP and backup codes in one committed state", async () => {
    const user = await createTestUser();
    await addTotp(user.id);
    const currentUser = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const result = await securityFactorRepo.replaceTotp({
      backupCodes: "new-backup-codes",
      expectedSecurityGeneration: currentUser.securityGeneration,
      secret: "new-secret",
      userId: user.id,
    });
    expect(result).toMatchObject({ hasSecurityFactor: true, hasTotp: true });
    await expect(
      testPrisma.twoFactor.findMany({ where: { userId: user.id } }),
    ).resolves.toEqual([
      expect.objectContaining({
        backupCodes: "new-backup-codes",
        secret: "new-secret",
        verified: true,
      }),
    ]);
  });

  it("binds a confirmed factor to the new generation without extending the settings window", async () => {
    const user = await createTestUser({ platformRole: "admin" });
    const sessionId = `factor-change-${user.id}`;
    const previousProof = securityGenerationProof(user);
    await unlockSecuritySettings(sessionId, previousProof);
    await getRedis().expire(keys.securitySettingsGrant(sessionId), 120);
    await getRedis().set(
      keys.adminMode(sessionId),
      securityGenerationMarker(previousProof),
      "EX",
      600,
    );
    await getRedis().set(
      keys.adminSessionMfa(sessionId),
      securityGenerationMarker(previousProof),
      "EX",
      120,
    );
    await addPasskey(user.id);
    const currentUser = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const currentProof = securityGenerationProof(currentUser);

    await expect(
      markFactorChangeVerifiedSession(sessionId, previousProof, currentProof, "regular"),
    ).resolves.toBe(true);
    expect(await getRedis().ttl(keys.securitySettingsGrant(sessionId))).toBeLessThanOrEqual(
      120,
    );
    expect(await getRedis().ttl(keys.adminSessionMfa(sessionId))).toBeLessThanOrEqual(120);
    await expect(getRedis().get(keys.adminSessionMfa(sessionId))).resolves.toBe(
      securityGenerationMarker(currentProof),
    );
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("serializes concurrent removals so a super admin keeps one final factor", async () => {
    const user = await createTestUser({ isSuperAdmin: true, platformRole: "admin" });
    const passkey = await addPasskey(user.id);
    await addTotp(user.id);
    const currentUser = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const outcomes = await Promise.all([
      securityFactorRepo.removeTotp(user.id, currentUser.securityGeneration),
      securityFactorRepo.removePasskey(user.id, passkey.id, currentUser.securityGeneration),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["removed", "stale"]);
    await expect(securityFactorRepo.getState(user.id)).resolves.toMatchObject({
      hasSecurityFactor: true,
    });
  });

  it("rejects factor mutations authorized for an older security generation", async () => {
    const user = await createTestUser();
    const passkey = await addPasskey(user.id);
    await addTotp(user.id);
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await testPrisma.user.update({
      where: { id: user.id },
      data: { email: `updated-${user.email}` },
    });

    await expect(
      securityFactorRepo.removeTotp(user.id, before.securityGeneration),
    ).resolves.toMatchObject({ outcome: "stale" });
    await expect(
      securityFactorRepo.removePasskey(user.id, passkey.id, before.securityGeneration),
    ).resolves.toMatchObject({ outcome: "stale" });
    await expect(
      securityFactorRepo.replaceBackupCodes(user.id, "new-codes", before.securityGeneration),
    ).resolves.toBeNull();
    await expect(securityFactorRepo.getState(user.id)).resolves.toMatchObject({
      hasPasskey: true,
      hasTotp: true,
    });
  });

  it("lets a regular account remove its final factor", async () => {
    const user = await createTestUser();
    await addTotp(user.id);
    const currentUser = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(
      securityFactorRepo.removeTotp(user.id, currentUser.securityGeneration),
    ).resolves.toMatchObject({
      outcome: "removed",
      state: { hasSecurityFactor: false, hasTotp: false },
    });
    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ twoFactorEnabled: false });
  });

  it("recovery removes every factor and revokes every other session", async () => {
    const user = await createTestUser({ isSuperAdmin: true, platformRole: "admin" });
    await addTotp(user.id);
    await addPasskey(user.id);
    await testPrisma.session.createMany({
      data: [
        {
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          id: `keep-${user.id}`,
          token: `keep-token-${user.id}`,
          userId: user.id,
        },
        {
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          id: `revoke-${user.id}`,
          token: `revoke-token-${user.id}`,
          userId: user.id,
        },
      ],
    });
    await expect(
      securityFactorRepo.resetForRecovery(user.id, `keep-${user.id}`),
    ).resolves.toMatchObject({ hasSecurityFactor: false });
    await expect(testPrisma.session.findMany({ where: { userId: user.id } })).resolves.toEqual([
      expect.objectContaining({ id: `keep-${user.id}` }),
    ]);
  });
});
