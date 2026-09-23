import {
  problemRepo,
  problemWorkspaceFileRepo,
  submissionRepo,
  testcaseSetRepo,
} from "@nojv/db";
import {
  LANGUAGE_TEMPLATES,
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
import { parsePersistedAdvancedConfig, parsePersistedJudgeConfig } from "./judge-config";

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
  problem: NonNullable<Awaited<ReturnType<typeof problemRepo.findDetailById>>>,
  attempters: number,
  solvers: number,
): Promise<ProblemDetail> {
  const tags = problem.tags;
  const statement = problem.statement ?? null;

  const judgeConfig: JudgeConfig = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);

  const rawFiles = problem.workspaceFiles;
  const visibleWorkspaceFiles = await Promise.all(
    rawFiles.map(async (f) => {
      const visibility = f.visibility;
      const content =
        visibility === "hidden" ? "" : await readWorkspaceFileBlob(f.contentStorage);
      return {
        language: f.language,
        path: f.path,
        content,
        visibility,
        description: f.description,
      };
    }),
  );

  const type = problem.type;

  return {
    acceptanceRate: attempters > 0 ? solvers / attempters : 0,
    totalScore: computeProblemTotalScore({
      id: problem.id,
      type,
      testcaseSets: problem.testcaseSets,
      advancedConfig: problem.advancedConfig,
    }),
    authorUsername: problem.author.username ?? "",
    difficulty: problem.difficulty,
    displayId: problem.displayId,
    id: problem.id,
    inputFormat: statement?.inputFormat ?? "",
    judgeConfig,
    judgeType: judgeConfig.type,
    memoryLimitMb: problem.memoryLimitMb,
    outputFormat: statement?.outputFormat ?? "",
    type,
    samples: buildProblemSamples(problem),
    starterByLanguage: buildStarterByLanguage(type, visibleWorkspaceFiles),
    statement: statement?.bodyMarkdown ?? "",
    status: problem.status,
    tags,
    timeLimitMs: problem.timeLimitMs,
    title: problem.title,
    totalSubmissions: attempters,
    visibility: problem.visibility,
    workspaceFiles: visibleWorkspaceFiles,
    advancedConfig: parsePersistedAdvancedConfig(problem.advancedConfig, problem.id),
    advancedRequiredPaths: problem.advancedRequiredPaths,
  };
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
