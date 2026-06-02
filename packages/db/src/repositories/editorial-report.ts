import { prisma } from "../client";
import type { EditorialReportStatus } from "../../generated/prisma/client";
import { problemMiniSelect, userPublicSelect } from "./selects";

export const editorialReportRepo = {
  create(data: { editorialId: string; reportedByUserId: string; reason: string }) {
    return prisma.editorialReport.create({ data });
  },

  listByStatus(status: EditorialReportStatus) {
    return prisma.editorialReport.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        editorial: {
          include: {
            problem: { select: problemMiniSelect },
            user: { select: userPublicSelect },
          },
        },
        reportedBy: { select: { name: true, displayUsername: true } },
      },
    });
  },

  findById(id: string) {
    return prisma.editorialReport.findUnique({ where: { id } });
  },

  updateStatus(
    id: string,
    data: { status: EditorialReportStatus; resolvedByUserId: string; resolvedAt: Date },
  ) {
    return prisma.editorialReport.update({ where: { id }, data });
  },
};
