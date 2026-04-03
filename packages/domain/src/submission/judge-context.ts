import { submissionRepo } from "@nojv/db";
import type { Prisma } from "@nojv/db";
import type {
  JudgeConfig,
  JudgeType,
  NetworkAccessConfig,
  PipelineConfig,
  ProblemJudgeTestcase,
  SubmissionDraft,
  SubmissionResult,
  SubmissionType
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";

// --- Types ---

export interface TestcaseSetGroup {
  id: string;
  isHidden: boolean;
  name: string;
  testcases: ProblemJudgeTestcase[];
  weight: number;
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

  return {
    artifactPatterns: judgeConfig.artifacts?.patterns ?? [],
    checkerScript: judgeConfig.checkerScript ?? null,
    interactorScript: judgeConfig.interactorScript ?? null,
    judgeType: judgeConfig.type,
    memoryLimitMb: problem.memoryLimitMb,
    networkAccessConfig: judgeConfig.networkAccess ?? null,
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
    timeLimitMs: problem.timeLimitMs
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
    verdictDetail: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
    ...(result.subtaskResults
      ? {
          subtaskResults: JSON.parse(
            JSON.stringify(result.subtaskResults)
          ) as Prisma.InputJsonValue
        }
      : {}),
    ...(result.pipelineResult
      ? {
          pipelineResult: JSON.parse(
            JSON.stringify(result.pipelineResult)
          ) as Prisma.InputJsonValue
        }
      : {}),
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
      // SubmissionDraft still uses problemSlug field name (core schema rename pending)
      problemSlug: s.problemId,
      sampleOnly: s.sampleOnly,
      sourceCode: s.sourceCode
    }
  }));
}
