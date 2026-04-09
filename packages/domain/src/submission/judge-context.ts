import { submissionRepo } from "@nojv/db";
import type { Prisma } from "@nojv/db";
import type {
  JudgeConfig,
  JudgeType,
  NetworkAccessConfig,
  PipelineConfig,
  ProblemImageSource,
  ProblemJudgeTestcase,
  ProblemMode,
  SubmissionDraft,
  SubmissionResult,
  SubmissionType
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { toJsonValue } from "../shared/to-json-value";

// --- Types ---

export interface TestcaseSetGroup {
  id: string;
  isHidden: boolean;
  name: string;
  testcases: ProblemJudgeTestcase[];
  weight: number;
}

export interface AdvancedModeContext {
  imageRef: string;
  imageSource: ProblemImageSource;
  resourceLimits: {
    totalTimeMs: number;
    memoryMb: number;
    networkEnabled: boolean;
  };
}

export interface SubmissionJudgeContext {
  artifactPatterns: string[];
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: JudgeType;
  memoryLimitMb: number;
  networkAccessConfig: NetworkAccessConfig | null;
  pipelineConfig: PipelineConfig | null;
  problemId: string;
  scoringLanguage: string | null;
  scoringScript: string | null;
  submissionType: SubmissionType;
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[];
  testcaseSets: TestcaseSetGroup[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs: number;
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
    isHidden: ts.isHidden,
    name: ts.name,
    testcases: ts.testcases.map((testcase) => ({
      expectedStdout: testcase.expectedStdout ?? undefined,
      id: testcase.id,
      inputFiles: (testcase.inputFiles as Record<string, string> | null) ?? undefined,
      isHidden: ts.isHidden,
      stdin: testcase.stdin,
      weight: ts.weight
    })),
    weight: ts.weight
  }));

  // Phase 7: surface advanced-mode container config when the problem is in
  // advanced mode. We default to safe limits if the schema columns are unset.
  const mode: ProblemMode = problem.mode ?? "standard";
  const advanced: AdvancedModeContext | null =
    mode === "advanced" && problem.advancedImageRef && problem.advancedImageSource
      ? {
          imageRef: problem.advancedImageRef,
          imageSource: problem.advancedImageSource as ProblemImageSource,
          resourceLimits: {
            totalTimeMs: 30_000,
            memoryMb: 1_024,
            networkEnabled: false
          }
        }
      : null;

  return {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- phase-2 rewrite
    artifactPatterns: judgeConfig.artifacts?.patterns ?? [],
    checkerScript: judgeConfig.checkerScript ?? null,
    interactorScript: judgeConfig.interactorScript ?? null,
    judgeType: judgeConfig.type,
    memoryLimitMb: problem.memoryLimitMb,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- phase-2 rewrite
    networkAccessConfig: judgeConfig.networkAccess ?? null,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- phase-2 rewrite
    pipelineConfig: (judgeConfig.pipeline as PipelineConfig | undefined) ?? null,
    problemId: submission.problemId,
    scoringLanguage: judgeConfig.scoring?.language ?? null,
    scoringScript: judgeConfig.scoring?.script ?? null,
    submissionType: problem.submissionType,
    templates: problem.templates.map((t) => ({
      driverCode: t.driverCode,
      insertionMarker: t.insertionMarker,
      language: t.language,
      templateCode: t.templateCode
    })),
    testcaseSets,
    testcases: testcaseSets.flatMap((ts) => ts.testcases),
    timeLimitMs: problem.timeLimitMs,
    mode,
    advanced
  };
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
    ...(result.subtaskResults ? { subtaskResults: toJsonValue(result.subtaskResults) } : {}),
    ...(result.pipelineResult ? { pipelineResult: toJsonValue(result.pipelineResult) } : {}),
    ...(result.artifactPaths ? { artifactPaths: result.artifactPaths } : {})
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
