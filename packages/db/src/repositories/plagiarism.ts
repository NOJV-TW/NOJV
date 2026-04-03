import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const plagiarismReportRepo = {
  /** List reports for an assessment. */
  listByAssessmentId(assessmentId: string) {
    return prisma.plagiarismReport.findMany({
      where: { courseAssessmentId: assessmentId },
      orderBy: { createdAt: "desc" },
      select: {
        completedAt: true,
        createdAt: true,
        id: true,
        mossReportUrl: true,
        results: true,
        status: true
      }
    });
  },

  /** List reports matching a plagiarism target filter. */
  listByTarget(where: Prisma.PlagiarismReportWhereInput) {
    return prisma.plagiarismReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        completedAt: true,
        createdAt: true,
        id: true,
        mossReportUrl: true,
        results: true,
        status: true
      }
    });
  },

  /** Create a new plagiarism report. */
  create(data: Prisma.PlagiarismReportUncheckedCreateInput) {
    return prisma.plagiarismReport.create({ data });
  },

  updateStatus(id: string, status: string) {
    return prisma.plagiarismReport.update({
      data: { status } as Prisma.PlagiarismReportUncheckedUpdateInput,
      where: { id }
    });
  },

  /** Complete a plagiarism report with results. */
  complete(
    id: string,
    data: {
      mossReportUrl: string | null;
      results: Prisma.InputJsonValue;
      status: string;
    }
  ) {
    return prisma.plagiarismReport.update({
      data: {
        completedAt: new Date(),
        mossReportUrl: data.mossReportUrl,
        results: data.results,
        status: data.status
      } as Prisma.PlagiarismReportUncheckedUpdateInput,
      where: { id }
    });
  },

  /** Mark a plagiarism report as failed. */
  markFailed(id: string) {
    return prisma.plagiarismReport.update({
      data: { completedAt: new Date(), status: "failed" },
      where: { id }
    });
  }
};
