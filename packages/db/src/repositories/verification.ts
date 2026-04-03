import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const verificationRepo = {
  findById(id: string) {
    return prisma.verification.findUnique({ where: { id } });
  },

  create(data: Prisma.VerificationCreateInput) {
    return prisma.verification.create({ data });
  },

  delete(id: string) {
    return prisma.verification.delete({ where: { id } });
  }
};
