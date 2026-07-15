import {
  Prisma,
  problemBookmarkRepo,
  problemRepo,
  problemStatementRepo,
  problemWorkspaceFileRepo,
  submissionRepo,
  testcaseSetRepo,
} from "@nojv/db";
import {
  LANGUAGE_TEMPLATES,
  advancedConfigSchema,
  judgeConfigSchema,
  judgeTypes,
  problemDifficultySchema,
  problemSampleSchema,
  type AdvancedConfig,
  type JudgeConfig,
  type JudgeType,
  type ProblemDifficulty,
  type ProblemSample,
  type ProblemStatus,
  type ProblemType,
  type ProblemVisibility,
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";

import { readWorkspaceFileBlob } from "./blobs";
import { computeProblemTotalScore } from "./total-score";

export interface ProblemDetail {
  acceptanceRate: number;
  authorUsername: string;
  difficulty: ProblemDifficulty;
  displayId: number | null;
  id: string;
  inputFormat: string;
  judgeConfig: JudgeConfig;
  judgeType: JudgeType;
  memoryLimitMb: number;
  outputFormat: string;
  type: ProblemType;
  samples: { input: string; output: string }[];
  starterByLanguage: Record<string, string>;
  statement: string;
  status: ProblemStatus;
  tags: string[];
  timeLimitMs: number;
  title: string;
  totalScore: number;
  totalSubmissions: number;
  visibility: ProblemVisibility;
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    description: string;
  }[];
  advancedConfig: AdvancedConfig | null;
  advancedRequiredPaths: string[];
}

export function buildProblemSamples(problem: { samples?: unknown }): ProblemSample[] {
  if (!Array.isArray(problem.samples)) return [];
  const samples: ProblemSample[] = [];
  for (const entry of problem.samples) {
    const parsed = problemSampleSchema.safeParse(entry);
    if (parsed.success) samples.push(parsed.data);
    if (samples.length === 5) break;
  }
  return samples;
}

export function buildStarterByLanguage(
  type: ProblemType,
  workspaceFiles: {
    language: string;
    path: string;
    visibility: string;
    content: string;
  }[] = [],
): Record<string, string> {
  const result: Record<string, string> = { ...LANGUAGE_TEMPLATES };
  if (type !== "multi_file") return result;
  for (const lang of Object.keys(result)) {
    const first = workspaceFiles.find(
      (f) => f.language === lang && f.visibility === "editable",
    );
    if (first) {
      result[lang] = first.content;
    }
  }
  return result;
}

async function mapPersistedProblemDetail(
  problem: {
    author?: { username: string | null } | null;
    title: string;
    displayId: number | null;
    id: string;
    difficulty?: ProblemDifficulty;
    judgeConfig?: unknown;
    memoryLimitMb?: number;
    samples?: unknown;
    statement?: {
      bodyMarkdown: string;
      inputFormat?: string;
      outputFormat?: string;
    } | null;
    tags?: string[];
    status?: ProblemStatus;
    timeLimitMs?: number;
    visibility: ProblemVisibility;
    type: ProblemType;
    advancedConfig?: unknown;
    advancedRequiredPaths?: string[];
    testcaseSets?: { weight: number }[];
    workspaceFiles?: {
      language: string;
      path: string;
      contentStorage: unknown;
      visibility: string;
      orderIndex?: number;
      description?: string;
    }[];
  },
  attempters: number,
  solvers: number,
): Promise<ProblemDetail> {
  const tags = problem.tags ?? [];
  const statement = problem.statement ?? null;

  const judgeConfig: JudgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
    type: "standard",
  };

  const rawFiles = problem.workspaceFiles ?? [];
  const visibleWorkspaceFiles = await Promise.all(
    rawFiles.map(async (f) => {
      const visibility = f.visibility as "editable" | "readonly" | "hidden";
      const content =
        visibility === "hidden" ? "" : await readWorkspaceFileBlob(f.contentStorage);
      return {
        language: f.language,
        path: f.path,
        content,
        visibility,
        description: f.description ?? "",
      };
    }),
  );

  const type = problem.type;

  return {
    acceptanceRate: attempters > 0 ? solvers / attempters : 0,
    totalScore: computeProblemTotalScore({
      type,
      testcaseSets: problem.testcaseSets ?? [],
      advancedConfig: problem.advancedConfig,
    }),
    authorUsername: problem.author?.username ?? "course_staff",
    difficulty: problem.difficulty ?? "medium",
    displayId: problem.displayId,
    id: problem.id,
    inputFormat: statement?.inputFormat ?? "",
    judgeConfig,
    judgeType: judgeConfig.type,
    memoryLimitMb: problem.memoryLimitMb ?? 256,
    outputFormat: statement?.outputFormat ?? "",
    type,
    samples: buildProblemSamples(problem),
    starterByLanguage: buildStarterByLanguage(type, visibleWorkspaceFiles),
    statement: statement?.bodyMarkdown ?? "",
    status: problem.status ?? "published",
    tags,
    timeLimitMs: problem.timeLimitMs ?? 1_000,
    title: problem.title,
    totalSubmissions: attempters,
    visibility: problem.visibility,
    workspaceFiles: visibleWorkspaceFiles,
    advancedConfig: advancedConfigSchema.safeParse(problem.advancedConfig).data ?? null,
    advancedRequiredPaths: problem.advancedRequiredPaths ?? [],
  };
}

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
    return [{ submissions: { some: { userId: uid, sampleOnly: false, status: "accepted" } } }];
  }
  if (status === "attempted") {
    return [
      { submissions: { some: { userId: uid, sampleOnly: false } } },
      { submissions: { none: { userId: uid, sampleOnly: false, status: "accepted" } } },
    ];
  }
  if (status === "untried") {
    return [{ submissions: { none: { userId: uid, sampleOnly: false } } }];
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
    const judgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
      type: "standard" as const,
    };
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

export async function listEditableProblems(userId: string, sort: "asc" | "desc" = "asc") {
  const problems = await problemRepo.listEditable(userId, sort);

  return problems.map((problem) => {
    const judgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
      type: "standard" as const,
    };
    return {
      difficulty: problem.difficulty,
      displayId: problem.displayId,
      id: problem.id,
      judgeType: judgeConfig.type,
      type: problem.type,
      status: problem.status,
      tags: problem.tags,
      title: problem.title,
      visibility: problem.visibility,
    };
  });
}

export async function getProblemPageData(
  id: string,
  opts?: { includeAdvancedConfig?: boolean },
) {
  const persistedProblem = await problemRepo.findDetailById(id);

  if (!persistedProblem) {
    throw new NotFoundError(`Problem not found: ${id}`);
  }

  const [stats] = await submissionRepo.countUserStatsByProblem([persistedProblem.id]);

  const detail = await mapPersistedProblemDetail(
    persistedProblem,
    stats?.attempters ?? 0,
    stats?.solvers ?? 0,
  );

  if (!opts?.includeAdvancedConfig) {
    return { ...detail, advancedConfig: null };
  }

  return detail;
}

export async function getProblemTestcaseSets(problemId: string) {
  return testcaseSetRepo.findByProblemId(problemId);
}

export async function getProblemRowById(id: string) {
  return problemRepo.findById(id);
}

export async function listProblemWorkspaceFiles(problemId: string) {
  return problemWorkspaceFileRepo.findByProblemId(problemId);
}
