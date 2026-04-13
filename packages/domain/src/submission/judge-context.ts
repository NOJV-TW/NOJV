import { submissionRepo } from "@nojv/db";
import type { Prisma, SubtaskScoringStrategy } from "@nojv/db";
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
  WorkspaceFileVisibility
} from "@nojv/core";

import { readTestcaseBlobs, readWorkspaceFileBlob } from "../problem/blobs";
import { NotFoundError } from "../shared/errors";
import { toJsonValue } from "../shared/to-json-value";

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

export async function getJudgeContext(submissionId: string): Promise<SubmissionJudgeContext> {
  const submission = await submissionRepo.findByIdWithJudgeContext(submissionId);

  if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);

  const { problem } = submission;
  const judgeConfig = (problem.judgeConfig as JudgeConfig | null) ?? {
    type: "standard" as const
  };

  // Hydrate every testcase set's blobs in parallel. Each testcase row
  // carries S3 keys (inputKey / outputKey / inputFileKeys) which we read
  // back as in-memory strings here so the rest of the pipeline (worker,
  // sandbox-runner) sees the same shape it always has.
  const testcaseSets: TestcaseSetGroup[] = await Promise.all(
    problem.testcaseSets.map(async (ts) => {
      const testcases = await Promise.all(
        ts.testcases.map(async (testcase): Promise<ProblemJudgeTestcase> => {
          const blobs = await readTestcaseBlobs({
            inputKey: testcase.inputKey,
            outputKey: testcase.outputKey,
            inputFileKeys: (testcase.inputFileKeys as Record<string, string> | null) ?? null
          });
          return {
            id: testcase.id,
            input: blobs.input,
            ...(blobs.output !== undefined ? { output: blobs.output } : {}),
            ...(blobs.inputFiles !== undefined ? { inputFiles: blobs.inputFiles } : {}),
            weight: ts.weight
          };
        })
      );
      return {
        id: ts.id,
        name: ts.name,
        testcases,
        weight: ts.weight
      };
    })
  );

  const samples = collectSamples(problem);

  // Runtime: authoritative source is judgeConfig.runtime. Legacy problems
  // fall back to Problem.timeLimitMs / memoryLimitMb.
  const runtime: Runtime = judgeConfig.runtime ?? {
    env: {},
    memoryLimitMb: problem.memoryLimitMb,
    timeLimitMs: problem.timeLimitMs
  };

  const subtaskStrategies: SubtaskStrategyMap = Object.fromEntries(
    problem.testcaseSets.map((ts) => [ts.id, ts.scoringStrategy])
  );

  // Hydrate every workspace file's content from S3 in parallel. Same
  // shape as before — downstream consumers (worker, judge.ts) read
  // `f.content` directly.
  const workspaceFiles: WorkspaceFileEntry[] = await Promise.all(
    problem.workspaceFiles.map(
      async (f): Promise<WorkspaceFileEntry> => ({
        content: await readWorkspaceFileBlob(f.contentKey),
        language: f.language,
        path: f.path,
        visibility: f.visibility as WorkspaceFileVisibility
      })
    )
  );

  const assessment = submission.courseAssessment;

  // Late-penalty rules live on the assessment only — contests no longer
  // carry adjustmentRules. The contest endsAt is still a useful default
  // due-by for fallback display.
  const contestEnd = submission.contestParticipation?.contest.endsAt ?? null;
  const adjustment: AdjustmentContext = {
    assessmentAdjustmentRules: assessment?.adjustmentRules as AdjustmentRules | null,
    dueAt: assessment?.dueAt ?? contestEnd,
    submittedAt: submission.createdAt
  };

  // special_env: the TA image fully owns grading. The system only hands
  // over the student files + resource limits; no testcase payload.
  const problemType = problem.type as ProblemType;
  const advanced: AdvancedModeContext | null =
    problemType === "special_env" && problem.advancedImageRef && problem.advancedImageSource
      ? {
          imageRef: problem.advancedImageRef,
          imageSource: problem.advancedImageSource as ProblemImageSource,
          resourceLimits: {
            totalTimeMs: problem.timeLimitMs,
            memoryMb: problem.memoryLimitMb
          }
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
    advanced
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
        typeof (s as { output?: unknown }).output === "string"
    )
    .map((s) => ({ input: s.input, output: s.output }));
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
  // verdictDetail is the sole source of truth for the full result blob:
  // case-by-case results, subtask scores, compiler output — they all live
  // inside it. There are no separate columns to keep in sync any more.
  const submission = await submissionRepo.complete(submissionId, {
    runtimeMs: result.runtimeMs,
    score: result.score,
    status: result.verdict,
    verdictDetail: toJsonValue(result)
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

  // Submission has direct contestId / courseAssessmentId columns now;
  // no need to traverse contestParticipation.
  if (input.contestId) {
    where.contestId = input.contestId;
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
