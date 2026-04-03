import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { SubmissionStatus } from "../../generated/prisma/enums";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const submissionRepo = {
  findById(id: string) {
    return prisma.submission.findUnique({ where: { id } });
  },

  findByIdWithProblemSlug(id: string) {
    return prisma.submission.findUnique({
      include: { problem: { select: { slug: true } } },
      where: { id }
    });
  },

  /** Fetch submission with full problem data for judging (templates, testcases). */
  findByIdWithJudgeContext(id: string) {
    return prisma.submission.findUnique({
      include: {
        problem: {
          include: {
            templates: true,
            testcaseSets: {
              include: {
                testcases: { orderBy: { ordinal: "asc" as const } }
              },
              orderBy: { createdAt: "asc" as const }
            }
          }
        }
      },
      where: { id }
    });
  },

  /** List user submissions for a problem, filtered by verdict statuses. */
  listByUserAndProblem(opts: {
    problemId: string;
    userId: string;
    statusIn: SubmissionStatus[];
    courseAssessmentId?: string;
    take?: number;
  }) {
    return prisma.submission.findMany({
      where: {
        problemId: opts.problemId,
        userId: opts.userId,
        sampleOnly: false,
        status: { in: opts.statusIn },
        ...(opts.courseAssessmentId ? { courseAssessmentId: opts.courseAssessmentId } : {})
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        language: true,
        score: true,
        status: true,
        runtimeMs: true,
        subtaskResults: true,
        verdictDetail: true
      },
      take: opts.take ?? 50
    });
  },

  /** Count submissions matching a filter (used for attempt limits, AC checks). */
  count(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.count({ where });
  },

  /** Find the most recent submission matching criteria. */
  findMostRecent(where: Prisma.SubmissionWhereInput, select?: Prisma.SubmissionSelect) {
    return prisma.submission.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: select ?? { createdAt: true }
    });
  },

  /** Find many submissions with custom where/select/orderBy. */
  findMany(args: Prisma.SubmissionFindManyArgs) {
    return prisma.submission.findMany(args);
  },

  /** Group submissions by user and problem (progress matrix). */
  groupByUserAndProblem(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.groupBy({
      by: ["userId", "problemId"],
      where,
      _max: { score: true },
      _count: { id: true }
    });
  },

  /** Group accepted submissions by problemId. */
  groupAcceptedByProblem(problemIds: string[]) {
    return prisma.submission.groupBy({
      by: ["problemId"],
      _count: true,
      where: { problemId: { in: problemIds }, status: "accepted" }
    });
  },

  /** Group submissions by problemId and status for a user. */
  groupByProblemAndStatus(userId: string, problemIds: string[]) {
    return prisma.submission.groupBy({
      by: ["problemId", "status"],
      _count: true,
      where: {
        problemId: { in: problemIds },
        sampleOnly: false,
        userId
      }
    });
  },

  /** Find submissions for contest scoreboard. */
  findForContestScoreboard(participationIds: string[]) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        contestParticipation: { select: { userId: true } },
        createdAt: true,
        problemId: true,
        score: true,
        status: true
      },
      where: {
        contestParticipationId: { in: participationIds },
        sampleOnly: false
      }
    });
  },

  /** Find submissions for contest chart data. */
  findForContestChart(participationIds: string[]) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        contestParticipationId: true,
        createdAt: true,
        problemId: true,
        score: true,
        status: true
      },
      where: {
        contestParticipationId: { in: participationIds },
        sampleOnly: false
      }
    });
  },

  /** Find submissions for a contest participation (scoring). */
  findForParticipationScoring(participationId: string) {
    return prisma.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        problemId: true,
        score: true,
        status: true
      },
      where: {
        contestParticipationId: participationId,
        sampleOnly: false
      }
    });
  },

  /** Find submissions for rejudge. */
  findForRejudge(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.findMany({
      select: {
        id: true,
        language: true,
        problem: { select: { slug: true } },
        sampleOnly: true,
        sourceCode: true
      },
      where
    });
  },

  /** Find submissions for plagiarism check. */
  findForPlagiarism(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.findMany({
      where,
      select: {
        id: true,
        language: true,
        problemId: true,
        score: true,
        sourceCode: true,
        userId: true
      },
      orderBy: { score: "desc" }
    });
  },

  /** Recent submissions for dashboard. */
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
        problem: { select: { slug: true, defaultTitle: true } }
      }
    });
  },

  /** Find distinct AC'd problems for a user (dashboard recommendations). */
  findDistinctAcByUser(userId: string) {
    return prisma.submission.findMany({
      where: { userId, status: "accepted", sampleOnly: false },
      select: { problemId: true, problem: { select: { tags: true } } },
      distinct: ["problemId"] as const
    });
  },

  /** Find recent error submissions (admin panel). */
  findRecentErrors(take: number) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        status: {
          in: ["compile_error", "runtime_error", "time_limit_exceeded", "memory_limit_exceeded"]
        }
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        status: true,
        language: true,
        createdAt: true,
        user: { select: { username: true, name: true } },
        problem: { select: { slug: true, defaultTitle: true } }
      }
    });
  },

  /** Find submissions in a date range (admin stats). */
  findInDateRange(from: Date) {
    return prisma.submission.findMany({
      where: { sampleOnly: false, createdAt: { gte: from } },
      select: { createdAt: true, status: true }
    });
  },

  /** Group submissions by status in a date range (admin stats). */
  groupByStatus(from: Date) {
    return prisma.submission.groupBy({
      by: ["status"],
      where: { sampleOnly: false, createdAt: { gte: from } },
      _count: { _all: true }
    });
  },

  /** Find submissions for a course in specific assessments (manage analytics). */
  findByCourseAndAssessments(courseSlug: string, assessmentIds: string[]) {
    return prisma.submission.findMany({
      where: {
        course: { slug: courseSlug },
        sampleOnly: false,
        courseAssessmentId: { in: assessmentIds }
      },
      select: {
        courseAssessmentId: true,
        userId: true,
        status: true,
        score: true,
        problemId: true,
        createdAt: true
      }
    });
  },

  /** Find submissions for a course with assessment details (teacher overview). */
  findByCourseSlugsWith7dStats(courseSlugs: string[], from: Date) {
    return prisma.submission.findMany({
      where: {
        sampleOnly: false,
        createdAt: { gte: from },
        course: { slug: { in: courseSlugs } },
        courseAssessmentId: { not: null }
      },
      select: {
        status: true,
        courseAssessmentId: true,
        courseAssessment: {
          select: {
            slug: true,
            title: true,
            course: { select: { slug: true, title: true } }
          }
        }
      }
    });
  },

  /** Group best scores by user/problem (export CSV). */
  groupBestScores(opts: {
    assessmentId: string;
    studentIds: string[];
    problemIds: string[];
  }) {
    if (opts.studentIds.length === 0 || opts.problemIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ["userId", "problemId"],
      _max: { score: true },
      where: {
        courseAssessmentId: opts.assessmentId,
        sampleOnly: false,
        userId: { in: opts.studentIds },
        problemId: { in: opts.problemIds }
      }
    });
  },

  /** Group failing submissions by problem (admin stats). */
  groupFailuresByProblem(from: Date, take: number) {
    return prisma.submission.groupBy({
      by: ["problemId"],
      where: {
        sampleOnly: false,
        createdAt: { gte: from },
        status: {
          in: ["compile_error", "runtime_error", "time_limit_exceeded", "memory_limit_exceeded"]
        }
      },
      _count: { _all: true },
      orderBy: { _count: { problemId: "desc" } },
      take
    });
  },

  updateStatus(id: string, status: string) {
    return prisma.submission.update({
      data: { status } as Prisma.SubmissionUncheckedUpdateInput,
      where: { id }
    });
  },

  /** Complete a submission with full verdict data. */
  complete(id: string, data: Prisma.SubmissionUpdateInput) {
    return prisma.submission.update({
      data,
      include: { problem: { select: { slug: true } } },
      where: { id }
    });
  },

  create(data: Prisma.SubmissionCreateInput) {
    return prisma.submission.create({ data });
  },

  // ── Transaction variants ──

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.submission.findUnique({ where: { id } });
      },

      count(where: Prisma.SubmissionWhereInput) {
        return tx.submission.count({ where });
      },

      findMostRecent(where: Prisma.SubmissionWhereInput, select?: Prisma.SubmissionSelect) {
        return tx.submission.findFirst({
          where,
          orderBy: { createdAt: "desc" },
          select: select ?? { createdAt: true }
        });
      },

      create(data: Prisma.SubmissionUncheckedCreateInput) {
        return tx.submission.create({ data });
      }
    };
  }
};
