import { assessmentRepo, problemRepo, submissionRepo } from "@nojv/db";
import type { Prisma } from "@nojv/db";
import {
  adjustmentRulesSchema,
  judgeConfigSchema,
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  type AdjustmentRules,
  type JudgeConfig,
  type ProblemJudgeTestcase,
  type ProblemSample,
  type Runtime,
  type SubmissionDraft,
  type SubmissionMode,
} from "@nojv/core";
import { z } from "zod";

import {
  readTestcaseBlobs,
  readValidatorScriptBlob,
  readWorkspaceFileBlob,
} from "../problem/blobs";
import type { ActorContext } from "../shared/actor-context";
import { NotFoundError } from "../shared/errors";
import { canOperateOnSubmission } from "./permissions";
import { stripStaffFeedback } from "./scoring";
import type {
  AdjustmentContext,
  AdvancedModeContext,
  SubmissionJudgeContext,
  SubtaskStrategyMap,
  TestcaseSetGroup,
  WorkspaceFileEntry,
} from "./types";

export async function getSubmissionForUser(
  submissionId: string,
  userId: string,
  isAdmin: boolean,
) {
  const submission = await submissionRepo.findById(submissionId);

  if (!submission) {
    throw new NotFoundError("Submission not found.");
  }

  if (submission.userId !== userId && !isAdmin) {
    throw new NotFoundError("Submission not found.");
  }

  return submission;
}

/**
 * Thin wrapper around `submissionRepo.findById` — used by the rejudge
 * endpoint to load the submission row before the authz check. Returns
 * null on miss; callers surface a 404.
 */
export async function getSubmissionById(id: string) {
  return submissionRepo.findById(id);
}

/**
 * Full detail payload for the submission dashboard page.
 *
 * Access rule:
 *   - submission owner → always
 *   - else → delegates to `canOperateOnSubmission` (admin / contest
 *     organizer / course staff / problem author)
 *
 * Staff-only flag `viewerIsStaff` tells the UI whether to expose the
 * submitter's identity; the owner viewing their own submission doesn't
 * see that section.
 */
export async function getSubmissionDetail(actor: ActorContext, submissionId: string) {
  const submission = await submissionRepo.findByIdForDetail(submissionId);
  if (!submission) throw new NotFoundError("Submission not found.");

  const isOwner = submission.userId === actor.userId;
  const viewerIsStaff = !isOwner && (await canOperateOnSubmission(actor, submission));

  if (!isOwner && !viewerIsStaff) {
    throw new NotFoundError("Submission not found.");
  }

  const language = languageSchema.parse(submission.language);
  submissionVerdictSchema.parse(submission.status);

  // Pre-terminal submissions (queued/compiling/running) have no verdictDetail.
  const parsedResult = submissionResultSchema.safeParse(submission.verdictDetail);
  const rawResult = parsedResult.success ? parsedResult.data : null;
  // Staff-only operator messages must NEVER reach a non-staff payload — strip
  // server-side so "View Source" cannot recover them. Owners viewing their own
  // submission are NOT staff for this gate (viewerIsStaff is false when isOwner).
  const result =
    rawResult === null || viewerIsStaff ? rawResult : stripStaffFeedback(rawResult);

  return {
    id: submission.id,
    createdAt: submission.createdAt.toISOString(),
    language,
    sourceCode: submission.sourceCode,
    status: submission.status,
    score: submission.score,
    runtimeMs: submission.runtimeMs,
    memoryKb: submission.memoryKb,
    sampleOnly: submission.sampleOnly,
    result,
    problem: submission.problem,
    context: buildSubmissionContext(submission),
    submitter: viewerIsStaff
      ? { name: submission.user.name, username: submission.user.username }
      : null,
    viewerIsStaff,
  };
}

export type SubmissionContextKind = "exam" | "contest" | "assignment" | "practice";

// Derive a submission's context kind from its FK columns. A DB XOR constraint
// guarantees at most one of these context FKs is set, so the check order is
// immaterial; a row that only carries `virtualContestId` counts as practice.
export function deriveSubmissionContextKind(fks: {
  contestId: string | null;
  courseAssessmentId: string | null;
  examId: string | null;
}): SubmissionContextKind {
  if (fks.examId) return "exam";
  if (fks.contestId) return "contest";
  if (fks.courseAssessmentId) return "assignment";
  return "practice";
}

function buildSubmissionContext(submission: {
  contestId: string | null;
  contest: { id: string; title: string } | null;
  courseAssessmentId: string | null;
  courseAssessment: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
  examId: string | null;
  exam: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
}) {
  if (submission.contest) {
    return {
      kind: "contest" as const,
      contestId: submission.contest.id,
      contestTitle: submission.contest.title,
    };
  }
  if (submission.courseAssessment) {
    return {
      kind: "assignment" as const,
      assignmentId: submission.courseAssessment.id,
      assignmentTitle: submission.courseAssessment.title,
      courseId: submission.courseAssessment.course.id,
      courseTitle: submission.courseAssessment.course.title,
    };
  }
  if (submission.exam) {
    return {
      kind: "exam" as const,
      examId: submission.exam.id,
      examTitle: submission.exam.title,
      courseId: submission.exam.course.id,
      courseTitle: submission.exam.course.title,
    };
  }
  return { kind: "practice" as const };
}

export async function listUserSubmissions(userId: string) {
  const submissions = await submissionRepo.listByUser({ userId });

  return submissions.map((s) => {
    const language = languageSchema.parse(s.language);

    return {
      createdAt: s.createdAt.toISOString(),
      id: s.id,
      language,
      problemId: s.problem.id,
      problemTitle: s.problem.title,
      runtimeMs: s.runtimeMs,
      memoryKb: s.memoryKb,
      score: s.score,
      status: s.status,
      context: deriveSubmissionContextKind(s),
    };
  });
}

/**
 * How many submissions the user has made against an assignment since UTC
 * midnight. Matches the boundary used by the daily-quota gate in
 * `createQueuedSubmissionRecord` so the displayed count and the enforced
 * count agree.
 */
export async function countAssignmentSubmissionsToday(
  userId: string,
  assignmentId: string,
): Promise<number> {
  const now = new Date();
  const startOfDayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  return submissionRepo.countForUserAndAssessmentSince(userId, assignmentId, startOfDayUtc);
}

export async function listProblemSubmissions(
  userId: string,
  problemId: string,
  context?: { assignmentId: string; courseId: string } | { contestId: string },
) {
  const isAssignmentFilter = context !== undefined && "assignmentId" in context;

  const problemP = problemRepo.findById(problemId);

  const assignmentP = isAssignmentFilter
    ? assessmentRepo.findByCourseAndId(context.courseId, context.assignmentId)
    : null;

  const [problem, assignment] = await Promise.all([problemP, assignmentP]);

  if (!problem) return [];
  if (isAssignmentFilter && !assignment) return [];

  const courseAssessmentId = assignment?.id;
  const contestId =
    context !== undefined && "contestId" in context ? context.contestId : undefined;

  const submissions = await submissionRepo.listByUserAndProblem({
    problemId: problem.id,
    userId,
    statusIn: [...submissionVerdicts],
    ...(courseAssessmentId ? { courseAssessmentId } : {}),
    ...(contestId ? { contestId } : {}),
  });

  return submissions.map((s) => {
    // verdictDetail is the sole source of truth; `s.status` is validated to surface enum-column corruption.
    submissionVerdictSchema.parse(s.status);
    // Always strip staffFeedback — this surface is the user's own submission
    // history in a problem panel and never has a staff viewer.
    const result = stripStaffFeedback(submissionResultSchema.parse(s.verdictDetail));
    const language = languageSchema.parse(s.language);

    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString(),
      context: deriveSubmissionContextKind(s),
    };
  });
}

// Contest wins over assignment — a submission carrying a contestId is always
// contest-mode even if courseAssessmentId is also set.
export function deriveSubmissionMode(s: {
  contestId: string | null;
  courseAssessmentId: string | null;
}): SubmissionMode {
  if (s.contestId) return "contest";
  if (s.courseAssessmentId) return "assignment";
  return "practice";
}

// ─────────────────────────────────────────────────────────────────────────
// Judge context — sandbox-bound read assembled for the worker.
// ─────────────────────────────────────────────────────────────────────────

const inputFileKeysSchema = z.record(z.string(), z.string());

const DEFAULT_JUDGE_CONFIG: JudgeConfig = { type: "standard" };

function parseJudgeConfig(raw: unknown, submissionId: string): JudgeConfig {
  if (raw == null) return DEFAULT_JUDGE_CONFIG;
  const result = judgeConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[submission.queries] Invalid judgeConfig for submission ${submissionId}; falling back to default.`,
    result.error.issues,
  );
  return DEFAULT_JUDGE_CONFIG;
}

function parseAdjustmentRules(raw: unknown, submissionId: string): AdjustmentRules | null {
  if (raw == null) return null;
  const result = adjustmentRulesSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[submission.queries] Invalid adjustmentRules on assignment for submission ${submissionId}; ignoring.`,
    result.error.issues,
  );
  return null;
}

function parseInputFileKeys(raw: unknown, testcaseId: string): Record<string, string> | null {
  if (raw == null) return null;
  const result = inputFileKeysSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[submission.queries] Invalid inputFileKeys for testcase ${testcaseId}; treating as empty.`,
    result.error.issues,
  );
  return null;
}

/** Derive whether this submission runs in standard or advanced (custom-image) sandbox mode. */
export function deriveJudgeMode(
  context: Pick<SubmissionJudgeContext, "problemType" | "advanced">,
): "standard" | "advanced" {
  return context.problemType === "special_env" && context.advanced !== null
    ? "advanced"
    : "standard";
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

  const assignment = submission.courseAssessment;

  // Adjustment rules are assignment-only; contest endsAt is a fallback due-by.
  const contestEnd = submission.contestParticipation?.contest.endsAt ?? null;
  const adjustment: AdjustmentContext = {
    assignmentAdjustmentRules: assignment
      ? parseAdjustmentRules(assignment.adjustmentRules, submissionId)
      : null,
    dueAt: assignment?.dueAt ?? contestEnd,
    finalDay: assignment?.closesAt ?? contestEnd,
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

  const [checkerScript, interactorScript] = await Promise.all([
    judgeConfig.checkerKey
      ? readValidatorScriptBlob(judgeConfig.checkerKey)
      : Promise.resolve(null),
    judgeConfig.interactorKey
      ? readValidatorScriptBlob(judgeConfig.interactorKey)
      : Promise.resolve(null),
  ]);

  return {
    adjustment,
    checkerScript,
    interactorScript,
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

export async function listForRejudge(input: {
  problemId: string;
  contestId?: string;
  assignmentId?: string;
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
  if (input.assignmentId) {
    where.courseAssessmentId = input.assignmentId;
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
