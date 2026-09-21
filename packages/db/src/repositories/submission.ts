import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { SupportedLanguage, SubmissionStatus } from "../../generated/prisma/enums";
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

const submissionResultStatuses: SubmissionStatus[] = [
  "accepted",
  "wrong_answer",
  "compile_error",
  "runtime_error",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "system_error",
];

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
  activeJudgeRunId: true,
  createdAt: true,
  updatedAt: true,
  judgeGeneration: true,
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

export interface SubmissionHistoryFilters {
  problemId?: string;
  status?: SubmissionStatus;
  language?: SupportedLanguage;
  contextType?: "practice" | "assignment" | "contest" | "exam" | "virtual";
  search?: string;
}

export interface SubmissionHistoryBoundary {
  id: string;
  createdAt: Date;
}

export const submissionRepo = {
  findById(id: string) {
    return prisma.submission.findUnique({ where: { id } });
  },

  async listPendingForUser(input: { userId: string; cursor?: string; queuedIds: string[] }) {
    const scope = {
      ...userFacingSubmissionWhere(input.userId, true),
      sampleOnly: false,
    } satisfies Prisma.SubmissionWhereInput;
    const cursor = input.cursor
      ? await prisma.submission.findFirst({
          where: { ...scope, id: input.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    if (input.cursor && !cursor) return null;
    return prisma.submission.findMany({
      where: {
        ...scope,
        AND: [
          {
            OR: [
              { status: { in: ["pending_upload", "queued", "compiling", "running"] } },
              { id: { in: input.queuedIds } },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: { problem: { select: problemMiniSelect } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    });
  },

  async listHistoryPage(input: {
    userId?: string;
    context?: { type: "assignment" | "exam"; id: string };
    filters: SubmissionHistoryFilters;
    queuedRejudgeIds?: string[];
    page: number;
    limit: number;
    snapshot?: SubmissionHistoryBoundary;
  }) {
    const scope: Prisma.SubmissionWhereInput = {
      ...(input.userId ? userFacingSubmissionWhere(input.userId, true) : {}),
      sampleOnly: false,
      isReferenceSolution: false,
      ...(input.context?.type === "assignment" ? { assessmentId: input.context.id } : {}),
      ...(input.context?.type === "exam" ? { examId: input.context.id } : {}),
    };
    const filters = input.filters;
    const where: Prisma.SubmissionWhereInput = {
      AND: [
        scope,
        {
          ...(filters.problemId ? { problemId: filters.problemId } : {}),
          ...(filters.status === "queued"
            ? {
                AND: [
                  {
                    OR: [
                      { status: "queued" as const },
                      { id: { in: input.queuedRejudgeIds ?? [] } },
                    ],
                  },
                ],
              }
            : filters.status
              ? { status: filters.status, id: { notIn: input.queuedRejudgeIds ?? [] } }
              : {}),
          ...(filters.language ? { language: filters.language } : {}),
          ...(filters.contextType === "practice"
            ? { assessmentId: null, examId: null, contestId: null, participationId: null }
            : {}),
          ...(filters.contextType === "assignment" ? { assessmentId: { not: null } } : {}),
          ...(filters.contextType === "exam" ? { examId: { not: null } } : {}),
          ...(filters.contextType === "contest"
            ? { contestId: { not: null }, participationId: null }
            : {}),
          ...(filters.contextType === "virtual" ? { participationId: { not: null } } : {}),
          ...(filters.search
            ? {
                OR: [
                  { problem: { title: { contains: filters.search, mode: "insensitive" } } },
                  { user: { username: { contains: filters.search, mode: "insensitive" } } },
                  { user: { name: { contains: filters.search, mode: "insensitive" } } },
                  { ipAddress: { contains: filters.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
      ],
    };
    return prisma.$transaction(
      async (tx) => {
        if (input.snapshot?.id) {
          const anchor = await tx.submission.findFirst({
            where: {
              AND: [scope, { id: input.snapshot.id, createdAt: input.snapshot.createdAt }],
            },
            select: { id: true },
          });
          if (!anchor) return null;
        }
        const snapshot = input.snapshot ??
          (await tx.submission.findFirst({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, createdAt: true },
          })) ?? { id: "", createdAt: new Date() };
        const bounded = {
          AND: [
            where,
            {
              OR: [
                { createdAt: { lt: snapshot.createdAt } },
                { createdAt: snapshot.createdAt, id: { lte: snapshot.id } },
              ],
            },
          ],
        } satisfies Prisma.SubmissionWhereInput;
        const [rows, totalCount, newCount] = await Promise.all([
          tx.submission.findMany({
            where: bounded,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (input.page - 1) * input.limit,
            take: input.limit,
            select: {
              id: true,
              createdAt: true,
              updatedAt: true,
              judgeGeneration: true,
              language: true,
              score: true,
              status: true,
              runtimeMs: true,
              memoryKb: true,
              verdictSummary: true,
              contestId: true,
              assessmentId: true,
              examId: true,
              participationId: true,
              ipAddress: true,
              problem: {
                select: {
                  ...problemMiniSelect,
                  type: true,
                  advancedConfig: true,
                  testcaseSets: { select: { weight: true } },
                },
              },
              user: { select: userMiniSelect },
            },
          }),
          tx.submission.count({ where: bounded }),
          tx.submission.count({
            where: {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { gt: snapshot.createdAt } },
                    { createdAt: snapshot.createdAt, id: { gt: snapshot.id } },
                  ],
                },
              ],
            },
          }),
        ]);
        return { rows, totalCount, newCount, snapshot };
      },
      { isolationLevel: "RepeatableRead" },
    );
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

  findByIdForDispatchMeta(id: string) {
    return prisma.submission.findUnique({
      where: { id },
      select: {
        userId: true,
        createdAt: true,
        problem: {
          select: {
            id: true,
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
        isReferenceSolution: false,
        status: { in: opts.statusIn },
        ...(opts.contestId ? { contestId: opts.contestId } : {}),
        ...(opts.assessmentId ? { assessmentId: opts.assessmentId } : {}),
        ...(opts.participationId ? { participationId: opts.participationId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        judgeGeneration: true,
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

  countByUser(opts: { userId: string; enforceExamConfinement: boolean }) {
    return prisma.submission.count({
      where: {
        ...userFacingSubmissionWhere(opts.userId, opts.enforceExamConfinement),
        sampleOnly: false,
        isReferenceSolution: false,
      },
    });
  },

  countAll() {
    return prisma.submission.count({
      where: { sampleOnly: false, isReferenceSolution: false },
    });
  },

  async listByUser(opts: {
    userId: string;
    enforceExamConfinement: boolean;
    limit: number;
    cursor?: string;
    problemId?: string;
    examId?: string;
    assessmentId?: string;
    contestId?: string;
    participationId?: string;
  }) {
    const scope = {
      ...userFacingSubmissionWhere(opts.userId, opts.enforceExamConfinement),
      sampleOnly: false,
      isReferenceSolution: false,
      ...(opts.problemId ? { problemId: opts.problemId } : {}),
      ...(opts.examId ? { examId: opts.examId } : {}),
      ...(opts.assessmentId ? { assessmentId: opts.assessmentId } : {}),
      ...(opts.contestId ? { contestId: opts.contestId } : {}),
      ...(opts.participationId ? { participationId: opts.participationId } : {}),
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
          updatedAt: true,
          judgeGeneration: true,
          language: true,
          score: true,
          status: true,
          runtimeMs: true,
          memoryKb: true,
          verdictSummary: true,
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

  listAllPaged(opts: {
    limit: number;
    cursor?: string;
    userId?: string;
    problemId?: string;
    status?: SubmissionStatus;
  }) {
    const where: Prisma.SubmissionWhereInput = {
      sampleOnly: false,
      isReferenceSolution: false,
    };
    if (opts.userId) where.userId = opts.userId;
    if (opts.problemId) where.problemId = opts.problemId;
    if (opts.status) where.status = opts.status;

    return prisma.submission.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        judgeGeneration: true,
        language: true,
        score: true,
        status: true,
        verdictSummary: true,
        contestId: true,
        examId: true,
        assessmentId: true,
        problem: {
          select: {
            ...problemMiniSelect,
            type: true,
            advancedConfig: true,
            testcaseSets: { select: { weight: true } },
          },
        },
        user: { select: userMiniSelect },
      },
    });
  },

  listRecentForContext(opts: {
    context: { type: "assignment"; id: string } | { type: "exam"; id: string };
    limit: number;
  }) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        ...(opts.context.type === "assignment"
          ? { assessmentId: opts.context.id }
          : { examId: opts.context.id }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit,
      select: {
        id: true,
        createdAt: true,
        ipAddress: true,
        language: true,
        score: true,
        status: true,
        problem: { select: problemMiniSelect },
        user: { select: userMiniSelect },
      },
    });
  },

  listSystemErrorsForRecovery({ limit }: { limit: number }) {
    return prisma.submission.findMany({
      where: { status: "system_error", judgeGeneration: 1 },
      select: { id: true, judgeGeneration: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  count(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.count({
      where: where.sampleOnly === false ? { ...where, isReferenceSolution: false } : where,
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

  listByContest(opts: { contestId: string; take?: number }) {
    return prisma.submission.findMany({
      where: { contestId: opts.contestId, sampleOnly: false, isReferenceSolution: false },
      orderBy: { createdAt: "desc" },
      select: contestExamListSelect,
      take: opts.take ?? 100,
    });
  },

  listByExam(opts: { examId: string; take?: number }) {
    return prisma.submission.findMany({
      where: { examId: opts.examId, sampleOnly: false, isReferenceSolution: false },
      orderBy: { createdAt: "desc" },
      select: contestExamListSelect,
      take: opts.take ?? 100,
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

  findForRejudge(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.findMany({
      select: {
        id: true,
        userId: true,
        judgeGeneration: true,
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

  updateStatus(id: string, status: SubmissionStatus) {
    return prisma.submission.update({
      data: { status },
      where: { id },
    });
  },

  complete(id: string, data: Prisma.SubmissionUpdateInput) {
    return prisma.submission.update({
      data,
      where: { id },
    });
  },

  completeIfInProgress(id: string, data: Prisma.SubmissionUpdateInput, updatedBefore?: Date) {
    return prisma.submission.updateMany({
      data,
      where: {
        id,
        ...(updatedBefore ? { updatedAt: { lt: updatedBefore } } : {}),
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
        isReferenceSolution: false,
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
            isReferenceSolution: false,
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
