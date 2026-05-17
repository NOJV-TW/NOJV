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

// Shared list shape for contest / exam submission feeds — identical columns,
// different scoping. Keep extracted so adding a column updates one place.
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

// Scoring base — chart, scoreboard, and per-participation scoring share these
// four columns; each method spreads it and adds the nesting it needs.
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

  findByIdWithProblemId(id: string) {
    return prisma.submission.findUnique({
      select: {
        id: true,
        problemId: true,
        status: true,
        language: true,
        sourceCode: true,
        score: true,
        runtimeMs: true,
        sampleOnly: true,
        userId: true,
        createdAt: true,
        contestParticipationId: true,
        courseAssessmentId: true,
        courseId: true,
        verdictDetail: true,
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
        courseAssessmentId: true,
        examId: true,
        sampleOnly: true,
        language: true,
        sourceCode: true,
        status: true,
        score: true,
        runtimeMs: true,
        memoryKb: true,
        verdictDetail: true,
        createdAt: true,
        user: { select: userMiniSelect },
        problem: { select: problemMiniSelect },
        contest: { select: { id: true, title: true } },
        courseAssessment: {
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
        courseAssessment: {
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
    courseAssessmentId?: string;
    virtualContestId?: string;
    take?: number;
  }) {
    return prisma.submission.findMany({
      where: {
        problemId: opts.problemId,
        userId: opts.userId,
        sampleOnly: false,
        status: { in: opts.statusIn },
        ...(opts.courseAssessmentId ? { courseAssessmentId: opts.courseAssessmentId } : {}),
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
        verdictDetail: true,
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

  // User-based stats per problem: how many distinct users tried it, and how
  // many of those AC'd at least once. Drives the public AC rate (people-based,
  // not submission-based) so that one prolific student spamming submissions
  // can't skew the visible rate. `sampleOnly: false` excludes Run-mode dry-runs
  // since they aren't real attempts.
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
      by: ["courseAssessmentId", "userId", "problemId"],
      _max: { score: true },
      where: {
        courseAssessmentId: { in: assessmentIds },
        sampleOnly: false,
      },
    });
  },

  groupAcceptedByAssessmentForUser(opts: { assessmentIds: string[]; userId: string }) {
    if (opts.assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["courseAssessmentId", "problemId"],
      _count: { _all: true },
      where: {
        courseAssessmentId: { in: opts.assessmentIds },
        userId: opts.userId,
        sampleOnly: false,
        status: "accepted",
      },
    });
  },

  groupBestScoresByAssessmentForUser(opts: { assessmentIds: string[]; userId: string }) {
    if (opts.assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["courseAssessmentId", "problemId"],
      _max: { score: true },
      where: {
        courseAssessmentId: { in: opts.assessmentIds },
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

  /**
   * Real (non-sample) submissions tagged to one virtual contest, in
   * chronological order. Drives the compute-on-read virtual scoreboard:
   * a virtual contest has a single participant so no participation join
   * is needed — `userId` is carried directly on the row.
   */
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
        sourceCode: true,
      },
      where,
    });
  },

  // Used by the batch-rejudge authz check: is there any submission for this
  // problem that's attached to a contest / assessment / exam context? If so,
  // an unscoped batch would include work that the problem author alone can't
  // re-grade, and the caller must scope the batch instead.
  async anyWithContextForProblem(problemId: string): Promise<boolean> {
    const row = await prisma.submission.findFirst({
      where: {
        problemId,
        OR: [
          { contestId: { not: null } },
          { courseAssessmentId: { not: null } },
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
        sourceCode: true,
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
        courseAssessmentId: { not: null },
      },
      select: {
        status: true,
        courseAssessmentId: true,
        courseAssessment: {
          select: {
            id: true,
            title: true,
            course: { select: courseMiniSelect },
          },
        },
      },
    });
  },

  // Verdict distribution across a set of assessments — backs the class-analytics
  // verdict pie. Counts every real submission (Run-mode dry-runs excluded).
  groupStatusByAssessments(assessmentIds: string[]) {
    if (assessmentIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["status"],
      where: {
        courseAssessmentId: { in: assessmentIds },
        sampleOnly: false,
      },
      _count: { _all: true },
    });
  },

  // Per-problem people-based stats scoped to a set of assessments: distinct
  // attempters and distinct solvers. Drives the "hardest problems" panel —
  // people-based so one student spamming submissions can't skew the AC rate.
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
      WHERE "courseAssessmentId" = ANY(${assessmentIds}::text[])
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
        courseAssessmentId: opts.assessmentId,
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

  complete(id: string, data: Prisma.SubmissionUpdateInput) {
    return prisma.submission.update({
      data,
      where: { id },
    });
  },

  create(data: Prisma.SubmissionCreateInput) {
    return prisma.submission.create({ data });
  },

  countForUserAndAssessmentSince(userId: string, courseAssessmentId: string, sinceTime: Date) {
    return prisma.submission.count({
      where: {
        userId,
        courseAssessmentId,
        sampleOnly: false,
        createdAt: { gte: sinceTime },
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

      countForUserAndAssessmentSince(
        userId: string,
        courseAssessmentId: string,
        sinceTime: Date,
      ) {
        return tx.submission.count({
          where: {
            userId,
            courseAssessmentId,
            sampleOnly: false,
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
