import {
  problemRepo,
  problemStatementRepo,
  submissionRepo,
  testcaseSetRepo,
  type Prisma
} from "@nojv/db";
import {
  DEFAULT_LOCALE,
  problemDifficultySchema,
  submissionTypeSchema,
  type JudgeConfig,
  type JudgeType,
  type ProblemDifficulty,
  type ProblemStatus,
  type ProblemVisibility,
  type SubmissionType
} from "@nojv/core";

// ─── Types ──────────────────────────────────────────────────────────

export interface TemplateInfo {
  driverCode: string;
  insertionMarker: string;
  templateCode: string;
}

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
  samples: { explanation: string; input: string; output: string }[];
  starterByLanguage: Record<string, string>;
  statement: string;
  status: ProblemStatus;
  submissionType: SubmissionType;
  summary: string;
  tags: string[];
  templates: Partial<Record<string, TemplateInfo>>;
  timeLimitMs: number;
  title: string;
  totalSubmissions: number;
  visibility: ProblemVisibility;
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
  testcaseSets?: {
    isHidden: boolean;
    testcases: {
      expectedStdout: string | null;
      stdin: string;
    }[];
  }[];
}) {
  const visibleSet =
    problem.testcaseSets?.find((testcaseSet) => !testcaseSet.isHidden) ??
    problem.testcaseSets?.[0];

  if (!visibleSet || visibleSet.testcases.length === 0) {
    return [];
  }

  return visibleSet.testcases.map((tc) => ({
    explanation: "",
    input: tc.stdin,
    output: tc.expectedStdout ?? ""
  }));
}

function buildTemplatesMap(
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[]
): Partial<Record<string, TemplateInfo>> {
  const map: Partial<Record<string, TemplateInfo>> = {};

  for (const tpl of templates) {
    map[tpl.language] = {
      driverCode: tpl.driverCode,
      insertionMarker: tpl.insertionMarker,
      templateCode: tpl.templateCode
    };
  }

  return map;
}

function buildStarterByLanguage(
  submissionType: string,
  templates: {
    language: string;
    templateCode: string;
  }[]
): Record<string, string> {
  if (submissionType === "function" && templates.length > 0) {
    const starter: Record<string, string> = { ...starterByLanguage };

    for (const tpl of templates) {
      starter[tpl.language] = tpl.templateCode;
    }

    return starter;
  }

  return { ...starterByLanguage };
}

function mapPersistedProblemDetail(
  problem: {
    author?: { username: string | null } | null;
    defaultTitle: string;
    difficulty: string;
    id: string;
    judgeConfig?: unknown;
    memoryLimitMb?: number;
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
    templates?: {
      driverCode: string;
      insertionMarker: string;
      language: string;
      templateCode: string;
    }[];
    testcaseSets?: {
      isHidden: boolean;
      testcases: {
        expectedStdout: string | null;
        stdin: string;
      }[];
    }[];
    status?: string;
    timeLimitMs?: number;
    visibility: ProblemVisibility;
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
  const problemTemplates = problem.templates ?? [];

  const judgeConfig = (problem.judgeConfig as JudgeConfig | null) ?? {
    type: "standard" as const
  };

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
    samples: buildProblemSamples(problem),
    starterByLanguage: buildStarterByLanguage(submissionType, problemTemplates),
    statement: localized.statement,
    status: (problem.status as ProblemStatus | undefined) ?? "published",
    submissionType,
    summary: problem.summary.trim().length > 0 ? problem.summary : localized.statement,
    tags: problem.tags ?? [],
    templates: buildTemplatesMap(problemTemplates),
    timeLimitMs: problem.timeLimitMs ?? 1_000,
    title: localized.title,
    totalSubmissions,
    visibility: problem.visibility
  };
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
  const where: Prisma.ProblemWhereInput = { visibility: "public" };

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
    return {
      acceptanceRate: total > 0 ? accepted / total : 0,
      difficulty: parseDifficulty(problem.difficulty),
      id: problem.id,
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

  return problems.map((problem) => ({
    difficulty: parseDifficulty(problem.difficulty),
    id: problem.id,
    status: problem.status,
    tags: problem.tags,
    title: problem.defaultTitle,
    visibility: problem.visibility
  }));
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
