import { prisma } from "../client";

export const authCleanupRepo = {
  deleteExpiredSessions(now: Date = new Date()) {
    return prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  },

  deleteExpiredVerifications(now: Date = new Date()) {
    return prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } });
  },
};
