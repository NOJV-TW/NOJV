import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

/**
 * Dedicated store for school-email verification tokens. Decoupled
 * from better-auth's Verification table so neither side's cleanup
 * sweeps interfere with the other.
 */
export const schoolVerificationTokenRepo = {
  create(data: Prisma.SchoolVerificationTokenUncheckedCreateInput) {
    return prisma.schoolVerificationToken.create({ data });
  },

  /** Look up a token by its primary key (the token string itself). */
  findById(token: string) {
    return prisma.schoolVerificationToken.findUnique({
      where: { token }
    });
  },

  delete(token: string) {
    return prisma.schoolVerificationToken.delete({ where: { token } });
  },

  /** Sweep expired tokens. Returns the number deleted. */
  deleteExpired(now: Date = new Date()) {
    return prisma.schoolVerificationToken.deleteMany({
      where: { expiresAt: { lt: now } }
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.SchoolVerificationTokenUncheckedCreateInput) {
        return tx.schoolVerificationToken.create({ data });
      },

      delete(token: string) {
        return tx.schoolVerificationToken.delete({ where: { token } });
      }
    };
  }
};
