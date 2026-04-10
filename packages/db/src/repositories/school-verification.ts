import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const schoolVerificationTokenRepo = {
  create(data: Prisma.SchoolVerificationTokenUncheckedCreateInput) {
    return prisma.schoolVerificationToken.create({ data });
  },

  findById(token: string) {
    return prisma.schoolVerificationToken.findUnique({
      where: { token }
    });
  },

  delete(token: string) {
    return prisma.schoolVerificationToken.delete({ where: { token } });
  },

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
