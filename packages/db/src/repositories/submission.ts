import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { SubmissionStatus } from "../../generated/prisma/enums";
import type { TransactionClient } from "../transaction";
import {
  courseMiniSelect,
  problemMiniSelect,
  userMiniSelect,
  userPublicSelect,
} from "./selects";

type TxClient = TransactionClient;

const contestExamListSelect = {
  id: true,
  createdAt: true,
  language: true,
  score: true,
  status: true,
  runtimeMs: true,
  problem: { select: problemMiniSelect },
  user: { select: userMiniSelect },
} satisfies Prisma.SubmissionSelect;

const scoringBaseSelect = {
  createdAt: true,
  problemId: true,
  score: true,
  status: true,
} satisfies Prisma.SubmissionSelect;

export const submissionRepo = {
  findById(id: string) {
    return prisma.submission.findUnique({ where: { id } });
  },

  findStatusById(id: string) {
    return prisma.submission.findUnique({ where: { id }, select: { status: true } });
  },

  findByIdWithProblemId(id: string) {
    return prisma.submission.findUnique({
      select: {
        id: true,
        problemId: true,
        status: true,
        language: true,
        sourceStoragePrefix: true,
        score: true,
        runtimeMs: true,
        sampleOnly: true,
        userId: true,
        createdAt: true,
        contestParticipationId: true,
        assessmentId: true,
        courseId: true,
        verdictSummary: true,
        verdictDetailStorageKey: true,
      },
      where: { id },
    });
  },

  findByIdForDetail(id: string) {
    return prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        problemId: true,
        contestId: true,
        courseId: true,
        assessmentId: true,
        examId: true,
        sampleOnly: true,
        language: true,
        sourceStoragePrefix: true,
        status: true,
        score: true,
        runtimeMs: true,
        memoryKb: true,
        verdictSummary: true,
        verdictDetailStorageKey: true,
        createdAt: true,
        user: { select: userMiniSelect },
        problem: { select: problemMiniSelect },
        contest: { select: { id: true, title: true } },
        assessment: {
          select: {
            id: true,
            title: true,
            courseId: true,
            course: { select: { id: true, title: true } },
          },
        },
        exam: {
          select: {
            id: true,
            title: true,
            courseId: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
    });
  },

  findByIdWithJudgeContext(id: string) {
    return prisma.submission.findUnique({
      include: {
        contestParticipation: {
          select: {
            contestId: true,
            contest: {
              select: { endsAt: true, startsAt: true },
            },
          },
        },
        assessment: {
          select: { adjustmentRules: true, closesAt: true, dueAt: true, opensAt: true },
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

  listByUserAndProblem(opts: {
    problemId: string;
    userId: string;
    statusIn: SubmissionStatus[];
    contestId?: string;
    assessmentId?: string;
    virtualContestId?: string;
    take?: number;
  }) {
    return prisma.submission.findMany({
      where: {
        problemId: opts.problemId,
        userId: opts.userId,
        sampleOnly: false,
        status: { in: opts.statusIn },
        ...(opts.contestId ? { contestId: opts.contestId } : {}),
        ...(opts.assessmentId ? { assessmentId: opts.assessmentId } : {}),
        ...(opts.virtualContestId ? { virtualContestId: opts.virtualContestId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        language: true,
        score: true,
        status: true,
        runtimeMs: true,
        verdictSummary: true,
        verdictDetailStorageKey: true,
        contestId: true,
        assessmentId: true,
        examId: true,
      },
      take: opts.take ?? 50,
    });
  },

  listByUser(opts: { userId: string; take?: number }) {
    return prisma.submission.findMany({
      where: {
        userId: opts.userId,
        sampleOnly: false,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        language: true,
        score: true,
        status: true,
        runtimeMs: true,
        memoryKb: true,
        contestId: true,
        assessmentId: true,
        examId: true,
        problem: { select: problemMiniSelect },
      },
      take: opts.take ?? 50,
    });
  },

  count(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.count({ where });
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

  groupByUserAndProblem(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.groupBy({
      by: ["userId", "problemId"],
      where,
      _max: { score: true },
      _count: { id: true },
    });
  },

  groupAcceptedByProblem(problemIds: string[]) {
    return prisma.submission.groupBy({
      by: ["problemId"],
      _count: true,
      where: { problemId: { in: problemIds }, status: "accepted" },
    });
  },

  async countUserStatsByProblem(
    problemIds: string[],
  ): Promise<{ problemId: string; attempters: number; solvers: number }[]> {
    if (problemIds.length === 0) return [];
    return prisma.$queryRaw<{ problemId: string; attempters: number; solvers: number }[]>`
      SELECT
        "problemId",
        COUNT(DISTINCT "userId")::int AS attempters,
        COUNT(DISTINCT "userId") FILTER (WHERE status = 'accepted')::int AS solvers
      FROM "Submission"
      WHERE "problemId" = ANY(${problemIds}::text[])
        AND "sampleOnly" = false
      GROUP BY "problemId"
    `;
  },

  groupBestScoresByAssessment(assessmentIds: string[]) {
    if (assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["assessmentId", "userId", "problemId"],
      _max: { score: true },
      where: {
        assessmentId: { in: assessmentIds },
        sampleOnly: false,
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
        userId,
      },
    });
  },

  listByContest(opts: { contestId: string; take?: number }) {
    return prisma.submission.findMany({
      where: { contestId: opts.contestId, sampleOnly: false },
      orderBy: { createdAt: "desc" },
      select: contestExamListSelect,
      take: opts.take ?? 100,
    });
  },

  listByExam(opts: { examId: string; take?: number }) {
    return prisma.submission.findMany({
      where: { examId: opts.examId, sampleOnly: false },
      orderBy: { createdAt: "desc" },
      select: contestExamListSelect,
      take: opts.take ?? 100,
    });
  },

  findForContestScoreboard(participationIds: string[]) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        ...scoringBaseSelect,
        contestParticipation: { select: { userId: true } },
      },
      where: {
        contestParticipationId: { in: participationIds },
        sampleOnly: false,
      },
    });
  },

  findForContestScoreboardByContestId(contestId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: { ...scoringBaseSelect, userId: true },
      where: { contestId, sampleOnly: false },
    });
  },

  findForVirtualContestScoreboard(virtualContestId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        ...scoringBaseSelect,
        userId: true,
      },
      where: {
        virtualContestId,
        sampleOnly: false,
      },
    });
  },

  findForContestChart(participationIds: string[]) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        ...scoringBaseSelect,
        contestParticipationId: true,
      },
      where: {
        contestParticipationId: { in: participationIds },
        sampleOnly: false,
      },
    });
  },

  findForParticipationScoring(participationId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: scoringBaseSelect,
      where: {
        contestParticipationId: participationId,
        sampleOnly: false,
      },
    });
  },

  findForRejudge(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.findMany({
      select: {
        id: true,
        language: true,
        problemId: true,
        sampleOnly: true,
        sourceStoragePrefix: true,
      },
      where,
    });
  },

  async listIdsForContext(
    context:
      | { type: "assignment"; assignmentId: string }
      | { type: "exam"; examId: string }
      | { type: "contest"; contestId: string },
  ): Promise<string[]> {
    let where: Prisma.SubmissionWhereInput;
    switch (context.type) {
      case "assignment":
        where = { assessmentId: context.assignmentId };
        break;
      case "exam":
        where = { examId: context.examId };
        break;
      default:
        where = { contestId: context.contestId };
        break;
    }
    const rows = await prisma.submission.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  },

  async anyWithContextForProblem(problemId: string): Promise<boolean> {
    const row = await prisma.submission.findFirst({
      where: {
        problemId,
        OR: [
          { contestId: { not: null } },
          { assessmentId: { not: null } },
          { examId: { not: null } },
        ],
      },
      select: { id: true },
    });
    return row !== null;
  },

  findForPlagiarism(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.findMany({
      where,
      select: {
        id: true,
        language: true,
        problemId: true,
        score: true,
        sourceStoragePrefix: true,
        userId: true,
      },
      orderBy: { score: "desc" },
    });
  },

  findRecentByUser(userId: string, take: number) {
    return prisma.submission.findMany({
      take,
      orderBy: { createdAt: "desc" },
      where: { userId, sampleOnly: false },
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
      where: { userId, status: "accepted", sampleOnly: false },
      select: {
        problemId: true,
        problem: { select: { tags: true, difficulty: true } },
      },
      distinct: ["problemId"] as const,
    });
  },

  groupByLanguageForUser(userId: string) {
    return prisma.submission.groupBy({
      by: ["language"],
      where: { userId, sampleOnly: false },
      _count: { _all: true },
    });
  },

  groupByStatusForUser(userId: string) {
    return prisma.submission.groupBy({
      by: ["status"],
      where: { userId, sampleOnly: false },
      _count: { _all: true },
    });
  },

  findRecentErrors(take: number) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        status: {
          in: [
            "compile_error",
            "runtime_error",
            "time_limit_exceeded",
            "memory_limit_exceeded",
          ],
        },
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
      where: { sampleOnly: false, createdAt: { gte: from } },
      select: { createdAt: true, status: true },
    });
  },

  groupByStatus(from: Date) {
    return prisma.submission.groupBy({
      by: ["status"],
      where: { sampleOnly: false, createdAt: { gte: from } },
      _count: { _all: true },
    });
  },

  findByCourseIdsWith7dStats(courseIds: string[], from: Date) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
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
      },
      _count: { _all: true },
    });
  },

  async countUserStatsByProblemForAssessments(
    assessmentIds: string[],
  ): Promise<{ problemId: string; attempters: number; solvers: number }[]> {
    if (assessmentIds.length === 0) return [];
    return prisma.$queryRaw<{ problemId: string; attempters: number; solvers: number }[]>`
      SELECT
        "problemId",
        COUNT(DISTINCT "userId")::int AS attempters,
        COUNT(DISTINCT "userId") FILTER (WHERE status = 'accepted')::int AS solvers
      FROM "Submission"
      WHERE "assessmentId" = ANY(${assessmentIds}::text[])
        AND "sampleOnly" = false
      GROUP BY "problemId"
    `;
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

  updateStatus(id: string, status: string) {
    return prisma.submission.update({
      data: { status } as Prisma.SubmissionUncheckedUpdateInput,
      where: { id },
    });
  },

  updateStatusIfIn(id: string, fromStatuses: string[], status: string) {
    return prisma.submission.updateMany({
      data: { status } as Prisma.SubmissionUncheckedUpdateInput,
      where: { id, status: { in: fromStatuses as SubmissionStatus[] } },
    });
  },

  complete(id: string, data: Prisma.SubmissionUpdateInput) {
    return prisma.submission.update({
      data,
      where: { id },
    });
  },

  create(data: Prisma.SubmissionCreateInput) {
    return prisma.submission.create({ data });
  },

  countForUserAssessmentProblemSince(
    userId: string,
    assessmentId: string,
    problemId: string,
    sinceTime: Date,
  ) {
    return prisma.submission.count({
      where: {
        userId,
        assessmentId,
        problemId,
        sampleOnly: false,
        status: { not: "system_error" },
        createdAt: { gte: sinceTime },
      },
    });
  },

  findStalePendingIds(before: Date) {
    return prisma.submission.findMany({
      select: { id: true },
      where: {
        status: { in: ["queued", "compiling", "running"] },
        updatedAt: { lt: before },
      },
    });
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.submission.findUnique({ where: { id } });
      },

      count(where: Prisma.SubmissionWhereInput) {
        return tx.submission.count({ where });
      },

      countForUserAssessmentProblemSince(
        userId: string,
        assessmentId: string,
        problemId: string,
        sinceTime: Date,
      ) {
        return tx.submission.count({
          where: {
            userId,
            assessmentId,
            problemId,
            sampleOnly: false,
            status: { not: "system_error" },
            createdAt: { gte: sinceTime },
          },
        });
      },

      findMostRecent(where: Prisma.SubmissionWhereInput, select?: Prisma.SubmissionSelect) {
        return tx.submission.findFirst({
          where,
          orderBy: { createdAt: "desc" },
          select: select ?? { createdAt: true },
        });
      },

      create(data: Prisma.SubmissionUncheckedCreateInput) {
        return tx.submission.create({ data });
      },
    };
  },
};
