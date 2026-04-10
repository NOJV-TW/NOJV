import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { PlagiarismReportStatus } from "../../generated/prisma/enums";

const reportSummarySelect = {
  id: true,
  contestId: true,
  courseAssessmentId: true,
  triggeredById: true,
  status: true,
  results: true,
  mossReportUrl: true,
  createdAt: true,
  completedAt: true
} satisfies Prisma.PlagiarismReportSelect;

/**
 * PlagiarismReport is 1:1 with its parent (Contest or CourseAssessment)
 * via @unique foreign keys. Re-running MOSS updates the single row in
 * place; there is no history. Exactly one of `contestId` /
 * `courseAssessmentId` is non-null, enforced by a CHECK constraint.
 */
export const plagiarismReportRepo = {
  /** Look up the single report for a course assessment, if any. */
  findByAssessmentId(courseAssessmentId: string) {
    return prisma.plagiarismReport.findUnique({
      where: { courseAssessmentId },
      select: reportSummarySelect
    });
  },

  /** Look up the single report for a contest, if any. */
  findByContestId(contestId: string) {
    return prisma.plagiarismReport.findUnique({
      where: { contestId },
      select: reportSummarySelect
    });
  },

  findById(id: string) {
    return prisma.plagiarismReport.findUnique({
      where: { id },
      select: reportSummarySelect
    });
  },

  /** Create a new plagiarism report. Caller must set exactly one of
   * contestId / courseAssessmentId (XOR enforced by CHECK constraint). */
  create(data: Prisma.PlagiarismReportUncheckedCreateInput) {
    return prisma.plagiarismReport.create({ data });
  },

  updateStatus(id: string, status: PlagiarismReportStatus) {
    return prisma.plagiarismReport.update({
      data: { status },
      where: { id }
    });
  },

  /** Complete a plagiarism report with results. */
  complete(
    id: string,
    data: {
      mossReportUrl: string | null;
      results: Prisma.InputJsonValue;
      status: PlagiarismReportStatus;
    }
  ) {
    return prisma.plagiarismReport.update({
      data: {
        completedAt: new Date(),
        mossReportUrl: data.mossReportUrl,
        results: data.results,
        status: data.status
      },
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
