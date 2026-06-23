import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const apiTokenRepo = {
  create(data: Prisma.ApiTokenUncheckedCreateInput) {
    return prisma.apiToken.create({ data });
  },

  findByIdForUser(id: string, userId: string) {
    return prisma.apiToken.findFirst({
      where: { id, userId },
    });
  },

  findByPrefix(prefix: string) {
    return prisma.apiToken.findUnique({
      where: { prefix },
      include: {
        user: {
          select: {
            disabled: true,
            email: true,
            emailVerified: true,
            id: true,
            name: true,
            platformRole: true,
            status: true,
            username: true,
          },
        },
      },
    });
  },

  listForUser(userId: string) {
    return prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  },

  updateForUser(id: string, userId: string, data: Prisma.ApiTokenUncheckedUpdateManyInput) {
    return prisma.apiToken.updateMany({
      where: { id, userId },
      data,
    });
  },

  markUsed(id: string, ip: string) {
    return prisma.apiToken.update({
      where: { id },
      data: {
        lastUsedAt: new Date(),
        lastUsedIp: ip,
      },
    });
  },
};
