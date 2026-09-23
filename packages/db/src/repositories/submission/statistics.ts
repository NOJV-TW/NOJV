import { prisma } from "../../client";
import type { Prisma } from "../../../generated/prisma/client";
import type { SubmissionStatus } from "../../../generated/prisma/enums";
import {
  courseMiniSelect,
  problemMiniSelect,
  userMiniSelect,
  userPublicSelect,
} from "../selects";
import { contestExamListSelect, scoringBaseSelect, submissionResultStatuses } from "./shared";
import {
  countProblemStatusSummaryForUser,
  countUserStatsByProblem,
  countUserStatsByProblemForAssessments,
} from "../submission-stats";

export const submissionStatistics = {
  groupByUserAndProblem(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.groupBy({
      by: ["userId", "problemId"],
      where: { ...where, isReferenceSolution: false },
      _max: { score: true },
      _count: { id: true },
    });
  },

  groupAcceptedByProblem(problemIds: string[]) {
    return prisma.submission.groupBy({
      by: ["problemId"],
      _count: true,
      where: {
        problemId: { in: problemIds },
        status: "accepted",
        isReferenceSolution: false,
      },
    });
  },

  groupBestScoresByAssessment(assessmentIds: string[]) {
    if (assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["assessmentId", "userId", "problemId"],
      _max: { score: true },
      where: {
        assessmentId: { in: assessmentIds },
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  groupAcceptedByAssessmentForUser(opts: { assessmentIds: string[]; userId: string }) {
    if (opts.assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["assessmentId", "problemId"],
      _count: { _all: true },
      where: {
        assessmentId: { in: opts.assessmentIds },
        userId: opts.userId,
        sampleOnly: false,
        isReferenceSolution: false,
        status: "accepted",
      },
    });
  },

  groupBestScoresByAssessmentForUser(opts: { assessmentIds: string[]; userId: string }) {
    if (opts.assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["assessmentId", "problemId"],
      _max: { score: true },
      where: {
        assessmentId: { in: opts.assessmentIds },
        userId: opts.userId,
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  groupBestScoresByExam(examIds: string[]) {
    if (examIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["examId", "userId", "problemId"],
      _max: { score: true },
      where: {
        examId: { in: examIds },
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  groupAcceptedByExamForUser(opts: { examIds: string[]; userId: string }) {
    if (opts.examIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["examId", "problemId"],
      _count: { _all: true },
      where: {
        examId: { in: opts.examIds },
        userId: opts.userId,
        sampleOnly: false,
        isReferenceSolution: false,
        status: "accepted",
      },
    });
  },

  groupBestScoresByExamForUser(opts: { examIds: string[]; userId: string }) {
    if (opts.examIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["examId", "problemId"],
      _max: { score: true },
      where: {
        examId: { in: opts.examIds },
        userId: opts.userId,
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  groupByProblemAndStatus(userId: string, problemIds: string[]) {
    return prisma.submission.groupBy({
      by: ["problemId", "status"],
      _count: true,
      where: {
        problemId: { in: problemIds },
        sampleOnly: false,
        isReferenceSolution: false,
        userId,
      },
    });
  },

  findForContestScoreboardByContestId(contestId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: { ...scoringBaseSelect, userId: true },
      where: { contestId, sampleOnly: false, isReferenceSolution: false },
    });
  },

  findForVirtualContestScoreboard(participationId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        ...scoringBaseSelect,
        userId: true,
      },
      where: {
        participationId,
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  findForContestChartByContestId(contestId: string, userIds: string[]) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: { ...scoringBaseSelect, userId: true },
      where: {
        contestId,
        userId: { in: userIds },
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  findForContestScoring(contestId: string, userId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: scoringBaseSelect,
      where: {
        contestId,
        userId,
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  findForPlagiarism(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.findMany({
      where,
      select: {
        id: true,
        language: true,
        problemId: true,
        score: true,
        sourceStorage: true,
        userId: true,
      },
      orderBy: { score: "desc" },
    });
  },

  findRecentByUser(userId: string, take: number) {
    return prisma.submission.findMany({
      take,
      orderBy: { createdAt: "desc" },
      where: { userId, sampleOnly: false, isReferenceSolution: false },
      select: {
        id: true,
        status: true,
        language: true,
        createdAt: true,
        problem: { select: problemMiniSelect },
      },
    });
  },

  findDistinctAcByUser(userId: string) {
    return prisma.submission.findMany({
      where: { userId, status: "accepted", sampleOnly: false, isReferenceSolution: false },
      select: {
        problemId: true,
        problem: { select: { tags: true, difficulty: true } },
      },
      distinct: ["problemId"] as const,
    });
  },

  findDistinctAttemptedByUser(userId: string) {
    return prisma.submission.findMany({
      where: {
        userId,
        sampleOnly: false,
        isReferenceSolution: false,
        status: { in: submissionResultStatuses },
      },
      select: { problemId: true },
      distinct: ["problemId"] as const,
    });
  },

  findDistinctPublicAcByUser(userId: string) {
    return prisma.submission.findMany({
      where: {
        userId,
        status: "accepted",
        sampleOnly: false,
        isReferenceSolution: false,
        problem: { visibility: "public", status: "published" },
      },
      select: {
        problemId: true,
        problem: {
          select: { id: true, displayId: true, title: true, difficulty: true, tags: true },
        },
      },
      distinct: ["problemId"] as const,
    });
  },

  groupByLanguageForUser(userId: string) {
    return prisma.submission.groupBy({
      by: ["language"],
      where: {
        userId,
        sampleOnly: false,
        isReferenceSolution: false,
        status: { in: submissionResultStatuses },
      },
      _count: { _all: true },
    });
  },

  groupByStatusForUser(userId: string) {
    return prisma.submission.groupBy({
      by: ["status"],
      where: {
        userId,
        sampleOnly: false,
        isReferenceSolution: false,
        status: { in: submissionResultStatuses },
      },
      _count: { _all: true },
    });
  },

  findRecentErrors(take: number) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        status: "system_error",
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        status: true,
        language: true,
        createdAt: true,
        user: { select: userPublicSelect },
        problem: { select: problemMiniSelect },
      },
    });
  },

  findInDateRange(from: Date) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        createdAt: { gte: from },
        status: { in: submissionResultStatuses },
      },
      select: { createdAt: true, status: true },
    });
  },

  findForPlatformStats(from: Date) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        createdAt: { gte: from },
        status: { in: submissionResultStatuses },
      },
      select: {
        createdAt: true,
        status: true,
        userId: true,
        language: true,
        problemId: true,
      },
    });
  },

  groupByStatus(from: Date) {
    return prisma.submission.groupBy({
      by: ["status"],
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        createdAt: { gte: from },
        status: { in: submissionResultStatuses },
      },
      _count: { _all: true },
    });
  },

  findByCourseIdsWith7dStats(courseIds: string[], from: Date) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        createdAt: { gte: from },
        courseId: { in: courseIds },
        assessmentId: { not: null },
      },
      select: {
        status: true,
        assessmentId: true,
        assessment: {
          select: {
            id: true,
            title: true,
            course: { select: courseMiniSelect },
          },
        },
      },
    });
  },

  groupStatusByAssessments(assessmentIds: string[]) {
    if (assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["status"],
      where: {
        assessmentId: { in: assessmentIds },
        sampleOnly: false,
        isReferenceSolution: false,
      },
      _count: { _all: true },
    });
  },

  countUserStatsByProblemForAssessments(assessmentIds: string[]) {
    return countUserStatsByProblemForAssessments(assessmentIds);
  },

  groupBestScores(opts: { assessmentId: string; studentIds: string[]; problemIds: string[] }) {
    if (opts.studentIds.length === 0 || opts.problemIds.length === 0)
      return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["userId", "problemId"],
      _max: { score: true },
      where: {
        assessmentId: opts.assessmentId,
        sampleOnly: false,
        isReferenceSolution: false,
        userId: { in: opts.studentIds },
        problemId: { in: opts.problemIds },
      },
    });
  },

  groupFailuresByProblem(from: Date, take: number) {
    return prisma.submission.groupBy({
      by: ["problemId"],
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        createdAt: { gte: from },
        status: {
          in: [
            "compile_error",
            "runtime_error",
            "time_limit_exceeded",
            "memory_limit_exceeded",
          ],
        },
      },
      _count: { _all: true },
      orderBy: { _count: { problemId: "desc" } },
      take,
    });
  },

  countUserStatsByProblem(problemIds: string[]) {
    return countUserStatsByProblem(problemIds);
  },

  countProblemStatusSummaryForUser(userId: string) {
    return countProblemStatusSummaryForUser(userId);
  },
};
