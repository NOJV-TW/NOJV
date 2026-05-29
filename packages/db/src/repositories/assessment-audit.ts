import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

export const assessmentAuditLogRepo = {
  listByAssessment(assessmentId: string, take = 20) {
    return prisma.assessmentAuditLog.findMany({
      where: { assessmentId },
      include: { actor: { select: { name: true, displayUsername: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  withTx(tx: TransactionClient) {
    return {
      create(data: Prisma.AssessmentAuditLogUncheckedCreateInput) {
        return tx.assessmentAuditLog.create({ data });
      },
    };
  },
};
