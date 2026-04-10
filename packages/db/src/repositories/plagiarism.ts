import { prisma } from "../client";
import { Prisma } from "../../generated/prisma/client";
import type { PlagiarismReportStatus } from "../../generated/prisma/enums";

/**
 * Plagiarism state is inlined on `Contest` and `CourseAssessment` as six
 * `plagiarism*` columns. There is no `PlagiarismReport` table any more —
 * re-running MOSS updates the same row in place. A parent whose
 * `plagiarismStatus` is NULL is considered to have no report.
 */

/** Shape of the plagiarism payload returned by `findBy*` methods. */
export interface PlagiarismReportSummary {
  status: PlagiarismReportStatus;
  results: Prisma.JsonValue | null;
  mossReportUrl: string | null;
  triggeredAt: Date | null;
  completedAt: Date | null;
  triggeredById: string | null;
}

/** Shape accepted by `upsertFor*` — every field optional; null clears. */
export interface PlagiarismUpsertInput {
  status?: PlagiarismReportStatus | null;
  results?: Prisma.InputJsonValue | null;
  mossReportUrl?: string | null;
  triggeredAt?: Date | null;
  completedAt?: Date | null;
  triggeredById?: string | null;
}

const plagiarismSelect = {
  plagiarismStatus: true,
  plagiarismResults: true,
  plagiarismMossReportUrl: true,
  plagiarismTriggeredAt: true,
  plagiarismCompletedAt: true,
  plagiarismTriggeredById: true
} as const;

interface PlagiarismRow {
  plagiarismStatus: PlagiarismReportStatus | null;
  plagiarismResults: Prisma.JsonValue | null;
  plagiarismMossReportUrl: string | null;
  plagiarismTriggeredAt: Date | null;
  plagiarismCompletedAt: Date | null;
  plagiarismTriggeredById: string | null;
}

function toSummary(row: PlagiarismRow | null): PlagiarismReportSummary | null {
  if (row?.plagiarismStatus == null) return null;
  return {
    status: row.plagiarismStatus,
    results: row.plagiarismResults,
    mossReportUrl: row.plagiarismMossReportUrl,
    triggeredAt: row.plagiarismTriggeredAt,
    completedAt: row.plagiarismCompletedAt,
    triggeredById: row.plagiarismTriggeredById
  };
}

function toContestUpdate(input: PlagiarismUpsertInput): Prisma.ContestUncheckedUpdateInput {
  const data: Prisma.ContestUncheckedUpdateInput = {};
  if (input.status !== undefined) data.plagiarismStatus = input.status;
  if (input.results !== undefined) {
    data.plagiarismResults = input.results ?? Prisma.JsonNull;
  }
  if (input.mossReportUrl !== undefined) data.plagiarismMossReportUrl = input.mossReportUrl;
  if (input.triggeredAt !== undefined) data.plagiarismTriggeredAt = input.triggeredAt;
  if (input.completedAt !== undefined) data.plagiarismCompletedAt = input.completedAt;
  if (input.triggeredById !== undefined) data.plagiarismTriggeredById = input.triggeredById;
  return data;
}

function toAssessmentUpdate(
  input: PlagiarismUpsertInput
): Prisma.CourseAssessmentUncheckedUpdateInput {
  const data: Prisma.CourseAssessmentUncheckedUpdateInput = {};
  if (input.status !== undefined) data.plagiarismStatus = input.status;
  if (input.results !== undefined) {
    data.plagiarismResults = input.results ?? Prisma.JsonNull;
  }
  if (input.mossReportUrl !== undefined) data.plagiarismMossReportUrl = input.mossReportUrl;
  if (input.triggeredAt !== undefined) data.plagiarismTriggeredAt = input.triggeredAt;
  if (input.completedAt !== undefined) data.plagiarismCompletedAt = input.completedAt;
  if (input.triggeredById !== undefined) data.plagiarismTriggeredById = input.triggeredById;
  return data;
}

const clearInput: PlagiarismUpsertInput = {
  status: null,
  results: null,
  mossReportUrl: null,
  triggeredAt: null,
  completedAt: null,
  triggeredById: null
};

export const plagiarismRepo = {
  /** Look up the plagiarism payload for a contest, or null if none. */
  async findByContestId(contestId: string): Promise<PlagiarismReportSummary | null> {
    const row = await prisma.contest.findUnique({
      where: { id: contestId },
      select: plagiarismSelect
    });
    return toSummary(row);
  },

  /** Look up the plagiarism payload for a course assessment, or null if none. */
  async findByAssessmentId(
    courseAssessmentId: string
  ): Promise<PlagiarismReportSummary | null> {
    const row = await prisma.courseAssessment.findUnique({
      where: { id: courseAssessmentId },
      select: plagiarismSelect
    });
    return toSummary(row);
  },

  /** Write plagiarism fields onto a contest. Pass only the fields you want to change. */
  upsertForContest(contestId: string, input: PlagiarismUpsertInput) {
    return prisma.contest.update({
      where: { id: contestId },
      data: toContestUpdate(input),
      select: plagiarismSelect
    });
  },

  /** Write plagiarism fields onto a course assessment. Pass only the fields you want to change. */
  upsertForAssessment(courseAssessmentId: string, input: PlagiarismUpsertInput) {
    return prisma.courseAssessment.update({
      where: { id: courseAssessmentId },
      data: toAssessmentUpdate(input),
      select: plagiarismSelect
    });
  },

  /** Reset all plagiarism fields on a contest back to null (cancels a scan). */
  clearForContest(contestId: string) {
    return prisma.contest.update({
      where: { id: contestId },
      data: toContestUpdate(clearInput)
    });
  },

  /** Reset all plagiarism fields on a course assessment back to null (cancels a scan). */
  clearForAssessment(courseAssessmentId: string) {
    return prisma.courseAssessment.update({
      where: { id: courseAssessmentId },
      data: toAssessmentUpdate(clearInput)
    });
  }
};
