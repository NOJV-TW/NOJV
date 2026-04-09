import { submissionRepo } from "@nojv/db";
import type { Prisma } from "@nojv/db";
import type {
  AdjustmentRules,
  Compare,
  JudgeConfig,
  JudgeType,
  ProblemImageSource,
  ProblemJudgeTestcase,
  ProblemMode,
  ProblemSample,
  Runtime,
  SubmissionDraft,
  SubmissionResult,
  SubmissionType,
  WorkspaceFileVisibility
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { toJsonValue } from "../shared/to-json-value";

// --- Types ---

export interface TestcaseSetGroup {
  id: string;
  name: string;
  testcases: ProblemJudgeTestcase[];
  weight: number;
}

export interface WorkspaceFileEntry {
  content: string;
  editableRegions: [number, number][] | null;
  language: string;
  orderIndex: number;
  path: string;
  visibility: WorkspaceFileVisibility;
}

export type SubtaskStrategyMap = Record<string, "all_or_nothing" | "proportional" | "minimum">;

export interface AdjustmentContext {
  assessmentAdjustmentRules: AdjustmentRules | null;
  contestAdjustmentRules: AdjustmentRules | null;
  dueAt: Date | null;
  submittedAt: Date;
}

export interface AdvancedModeContext {
  imageRef: string;
  imageSource: ProblemImageSource;
  resourceLimits: {
    totalTimeMs: number;
    memoryMb: number;
    networkEnabled: boolean;
  };
  testcases: {
    stdin: string;
    expected: string;
    files: Record<string, string>;
  }[];
}

export interface SubmissionJudgeContext {
  adjustment: AdjustmentContext;
  checkerScript: string | null;
  compare: Compare | null;
  interactorScript: string | null;
  judgeType: JudgeType;
  memoryLimitMb: number;
  problemId: string;
  runtime: Runtime;
  samples: ProblemSample[];
  submissionType: SubmissionType;
  subtaskStrategies: SubtaskStrategyMap;
  testcaseSets: TestcaseSetGroup[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs: number;
  workspaceFiles: WorkspaceFileEntry[];
  /**
   * Phase 7: when the problem is in advanced mode, this carries the
   * TA-provided judge image ref + resource limits. The downstream judge
   * activity uses it to populate `SandboxRequest.advanced`.
   */
  mode: ProblemMode;
  advanced: AdvancedModeContext | null;
}

export interface CompletedSubmission {
  contestParticipationId: string | null;
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  score: number;
  status: string;
  userId: string;
}

// --- Domain functions ---

export async function getJudgeContext(submissionId: string): Promise<SubmissionJudgeContext> {
  const submission = await submissionRepo.findByIdWithJudgeContext(submissionId);

  if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);

  const { problem } = submission;
  const judgeConfig = (problem.judgeConfig as JudgeConfig | null) ?? {
    type: "standard" as const
  };

  const testcaseSets: TestcaseSetGroup[] = problem.testcaseSets.map((ts) => ({
    id: ts.id,
    name: ts.name,
    testcases: ts.testcases.map((testcase) => ({
      expectedStdout: testcase.expectedStdout ?? undefined,
      id: testcase.id,
      inputFiles: (testcase.inputFiles as Record<string, string> | null) ?? undefined,
      isHidden: true,
      stdin: testcase.stdin,
      weight: ts.weight
    })),
    weight: ts.weight
  }));

  // Samples come from Problem.samples JSON (Phase 1 column).
  const samples = collectSamples(problem);

  // Runtime: authoritative source is judgeConfig.runtime. Legacy problems
  // fall back to Problem.timeLimitMs / memoryLimitMb.
  const runtime: Runtime = judgeConfig.runtime ?? {
    env: {},
    memoryLimitMb: problem.memoryLimitMb,
    timeLimitMs: problem.timeLimitMs
  };

  const subtaskStrategies: SubtaskStrategyMap =
    (judgeConfig.scoring?.subtaskStrategies as SubtaskStrategyMap | undefined) ?? {};

  const workspaceFiles: WorkspaceFileEntry[] = problem.workspaceFiles.map((f) => ({
    content: f.content,
    editableRegions: (f.editableRegions as [number, number][] | null) ?? null,
    language: f.language,
    orderIndex: f.orderIndex,
    path: f.path,
    visibility: f.visibility as WorkspaceFileVisibility
  }));

  const assessment = submission.courseAssessment;
  const contest = submission.contestParticipation?.contest ?? null;

  const adjustment: AdjustmentContext = {
    assessmentAdjustmentRules: (assessment?.adjustmentRules as AdjustmentRules | null) ?? null,
    contestAdjustmentRules: (contest?.adjustmentRules as AdjustmentRules | null) ?? null,
    dueAt: assessment?.dueAt ?? contest?.endsAt ?? null,
    submittedAt: submission.createdAt
  };

  // Phase 7: surface advanced-mode container config when the problem is in
  // advanced mode. Reads Problem.advancedResourceLimits if set, otherwise
  // falls back to safe defaults.
  const mode: ProblemMode = problem.mode;
  const parsedLimits = parseAdvancedResourceLimits(problem.advancedResourceLimits);
  const advancedTestcases = problem.advancedTestcases.map((c) => ({
    stdin: c.stdin,
    expected: c.expected,
    files: (c.files as Record<string, string> | null) ?? {}
  }));
  const advanced: AdvancedModeContext | null =
    mode === "advanced" && problem.advancedImageRef && problem.advancedImageSource
      ? {
          imageRef: problem.advancedImageRef,
          imageSource: problem.advancedImageSource as ProblemImageSource,
          resourceLimits: parsedLimits ?? {
            totalTimeMs: 30_000,
            memoryMb: 1_024,
            networkEnabled: false
          },
          testcases: advancedTestcases
        }
      : null;

  return {
    adjustment,
    checkerScript: judgeConfig.checkerScript ?? null,
    compare: judgeConfig.compare ?? null,
    interactorScript: judgeConfig.interactorScript ?? null,
    judgeType: judgeConfig.type,
    memoryLimitMb: runtime.memoryLimitMb,
    problemId: submission.problemId,
    runtime,
    samples,
    submissionType: problem.submissionType,
    subtaskStrategies,
    testcaseSets,
    testcases: testcaseSets.flatMap((ts) => ts.testcases),
    timeLimitMs: runtime.timeLimitMs,
    workspaceFiles,
    mode,
    advanced
  };
}

function collectSamples(problem: { samples: unknown }): ProblemSample[] {
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

export async function updateSubmissionStatus(
  submissionId: string,
  status: string
): Promise<void> {
  await submissionRepo.updateStatus(submissionId, status);
}

export async function completeJudge(
  submissionId: string,
  result: SubmissionResult
): Promise<CompletedSubmission> {
  const submission = await submissionRepo.complete(submissionId, {
    compilerOutput: result.verdict === "compile_error" ? result.feedback : null,
    runtimeMs: result.runtimeMs,
    score: result.score,
    status: result.verdict,
    verdictDetail: toJsonValue(result),
    ...(result.subtaskResults ? { subtaskResults: toJsonValue(result.subtaskResults) } : {})
  });

  return {
    contestParticipationId: submission.contestParticipationId,
    id: submission.id,
    language: submission.language,
    problemId: submission.problemId,
    sampleOnly: submission.sampleOnly,
    score: submission.score,
    status: submission.status,
    userId: submission.userId
  };
}

export async function findForRejudge(input: {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
}): Promise<{ submissionId: string; draft: SubmissionDraft }[]> {
  const where: Prisma.SubmissionWhereInput = {
    problemId: input.problemId,
    sampleOnly: false
  };

  if (input.contestId) {
    where.contestParticipation = { contestId: input.contestId };
  }
  if (input.assessmentId) {
    where.courseAssessmentId = input.assessmentId;
  }

  const submissions = await submissionRepo.findForRejudge(where);

  return submissions.map((s) => ({
    submissionId: s.id,
    draft: {
      language: s.language,
      problemId: s.problemId,
      sampleOnly: s.sampleOnly,
      sourceCode: s.sourceCode
    }
  }));
}
