import { prisma } from "../client";
import { Prisma } from "../../generated/prisma/client";
import type { PlagiarismReportStatus } from "../../generated/prisma/enums";

export interface PlagiarismReportSummary {
  status: PlagiarismReportStatus;
  results: Prisma.JsonValue | null;
  reportUrl: string | null;
  triggeredAt: Date | null;
  completedAt: Date | null;
  triggeredById: string | null;
}

export interface PlagiarismUpsertInput {
  status?: PlagiarismReportStatus | null;
  results?: Prisma.InputJsonValue | null;
  reportUrl?: string | null;
  triggeredAt?: Date | null;
  completedAt?: Date | null;
  triggeredById?: string | null;
}

const plagiarismSelect = {
  plagiarismStatus: true,
  plagiarismResults: true,
  plagiarismReportUrl: true,
  plagiarismTriggeredAt: true,
  plagiarismCompletedAt: true,
  plagiarismTriggeredById: true,
} as const;

interface PlagiarismRow {
  plagiarismStatus: PlagiarismReportStatus | null;
  plagiarismResults: Prisma.JsonValue | null;
  plagiarismReportUrl: string | null;
  plagiarismTriggeredAt: Date | null;
  plagiarismCompletedAt: Date | null;
  plagiarismTriggeredById: string | null;
}

function toSummary(row: PlagiarismRow | null): PlagiarismReportSummary | null {
  if (row?.plagiarismStatus == null) return null;
  return {
    status: row.plagiarismStatus,
    results: row.plagiarismResults,
    reportUrl: row.plagiarismReportUrl,
    triggeredAt: row.plagiarismTriggeredAt,
    completedAt: row.plagiarismCompletedAt,
    triggeredById: row.plagiarismTriggeredById,
  };
}

function buildPlagiarismUpdate(input: PlagiarismUpsertInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.status !== undefined) data.plagiarismStatus = input.status;
  if (input.results !== undefined) data.plagiarismResults = input.results ?? Prisma.JsonNull;
  if (input.reportUrl !== undefined) data.plagiarismReportUrl = input.reportUrl;
  if (input.triggeredAt !== undefined) data.plagiarismTriggeredAt = input.triggeredAt;
  if (input.completedAt !== undefined) data.plagiarismCompletedAt = input.completedAt;
  if (input.triggeredById !== undefined) data.plagiarismTriggeredById = input.triggeredById;
  return data;
}

const clearInput: PlagiarismUpsertInput = {
  status: null,
  results: null,
  reportUrl: null,
  triggeredAt: null,
  completedAt: null,
  triggeredById: null,
};

export const plagiarismRepo = {
  async findByExamId(examId: string): Promise<PlagiarismReportSummary | null> {
    const row = await prisma.exam.findUnique({
      where: { id: examId },
      select: plagiarismSelect,
    });
    return toSummary(row);
  },

  async findByAssessmentId(
    courseAssessmentId: string,
  ): Promise<PlagiarismReportSummary | null> {
    const row = await prisma.courseAssessment.findUnique({
      where: { id: courseAssessmentId },
      select: plagiarismSelect,
    });
    return toSummary(row);
  },

  async findByContestId(contestId: string): Promise<PlagiarismReportSummary | null> {
    const row = await prisma.contest.findUnique({
      where: { id: contestId },
      select: plagiarismSelect,
    });
    return toSummary(row);
  },

  upsertForExam(examId: string, input: PlagiarismUpsertInput) {
    return prisma.exam.update({
      where: { id: examId },
      data: buildPlagiarismUpdate(input),
      select: plagiarismSelect,
    });
  },

  upsertForAssessment(courseAssessmentId: string, input: PlagiarismUpsertInput) {
    return prisma.courseAssessment.update({
      where: { id: courseAssessmentId },
      data: buildPlagiarismUpdate(input),
      select: plagiarismSelect,
    });
  },

  upsertForContest(contestId: string, input: PlagiarismUpsertInput) {
    return prisma.contest.update({
      where: { id: contestId },
      data: buildPlagiarismUpdate(input),
      select: plagiarismSelect,
    });
  },

  clearForContest(contestId: string) {
    return prisma.contest.update({
      where: { id: contestId },
      data: buildPlagiarismUpdate(clearInput),
    });
  },

  clearForExam(examId: string) {
    return prisma.exam.update({
      where: { id: examId },
      data: buildPlagiarismUpdate(clearInput),
    });
  },

  clearForAssessment(courseAssessmentId: string) {
    return prisma.courseAssessment.update({
      where: { id: courseAssessmentId },
      data: buildPlagiarismUpdate(clearInput),
    });
  },
};
