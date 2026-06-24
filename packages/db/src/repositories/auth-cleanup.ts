import { prisma } from "../client";

// better-auth never prunes its own Session/Verification rows, so they grow
// monotonically. The submission sweeper calls these to bound the tables.
export const authCleanupRepo = {
  deleteExpiredSessions(now: Date = new Date()) {
    return prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  },

  deleteExpiredVerifications(now: Date = new Date()) {
    return prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } });
  },
};
