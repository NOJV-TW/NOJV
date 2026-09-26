import { prisma } from "../../client";
import type { Prisma } from "../../../generated/prisma/client";
import { problemMiniSelect } from "../selects";
import { submissionDetailSelect, userFacingSubmissionWhere } from "./shared";

export const submissionIdentity = {
  findById(id: string) {
    return prisma.submission.findUnique({ where: { id } });
  },

  findLatestReferenceForProblem(problemId: string) {
    return prisma.submission.findFirst({
      where: { problemId, isReferenceSolution: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        judgeGeneration: true,
        language: true,
        problemId: true,
        isReferenceSolution: true,
        sampleOnly: true,
        assessmentId: true,
        contestId: true,
        courseId: true,
        examId: true,
        participationId: true,
        referenceProblemStorageGeneration: true,
        sourceStorage: true,
        status: true,
        score: true,
        runtimeMs: true,
        memoryKb: true,
        verdictSummary: true,
      },
    });
  },

  findByIdForUserRead(input: { id: string; userId: string; adminRecovery: boolean }) {
    if (input.adminRecovery) return prisma.submission.findUnique({ where: { id: input.id } });
    return prisma.submission.findFirst({
      where: {
        id: input.id,
        ...userFacingSubmissionWhere(input.userId, true),
      },
    });
  },

  listByIdsForUserRead(input: { ids: string[]; userId: string; adminRecovery: boolean }) {
    return prisma.submission.findMany({
      where: {
        id: { in: input.ids },
        ...(input.adminRecovery ? {} : userFacingSubmissionWhere(input.userId, true)),
      },
      include: { problem: { select: problemMiniSelect } },
    });
  },

  listByIdsForStaffRead(ids: string[]) {
    return prisma.submission.findMany({
      where: { id: { in: ids } },
      include: { problem: { select: problemMiniSelect } },
    });
  },

  findByIdWithProblemId(id: string) {
    return prisma.submission.findUnique({
      select: {
        id: true,
        problemId: true,
        status: true,
        language: true,
        sourceStorage: true,
        score: true,
        runtimeMs: true,
        sampleOnly: true,
        userId: true,
        createdAt: true,
        assessmentId: true,
        courseId: true,
        verdictSummary: true,
        verdictDetailStorage: true,
      },
      where: { id },
    });
  },

  findByIdForDetail(input: { id: string; userId: string; adminRecovery: boolean }) {
    return prisma.submission.findFirst({
      where: input.adminRecovery
        ? { id: input.id }
        : {
            id: input.id,
            isReferenceSolution: false,
            ...userFacingSubmissionWhere(input.userId, true),
          },
      select: submissionDetailSelect,
    });
  },

  findByIdForStaffDetailCandidate(id: string) {
    return prisma.submission.findUnique({
      where: { id },
      select: submissionDetailSelect,
    });
  },

  findByIdWithJudgeContext(id: string) {
    return prisma.submission.findUnique({
      include: {
        contest: {
          select: { endsAt: true, startsAt: true },
        },
        assessment: {
          select: { adjustmentRules: true, dueAt: true },
        },
        exam: {
          select: { adjustmentRules: true, dueAt: true },
        },
        problem: {
          include: {
            testcaseSets: {
              include: {
                testcases: { orderBy: { ordinal: "asc" as const } },
              },
              orderBy: [{ ordinal: "asc" as const }, { createdAt: "asc" as const }],
            },
            workspaceFiles: {
              orderBy: [
                { language: "asc" as const },
                { orderIndex: "asc" as const },
                { path: "asc" as const },
              ],
            },
          },
        },
      },
      where: { id },
    });
  },

  findMostRecent(where: Prisma.SubmissionWhereInput, select?: Prisma.SubmissionSelect) {
    return prisma.submission.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: select ?? { createdAt: true },
    });
  },

  findMany(args: Prisma.SubmissionFindManyArgs) {
    return prisma.submission.findMany(args);
  },
};
