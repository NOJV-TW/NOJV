import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const schoolVerificationTokenRepo = {
  create(data: Prisma.SchoolVerificationTokenUncheckedCreateInput) {
    return prisma.schoolVerificationToken.create({ data });
  },

  findById(token: string) {
    return prisma.schoolVerificationToken.findUnique({
      where: { token },
    });
  },

  delete(token: string) {
    return prisma.schoolVerificationToken.delete({ where: { token } });
  },

  deleteExpired(now: Date = new Date()) {
    return prisma.schoolVerificationToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
  },
};
