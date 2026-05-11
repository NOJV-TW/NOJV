import { submissionRepo } from "@nojv/db";
import type { Prisma, SubtaskScoringStrategy } from "@nojv/db";
import { adjustmentRulesSchema, judgeConfigSchema } from "@nojv/core";
import type {
  AdjustmentRules,
  JudgeConfig,
  JudgeType,
  ProblemImageSource,
  ProblemJudgeTestcase,
  ProblemSample,
  ProblemType,
  Runtime,
  SubmissionDraft,
  SubmissionResult,
  WorkspaceFileVisibility,
} from "@nojv/core";
import { z } from "zod";

import { readTestcaseBlobs, readWorkspaceFileBlob } from "../problem/blobs";
import { NotFoundError } from "../shared/errors";
import { toJsonValue } from "../shared/to-json-value";

const inputFileKeysSchema = z.record(z.string(), z.string());

const DEFAULT_JUDGE_CONFIG: JudgeConfig = { type: "standard" };

function parseJudgeConfig(raw: unknown, submissionId: string): JudgeConfig {
  if (raw == null) return DEFAULT_JUDGE_CONFIG;
  const result = judgeConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[judge-context] Invalid judgeConfig for submission ${submissionId}; falling back to default.`,
    result.error.issues,
  );
  return DEFAULT_JUDGE_CONFIG;
}

function parseAdjustmentRules(raw: unknown, submissionId: string): AdjustmentRules | null {
  if (raw == null) return null;
  const result = adjustmentRulesSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[judge-context] Invalid adjustmentRules on assessment for submission ${submissionId}; ignoring.`,
    result.error.issues,
  );
  return null;
}

function parseInputFileKeys(raw: unknown, testcaseId: string): Record<string, string> | null {
  if (raw == null) return null;
  const result = inputFileKeysSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[judge-context] Invalid inputFileKeys for testcase ${testcaseId}; treating as empty.`,
    result.error.issues,
  );
  return null;
}

export interface TestcaseSetGroup {
  id: string;
  name: string;
  testcases: ProblemJudgeTestcase[];
  weight: number;
}

export interface WorkspaceFileEntry {
  content: string;
  language: string;
  path: string;
  visibility: WorkspaceFileVisibility;
}

export type SubtaskStrategyMap = Record<string, SubtaskScoringStrategy>;

export interface AdjustmentContext {
  assessmentAdjustmentRules: AdjustmentRules | null;
  dueAt: Date | null;
  /** Hard close of the owning assessment — used by `flat_late_penalty` / `daily_late_penalty` (`startFrom: "final_day"`) and by `final_day_zero`. */
  finalDay: Date | null;
  submittedAt: Date;
}

export interface AdvancedModeContext {
  imageRef: string;
  imageSource: ProblemImageSource;
  resourceLimits: {
    totalTimeMs: number;
    memoryMb: number;
  };
}

export interface SubmissionJudgeContext {
  adjustment: AdjustmentContext;
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: JudgeType;
  runtime: Runtime;
  samples: ProblemSample[];
  problemType: ProblemType;
  subtaskStrategies: SubtaskStrategyMap;
  testcaseSets: TestcaseSetGroup[];
  workspaceFiles: WorkspaceFileEntry[];
  /** Non-null only when `problemType === "special_env"`. */
  advanced: AdvancedModeContext | null;
}

/** Derive whether this submission runs in standard or advanced (custom-image) sandbox mode. */
export function deriveJudgeMode(
  context: Pick<SubmissionJudgeContext, "problemType" | "advanced">,
): "standard" | "advanced" {
  return context.problemType === "special_env" && context.advanced !== null
    ? "advanced"
    : "standard";
}

export interface CompletedSubmission {
  contestParticipationId: string | null;
  createdAt: Date;
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  score: number;
  status: string;
  userId: string;
}

export async function getJudgeContext(submissionId: string): Promise<SubmissionJudgeContext> {
  const submission = await submissionRepo.findByIdWithJudgeContext(submissionId);

  if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);

  const { problem } = submission;
  const judgeConfig = parseJudgeConfig(problem.judgeConfig, submissionId);

  const testcaseSets: TestcaseSetGroup[] = await Promise.all(
    problem.testcaseSets.map(async (ts) => {
      const testcases = await Promise.all(
        ts.testcases.map(async (testcase): Promise<ProblemJudgeTestcase> => {
          const blobs = await readTestcaseBlobs({
            inputKey: testcase.inputKey,
            outputKey: testcase.outputKey,
            inputFileKeys: parseInputFileKeys(testcase.inputFileKeys, testcase.id),
          });
          return {
            id: testcase.id,
            input: blobs.input,
            ...(blobs.output !== undefined ? { output: blobs.output } : {}),
            ...(blobs.inputFiles !== undefined ? { inputFiles: blobs.inputFiles } : {}),
            weight: ts.weight,
          };
        }),
      );
      return {
        id: ts.id,
        name: ts.name,
        testcases,
        weight: ts.weight,
      };
    }),
  );

  const samples = collectSamples(problem);

  // Legacy problems without judgeConfig.runtime fall back to Problem columns.
  const runtime: Runtime = judgeConfig.runtime ?? {
    env: {},
    memoryLimitMb: problem.memoryLimitMb,
    timeLimitMs: problem.timeLimitMs,
  };

  const subtaskStrategies: SubtaskStrategyMap = Object.fromEntries(
    problem.testcaseSets.map((ts) => [ts.id, ts.scoringStrategy]),
  );

  const workspaceFiles: WorkspaceFileEntry[] = await Promise.all(
    problem.workspaceFiles.map(
      async (f): Promise<WorkspaceFileEntry> => ({
        content: await readWorkspaceFileBlob(f.contentKey),
        language: f.language,
        path: f.path,
        visibility: f.visibility,
      }),
    ),
  );

  const assessment = submission.courseAssessment;

  // Adjustment rules are assessment-only; contest endsAt is a fallback due-by.
  const contestEnd = submission.contestParticipation?.contest.endsAt ?? null;
  const adjustment: AdjustmentContext = {
    assessmentAdjustmentRules: assessment
      ? parseAdjustmentRules(assessment.adjustmentRules, submissionId)
      : null,
    dueAt: assessment?.dueAt ?? contestEnd,
    finalDay: assessment?.closesAt ?? contestEnd,
    submittedAt: submission.createdAt,
  };

  const problemType = problem.type;
  const advanced: AdvancedModeContext | null =
    problemType === "special_env" && problem.advancedImageRef && problem.advancedImageSource
      ? {
          imageRef: problem.advancedImageRef,
          imageSource: problem.advancedImageSource,
          resourceLimits: {
            totalTimeMs: problem.timeLimitMs,
            memoryMb: problem.memoryLimitMb,
          },
        }
      : null;

  return {
    adjustment,
    checkerScript: judgeConfig.checkerScript ?? null,
    interactorScript: judgeConfig.interactorScript ?? null,
    judgeType: judgeConfig.type,
    runtime,
    samples,
    problemType,
    subtaskStrategies,
    testcaseSets,
    workspaceFiles,
    advanced,
  };
}

function collectSamples(problem: { samples: unknown }): ProblemSample[] {
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

export async function updateSubmissionStatus(
  submissionId: string,
  status: string,
): Promise<void> {
  await submissionRepo.updateStatus(submissionId, status);
}

export async function completeJudge(
  submissionId: string,
  result: SubmissionResult,
): Promise<CompletedSubmission> {
  const submission = await submissionRepo.complete(submissionId, {
    runtimeMs: result.runtimeMs,
    score: result.score,
    status: result.verdict,
    verdictDetail: toJsonValue(result),
  });

  return {
    contestParticipationId: submission.contestParticipationId,
    createdAt: submission.createdAt,
    id: submission.id,
    language: submission.language,
    problemId: submission.problemId,
    sampleOnly: submission.sampleOnly,
    score: submission.score,
    status: submission.status,
    userId: submission.userId,
  };
}

export async function findForRejudge(input: {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
  examId?: string;
  userIds?: string[];
  since?: Date;
  until?: Date;
}): Promise<{ submissionId: string; draft: SubmissionDraft }[]> {
  const where: Prisma.SubmissionWhereInput = {
    problemId: input.problemId,
    sampleOnly: false,
  };

  if (input.contestId) {
    where.contestId = input.contestId;
  }
  if (input.assessmentId) {
    where.courseAssessmentId = input.assessmentId;
  }
  if (input.examId) {
    where.examId = input.examId;
  }
  if (input.userIds && input.userIds.length > 0) {
    where.userId = { in: input.userIds };
  }
  if (input.since || input.until) {
    where.createdAt = {
      ...(input.since ? { gte: input.since } : {}),
      ...(input.until ? { lte: input.until } : {}),
    };
  }

  const submissions = await submissionRepo.findForRejudge(where);

  return submissions.map((s) => ({
    submissionId: s.id,
    draft: {
      language: s.language,
      problemId: s.problemId,
      sampleOnly: s.sampleOnly,
      sourceCode: s.sourceCode,
    },
  }));
}

export async function findOneForRejudge(
  submissionId: string,
): Promise<{ submissionId: string; draft: SubmissionDraft } | null> {
  const submission = await submissionRepo.findById(submissionId);
  if (!submission) return null;
  return {
    submissionId: submission.id,
    draft: {
      language: submission.language,
      problemId: submission.problemId,
      sampleOnly: submission.sampleOnly,
      sourceCode: submission.sourceCode,
    },
  };
}
