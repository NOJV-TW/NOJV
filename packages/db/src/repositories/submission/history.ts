import { prisma } from "../../client";
import type { Prisma } from "../../../generated/prisma/client";
import type { SubmissionStatus } from "../../../generated/prisma/enums";
import { problemMiniSelect, userMiniSelect } from "../selects";
import {
  contestExamListSelect,
  type SubmissionClient,
  type SubmissionHistoryBoundary,
  type SubmissionHistoryFilters,
  type TxClient,
  userFacingSubmissionWhere,
} from "./shared";

export const submissionHistory = {
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
              { judgeExecutions: { some: { state: { notIn: ["completed", "cancelled"] } } } },
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
    context?: { type: "assignment" | "exam" | "contest"; id: string };
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
      ...(input.context?.type === "contest" ? { contestId: input.context.id } : {}),
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
          ...(filters.userSearch
            ? {
                user: {
                  OR: [
                    { username: { contains: filters.userSearch, mode: "insensitive" } },
                    { name: { contains: filters.userSearch, mode: "insensitive" } },
                  ],
                },
              }
            : {}),
          ...(filters.ipSearch
            ? { ipAddress: { contains: filters.ipSearch, mode: "insensitive" } }
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
    context: { type: "assignment" | "exam" | "contest"; id: string };
    limit: number;
  }) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        isReferenceSolution: false,
        ...(opts.context.type === "assignment"
          ? { assessmentId: opts.context.id }
          : opts.context.type === "exam"
            ? { examId: opts.context.id }
            : { contestId: opts.context.id }),
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

  count(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.count({
      where: where.sampleOnly === false ? { ...where, isReferenceSolution: false } : where,
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
};
