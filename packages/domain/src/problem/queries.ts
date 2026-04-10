import {
  problemRepo,
  problemStatementRepo,
  submissionRepo,
  testcaseSetRepo,
  type Prisma
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
  type ProblemVisibility
} from "@nojv/core";

import { pickProblemStatement } from "../shared/pick-problem-statement";

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
  samples: { stdin: string; expected: string }[];
  starterByLanguage: Record<string, string>;
  statement: string;
  status: ProblemStatus;
  tags: string[];
  timeLimitMs: number;
  title: string;
  totalSubmissions: number;
  visibility: ProblemVisibility;
  // Hidden files ship with `content === ""`; raw hidden content must never leave the server.
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    editableRegions: [number, number][] | null;
    description: string;
  }[];
  advancedImageRef: string | null;
  advancedImageSource: ProblemImageSource | null;
  networkEnabled: boolean;
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
  python: ``
};

// Difficulty lives inside `Problem.tags` as one of "easy" / "medium" / "hard".
function pickDifficultyFromTags(tags: string[]): ProblemDifficulty {
  for (const tag of tags) {
    const parsed = problemDifficultySchema.safeParse(tag);
    if (parsed.success) return parsed.data;
  }
  return "medium";
}

function buildProblemSamples(problem: {
  samples?: unknown;
}): { stdin: string; expected: string }[] {
  if (!Array.isArray(problem.samples)) return [];
  return problem.samples
    .filter(
      (s): s is { stdin: string; expected: string } =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as { stdin?: unknown }).stdin === "string" &&
        typeof (s as { expected?: unknown }).expected === "string"
    )
    .map((s) => ({ stdin: s.stdin, expected: s.expected }));
}

// Per language: use the first editable workspace file if any, else the hardcoded stub.
function buildStarterByLanguage(
  workspaceFiles: { language: string; path: string; visibility: string; content: string }[] = []
): Record<string, string> {
  const result: Record<string, string> = { ...starterByLanguage };
  for (const lang of Object.keys(result)) {
    const first = workspaceFiles.find(
      (f) => f.language === lang && f.visibility === "editable"
    );
    if (first) {
      result[lang] = first.content;
    }
  }
  return result;
}

// `editableRegions` is `Json?` at the DB layer; return null (whole-file editable) on bad input.
function parseEditableRegions(raw: unknown): [number, number][] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const result: [number, number][] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [start, end] = entry as [unknown, unknown];
    if (typeof start !== "number" || typeof end !== "number") return null;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 1 || end < start) return null;
    result.push([start, end]);
  }
  return result;
}

function mapPersistedProblemDetail(
  problem: {
    author?: { username: string | null } | null;
    title: string;
    id: string;
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
    networkEnabled?: boolean;
    advancedImageRef?: string | null;
    advancedImageSource?: ProblemImageSource | null;
    workspaceFiles?: {
      language: string;
      path: string;
      content: string;
      visibility: string;
      editableRegions?: unknown;
      orderIndex?: number;
      description?: string;
    }[];
  },
  locale: string,
  totalSubmissions: number,
  acceptedCount: number
): ProblemDetail {
  const tags = problem.tags ?? [];
  const localized = pickProblemStatement(problem.statements, locale, problem.title, "");

  const judgeConfig: JudgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
    type: "standard"
  };

  // SECURITY: hidden workspace files are kept in the list so the client can
  // render their metadata (path, language, description) but their `content`
  // is blanked out. Raw hidden content must never leave the server — the
  // judge pipeline reads it from the DB directly at judging time.
  const visibleWorkspaceFiles = (problem.workspaceFiles ?? []).map((f) => {
    const visibility = f.visibility as "editable" | "readonly" | "hidden";
    return {
      language: f.language,
      path: f.path,
      content: visibility === "hidden" ? "" : f.content,
      visibility,
      editableRegions: parseEditableRegions(f.editableRegions),
      description: f.description ?? ""
    };
  });

  return {
    acceptanceRate: totalSubmissions > 0 ? acceptedCount / totalSubmissions : 0,
    authorUsername: problem.author?.username ?? "course_staff",
    difficulty: pickDifficultyFromTags(tags),
    id: problem.id,
    inputFormat: localized.inputFormat,
    judgeConfig,
    judgeType: judgeConfig.type,
    memoryLimitMb: problem.memoryLimitMb ?? 256,
    outputFormat: localized.outputFormat,
    type: problem.type ?? "full_source",
    samples: buildProblemSamples(problem),
    starterByLanguage: buildStarterByLanguage(problem.workspaceFiles ?? []),
    statement: localized.statement,
    status: (problem.status as ProblemStatus | undefined) ?? "published",
    tags,
    timeLimitMs: problem.timeLimitMs ?? 1_000,
    title: localized.title,
    totalSubmissions,
    visibility: problem.visibility,
    workspaceFiles: visibleWorkspaceFiles,
    advancedImageRef: problem.advancedImageRef ?? null,
    advancedImageSource: problem.advancedImageSource ?? null,
    networkEnabled: problem.networkEnabled ?? false
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
  difficulty: string;
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
  params: ProblemListParams = {}
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
      problemStatementRepo.likeSearch(q)
    ]);
    const allIds = new Set([
      ...matchingRows.map((r) => r.problemId),
      ...likeRows.map((r) => r.problemId)
    ]);
    where.id = { in: [...allIds] };
  }

  // Difficulty filter — difficulty is now stored as a tag.
  if (params.difficulty && params.difficulty !== "all") {
    where.tags = { has: params.difficulty };
  }

  // Tag filter (intersected with difficulty if both are provided).
  if (params.tags && params.tags.length > 0) {
    where.tags = { hasEvery: params.tags };
  }

  // Count + fetch in parallel
  const [totalCount, persistedProblems] = await Promise.all([
    problemRepo.count(where),
    problemRepo.listWithCounts({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  const problemIds = persistedProblems.map((p) => p.id);

  // Batch-fetch accepted counts + user status in parallel
  const [acceptedCounts, userSubmissions] = await Promise.all([
    problemIds.length > 0 ? submissionRepo.groupAcceptedByProblem(problemIds) : [],
    params.userId && problemIds.length > 0
      ? submissionRepo.groupByProblemAndStatus(params.userId, problemIds)
      : []
  ]);

  const acceptedByProblemId = new Map(acceptedCounts.map((r) => [r.problemId, r._count]));

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
    const total = problem._count.submissions;
    const accepted = acceptedByProblemId.get(problem.id) ?? 0;
    const judgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
      type: "standard" as const
    };
    return {
      acceptanceRate: total > 0 ? accepted / total : 0,
      difficulty: pickDifficultyFromTags(problem.tags),
      id: problem.id,
      judgeType: judgeConfig.type,
      type: problem.type,
      status: statusByProblemId.get(problem.id) ?? null,
      tags: problem.tags,
      title: problem.title,
      totalSubmissions: total
    };
  });

  return { page, pageSize, problems, totalCount };
}

export async function listEditableProblems(userId: string) {
  const problems = await problemRepo.listEditable(userId);

  return problems.map((problem) => {
    const judgeConfig = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
      type: "standard" as const
    };
    return {
      difficulty: pickDifficultyFromTags(problem.tags),
      id: problem.id,
      judgeType: judgeConfig.type,
      type: problem.type,
      status: problem.status,
      tags: problem.tags,
      title: problem.title,
      visibility: problem.visibility
    };
  });
}

export async function getProblemPageData(id: string, locale: string = DEFAULT_LOCALE) {
  const persistedProblem = await problemRepo.findDetailById(id);

  if (!persistedProblem) {
    return null;
  }

  const acceptedCount = await submissionRepo.count({
    problemId: persistedProblem.id,
    status: "accepted"
  });

  return mapPersistedProblemDetail(
    persistedProblem,
    locale,
    persistedProblem._count.submissions,
    acceptedCount
  );
}

export async function getProblemTestcaseSets(problemId: string) {
  return testcaseSetRepo.findByProblemId(problemId);
}
