import { Prisma, submissionRepo } from "@nojv/db";
import {
  adjustmentRulesSchema,
  type AdjustmentRules,
  type Runtime,
  type SubmissionJudgeDraft,
} from "@nojv/core";
import { assertStorageObjectPointer } from "@nojv/storage";
import {
  parsePointerMap,
  readValidatorScriptBlob,
  readWorkspaceFileBlob,
} from "../problem/blobs";
import {
  parsePersistedAdvancedConfig,
  parsePersistedJudgeConfig,
} from "../problem/judge-config";
import { buildProblemSamples } from "../problem/details";
import { IntegrityError, NotFoundError } from "../shared/errors";
import type {
  AdjustmentContext,
  AdvancedModeContext,
  PinnedJudgeContext,
  PinnedJudgeTestcase,
  SubmissionJudgeContext,
  WorkspaceFileEntry,
} from "./types";

function parseAdjustmentRules(raw: unknown, submissionId: string): AdjustmentRules | null {
  if (raw == null) return null;
  const result = adjustmentRulesSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new IntegrityError(
    `Invalid adjustmentRules for submission ${submissionId}: ${result.error.issues
      .map((issue) => issue.path.join(".") || issue.code)
      .join(", ")}`,
  );
}

export function deriveJudgeMode(
  context: Pick<SubmissionJudgeContext, "problemType" | "advanced">,
): "standard" | "advanced" {
  if (context.problemType !== "special_env") return "standard";
  if (context.advanced === null)
    throw new IntegrityError("Advanced judge configuration is missing.");
  return "advanced";
}

export async function getJudgeContext(submissionId: string): Promise<PinnedJudgeContext> {
  const submission = await submissionRepo.findByIdWithJudgeContext(submissionId);

  if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);

  const { problem } = submission;
  const judgeConfig = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);
  if (judgeConfig.type === "checker" && !judgeConfig.checkerLanguage) {
    throw new IntegrityError(
      `Problem ${problem.id}: checkerLanguage is required to judge a submission.`,
    );
  }
  if (judgeConfig.type === "interactive" && !judgeConfig.interactorLanguage) {
    throw new IntegrityError(
      `Problem ${problem.id}: interactorLanguage is required to judge a submission.`,
    );
  }

  const testcaseSets: PinnedJudgeContext["testcaseSets"] = problem.testcaseSets.map((ts) => ({
    id: ts.id,
    name: ts.name,
    weight: ts.weight,
    testcases: ts.testcases.map((testcase): PinnedJudgeTestcase => {
      const inputFiles = parsePointerMap(testcase.inputFileStorage);
      return {
        id: testcase.id,
        input: assertStorageObjectPointer(testcase.inputStorage),
        ...(testcase.outputStorage !== null
          ? { output: assertStorageObjectPointer(testcase.outputStorage) }
          : {}),
        ...(inputFiles ? { inputFiles } : {}),
        weight: ts.weight,
      };
    }),
  }));

  const samples = buildProblemSamples(problem);

  const runtime: Runtime = {
    env: judgeConfig.runtime?.env ?? {},
    memoryLimitMb: problem.memoryLimitMb,
    timeLimitMs: problem.timeLimitMs,
  };

  const workspaceFiles: WorkspaceFileEntry[] = await Promise.all(
    problem.workspaceFiles.map(async (f): Promise<WorkspaceFileEntry> => ({
      content: await readWorkspaceFileBlob(f.contentStorage),
      language: f.language,
      path: f.path,
      visibility: f.visibility,
    })),
  );

  const assignment = submission.assessment;

  const context = assignment ?? submission.exam;
  const adjustment: AdjustmentContext = {
    adjustmentRules: context
      ? parseAdjustmentRules(context.adjustmentRules, submissionId)
      : null,
    dueAt: context?.dueAt ?? null,
    submittedAt: submission.createdAt,
  };

  const problemType = problem.type;
  const advancedConfig = parsePersistedAdvancedConfig(problem.advancedConfig, problem.id);
  if (problem.type === "special_env" && advancedConfig === null) {
    throw new IntegrityError(
      `Problem ${problem.id}: advancedConfig is required to judge a submission.`,
    );
  }
  const advanced: AdvancedModeContext | null =
    problemType === "special_env" && advancedConfig !== null
      ? {
          config: advancedConfig,
          requiredPaths: problem.advancedRequiredPaths,
          resourceLimits: {
            totalTimeMs: problem.timeLimitMs,
            memoryMb: problem.memoryLimitMb,
          },
        }
      : null;

  const [checkerScript, interactorScript] = await Promise.all([
    problem.checkerStorage
      ? readValidatorScriptBlob(problem.checkerStorage)
      : Promise.resolve(null),
    problem.interactorStorage
      ? readValidatorScriptBlob(problem.interactorStorage)
      : Promise.resolve(null),
  ]);

  return {
    adjustment,
    checkerScript,
    checkerLanguage: judgeConfig.checkerLanguage ?? null,
    interactorScript,
    interactorLanguage: judgeConfig.interactorLanguage ?? null,
    compareOptions: judgeConfig.compare ?? null,
    judgeType: judgeConfig.type,
    runtime,
    samples,
    problemType,
    testcaseSets,
    workspaceFiles,
    advanced,
  };
}

const IN_FLIGHT_SUBMISSION_STATUSES = [
  "pending_upload",
  "queued",
  "compiling",
  "running",
] as const;

export async function listForRejudge(input: {
  problemId: string;
  contestId?: string;
  assignmentId?: string;
  examId?: string;
  userIds?: string[];
  since?: Date;
  until?: Date;
}): Promise<
  {
    submissionId: string;
    studentId: string;
    judgeGeneration: number;
    draft: SubmissionJudgeDraft;
  }[]
> {
  const where: Prisma.SubmissionWhereInput = {
    problemId: input.problemId,
    sampleOnly: false,
    isReferenceSolution: false,
    status: { notIn: [...IN_FLIGHT_SUBMISSION_STATUSES] },
    sourceStorage: { not: Prisma.DbNull },
  };

  if (input.contestId) {
    where.contestId = input.contestId;
  }
  if (input.assignmentId) {
    where.assessmentId = input.assignmentId;
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
    studentId: s.userId,
    judgeGeneration: s.judgeGeneration,
    draft: {
      language: s.language,
      problemId: s.problemId,
      sampleOnly: s.sampleOnly,
    },
  }));
}

export async function findOneForRejudge(
  submissionId: string,
): Promise<{ submissionId: string; studentId: string; draft: SubmissionJudgeDraft } | null> {
  const submission = await submissionRepo.findById(submissionId);
  if (!submission) return null;
  if (submission.isReferenceSolution) return null;
  if ((IN_FLIGHT_SUBMISSION_STATUSES as readonly string[]).includes(submission.status)) {
    return null;
  }
  return {
    submissionId: submission.id,
    studentId: submission.userId,
    draft: {
      language: submission.language,
      problemId: submission.problemId,
      sampleOnly: submission.sampleOnly,
    },
  };
}
