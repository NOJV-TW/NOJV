import {
  problemRepo,
  problemStatementRepo,
  submissionRepo,
  testcaseSetRepo,
  type Prisma
} from "@nojv/db";
import {
  DEFAULT_LOCALE,
  deriveProblemType,
  judgeConfigSchema,
  problemDifficultySchema,
  submissionTypeSchema,
  type JudgeConfig,
  type JudgeType,
  type ProblemDifficulty,
  type ProblemImageSource,
  type ProblemMode,
  type ProblemStatus,
  type ProblemType,
  type ProblemVisibility,
  type SubmissionType
} from "@nojv/core";

// ─── Types ──────────────────────────────────────────────────────────

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
  /**
   * Derived, UI-facing category for the problem shape. Replaces the
   * legacy `mode` + `submissionType` pair on the client — `special_env`
   * is equivalent to the DB's `mode === "advanced"`, and the other
   * three categories carry all the distinctions that used to live in
   * `submissionType` plus the multi-file signal.
   */
  problemType: ProblemType;
  samples: { stdin: string; expected: string }[];
  starterByLanguage: Record<string, string>;
  statement: string;
  status: ProblemStatus;
  submissionType: SubmissionType;
  summary: string;
  tags: string[];
  timeLimitMs: number;
  title: string;
  totalSubmissions: number;
  visibility: ProblemVisibility;
  /**
   * Workspace files for the student editor. `"hidden"` files are included
   * (so the UI can show their metadata, e.g. description) but their `content`
   * is always `""` — raw hidden content must never leave the server. The
   * judge pipeline reads hidden content directly from the DB.
   */
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    editableRegions: [number, number][] | null;
    description: string;
  }[];
  // Phase 7: advanced-mode metadata
  advancedImageRef: string | null;
  advancedImageSource: ProblemImageSource | null;
  advancedResourceLimits: {
    totalTimeMs: number;
    memoryMb: number;
    networkEnabled: boolean;
  } | null;
}

/**
 * Default starter code per language. Duplicated from apps/web/src/lib/types.ts
 * to avoid pulling UI-layer dependencies into the domain package.
 */
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

// ─── Schema parse helpers ───────────────────────────────────────────

const parseDifficulty = (v: unknown) => problemDifficultySchema.catch("medium").parse(v);
const parseSubmissionType = (v: unknown) => submissionTypeSchema.catch("full_source").parse(v);

import { pickProblemStatement } from "../shared/pick-problem-statement";

// ─── Internal helpers ───────────────────────────────────────────────

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

/**
 * Build the starter-code map shown in the student editor.
 *
 * For each language in the hardcoded fallback table: if the problem has at
 * least one `editable` workspace file for that language, use the content of
 * the first one (already ordered by `orderIndex`, then `path` from the repo
 * layer). Otherwise fall back to the hardcoded stub.
 *
 * The hardcoded map is retained as a fallback for problems that haven't been
 * migrated to the workspace-file model.
 */
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

/**
 * Runtime-parse `ProblemWorkspaceFile.editableRegions`. The column is
 * stored as `Json?` so we can't trust the structural type. Returns `null`
 * (whole file editable) on any malformed input.
 */
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
    defaultTitle: string;
    difficulty: string;
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
    submissionType?: string;
    summary: string;
    tags?: string[];
    status?: string;
    timeLimitMs?: number;
    visibility: ProblemVisibility;
    mode?: ProblemMode | null;
    advancedImageRef?: string | null;
    advancedImageSource?: ProblemImageSource | null;
    advancedResourceLimits?: unknown;
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
  const localized = pickProblemStatement(
    problem.statements,
    locale,
    problem.defaultTitle,
    problem.summary
  );

  const submissionType = parseSubmissionType(problem.submissionType);

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

  const problemType = deriveProblemType({
    mode: problem.mode ?? "standard",
    submissionType,
    workspaceFileCount: (problem.workspaceFiles ?? []).length
  });

  return {
    acceptanceRate: totalSubmissions > 0 ? acceptedCount / totalSubmissions : 0,
    authorUsername: problem.author?.username ?? "course_staff",
    difficulty: parseDifficulty(problem.difficulty),
    id: problem.id,
    inputFormat: localized.inputFormat,
    judgeConfig,
    judgeType: judgeConfig.type,
    memoryLimitMb: problem.memoryLimitMb ?? 256,
    outputFormat: localized.outputFormat,
    problemType,
    samples: buildProblemSamples(problem),
    starterByLanguage: buildStarterByLanguage(problem.workspaceFiles ?? []),
    statement: localized.statement,
    status: (problem.status as ProblemStatus | undefined) ?? "published",
    submissionType,
    summary: problem.summary.trim().length > 0 ? problem.summary : localized.statement,
    tags: problem.tags ?? [],
    timeLimitMs: problem.timeLimitMs ?? 1_000,
    title: localized.title,
    totalSubmissions,
    visibility: problem.visibility,
    workspaceFiles: visibleWorkspaceFiles,
    advancedImageRef: problem.advancedImageRef ?? null,
    advancedImageSource: problem.advancedImageSource ?? null,
    advancedResourceLimits: parseAdvancedResourceLimits(problem.advancedResourceLimits)
  };
}

function parseAdvancedResourceLimits(
  raw: unknown
): { totalTimeMs: number; memoryMb: number; networkEnabled: boolean } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const totalTimeMs = typeof obj.totalTimeMs === "number" ? obj.totalTimeMs : null;
  const memoryMb = typeof obj.memoryMb === "number" ? obj.memoryMb : null;
  const networkEnabled = typeof obj.networkEnabled === "boolean" ? obj.networkEnabled : null;
  if (totalTimeMs === null || memoryMb === null || networkEnabled === null) return null;
  return { totalTimeMs, memoryMb, networkEnabled };
}

// ─── Public query functions ─────────────────────────────────────────

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
  problemType: ProblemType;
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

  // Difficulty filter
  if (params.difficulty && params.difficulty !== "all") {
    where.difficulty = params.difficulty;
  }

  // Tag filter
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
    const submissionType = parseSubmissionType(problem.submissionType);
    const problemType = deriveProblemType({
      mode: problem.mode,
      submissionType,
      workspaceFileCount: problem._count.workspaceFiles
    });
    return {
      acceptanceRate: total > 0 ? accepted / total : 0,
      difficulty: parseDifficulty(problem.difficulty),
      id: problem.id,
      judgeType: judgeConfig.type,
      problemType,
      status: statusByProblemId.get(problem.id) ?? null,
      tags: problem.tags,
      title: problem.defaultTitle,
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
    const submissionType = parseSubmissionType(problem.submissionType);
    const problemType = deriveProblemType({
      mode: problem.mode,
      submissionType,
      workspaceFileCount: problem._count.workspaceFiles
    });
    return {
      difficulty: parseDifficulty(problem.difficulty),
      id: problem.id,
      judgeType: judgeConfig.type,
      problemType,
      status: problem.status,
      tags: problem.tags,
      title: problem.defaultTitle,
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
