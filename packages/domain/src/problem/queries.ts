import {
  problemRepo,
  problemStatementRepo,
  problemWorkspaceFileRepo,
  submissionRepo,
  testcaseSetRepo,
  type Prisma,
} from "@nojv/db";
import {
  DEFAULT_LOCALE,
  judgeConfigSchema,
  problemDifficultySchema,
  type JudgeConfig,
  type JudgeType,
  type ProblemDifficulty,
  type ProblemImageSource,
  type ProblemStatus,
  type ProblemType,
  type ProblemVisibility,
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { pickProblemStatement } from "../shared/pick-problem-statement";

import { readWorkspaceFileBlob } from "./blobs";

export interface ProblemDetail {
  acceptanceRate: number;
  authorUsername: string;
  difficulty: ProblemDifficulty;
  id: string;
  inputFormat: string;
  judgeConfig: JudgeConfig;
  judgeType: JudgeType;
  memoryLimitMb: number;
  outputFormat: string;
  /** Direct column on Problem; the single source of truth for shape. */
  type: ProblemType;
  samples: { input: string; output: string }[];
  starterByLanguage: Record<string, string>;
  statement: string;
  status: ProblemStatus;
  tags: string[];
  timeLimitMs: number;
  title: string;
  /**
   * Number of distinct users who tried this problem (sampleOnly Run
   * dry-runs excluded). Field name is preserved for backward compat —
   * UI uses it only as a "any data yet?" guard for the AC rate label.
   * The matching `acceptanceRate` is solvers / attempters.
   */
  totalSubmissions: number;
  visibility: ProblemVisibility;
  // Hidden files ship with `content === ""`; raw hidden content must never leave the server.
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    description: string;
  }[];
  advancedImageRef: string | null;
  advancedImageSource: ProblemImageSource | null;
  advancedRequiredPaths: string[];
}

// Duplicated from apps/web/src/lib/types.ts to avoid a UI→domain import.
const starterByLanguage: Record<string, string> = {
  c: `#include <stdio.h>

int main() {

}
`,
  go: `package main

func main() {
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {

}
`,
  java: `import java.util.Scanner;

public class Main {
  public static void main(String[] args) {

  }
}
`,
  rust: `use std::io::{self, Read};

fn main() {

}
`,
  javascript: ``,
  typescript: ``,
  python: ``,
};

function buildProblemSamples(problem: {
  samples?: unknown;
}): { input: string; output: string }[] {
  if (!Array.isArray(problem.samples)) return [];
  return problem.samples
    .filter(
      (s): s is { input: string; output: string } =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as { input?: unknown }).input === "string" &&
        typeof (s as { output?: unknown }).output === "string",
    )
    .map((s) => ({ input: s.input, output: s.output }));
}

// Per language: use the first editable workspace file if any, else the hardcoded stub.
function buildStarterByLanguage(
  workspaceFiles: {
    language: string;
    path: string;
    visibility: string;
    content: string;
  }[] = [],
): Record<string, string> {
  const result: Record<string, string> = { ...starterByLanguage };
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
    id: string;
    difficulty?: ProblemDifficulty;
    judgeConfig?: unknown;
    memoryLimitMb?: number;
    samples?: unknown;
    statements?: {
      bodyMarkdown: string;
      inputFormat?: string;
      locale: string;
      outputFormat?: string;
      title: string;
    }[];
    tags?: string[];
    status?: string;
    timeLimitMs?: number;
    visibility: ProblemVisibility;
    type?: ProblemType;
    advancedImageRef?: string | null;
    advancedImageSource?: ProblemImageSource | null;
    advancedRequiredPaths?: string[];
    workspaceFiles?: {
      language: string;
      path: string;
      contentKey: string;
      visibility: string;
      orderIndex?: number;
      description?: string;
    }[];
  },
  locale: string,
  attempters: number,
  solvers: number,
): Promise<ProblemDetail> {
  const tags = problem.tags ?? [];
  const localized = pickProblemStatement(problem.statements, locale, problem.title, "");

  const judgeConfig: JudgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
    type: "standard",
  };

  // SECURITY: hidden workspace files are kept in the list so the client can
  // render their metadata (path, language, description) but their `content`
  // is blanked out. Raw hidden content must never leave the server — the
  // judge pipeline reads it from S3 directly at judging time. We only fetch
  // S3 content for non-hidden files, so we never even touch the bytes for
  // hidden ones in this code path.
  const rawFiles = problem.workspaceFiles ?? [];
  const visibleWorkspaceFiles = await Promise.all(
    rawFiles.map(async (f) => {
      const visibility = f.visibility as "editable" | "readonly" | "hidden";
      const content = visibility === "hidden" ? "" : await readWorkspaceFileBlob(f.contentKey);
      return {
        language: f.language,
        path: f.path,
        content,
        visibility,
        description: f.description ?? "",
      };
    }),
  );

  return {
    acceptanceRate: attempters > 0 ? solvers / attempters : 0,
    authorUsername: problem.author?.username ?? "course_staff",
    difficulty: problem.difficulty ?? "medium",
    id: problem.id,
    inputFormat: localized.inputFormat,
    judgeConfig,
    judgeType: judgeConfig.type,
    memoryLimitMb: problem.memoryLimitMb ?? 256,
    outputFormat: localized.outputFormat,
    type: problem.type ?? "full_source",
    samples: buildProblemSamples(problem),
    starterByLanguage: buildStarterByLanguage(visibleWorkspaceFiles),
    statement: localized.statement,
    status: (problem.status as ProblemStatus | undefined) ?? "published",
    tags,
    timeLimitMs: problem.timeLimitMs ?? 1_000,
    title: localized.title,
    totalSubmissions: attempters,
    visibility: problem.visibility,
    workspaceFiles: visibleWorkspaceFiles,
    advancedImageRef: problem.advancedImageRef ?? null,
    advancedImageSource: problem.advancedImageSource ?? null,
    advancedRequiredPaths: problem.advancedRequiredPaths ?? [],
  };
}

export interface ProblemListParams {
  difficulty?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  q?: string | undefined;
  tags?: string[] | undefined;
  userId?: string | null | undefined;
}

export type ProblemUserStatus = "ac" | "attempted" | null;

export interface ProblemCardWithStatus {
  acceptanceRate: number;
  difficulty: ProblemDifficulty;
  id: string;
  judgeType: JudgeType;
  type: ProblemType;
  status: ProblemUserStatus;
  tags: string[];
  title: string;
  totalSubmissions: number;
}

export interface ProblemListResult {
  page: number;
  pageSize: number;
  problems: ProblemCardWithStatus[];
  totalCount: number;
}

export async function listProblemCards(
  params: ProblemListParams = {},
): Promise<ProblemListResult> {
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));
  const page = Math.max(1, params.page ?? 1);

  // Build the where clause
  const where: Prisma.ProblemWhereInput = { visibility: "public", status: "published" };

  // Full-text search: find matching problem IDs via GIN index + LIKE fallback
  if (params.q && params.q.trim().length > 0) {
    const q = params.q.trim();
    const [matchingRows, likeRows] = await Promise.all([
      problemStatementRepo.fullTextSearch(q),
      problemStatementRepo.likeSearch(q),
    ]);
    const allIds = new Set([
      ...matchingRows.map((r) => r.problemId),
      ...likeRows.map((r) => r.problemId),
    ]);
    where.id = { in: [...allIds] };
  }

  // Difficulty filter — now a dedicated column.
  if (params.difficulty && params.difficulty !== "all") {
    const parsed = problemDifficultySchema.safeParse(params.difficulty);
    if (parsed.success) where.difficulty = parsed.data;
  }

  // Tag filter.
  if (params.tags && params.tags.length > 0) {
    where.tags = { hasEvery: params.tags };
  }

  // Count + fetch in parallel
  const [totalCount, persistedProblems] = await Promise.all([
    problemRepo.count(where),
    problemRepo.listWithCounts({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const problemIds = persistedProblems.map((p) => p.id);

  // Batch-fetch user-based stats + per-user status in parallel. AC rate is
  // people-based (distinct solvers / distinct attempters) so a single
  // student spamming the same problem can't tilt it.
  const [userStats, userSubmissions] = await Promise.all([
    submissionRepo.countUserStatsByProblem(problemIds),
    params.userId && problemIds.length > 0
      ? submissionRepo.groupByProblemAndStatus(params.userId, problemIds)
      : [],
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
      difficulty: problem.difficulty,
      id: problem.id,
      judgeType: judgeConfig.type,
      type: problem.type,
      status: statusByProblemId.get(problem.id) ?? null,
      tags: problem.tags,
      title: problem.title,
      totalSubmissions: attempters,
    };
  });

  return { page, pageSize, problems, totalCount };
}

export async function listEditableProblems(userId: string) {
  const problems = await problemRepo.listEditable(userId);

  return problems.map((problem) => {
    const judgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
      type: "standard" as const,
    };
    return {
      difficulty: problem.difficulty,
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

export async function getProblemPageData(id: string, locale: string = DEFAULT_LOCALE) {
  const persistedProblem = await problemRepo.findDetailById(id);

  if (!persistedProblem) {
    throw new NotFoundError(`Problem not found: ${id}`);
  }

  const [stats] = await submissionRepo.countUserStatsByProblem([persistedProblem.id]);

  return await mapPersistedProblemDetail(
    persistedProblem,
    locale,
    stats?.attempters ?? 0,
    stats?.solvers ?? 0,
  );
}

export async function getProblemTestcaseSets(problemId: string) {
  return testcaseSetRepo.findByProblemId(problemId);
}

/** Thin wrapper around `problemRepo.findById` — used where callers need the
 *  raw problem row (e.g. to pass `authorId` / `visibility` into a view-access
 *  check). Returns null when the row is missing; callers decide how to map
 *  that to a 404. */
export async function getProblemRowById(id: string) {
  return problemRepo.findById(id);
}

/** Workspace files for the edit page load. */
export async function listProblemWorkspaceFiles(problemId: string) {
  return problemWorkspaceFileRepo.findByProblemId(problemId);
}
