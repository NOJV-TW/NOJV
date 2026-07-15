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
import {
  countProblemStatusSummaryForUser,
  countUserStatsByProblem,
  countUserStatsByProblemForAssessments,
} from "./submission-stats";

type TxClient = TransactionClient;
type SubmissionClient = Pick<TxClient, "submission">;

export type SubmissionCreateContext =
  | { type: "practice" }
  | { type: "assignment"; assessmentId: string; courseId: string }
  | { type: "exam"; examId: string }
  | { type: "contest"; contestId: string }
  | { type: "virtual"; participationId: string };

type CanonicalSubmissionCreateInput = Omit<
  Prisma.SubmissionUncheckedCreateInput,
  "assessmentId" | "contestId" | "courseId" | "examId" | "participationId"
> & { context: SubmissionCreateContext };

function submissionContextColumns(
  context: SubmissionCreateContext,
): Pick<
  Prisma.SubmissionUncheckedCreateInput,
  "assessmentId" | "contestId" | "courseId" | "examId" | "participationId"
> {
  return {
    assessmentId: context.type === "assignment" ? context.assessmentId : null,
    courseId: context.type === "assignment" ? context.courseId : null,
    examId: context.type === "exam" ? context.examId : null,
    contestId: context.type === "contest" ? context.contestId : null,
    participationId: context.type === "virtual" ? context.participationId : null,
  };
}

function userFacingSubmissionWhere(
  userId: string,
  enforceExamConfinement: boolean,
): Prisma.SubmissionWhereInput {
  if (!enforceExamConfinement) return { userId };

  return {
    userId,
    OR: [
      {
        user: {
          activeExamSessions: { none: { endedAt: null } },
        },
      },
      {
        exam: {
          activeSessions: { some: { userId, endedAt: null } },
        },
      },
    ],
  };
}

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

const submissionDetailSelect = {
  id: true,
  userId: true,
  problemId: true,
  contestId: true,
  courseId: true,
  assessmentId: true,
  examId: true,
  sampleOnly: true,
  language: true,
  sourceStorage: true,
  status: true,
  score: true,
  runtimeMs: true,
  memoryKb: true,
  verdictSummary: true,
  verdictDetailStorage: true,
  judgeGeneration: true,
  activeJudgeRunId: true,
  createdAt: true,
  user: { select: userMiniSelect },
  problem: {
    select: {
      ...problemMiniSelect,
      type: true,
      advancedConfig: true,
      testcaseSets: { select: { weight: true } },
    },
  },
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
} satisfies Prisma.SubmissionSelect;

export const submissionRepo = {
  findById(id: string) {
    return prisma.submission.findUnique({ where: { id } });
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

  findByIdForDispatchMeta(id: string) {
    return prisma.submission.findUnique({
      where: { id },
      select: {
        problem: {
          select: {
            type: true,
            advancedConfig: true,
            advancedRequiredPaths: true,
            timeLimitMs: true,
            memoryLimitMb: true,
          },
        },
      },
    });
  },

  findByIdWithJudgeContext(id: string) {
    return prisma.submission.findUnique({
      include: {
        contest: {
          select: { endsAt: true, startsAt: true },
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
    participationId?: string;
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
        ...(opts.participationId ? { participationId: opts.participationId } : {}),
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
        verdictDetailStorage: true,
        contestId: true,
        assessmentId: true,
        examId: true,
      },
      take: opts.take ?? 50,
    });
  },

  async listByUser(opts: {
    userId: string;
    enforceExamConfinement: boolean;
    limit: number;
    cursor?: string;
  }) {
    const scope = {
      ...userFacingSubmissionWhere(opts.userId, opts.enforceExamConfinement),
      sampleOnly: false,
    } satisfies Prisma.SubmissionWhereInput;

    const readPage = (
      client: SubmissionClient,
      cursor: { id: string; createdAt: Date } | null,
    ) =>
      client.submission.findMany({
        where: {
          ...scope,
          ...(cursor
            ? {
                AND: {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        take: opts.limit + 1,
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
          problem: {
            select: {
              ...problemMiniSelect,
              type: true,
              advancedConfig: true,
              testcaseSets: { select: { weight: true } },
            },
          },
        },
      });

    const cursorId = opts.cursor;
    if (!cursorId) return readPage(prisma, null);

    return prisma.$transaction(
      async (tx) => {
        const cursor = await tx.submission.findFirst({
          where: { ...scope, id: cursorId },
          select: { id: true, createdAt: true },
        });
        if (!cursor) return null;
        return readPage(tx, cursor);
      },
      { isolationLevel: "RepeatableRead" },
    );
  },

  listAllPaged(opts: { limit: number; cursor?: string; userId?: string; problemId?: string }) {
    const where: Prisma.SubmissionWhereInput = { sampleOnly: false };
    if (opts.userId) where.userId = opts.userId;
    if (opts.problemId) where.problemId = opts.problemId;

    return prisma.submission.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        language: true,
        score: true,
        status: true,
        contestId: true,
        examId: true,
        assessmentId: true,
        problem: { select: problemMiniSelect },
        user: { select: userMiniSelect },
      },
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

  countUserStatsByProblem(problemIds: string[]) {
    return countUserStatsByProblem(problemIds);
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

  findForContestScoreboardByContestId(contestId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: { ...scoringBaseSelect, userId: true },
      where: { contestId, sampleOnly: false },
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
        sourceStorage: true,
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

  findDistinctPublicAcByUser(userId: string) {
    return prisma.submission.findMany({
      where: {
        userId,
        status: "accepted",
        sampleOnly: false,
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

  findForPlatformStats(from: Date) {
    return prisma.submission.findMany({
      where: { sampleOnly: false, createdAt: { gte: from } },
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

  updateStatus(id: string, status: SubmissionStatus) {
    return prisma.submission.update({
      data: { status },
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

  completeIfInProgress(id: string, data: Prisma.SubmissionUpdateInput) {
    return prisma.submission.updateMany({
      data,
      where: {
        id,
        status: {
          in: ["pending_upload", "queued", "compiling", "running"] as SubmissionStatus[],
        },
      },
    });
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

  countProblemStatusSummaryForUser(userId: string) {
    return countProblemStatusSummaryForUser(userId);
  },

  findStalePendingIds(before: Date) {
    return prisma.submission.findMany({
      select: { id: true },
      where: {
        status: { in: ["pending_upload", "queued", "compiling", "running"] },
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

      create(data: CanonicalSubmissionCreateInput) {
        const { context, ...submission } = data;
        return tx.submission.create({
          data: { ...submission, ...submissionContextColumns(context) },
        });
      },

      publishPendingUpload(id: string, sourceStorage: Prisma.InputJsonValue) {
        return tx.submission.update({
          where: { id, status: "pending_upload" },
          data: { sourceStorage, status: "queued" },
        });
      },
    };
  },
};
