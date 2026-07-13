import { describe, expect, it } from "vitest";

import { createTestUser, testPrisma } from "../../fixtures/factories";

async function generation(userId: string): Promise<number> {
  const user = await testPrisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { securityGeneration: true },
  });
  return user.securityGeneration;
}

describe("durable user security generation", () => {
  it("advances on every privilege, disablement, and 2FA state transition", async () => {
    const user = await createTestUser();
    expect(user.securityGeneration).toBe(0);

    await testPrisma.user.update({
      where: { id: user.id },
      data: { platformRole: "admin" },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.user.update({ where: { id: user.id }, data: { disabled: true } });
    expect(await generation(user.id)).toBe(2);
    await testPrisma.user.update({ where: { id: user.id }, data: { disabled: false } });
    expect(await generation(user.id)).toBe(3);

    await testPrisma.user.update({
      where: { id: user.id },
      data: { twoFactorActivated: true },
    });
    expect(await generation(user.id)).toBe(4);
    await testPrisma.user.update({
      where: { id: user.id },
      data: { twoFactorActivated: false },
    });
    expect(await generation(user.id)).toBe(5);

    await testPrisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, isSuperAdmin: true },
    });
    expect(await generation(user.id)).toBe(6);
  });

  it("does not advance for no-op state writes or profile-only changes", async () => {
    const user = await createTestUser();

    await testPrisma.user.update({
      where: { id: user.id },
      data: { disabled: false, name: "Renamed" },
    });

    expect(await generation(user.id)).toBe(0);
  });

  it("advances for identity, super-admin, onboarding, and password-policy changes", async () => {
    const user = await createTestUser();

    await testPrisma.user.update({
      where: { id: user.id },
      data: { email: `changed-${user.email}` },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    expect(await generation(user.id)).toBe(2);

    await testPrisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } });
    expect(await generation(user.id)).toBe(3);

    await testPrisma.user.update({
      where: { id: user.id },
      data: { status: "pending_first_login" },
    });
    expect(await generation(user.id)).toBe(4);

    await testPrisma.user.update({
      where: { id: user.id },
      data: { mustChangePassword: true },
    });
    expect(await generation(user.id)).toBe(5);
  });

  it("does not advance for session lifecycle because grants are bound to session IDs", async () => {
    const user = await createTestUser();
    const id = `session-${user.id}`;

    await testPrisma.session.create({
      data: {
        id,
        userId: user.id,
        token: `token-${user.id}`,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    expect(await generation(user.id)).toBe(0);

    await testPrisma.session.delete({ where: { id } });
    expect(await generation(user.id)).toBe(0);
  });

  it("rejects negative values and every attempted generation decrease", async () => {
    await expect(createTestUser({ securityGeneration: -1 })).rejects.toThrow(
      /nonnegative|check constraint/i,
    );

    const user = await createTestUser();
    await testPrisma.user.update({
      where: { id: user.id },
      data: { securityGeneration: 5 },
    });
    await expect(
      testPrisma.user.update({
        where: { id: user.id },
        data: { securityGeneration: 4 },
      }),
    ).rejects.toThrow(/cannot decrease|check constraint/i);
    await expect(generation(user.id)).resolves.toBe(5);
  });

  it("tracks TOTP set changes but ignores lockout bookkeeping", async () => {
    const user = await createTestUser();
    const id = `totp-${user.id}`;

    await testPrisma.twoFactor.create({
      data: {
        id,
        userId: user.id,
        secret: "secret-1",
        backupCodes: "codes-1",
      },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.twoFactor.update({
      where: { id },
      data: { failedVerificationCount: 1 },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.twoFactor.update({
      where: { id },
      data: { secret: "secret-2", backupCodes: "codes-2" },
    });
    expect(await generation(user.id)).toBe(2);

    await testPrisma.twoFactor.delete({ where: { id } });
    expect(await generation(user.id)).toBe(3);
  });

  it("tracks passkey authority changes but ignores assertion metadata and labels", async () => {
    const user = await createTestUser();
    const id = `passkey-${user.id}`;

    await testPrisma.passkey.create({
      data: {
        id,
        userId: user.id,
        publicKey: "public-key-1",
        credentialID: `credential-${user.id}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.passkey.update({
      where: { id },
      data: {
        counter: 1,
        name: "Renamed",
        backedUp: true,
        deviceType: "multiDevice",
        transports: "internal,hybrid",
        aaguid: "runtime-aaguid",
      },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.passkey.update({
      where: { id },
      data: { publicKey: "public-key-2" },
    });
    expect(await generation(user.id)).toBe(2);

    await testPrisma.passkey.delete({ where: { id } });
    expect(await generation(user.id)).toBe(3);
  });

  it("tracks credential account changes but ignores OAuth token refreshes", async () => {
    const user = await createTestUser();
    const id = `account-${user.id}`;

    await testPrisma.account.create({
      data: {
        id,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: "hash-1",
      },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.account.update({
      where: { id },
      data: { accessToken: "refreshed" },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.account.update({ where: { id }, data: { password: "hash-2" } });
    expect(await generation(user.id)).toBe(2);

    await testPrisma.account.delete({ where: { id } });
    expect(await generation(user.id)).toBe(3);
  });

  it("tracks registry credential authority but ignores last-used bookkeeping", async () => {
    const user = await createTestUser();

    await testPrisma.registryCredential.create({
      data: {
        userId: user.id,
        username: `registry-${user.id}`,
        passwordHash: "hash-1",
      },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.registryCredential.update({
      where: { userId: user.id },
      data: { lastUsedAt: new Date() },
    });
    expect(await generation(user.id)).toBe(1);

    await testPrisma.registryCredential.update({
      where: { userId: user.id },
      data: { passwordHash: "hash-2" },
    });
    expect(await generation(user.id)).toBe(2);

    await testPrisma.registryCredential.delete({ where: { userId: user.id } });
    expect(await generation(user.id)).toBe(3);
  });

  it("rolls generation back with a failed privilege-state transaction", async () => {
    const user = await createTestUser();

    await expect(
      testPrisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { platformRole: "admin", disabled: true },
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    await expect(
      testPrisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { platformRole: true, disabled: true, securityGeneration: true },
      }),
    ).resolves.toEqual({
      platformRole: "student",
      disabled: false,
      securityGeneration: 0,
    });
  });

  it("rolls generation back with a failed factor-set transaction", async () => {
    const user = await createTestUser();
    const id = `passkey-${user.id}`;

    await expect(
      testPrisma.$transaction(async (tx) => {
        await tx.passkey.create({
          data: {
            id,
            userId: user.id,
            publicKey: "public-key",
            credentialID: `credential-${user.id}`,
            counter: 0,
            deviceType: "singleDevice",
            backedUp: false,
          },
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    await expect(generation(user.id)).resolves.toBe(0);
    await expect(testPrisma.passkey.findUnique({ where: { id } })).resolves.toBeNull();
  });

  it("allows account deletion to cascade through every generation-tracked credential", async () => {
    const user = await createTestUser();
    await testPrisma.account.create({
      data: {
        id: `account-${user.id}`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: "hash",
      },
    });
    await testPrisma.twoFactor.create({
      data: {
        id: `totp-${user.id}`,
        userId: user.id,
        secret: "secret",
        backupCodes: "codes",
      },
    });
    await testPrisma.passkey.create({
      data: {
        id: `passkey-${user.id}`,
        userId: user.id,
        publicKey: "public-key",
        credentialID: `credential-${user.id}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    });
    await testPrisma.registryCredential.create({
      data: {
        userId: user.id,
        username: `registry-${user.id}`,
        passwordHash: "hash",
      },
    });

    await expect(testPrisma.user.delete({ where: { id: user.id } })).resolves.toMatchObject({
      id: user.id,
    });
  });
});
