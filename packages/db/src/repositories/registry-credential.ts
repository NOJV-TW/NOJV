import { prisma } from "../client";

export const registryCredentialRepo = {
  findByUserId(userId: string) {
    return prisma.registryCredential.findUnique({ where: { userId } });
  },

  findByUsername(username: string) {
    return prisma.registryCredential.findUnique({
      where: { username },
      include: {
        user: {
          select: {
            id: true,
            disabled: true,
            platformRole: true,
            canCreateAdvancedProblems: true,
          },
        },
      },
    });
  },

  upsertForUser(userId: string, username: string, passwordHash: string) {
    return prisma.registryCredential.upsert({
      where: { userId },
      create: { userId, username, passwordHash },
      update: { passwordHash },
    });
  },

  markUsed(id: string) {
    return prisma.registryCredential.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  },
};
