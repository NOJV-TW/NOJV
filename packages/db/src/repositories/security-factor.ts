import { randomUUID } from "node:crypto";

import { prisma } from "../client";
import type { TransactionClient } from "../transaction";

export interface SecurityFactorState {
  hasPasskey: boolean;
  hasSecurityFactor: boolean;
  hasTotp: boolean;
  isSuperAdmin: boolean;
  securityGeneration: number;
}

async function lockUser(tx: TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

async function stateInTransaction(
  tx: TransactionClient,
  userId: string,
): Promise<SecurityFactorState | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      isSuperAdmin: true,
      securityGeneration: true,
      _count: {
        select: {
          passkeys: true,
          twoFactors: { where: { verified: true } },
        },
      },
    },
  });
  if (!user) return null;
  const hasTotp = user._count.twoFactors > 0;
  const hasPasskey = user._count.passkeys > 0;
  return {
    hasPasskey,
    hasSecurityFactor: hasTotp || hasPasskey,
    hasTotp,
    isSuperAdmin: user.isSuperAdmin,
    securityGeneration: user.securityGeneration,
  };
}

export const securityFactorRepo = {
  async getState(userId: string): Promise<SecurityFactorState | null> {
    return prisma.$transaction((tx) => stateInTransaction(tx, userId));
  },

  async replaceTotp(input: {
    backupCodes: string;
    expectedSecurityGeneration: number;
    secret: string;
    userId: string;
  }): Promise<SecurityFactorState | null> {
    return prisma.$transaction(async (tx) => {
      await lockUser(tx, input.userId);
      const before = await stateInTransaction(tx, input.userId);
      if (before?.securityGeneration !== input.expectedSecurityGeneration) return null;
      await tx.twoFactor.deleteMany({ where: { userId: input.userId } });
      await tx.twoFactor.create({
        data: {
          id: randomUUID(),
          backupCodes: input.backupCodes,
          secret: input.secret,
          userId: input.userId,
          verified: true,
        },
      });
      await tx.user.update({
        where: { id: input.userId },
        data: { twoFactorEnabled: true },
      });
      const state = await stateInTransaction(tx, input.userId);
      if (!state) throw new Error("User disappeared while replacing TOTP.");
      return state;
    });
  },

  async removeTotp(
    userId: string,
    expectedSecurityGeneration: number,
  ): Promise<{
    outcome: "removed" | "missing" | "last_super_admin_factor" | "stale";
    state: SecurityFactorState;
  }> {
    return prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const before = await stateInTransaction(tx, userId);
      if (!before) throw new Error("User not found while removing TOTP.");
      if (before.securityGeneration !== expectedSecurityGeneration) {
        return { outcome: "stale", state: before };
      }
      if (!before.hasTotp) return { outcome: "missing", state: before };
      if (before.isSuperAdmin && !before.hasPasskey) {
        return { outcome: "last_super_admin_factor", state: before };
      }
      await tx.twoFactor.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
      const state = await stateInTransaction(tx, userId);
      if (!state) throw new Error("User disappeared while removing TOTP.");
      return { outcome: "removed", state };
    });
  },

  async removePasskey(
    userId: string,
    passkeyId: string,
    expectedSecurityGeneration: number,
  ): Promise<{
    outcome: "removed" | "missing" | "last_super_admin_factor" | "stale";
    state: SecurityFactorState;
  }> {
    return prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const [before, passkey] = await Promise.all([
        stateInTransaction(tx, userId),
        tx.passkey.findFirst({ where: { id: passkeyId, userId }, select: { id: true } }),
      ]);
      if (!before) throw new Error("User not found while removing passkey.");
      if (before.securityGeneration !== expectedSecurityGeneration) {
        return { outcome: "stale", state: before };
      }
      if (!passkey) return { outcome: "missing", state: before };
      if (
        before.isSuperAdmin &&
        !before.hasTotp &&
        (await tx.passkey.count({ where: { userId } })) === 1
      ) {
        return { outcome: "last_super_admin_factor", state: before };
      }
      await tx.passkey.delete({ where: { id: passkeyId } });
      const state = await stateInTransaction(tx, userId);
      if (!state) throw new Error("User disappeared while removing passkey.");
      return { outcome: "removed", state };
    });
  },

  async replaceBackupCodes(
    userId: string,
    backupCodes: string,
    expectedSecurityGeneration: number,
  ): Promise<SecurityFactorState | null> {
    return prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const before = await stateInTransaction(tx, userId);
      if (before?.securityGeneration !== expectedSecurityGeneration) return null;
      const result = await tx.twoFactor.updateMany({
        where: { userId, verified: true },
        data: { backupCodes },
      });
      if (result.count === 0) throw new Error("Verified TOTP factor not found.");
      const state = await stateInTransaction(tx, userId);
      if (!state) throw new Error("User disappeared while replacing backup codes.");
      return state;
    });
  },

  async resetForRecovery(
    userId: string,
    keepSessionId: string | null,
  ): Promise<SecurityFactorState> {
    return prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await tx.twoFactor.deleteMany({ where: { userId } });
      await tx.passkey.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
      await tx.session.deleteMany({
        where: {
          userId,
          ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
        },
      });
      const state = await stateInTransaction(tx, userId);
      if (!state) throw new Error("User disappeared during account recovery.");
      return state;
    });
  },
};
