import {
  Prisma,
  problemBookmarkRepo,
  problemRepo,
  problemStatementRepo,
  submissionRepo,
} from "@nojv/db";
import {
  judgeTypes,
  problemDifficultySchema,
  type JudgeType,
  type ProblemDifficulty,
  type ProblemType,
} from "@nojv/core";
import { parsePersistedJudgeConfig } from "./judge-config";

export type ProblemStatusFilter = "solved" | "attempted" | "untried" | "bookmarked";

export interface ProblemListParams {
  difficulty?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  q?: string | undefined;
  sort?: "asc" | "desc" | undefined;
  tags?: string[] | undefined;
  types?: ProblemType[] | undefined;
  judgeMethods?: JudgeType[] | undefined;
  status?: ProblemStatusFilter | undefined;
  userId?: string | null | undefined;
}

export type ProblemUserStatus = "ac" | "attempted" | null;

export interface ProblemCardWithStatus {
  acceptanceRate: number;
  bookmarked: boolean;
  difficulty: ProblemDifficulty;
  displayId: number | null;
  id: string;
  judgeType: JudgeType;
  type: ProblemType;
  status: ProblemUserStatus;
  tags: string[];
  title: string;
  totalSubmissions: number;
}

export interface ProblemStatusCounts {
  all: number;
  solved: number;
  attempted: number;
  untried: number;
  bookmarked: number;
}

export interface ProblemListResult {
  page: number;
  pageSize: number;
  problems: ProblemCardWithStatus[];
  totalCount: number;
  statusCounts: ProblemStatusCounts | null;
}

function buildJudgeMethodClauses(judgeMethods: JudgeType[]): Prisma.ProblemWhereInput[] {
  if (judgeMethods.length === 0 || judgeMethods.length >= judgeTypes.length) return [];
  const or: Prisma.ProblemWhereInput[] = [];
  for (const jm of judgeMethods) {
    if (jm === "standard") {
      or.push(
        { judgeConfig: { equals: Prisma.DbNull } },
        { judgeConfig: { path: ["type"], equals: "standard" } },
      );
    } else {
      or.push({ judgeConfig: { path: ["type"], equals: jm } });
    }
  }
  return [{ type: { not: "special_env" } }, { OR: or }];
}

function buildStatusClauses(
  uid: string,
  status: ProblemStatusFilter,
): Prisma.ProblemWhereInput[] {
  if (status === "solved") {
    return [
      {
        submissions: {
          some: {
            userId: uid,
            sampleOnly: false,
            isReferenceSolution: false,
            status: "accepted",
          },
        },
      },
    ];
  }
  if (status === "attempted") {
    return [
      {
        submissions: { some: { userId: uid, sampleOnly: false, isReferenceSolution: false } },
      },
      {
        submissions: {
          none: {
            userId: uid,
            sampleOnly: false,
            isReferenceSolution: false,
            status: "accepted",
          },
        },
      },
    ];
  }
  if (status === "untried") {
    return [
      {
        submissions: { none: { userId: uid, sampleOnly: false, isReferenceSolution: false } },
      },
    ];
  }
  return [{ bookmarks: { some: { userId: uid } } }];
}

async function buildProblemListWhere(
  params: ProblemListParams,
): Promise<Prisma.ProblemWhereInput> {
  const where: Prisma.ProblemWhereInput = { visibility: "public", status: "published" };

  if (params.q && params.q.trim().length > 0) {
    const q = params.q.trim();
    const matchingRows = await problemStatementRepo.fullTextSearch(q);
    const matchedIds =
      matchingRows.length > 0
        ? matchingRows.map((r) => r.problemId)
        : (await problemStatementRepo.likeSearch(q)).map((r) => r.problemId);
    where.id = { in: [...new Set(matchedIds)] };
  }

  if (params.difficulty && params.difficulty !== "all") {
    const parsed = problemDifficultySchema.safeParse(params.difficulty);
    if (parsed.success) where.difficulty = parsed.data;
  }

  if (params.tags && params.tags.length > 0) {
    where.tags = { hasEvery: params.tags };
  }

  const and: Prisma.ProblemWhereInput[] = [];

  if (params.types && params.types.length > 0) {
    where.type = { in: params.types };
  }

  if (params.judgeMethods) {
    and.push(...buildJudgeMethodClauses(params.judgeMethods));
  }

  if (params.userId && params.status) {
    and.push(...buildStatusClauses(params.userId, params.status));
  }

  if (and.length > 0) where.AND = and;

  return where;
}

export async function listProblemCards(
  params: ProblemListParams = {},
): Promise<ProblemListResult> {
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));
  const page = Math.max(1, params.page ?? 1);

  const where = await buildProblemListWhere(params);

  const [totalCount, persistedProblems, statusCounts] = await Promise.all([
    problemRepo.count(where),
    problemRepo.listWithCounts({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      sort: params.sort,
    }),
    computeStatusCounts(params.userId),
  ]);

  const problemIds = persistedProblems.map((p) => p.id);

  const [userStats, userSubmissions, bookmarkedIds] = await Promise.all([
    submissionRepo.countUserStatsByProblem(problemIds),
    params.userId && problemIds.length > 0
      ? submissionRepo.groupByProblemAndStatus(params.userId, problemIds)
      : [],
    params.userId
      ? problemBookmarkRepo.listBookmarkedIds(params.userId, problemIds)
      : new Set<string>(),
  ]);

  const statsByProblemId = new Map(
    userStats.map((r) => [r.problemId, { attempters: r.attempters, solvers: r.solvers }]),
  );

  const statusByProblemId = new Map<string, ProblemUserStatus>();
  for (const row of userSubmissions) {
    const current = statusByProblemId.get(row.problemId);
    if (row.status === "accepted") {
      statusByProblemId.set(row.problemId, "ac");
    } else if (current !== "ac") {
      statusByProblemId.set(row.problemId, "attempted");
    }
  }

  const problems: ProblemCardWithStatus[] = persistedProblems.map((problem) => {
    const stats = statsByProblemId.get(problem.id);
    const attempters = stats?.attempters ?? 0;
    const solvers = stats?.solvers ?? 0;
    const judgeConfig = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);
    return {
      acceptanceRate: attempters > 0 ? solvers / attempters : 0,
      bookmarked: bookmarkedIds.has(problem.id),
      difficulty: problem.difficulty,
      displayId: problem.displayId,
      id: problem.id,
      judgeType: judgeConfig.type,
      type: problem.type,
      status: statusByProblemId.get(problem.id) ?? null,
      tags: problem.tags,
      title: problem.title,
      totalSubmissions: attempters,
    };
  });

  return { page, pageSize, problems, totalCount, statusCounts };
}

async function computeStatusCounts(
  userId: string | null | undefined,
): Promise<ProblemStatusCounts | null> {
  if (!userId) return null;
  const { all, solved, attempted, bookmarked } =
    await submissionRepo.countProblemStatusSummaryForUser(userId);
  return { all, solved, attempted, untried: all - solved - attempted, bookmarked };
}

export async function listAdminProblems(sort: "asc" | "desc" = "asc") {
  const problems = await problemRepo.listAllForAdmin(sort);

  return problems.map((problem) => {
    const judgeConfig = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);
    return {
      authorUsername: problem.author.username ?? "",
      difficulty: problem.difficulty,
      displayId: problem.displayId,
      id: problem.id,
      judgeType: judgeConfig.type,
      type: problem.type,
      status: problem.status,
      tags: problem.tags,
      title: problem.title,
      visibility: problem.visibility,
      adminMayPublish: problem.adminMayPublish,
    };
  });
}
