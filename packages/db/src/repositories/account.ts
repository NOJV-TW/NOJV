import { prisma } from "../client";

export const accountRepo = {
  async hasCredentialPassword(userId: string): Promise<boolean> {
    const account = await prisma.account.findFirst({
      where: { userId, providerId: "credential", password: { not: null } },
      select: { id: true },
    });
    return account !== null;
  },

  listOAuthIdTokens(userId: string) {
    return prisma.account.findMany({
      where: { userId, providerId: { not: "credential" } },
      select: { providerId: true, accountId: true, idToken: true },
    });
  },
};
